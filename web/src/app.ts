// The page, put together: the emulator and its clock, the screen, the sound, the keyboards and joysticks, the tape
// deck, the library and the game in the machine, rewinding, save slots, and the settings. Every part is made
// elsewhere; this decides how they meet.

import { FrameScheduler, type Speed } from './clock/scheduler';
import { Loop } from './clock/loop';
import { MODELS, LoadError, type Emulator, type LoadResult, type Model, type SnapshotFormat } from './emulator/emulator';
import { CAPS_SHIFT, ENTER, KEY, SPACE, SYMBOL_SHIFT } from './emulator/keys';
import { KeyFeeder } from './input/feeder';
import { readGamepads } from './input/gamepad';
import { arrowsAreJoystick, type Mapping } from './input/keymap';
import { PadKeys } from './input/padkeys';
import { listenToKeyboard } from './input/pc-keyboard';
import { BOOT_FRAMES_MAX, loadKeys, romReady } from './input/typer';
import { createKeyboard } from './keyboard/keyboard';
import { choose, Unloadable } from './library/choose';
import { fetchManual, type Manual } from './library/manual';
import { isByHand, type GameCard } from './library/card';
import { cardFor } from './library/games';
import { screenOf, StartPilot, type StartChoice } from './library/start';
import { archiveUrl, fetchArchive, fetchEntry, type ZxEntry } from './library/zxinfo';
import { LIFT_128, Sound } from './audio/sound';
import { coloursOf, Rewind, type Moment } from './state/rewind';
import { Saves, thumbnailOf, type Slot } from './state/saves';
import { loadSettings, saveSettings, type Settings } from './state/settings';
import { button, segmented } from './ui/controls';
import { createDeck, PLAIN_SHELL, type Shell } from './ui/deck';
import { byId, download, h, s } from './ui/dom';
import { createGamePanel, type GameInfo, type StartState } from './ui/game';
import { createHelp } from './ui/help';
import { controlsNow, fallbackHowTo, modeOf, type Hands, type HowTo } from './ui/howto';
import { icon } from './ui/icons';
import { createInspector } from './ui/inspector';
import { createLibrary, SHELF } from './ui/library';
import { createOsd } from './ui/osd';
import { createOverlay, rememberDismissed, wasDismissed } from './ui/overlay';
import { createSettings } from './ui/settings';
import { createTapeBar } from './ui/tapebar';
import { createTimeline } from './ui/timeline';
import { toast, type Toast } from './ui/toast';
import { createTouchPad } from './ui/touch';
import { CROPS, fit } from './video/fit';
import { palette as paletteById } from './video/palette';
import type { Renderer } from './video/renderer';
import { STRIPE, WIDTH as KEYBOARD_WIDTH } from './keyboard/keyboard';

/** What a loading tape is waiting for, when the page loads it by itself: the ROM to be ready for keys, then the keys typed. */
type AutoLoad = { stage: 'boot'; since: number } | { stage: 'typing'; until: number } | null;

/** The game in the machine, which its save slots belong to: one from the library, or a file. */
interface Game {
  readonly key: string;
  readonly title: string;
  readonly entry?: ZxEntry;
}

export interface AppParts {
  readonly emulator: Emulator;
  readonly kind: 'wasm' | 'stub';
  readonly renderer: Renderer;
  readonly canvas: HTMLCanvasElement;
  /** False: the page never asks for the sound card (?sound=off), and runs on the display's clock alone. */
  readonly sound?: boolean;
}

/** The largest file the page takes: no Spectrum file comes near it (the machine refuses past it too). */
export const MAX_FILE = 16 << 20;

/** The cassettes games came on, where they were not the plain black of most: Durell's genuine Saboteur was blue, DURELL pressed into it. */
const SHELLS: Readonly<Record<string, Shell>> = {
  '0004293': { colour: '#1d4d9a', embossed: 'DURELL', rainbow: false },
};

/** How long the controls stay over the screen when play begins: eight seconds of the game. */
const CONTROLS_FRAMES = 400;
/** How long a game started by hand has run, its tape stopped, before its steps and controls show by themselves. */
const LOADED_FRAMES = 150;

const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, '0');
const SLOT_NAMES = ['the quick slot', 'slot 1', 'slot 2', 'slot 3'];
/** Where the page remembers which game a snapshot it saved was of, so that opening the file again brings the game back. */
const SNAPSHOTS_KEY = 'zx-spectrum.snapshots';

export class App {
  readonly emulator: Emulator;
  readonly renderer: Renderer;
  readonly settings: Settings;
  readonly scheduler: FrameScheduler;
  readonly loop: Loop;
  readonly feeder: KeyFeeder;
  readonly rewind = new Rewind();
  readonly saves = new Saves();
  sound: Sound | null = null;
  /** Frames of the machine's history: frames run, less those undone by going back. */
  history = 0;
  /** A program has been loaded since the machine was switched on (the keyboard is then for games, when automatic). */
  programLoaded = false;
  /** The name of what is loaded, for a snapshot's file name. */
  programName = 'spectrum';
  /** The game in the machine, if any. */
  game: Game | null = null;
  /** Why the machine stopped (something threw in a frame), while it waits to be started again. */
  broken: string | null = null;
  private userSpeed: Speed = 1;
  private autoLoad: AutoLoad = null;
  /** The tape in the deck is to load fast, whatever the loading style (Load it fast, for this tape). */
  private fastLoad = false;
  /** The library's game being fetched. */
  private picking: { id: string; abort: AbortController } | null = null;
  private fetching: Toast | null = null;
  private preview: Moment | null = null;
  /** Whether the emulator's states hold their pictures (the real core's do): then moments keep none of their own. */
  private statePictures: boolean | null = null;
  /** Pictures of moments read back from their states, the latest few, for scrubbing back and forth. */
  private pictures = new Map<Moment, Uint8Array>();
  /** The tape in the deck as it came, for a save slot to keep with the game. */
  private tapeFile: { game: string; name: string; bytes: Uint8Array } | null = null;
  /** And whatever tape went in last, to put back if the machine has to be started again. */
  private lastTape: { name: string; bytes: Uint8Array } | null = null;
  /** What a SAVE recorded last, kept across a reset until another replaces it. */
  private saved: Uint8Array = new Uint8Array(0);
  private savedSeen = 0;
  /** Starting the game: asked for (waiting for its first screen), or being driven. */
  private startWanted: StartChoice | null = null;
  private pilot: StartPilot | null = null;
  private startShown: StartState | null = null;
  /** How the person means to play the game in the machine: the joystick (the default) or its keys. */
  private playChoice: StartChoice = { joystick: true, skill: 1 };
  /** Whether the game's card says play is on the screen, as last looked (null: not looked since the machine jumped). */
  private inPlay: boolean | null = false;
  /** The frame the controls over the screen go at, when they showed by themselves (they stay while paused). */
  private controlsUntil = 0;
  /** The controls have shown by themselves for the game in the machine: once a game, unless its Start button is pressed. */
  private controlsShown = false;
  /** A game started by hand: the frame its tape was first seen stopped with the program running; null: not yet. */
  private loadedAt: number | null = null;
  /** The manual's table of keys, for the controls of a game with no card. */
  private manualTable: Manual['table'] = null;
  private gamepad = false;
  /** The page's joystick onto the game's keys, for a game whose card has a key map. */
  readonly padKeys: PadKeys;
  /** Something the person would lose has happened (a key typed, a program loaded): closing the tab asks first. */
  private touched = false;
  private newFrame = true;
  private keyBits = 0;
  private touchBits = 0;
  private padBits = 0;
  private padEnter = false;
  private padSpace = false;
  private lastJoystick = '';
  private sampleRate = 0;
  private wasAudio = false;
  private startingSound = false;
  private lit = new Uint8Array(40);
  /** When the last drawn key goes up (a latched shift goes up with it). */
  private drawnUntil = 0;
  private ambient = [0, 0, 0];
  private calmFrame: Uint8Array | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private readonly kind: 'wasm' | 'stub';
  private readonly soundAllowed: boolean;
  private readonly touchFirst = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  private keyboardView!: ReturnType<typeof createKeyboard>;
  private deck!: ReturnType<typeof createDeck>;
  private tapeBar!: ReturnType<typeof createTapeBar>;
  private osd!: ReturnType<typeof createOsd>;
  private overlay!: ReturnType<typeof createOverlay>;
  private timeline!: ReturnType<typeof createTimeline>;
  private library!: ReturnType<typeof createLibrary>;
  private gamePanel!: ReturnType<typeof createGamePanel>;
  private settingsPanel!: ReturnType<typeof createSettings>;
  private help!: ReturnType<typeof createHelp>;
  private inspector!: ReturnType<typeof createInspector>;
  private speedControl!: ReturnType<typeof segmented<string>>;
  private displayControl!: ReturnType<typeof segmented<string>>;
  private modelChip!: HTMLButtonElement;
  private keysChip!: HTMLElement;
  private soundButton!: HTMLButtonElement;
  private pauseButton!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private screenWrap!: HTMLElement;
  private mainCol!: HTMLElement;
  private side!: HTMLElement;
  private veil!: HTMLElement;
  private stoppedCard!: HTMLElement;
  private reader!: HTMLElement;

  constructor(parts: AppParts) {
    this.emulator = parts.emulator;
    this.kind = parts.kind;
    this.soundAllowed = parts.sound !== false;
    this.renderer = parts.renderer;
    this.settings = loadSettings();
    this.scheduler = new FrameScheduler(this.emulator.frameRate);
    this.feeder = new KeyFeeder((code, down) => this.emulator.key(code, down));
    this.padKeys = new PadKeys(this.feeder);
    this.loop = new Loop(this.scheduler, {
      runFrame: () => this.runFrame(),
      present: (now) => this.present(now),
      now: () => performance.now(),
      failed: (e) => this.fail(e),
    });
    if (this.emulator.model !== this.settings.model) this.emulator.setModel(this.settings.model);
    this.applyOptions();
    this.build(parts.canvas);
    this.applyView();
    this.listen();
    this.warmUp();
    this.loop.start();
    this.openLink();
  }

  // --- The machine's frames ----------------------------------------------------------------------------------------

  private runFrame(): void {
    // Paused (a breakpoint reached part way through a refresh's frames, flat out), or stopped: nothing more until it goes on.
    if (this.scheduler.speed === 'pause' || this.broken) return;
    const emu = this.emulator;
    this.drivePilot();
    // The page's joystick: the arrows and the fire key, the touch pad and a gamepad together. For a game whose card has
    // a key map (it takes no joystick), they press its keys instead, and the joystick itself is left at rest.
    const pressed = this.keyBits | this.touchBits | this.padBits;
    this.padKeys.update(pressed, emu.frameCount);
    this.feeder.tick(emu.frameCount);
    // The joystick, told only of a change (of its bits, or of the interface; a power-on unplugs it, afterReset).
    const kind = this.settings.joystick;
    const bits = kind === 'none' || this.padKeys.keymap ? 0 : pressed;
    const joystick = `${kind}:${bits}`;
    if (joystick !== this.lastJoystick) {
      emu.joystick(kind, bits);
      this.lastJoystick = joystick;
    }
    // Sound is made only when it is to be played: not before the sound card is allowed, nor flat out.
    const audio = !!this.sound && this.scheduler.audioLed;
    if (this.wasAudio && !audio && this.sound) {
      // Off to run flat out: what is queued is let go, and counted afresh when the sound comes back (no underrun).
      this.sound.clear();
      this.scheduler.setAudio(this.audioRate());
      this.sampleRate = 0;
    }
    this.wasAudio = audio;
    emu.setSound(audio);
    if (audio) {
      const rate = this.scheduler.sampleRate() ?? 0;
      if (rate !== this.sampleRate) {
        emu.setSampleRate(rate);
        this.sampleRate = rate;
      }
    }
    emu.runFrame();
    this.newFrame = true;
    if (emu.breakpoint !== null) {
      this.stopAt(emu.breakpoint);
      return;
    }
    this.history++;
    if (audio && this.sound) {
      const samples = emu.audio();
      this.sound.send(samples);
      this.scheduler.sentSamples(samples.length / 2);
    }
    // While flat out (a tape loading fast) a moment every five seconds rather than every half: they are the loading's.
    if (this.rewind.due(this.history, this.scheduler.speed === 'max' ? this.rewind.every * 10 : this.rewind.every)) this.keepMoment();
    this.stepAutoLoad();
    if (emu.tape.state().playing && !this.programLoaded) {
      this.programLoaded = true;
      // The set grows from the desk to the room's size, now that a program runs.
      this.resize();
    }
    if (this.history % 50 === 0) this.checkSaved();
    this.scheduler.speed = this.effectiveSpeed();
  }

  /** Flat out while the machine boots for a tape, and while a tape plays if it is to load fast (silent then). */
  private effectiveSpeed(): Speed {
    if (this.preview || this.broken) return 'pause';
    if (this.autoLoad?.stage === 'boot') return 'max';
    if (this.userSpeed !== 'pause' && (this.settings.loading !== 'authentic' || this.fastLoad) && this.emulator.tape.state().playing) return 'max';
    return this.userSpeed;
  }

  private setSpeed(speed: Speed): void {
    this.userSpeed = speed;
    this.speedControl.set(String(speed));
    this.scheduler.speed = this.effectiveSpeed();
  }

  togglePause(): void {
    this.setSpeed(this.userSpeed === 'pause' ? 1 : 'pause');
  }

  private stepAutoLoad(): void {
    const a = this.autoLoad;
    if (!a) return;
    const now = this.emulator.frameCount;
    // Typed once the ROM reads the keys: the 48K's copyright on its bottom line, or the 128's menu on the screen.
    if (a.stage === 'boot' && (now - a.since >= BOOT_FRAMES_MAX || romReady(this.emulator.screenText(), MODELS[this.emulator.model].menu))) {
      const until = this.feeder.type(loadKeys(this.emulator.model), now);
      this.autoLoad = { stage: 'typing', until: until + 2 };
    } else if (a.stage === 'typing' && now >= a.until) {
      // With the motor left to the machine, the ROM has started the tape already; otherwise start it.
      if (!this.settings.autoTape) this.emulator.tape.play();
      this.autoLoad = null;
    }
  }

  /** A breakpoint: the machine waits, and the inspector shows where. */
  private stopAt(pc: number): void {
    this.setSpeed('pause');
    toast(`Stopped at the breakpoint at ${hex4(pc)}.`);
    if (!this.settingsPanel.el.open) this.openSettings();
    this.inspector.el.scrollIntoView({ block: 'nearest' });
  }

  /** One instruction, from the inspector: the machine paused, a frame it ends shown and counted, a breakpoint said. */
  private stepOne(): void {
    if (this.broken) return;
    if (this.userSpeed !== 'pause') this.setSpeed('pause');
    this.feeder.tick(this.emulator.frameCount);
    const did = this.emulator.step();
    this.newFrame = true;
    if (did === 'frame') {
      this.history++;
      if (this.rewind.due(this.history)) this.keepMoment();
    } else if (did === 'breakpoint') toast(`At the breakpoint at ${hex4(this.emulator.registers().pc)}.`);
  }

  /** What a SAVE has recorded, looked at now and then: a new recording is offered to download. */
  private checkSaved(): void {
    const tap = this.emulator.savedTap();
    if (!tap.length || tap.length === this.savedSeen) return;
    this.savedSeen = tap.length;
    this.saved = tap;
    let blocks = 0;
    for (let i = 0; i + 2 <= tap.length; i += 2 + (tap[i] | (tap[i + 1] << 8))) blocks++;
    this.deck.setSaved(blocks, tap.length);
  }

  // --- Starting a game ---------------------------------------------------------------------------------------------

  /** The play card of the game in the machine, where the shelf has one (library/games/). */
  card(): GameCard | null {
    return cardFor(this.game?.entry?.id);
  }

  /** The game from its first screen to playing, the keys pressed for the person (now, or when that screen shows). */
  startGame(choice: StartChoice): void {
    const card = this.card();
    if (!card || isByHand(card.start) || this.broken) return;
    this.startSound();
    this.touched = true;
    this.playChoice = choice;
    // The game is told to take a Kempston joystick: the page's has to be one.
    if (choice.joystick && card.joystick && this.settings.joystick !== 'kempston') this.change({ joystick: 'kempston' });
    this.pilot = null;
    this.startWanted = choice;
    if (this.userSpeed === 'pause') this.setSpeed(1);
    this.showStart('armed');
  }

  /** Before each frame: the start asked for, begun once the game's first screen shows, and its keys pressed. */
  private drivePilot(): void {
    const frame = this.emulator.frameCount;
    const route = this.card()?.start;
    if (this.startWanted && route && frame % 5 === 0 && route.ready(screenOf(this.emulator))) {
      this.pilot = new StartPilot(route, this.startWanted, frame);
      this.startWanted = null;
      this.showStart('driving');
    }
    const pilot = this.pilot;
    if (!pilot) return;
    const press = pilot.tick(frame, () => screenOf(this.emulator));
    if (press) {
      this.feeder.hold('pilot', [press.code], press.from, 'free');
      this.feeder.release('pilot', press.until);
    }
    if (pilot.state !== 'driving') {
      this.pilot = null;
      this.showStart(pilot.state);
      if (pilot.state === 'done') this.playBegins(true);
    }
  }

  /**
   * Play has begun (`started`: the Start button got there; or the person started it): the controls over the screen for a
   * few seconds, the first time for this game (or whenever the Start button is pressed), unless they were closed before.
   */
  private playBegins(started = false): void {
    this.inPlay = true;
    const game = this.game;
    if (!game || (this.controlsShown && !started)) return;
    this.controlsShown = true;
    if (wasDismissed(game.key)) {
      const again = this.touchFirst ? 'The Controls button on the set' : 'F3';
      const card = this.card();
      toast(card && isByHand(card.start) ? `${game.title} has loaded. ${again} shows how to start it, and its controls.` : `${game.title}: you are playing. ${again} shows the controls.`);
      return;
    }
    this.showControls(true);
  }

  /** How the joystick reaches the person: the fire key, a touch screen, a gamepad. */
  private hands(): Hands {
    return { fireCode: this.settings.fireKey, touch: this.touchFirst, gamepad: this.gamepad };
  }

  /** What the controls over the screen say now. */
  private howTo(): HowTo {
    const card = this.card();
    return card ? controlsNow(card, { ...this.hands(), joystick: this.playChoice.joystick }) : fallbackHowTo(this.game?.entry?.controls ?? [], this.manualTable, this.hands(), !!this.game?.entry);
  }

  /** The controls over the screen: by themselves for a few seconds (`auto`), or asked for, until asked away. */
  showControls(auto = false): void {
    if (!this.game) {
      toast('Load a game first: its controls show here.');
      return;
    }
    this.overlay.show(this.howTo(), this.game.title, auto);
    this.controlsUntil = auto ? this.emulator.frameCount + CONTROLS_FRAMES : Infinity;
  }

  /** F3, or the button on the set: the controls shown, or hidden again. */
  toggleControls(): void {
    if (this.overlay.shown) this.overlay.hide();
    else this.showControls(false);
  }

  /** The way in on the picture too, while the game's first screen waits for it, saying how it will be played. */
  private promptStart(): void {
    const card = this.card();
    const way = card && modeOf(card, this.playChoice.joystick);
    this.overlay.prompt(this.startShown === 'ready' && way ? `The page answers its menus for you${way === 'Keys' ? '' : `, and you play with ${this.touchFirst ? 'the pad and FIRE' : 'the arrow keys'}`}.` : null);
  }

  private showStart(state: StartState): void {
    if (state === this.startShown) return;
    this.startShown = state;
    this.gamePanel.startState(state);
    this.promptStart();
  }

  // --- Rewinding ---------------------------------------------------------------------------------------------------

  private keepMoment(): void {
    const emu = this.emulator;
    // The picture's colours first: any later call may grow the module's memory, which leaves a view of it empty.
    const colours = coloursOf(emu.frame());
    const state = emu.saveState();
    // Asked once: whether a state can show its picture again, or the picture has to be kept beside it.
    this.statePictures ??= emu.statePicture(state) !== null;
    this.rewind.add({ frame: this.history, state, colours, picture: this.statePictures ? undefined : emu.frame().slice() });
  }

  /** A moment's picture: kept with it, or read back from its state (and kept a while, for scrubbing). */
  private pictureOf(m: Moment): Uint8Array | null {
    if (m.picture) return m.picture;
    let p = this.pictures.get(m);
    if (!p) {
      p = this.emulator.statePicture(m.state) ?? undefined;
      if (!p) return null;
      this.pictures.set(m, p);
      if (this.pictures.size > 8) this.pictures.delete(this.pictures.keys().next().value as Moment);
    }
    return p;
  }

  /** Back to a moment kept for rewinding. */
  goBack(index: number): void {
    const m = this.rewind.goBack(index);
    if (!m) return;
    this.emulator.loadState(m.state);
    this.history = m.frame;
    this.afterJump();
  }

  /** After the machine was put somewhere else in time (a moment, a save slot): nothing stale is played or pressed. */
  private afterJump(): void {
    this.scheduler.frameRate = this.emulator.frameRate; // the moment may be of another model
    this.modelChip.textContent = MODELS[this.emulator.model].short;
    this.feeder.clear();
    this.autoLoad = null;
    this.pilot = null;
    this.startWanted = null;
    this.startShown = null;
    this.overlay?.prompt(null);
    this.padKeys.forget();
    // Somewhere else in the game: play is looked for afresh, and its beginning not taken for news.
    this.inPlay = null;
    // The state has its own joystick interface (or none): the page's is told again.
    this.lastJoystick = '';
    this.sound?.clear();
    this.scheduler.setAudio(this.audioRate());
    this.sampleRate = 0;
    this.newFrame = true;
    this.applyLevel();
  }

  // --- The display -------------------------------------------------------------------------------------------------

  private present(_now: number): void {
    const pad = readGamepads();
    this.padBits = pad.bits;
    if (pad.present !== this.gamepad) {
      // A gamepad plugged in or out: the controls say so.
      this.gamepad = pad.present;
      this.gamePanel.hands(this.hands());
      this.overlay.update(this.howTo(), this.game?.title ?? '');
    }
    if (pad.enter !== this.padEnter) {
      this.padEnter = pad.enter;
      if (pad.enter) this.feeder.hold('pad-enter', [ENTER], this.emulator.frameCount, 'free');
      else this.feeder.release('pad-enter', this.emulator.frameCount);
    }
    if (pad.space !== this.padSpace) {
      this.padSpace = pad.space;
      if (pad.space) this.feeder.hold('pad-space', [SPACE], this.emulator.frameCount, 'free');
      else this.feeder.release('pad-space', this.emulator.frameCount);
    }
    if (this.broken) return;
    this.scheduler.speed = this.effectiveSpeed();
    const tape = this.emulator.tape.state();

    if (this.preview) {
      // While choosing a moment to go back to, its picture is shown, and the machine waits.
    } else if (this.newFrame) {
      const frame = this.emulator.frame();
      this.renderer.draw(this.calm(tape.playing) ? this.calmed(frame) : frame);
      this.newFrame = false;
      this.glow(this.emulator.frame());
    }
    if (!this.preview) this.osd.show(this.userSpeed === 'pause' ? { kind: 'paused' } : { kind: 'none' });
    this.deck.update();
    const barShown = this.tapeBar.shown;
    this.tapeBar.update({ title: this.game?.title ?? this.emulator.tape.blocks()[0]?.label ?? 'The tape', loading: this.autoLoad !== null, fast: this.fastLoad || this.settings.loading !== 'authentic', style: this.settings.loading });
    // Room under the screen for the tape's bar while it shows, so that it is in the window with the screen.
    if (this.tapeBar.shown !== barShown) this.resize();
    this.timeline.update();
    if (this.settingsPanel.el.open) this.inspector.update();
    for (let code = 0; code < 40; code++) {
      const on = this.feeder.isDown(code) ? 1 : 0;
      if (on !== this.lit[code]) {
        this.lit[code] = on;
        this.keyboardView.light(code, !!on);
      }
    }
    document.body.classList.toggle('loading-tape', tape.playing);
    // The card's route, now and then: whether the game's first screen is there (for the start button), and whether
    // play has begun without it (the person started the game themselves), which shows the controls.
    const card = this.card();
    if (card && isByHand(card.start)) {
      // A game started by hand: once it has loaded (its tape stopped, the program running) and run a few seconds, its
      // steps and controls show by themselves.
      const frame = this.emulator.frameCount;
      if (tape.playing || !this.programLoaded) this.loadedAt = null;
      else if (this.inPlay === false) {
        this.loadedAt ??= frame;
        if (frame - this.loadedAt >= LOADED_FRAMES) {
          this.loadedAt = null;
          this.playBegins();
        }
      }
    } else if (card && !this.pilot && this.emulator.frameCount % 25 === 0 && this.programLoaded) {
      const screen = screenOf(this.emulator);
      if (!this.startWanted && this.startShown !== 'done') this.showStart(card.start.ready(screen) ? 'ready' : this.startShown === 'gave up' ? 'gave up' : 'waiting');
      const playing = 'done' in card.start.next(screen, this.playChoice);
      if (playing && this.inPlay === false) this.playBegins();
      this.inPlay = playing;
    }
    // The controls that showed by themselves go after their few seconds of the game.
    if (this.overlay.shown && this.emulator.frameCount >= this.controlsUntil) this.overlay.hide();
  }

  /** Whether the loading stripes are drawn calmly now: asked for, or the system asks for less motion. */
  private calm(playing: boolean): boolean {
    if (!playing) return false;
    const c = this.settings.calmStripes;
    return c === 'on' || (c === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** The frame with its border in one colour, the one it shows most: the stripes without their flashing. */
  private calmed(frame: Uint8Array): Uint8Array {
    const w = this.emulator.frameWidth;
    const rows = this.emulator.frameHeight;
    const out = (this.calmFrame ??= new Uint8Array(frame.length));
    out.set(frame);
    const counts = new Uint32Array(16);
    for (let y = 0; y < rows; y += 2) {
      counts[frame[y * w + 2] & 15]++;
      counts[frame[y * w + w - 3] & 15]++;
    }
    let colour = 0;
    for (let c = 1; c < 16; c++) if (counts[c] > counts[colour]) colour = c;
    for (let y = 0; y < rows; y++) {
      const inPaper = y >= 48 && y < 240;
      if (!inPaper) out.fill(colour, y * w, (y + 1) * w);
      else {
        out.fill(colour, y * w, y * w + 48);
        out.fill(colour, y * w + 304, (y + 1) * w);
      }
    }
    return out;
  }

  /** The room lit by the television: the page's glow follows the border's colour, smoothed over a few frames. */
  private glow(frame: Uint8Array): void {
    if (!this.settings.ambient) return;
    const rgb = paletteById(this.settings.palette).rgb;
    let r = 0;
    let g = 0;
    let b = 0;
    const w = this.emulator.frameWidth;
    const rows = this.emulator.frameHeight;
    for (let y = 2; y < rows; y += 6) {
      for (const x of [4, w - 5]) {
        const c = (frame[y * w + x] & 15) * 3;
        r += rgb[c];
        g += rgb[c + 1];
        b += rgb[c + 2];
      }
    }
    const n = 2 * Math.ceil((rows - 2) / 6);
    const k = 0.18;
    this.ambient = [this.ambient[0] + (r / n - this.ambient[0]) * k, this.ambient[1] + (g / n - this.ambient[1]) * k, this.ambient[2] + (b / n - this.ambient[2]) * k];
    document.documentElement.style.setProperty('--ambient', this.ambient.map((v) => Math.round(v)).join(' '));
  }

  /** The tube warming up as the set is switched on: a line of light opening into the picture (a fade, for reduced motion). */
  private warmUp(): void {
    const c = this.renderer.canvas;
    c.classList.remove('warming');
    void c.offsetWidth; // so that the animation starts again
    c.classList.add('warming');
  }

  private resize(): void {
    const crop = CROPS[this.settings.crop];
    const rect = this.screenWrap.getBoundingClientRect();
    const phone = window.innerWidth < 760;
    // A phone held sideways (style.css's console): the screen the display's height, under the slim bar.
    const landscape = this.touchFirst && window.innerWidth > window.innerHeight && window.innerHeight < 500;
    const tv = this.settings.display === 'tv';
    const pad = tv ? (phone || landscape ? 12 : 28) : 0;
    let maxHeight = landscape ? window.innerHeight - 40 - 14 : phone ? window.innerHeight * 0.5 : window.innerHeight - 64 - 58 - 36 - (this.tapeBar?.shown ? 74 : 0);
    let maxWidth = rect.width;
    // At BASIC, nothing loaded, the keyboard's for typing: the set and the keyboard together on the desk, the keyboard
    // under it as wide as it, both in the window. Once a program runs the set is as large as the window allows.
    const desk = !phone && !landscape && this.settings.keyboard && !this.programLoaded && this.mapping() === 'natural';
    document.body.classList.toggle('desk', desk);
    if (desk) {
      const keyboardRatio = this.keyboardView.el.viewBox.baseVal.height / KEYBOARD_WIDTH || 0.47;
      // The window's height less the bar, the strip and their gaps, shared between the set (its aspect) and the keyboard.
      const aspect = tv ? (crop.width * 1.054) / crop.height : crop.width / crop.height;
      const room = window.innerHeight - 64 - 22 - 44 - 30 - 24;
      const width = Math.max(320, room / (1 / aspect + keyboardRatio));
      maxWidth = Math.min(maxWidth, width);
      maxHeight = Math.min(maxHeight, width / aspect + pad);
    }
    const size = fit(crop, this.settings.display, Math.max(64, maxWidth - pad), Math.max(64, maxHeight - pad), devicePixelRatio || 1);
    this.renderer.setSize(size);
    this.renderer.present();
    // The strip and the keyboard line up with the set.
    this.mainCol.style.setProperty('--screen-width', `${Math.round(size.cssWidth + pad)}px`);
  }

  private applyView(): void {
    const p = paletteById(this.settings.palette);
    this.renderer.setPalette(p.rgb);
    this.renderer.setView(this.settings.display, CROPS[this.settings.crop]);
    document.body.dataset.display = this.settings.display;
    if (!this.settings.ambient) document.documentElement.style.removeProperty('--ambient');
    document.body.classList.toggle('no-keyboard', !this.settings.keyboard);
    this.resize();
  }

  private applyOptions(): void {
    const s = this.settings;
    this.emulator.setOptions({ instantLoad: s.loading === 'instant', acceleratedLoad: s.loading !== 'authentic', autoTape: s.autoTape, issue2: s.issue2, ayStereo: s.ayStereo });
    this.sound?.setVolume(s.volume);
    this.sound?.setMuted(s.muted);
    this.applyLevel();
  }

  /** The 128 family's sound lifted to the 48K's loudness, when levelled. */
  private applyLevel(): void {
    this.sound?.setLevel(this.settings.levelSound && MODELS[this.emulator.model].ay ? LIFT_128 : 1);
  }

  /** Changes settings, applies them and remembers them. */
  change(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    if (patch.model && patch.model !== this.emulator.model) this.switchModel(patch.model);
    this.applyOptions();
    if ('display' in patch || 'crop' in patch || 'palette' in patch || 'ambient' in patch || 'keyboard' in patch) {
      // The switch between sharp pixels and the television: a moment's fade, not a cut.
      if ('display' in patch) this.fadeIn();
      this.applyView();
    }
    if ('palette' in patch) void this.showSlots();
    if ('calmStripes' in patch) this.newFrame = true;
    if ('joystick' in patch) this.lastJoystick = '';
    if ('fireKey' in patch) {
      this.gamePanel.hands(this.hands());
      this.overlay.update(this.howTo(), this.game?.title ?? '');
    }
    this.settingsPanel.sync({ ...this.settings, model: this.emulator.model });
    this.deck.setLoading(this.settings.loading);
    this.displayControl.set(this.settings.display);
    this.soundButton.replaceChildren(icon(this.settings.muted ? 'mute' : 'sound'));
  }

  private fadeIn(): void {
    const c = this.renderer.canvas;
    c.classList.remove('switching');
    void c.offsetWidth;
    c.classList.add('switching');
  }

  // --- What the machine is -----------------------------------------------------------------------------------------

  private switchModel(model: Model): void {
    this.emulator.setModel(model);
    this.afterReset();
    this.warmUp();
  }

  /** Off and on again. */
  reset(): void {
    if (this.broken) return;
    this.emulator.reset();
    this.afterReset();
    this.warmUp();
  }

  private afterReset(): void {
    this.feeder.clear();
    this.padKeys.forget();
    this.autoLoad = null;
    this.pilot = null;
    this.startWanted = null;
    this.startShown = null;
    this.overlay?.prompt(null);
    this.inPlay = false;
    if (this.overlay?.shown) this.overlay.hide();
    this.programLoaded = false;
    this.scheduler.frameRate = this.emulator.frameRate;
    this.sound?.clear();
    this.scheduler.setAudio(this.audioRate());
    this.sampleRate = 0;
    this.savedSeen = 0;
    // Switching on unplugs nothing, but the machine starts with no interface of its own: the page's is told again.
    this.lastJoystick = '';
    this.modelChip.textContent = MODELS[this.emulator.model].short;
    this.applyLevel();
    this.resize();
  }

  /** The keyboard's mapping now: automatic is for typing until a program is loaded, then for games. */
  mapping(): Mapping {
    if (this.settings.mapping === 'auto') return this.programLoaded ? 'positional' : 'natural';
    return this.settings.mapping;
  }

  // --- When something goes wrong in a frame ------------------------------------------------------------------------

  /**
   * Something threw while a frame ran or was shown. The machine waits, and the screen says what happened, with a way
   * to start it again: where the module trapped (its memory no longer to be trusted), a new one, put back at the last
   * moment kept, with the tape as it was.
   */
  private fail(e: unknown): void {
    console.error('The machine stopped:', e);
    if (this.broken) return;
    const why = (e as Error)?.message || String(e);
    this.broken = why;
    this.scheduler.speed = 'pause';
    this.stoppedCard.querySelector('.stopped-why')!.textContent = why;
    this.stoppedCard.hidden = false;
    this.osd.show({ kind: 'none' });
  }

  /** The machine started again after it stopped: a new module where the old one trapped, back to the last moment. */
  async restart(): Promise<void> {
    const emu = this.emulator;
    const card = this.stoppedCard;
    card.classList.add('working');
    try {
      if (emu.stopped && emu.revive) await emu.revive();
      if (!emu.stopped) {
        if (this.lastTape) {
          try {
            emu.load(this.lastTape.bytes, this.lastTape.name);
          } catch {
            // The moment goes back without its tape.
          }
        }
        const m = this.rewind.at(this.rewind.length - 1);
        if (m) {
          try {
            emu.loadState(m.state);
            this.history = m.frame;
          } catch {
            emu.reset();
          }
        }
      }
    } catch (e) {
      card.querySelector('.stopped-why')!.textContent = `It would not start again (${(e as Error).message}): reloading the page will.`;
      card.classList.remove('working');
      return;
    }
    card.classList.remove('working');
    card.hidden = true;
    this.broken = null;
    this.afterJump();
    this.deck.inserted(emu.tape.state().loaded ? (this.game?.title ?? this.lastTape?.name ?? null) : null, this.shellOf(this.game));
    this.setSpeed(1);
    toast('Started again, at the last moment kept before it stopped.');
  }

  // --- Files -------------------------------------------------------------------------------------------------------

  /**
   * A file in. A snapshot replaces the machine. A tape goes in the deck, and, if the machine is only at BASIC (nothing
   * loaded since it was switched on) or `autoload` says so, the page switches it on afresh and types LOAD "". A file
   * the machine refuses changes nothing: the machine runs on as it was.
   */
  loadFile(bytes: Uint8Array, name: string, options: { model?: Model; autoload?: boolean; title?: string; entry?: ZxEntry } = {}): LoadResult | null {
    if (this.broken) return null;
    if (bytes.length > MAX_FILE) {
      toast(`${name} is ${(bytes.length / 1048576).toFixed(0)} MB, larger than any Spectrum file: it is not one the machine can load.`, 'error');
      return null;
    }
    let result: LoadResult;
    const wasLoaded = this.programLoaded;
    try {
      result = this.emulator.load(bytes, name);
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) {
        this.fail(e);
        return null;
      }
      toast(e instanceof LoadError ? e.message : `${name} could not be loaded: ${(e as Error).message}`, 'error', { action: { label: 'Open another file', run: () => this.fileInput.click() } });
      return null;
    }
    if (result.kind === 'tape' && !result.blocks?.length) {
      // A tape with nothing on it to play (the stand-in takes one): out of the deck again, and the machine left alone.
      this.emulator.tape.eject();
      this.deck.inserted(null);
      toast(`${name} has nothing on it the deck can play: the machine was left as it was.`, 'error', { action: { label: 'Open another file', run: () => this.fileInput.click() } });
      return null;
    }
    this.touched = true;
    // The machine the file wants, switched to once the file is in (a tape stays in the deck across it).
    let switched = false;
    if (result.kind === 'tape' && options.model && options.model !== this.emulator.model) {
      this.emulator.setModel(options.model);
      this.afterReset();
      this.warmUp();
      switched = true;
    }
    const title = options.title ?? result.name;
    const game: Game = options.entry ? { key: `zxdb:${options.entry.id}`, title, entry: options.entry } : { key: `file:${result.name}`, title };
    if (result.kind === 'snapshot') {
      this.programName = fileName(title);
      this.afterReset();
      this.programLoaded = true;
      this.resize();
      this.setGame(game);
      this.deck.inserted(this.emulator.tape.state().loaded ? title : null);
      toast(`${title}: a snapshot of a ${MODELS[result.model ?? this.emulator.model].name}.`);
      // A snapshot this page saved of a game brings the game back with it (its panel, its keys, its slots).
      const known = this.snapshotGame(bytes);
      if (known) {
        const shelf = SHELF.find((e) => e.id === known.id);
        void (shelf ? Promise.resolve(shelf) : fetchEntry(known.id))
          .then((entry) => {
            if (this.game !== game) return;
            this.programName = fileName(known.title);
            this.setGame({ key: `zxdb:${entry.id}`, title: known.title, entry });
          })
          .catch(() => {});
      }
    } else if (result.kind === 'tape') {
      this.lastTape = { name: result.name, bytes: bytes.slice() };
      this.fastLoad = false;
      const auto = options.autoload ?? !wasLoaded;
      if (auto) {
        // A new program: its tape is the game's, and the machine starts afresh for it.
        this.programName = fileName(title);
        this.setGame(game);
        this.tapeFile = { game: game.key, name: result.name, bytes: this.lastTape.bytes };
        if (!switched) this.reset();
        this.autoLoad = { stage: 'boot', since: this.emulator.frameCount };
        toast(`${title}: ${MODELS[this.emulator.model].menu ? 'Tape Loader' : 'LOAD ""'}…`);
      } else toast(`${title} is in the deck: press play when the program asks for it.`);
      this.deck.inserted(title, this.shellOf(auto ? game : this.game));
    } else {
      toast(`${result.name} is on the screen.`);
    }
    return result;
  }

  /** The cassette a game came on, as far as the page knows: its own shell, or Sinclair's label for Sinclair's. */
  private shellOf(game: Game | null): Shell {
    const e = game?.entry;
    if (!e) return PLAIN_SHELL;
    return SHELLS[e.id] ?? { ...PLAIN_SHELL, rainbow: /Sinclair Research/i.test(e.publisher ?? '') };
  }

  /** A game from the library: its best file fetched from the archive, and loaded on the machine it wants. */
  async loadEntry(entry: ZxEntry): Promise<void> {
    let choice;
    try {
      choice = choose(entry);
    } catch (e) {
      if (e instanceof Unloadable) {
        toast(e.message, 'error');
        return;
      }
      throw e;
    }
    // One game at a time: a second chosen while the first is still coming supersedes it (a double click is one).
    if (this.picking?.id === entry.id) return;
    if (this.picking) {
      this.picking.abort.abort();
      this.library.progress(this.picking.id, null);
    }
    const picking = { id: entry.id, abort: new AbortController() };
    this.picking = picking;
    this.library.progress(entry.id, 0);
    // The cassette going in is seen: the side column back to its top, the deck and the game's panel.
    this.side.scrollTo?.({ top: 0, behavior: 'smooth' });
    try {
      // What the shelf's record leaves out (the inlay, the manual), from the entry itself, while the tape comes.
      const full = entry.inlay === undefined || entry.instructions === undefined ? fetchEntry(entry.id, { signal: picking.abort.signal }).catch(() => entry) : Promise.resolve(entry);
      const bytes = await fetchArchive(choice.file.path, (p) => this.library.progress(entry.id, p), picking.abort.signal);
      this.library.progress(entry.id, null);
      const name = choice.file.path.split('/').pop() ?? entry.title;
      // On the machine its play card was proved on, where it has one (Bubble Bobble's 128K tune, say).
      const model = choice.kind === 'tape' ? (cardFor(entry.id)?.model ?? choice.model) : undefined;
      const loaded = this.loadFile(bytes, name, { model, autoload: true, title: entry.title, entry: await full });
      if (loaded) this.setLink(entry.id);
      this.fetching?.dismiss();
      this.fetching = null;
      this.screenWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.fetching?.dismiss();
      this.fetching = null;
      this.library.progress(entry.id, (e as Error).message);
      const offline = /fetch|network/i.test((e as Error).message);
      toast(`${entry.title} could not be fetched: ${offline ? 'the archive did not answer (the network seems to be down)' : (e as Error).message}. Nothing in the machine was changed.`, 'error', { action: { label: 'Try again', run: () => void this.loadEntry(entry) } });
    } finally {
      if (this.picking === picking) this.picking = null;
    }
  }

  /** `?game=<ZXDB id>` in the page's address: that game, straight away. */
  private openLink(): void {
    const id = new URLSearchParams(location.search).get('game')?.trim() ?? '';
    if (!id) return;
    if (!/^[0-9]{1,7}$/.test(id)) {
      toast(`“${id}” is not a ZXDB entry’s number.`, 'error');
      return;
    }
    const padded = id.padStart(7, '0');
    const shelf = SHELF.find((e) => e.id === padded);
    this.fetching = toast(`${shelf?.title ?? `ZXDB ${Number(id)}`}: fetching it from the archive…`, 'info', { seconds: 30 });
    (shelf ? Promise.resolve(shelf) : fetchEntry(padded))
      .then((entry) => this.loadEntry(entry))
      .catch((e: Error) => {
        this.fetching?.dismiss();
        toast(`ZXDB ${Number(id)}: ${e.message}`, 'error');
      });
  }

  /** The page's address names the game in the machine (or none), so that a reload or a shared link brings it back. */
  private setLink(id: string | null): void {
    try {
      const url = new URL(location.href);
      if (id) url.searchParams.set('game', String(Number(id)));
      else url.searchParams.delete('game');
      history.replaceState(history.state, '', url);
    } catch {
      // An address that cannot be changed (a sandboxed frame): the link button still says it.
    }
  }

  private shareLink(): string | null {
    const id = this.game?.entry?.id;
    if (!id) return null;
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('game', String(Number(id)));
    return url.href;
  }

  private async share(): Promise<void> {
    const link = this.shareLink();
    if (!link) return;
    try {
      if (navigator.share && this.touchFirst) {
        await navigator.share({ title: this.game?.title, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast(`Copied: ${link}`);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      toast(`The link: ${link}`, 'info', 10);
    }
  }

  // --- The game in the machine -------------------------------------------------------------------------------------

  private setGame(game: Game): void {
    if (this.game?.key !== game.key) this.controlsShown = false;
    this.game = game;
    this.pilot = null;
    this.startWanted = null;
    this.startShown = null;
    this.overlay?.prompt(null);
    this.manualTable = null;
    if (!game.entry) this.setLink(null);
    const e = game.entry;
    const card = this.card();
    this.inPlay = false;
    // A game that takes no joystick: the page's joystick presses its keys while it runs.
    this.padKeys.set(card?.keymap ?? null, this.emulator.frameCount);
    const info: GameInfo = {
      key: game.key,
      title: game.title,
      meta: e ? [e.year, e.publisher, e.machine?.replace(/^ZX-Spectrum\s*/, '')].filter(Boolean).join(' · ') : 'Opened from a file',
      inlay: e?.inlay ? archiveUrl(e.inlay) : null,
      share: e ? this.shareLink() : null,
      card,
      controls: e?.controls ?? [],
      inZxdb: !!e,
      hasManual: !!e?.instructions,
    };
    this.gamePanel.show(info, this.hands());
    // The joystick by default wherever the game has one (the panel's choice): the arrows and the fire key, a gamepad,
    // the phone's pad.
    this.playChoice = this.gamePanel.choice();
    this.overlay.available(true);
    if (this.overlay.shown) this.overlay.update(this.howTo(), game.title);
    this.deck.setInlay(info.inlay);
    this.markKeys();
    void this.showSlots();
    if (e?.instructions) {
      this.gamePanel.manual('loading');
      fetchManual(e)
        ?.then((m) => {
          if (this.game !== game) return;
          this.gamePanel.manual(m);
          this.manualTable = m.table;
          this.markKeys();
          if (this.overlay.shown) this.overlay.update(this.howTo(), game.title);
        })
        .catch((err: Error) => this.game === game && this.gamePanel.manual(`The manual could not be fetched: ${err.message}.`));
    }
  }

  /** The way of playing chosen again in the panel: the controls and the keys marked follow it. */
  private chose(choice: StartChoice): void {
    this.playChoice = choice;
    this.markKeys();
    this.promptStart();
    this.overlay.update(this.howTo(), this.game?.title ?? '');
  }

  /**
   * The keys the person needs outlined on the drawn keyboard: with a card, the game's keys when they are the way chosen,
   * and its keys around play (pause, quit) whichever way; with none, the manual's table's, where they are Spectrum keys.
   */
  private markKeys(): void {
    const card = this.card();
    let names: string[];
    if (card) {
      const keys = !this.playChoice.joystick || !(card.joystick || card.keymap) ? card.controls.flatMap((c) => c.keys ?? []) : [];
      names = [...keys, ...card.extras.flatMap((x) => x.key.split('+'))];
    } else names = this.manualTable?.rows.map((r) => r[0]) ?? [];
    this.keyboardView.mark([...new Set(names.map((n) => KEY[n.trim().toUpperCase()]).filter((c): c is number => c !== undefined))]);
  }

  private slotsKey(): string {
    return this.game?.key ?? 'basic';
  }

  private async showSlots(): Promise<void> {
    if (!this.game) return;
    const key = this.slotsKey();
    const slots = await this.saves.list(key);
    if (this.slotsKey() === key) this.gamePanel.slots(slots, paletteById(this.settings.palette).rgb);
  }

  /** The machine as it is now, kept in a slot of the game's (0: the quick slot, F2). */
  async saveSlot(slot: number): Promise<void> {
    if (this.broken) return;
    const emu = this.emulator;
    const key = this.slotsKey();
    let snapshot: Uint8Array;
    try {
      snapshot = emu.saveSnapshot('szx');
    } catch {
      snapshot = new Uint8Array(0);
    }
    const state = emu.saveState();
    const s: Slot = { id: `${key}:${slot}`, game: key, slot, title: this.game?.title ?? 'BASIC', savedAt: Date.now(), state, snapshot, picture: thumbnailOf(emu.frame()) };
    const tape = this.tapeFile?.game === key ? { game: key, name: this.tapeFile.name, bytes: this.tapeFile.bytes } : null;
    const kept = await this.saves.put(s, tape);
    toast(kept ? `Saved in ${SLOT_NAMES[slot]}.` : `Saved in ${SLOT_NAMES[slot]} while this page is open: this browser is keeping no site data.`);
    await this.showSlots();
  }

  /** A slot put back (F4: the quick slot), with the game's tape in the deck where it was. */
  async loadSlot(slot: number): Promise<void> {
    if (this.broken) return;
    const key = this.slotsKey();
    const s = await this.saves.get(key, slot);
    if (!s) {
      toast(`Nothing is saved in ${SLOT_NAMES[slot]} yet: F2 saves there.`);
      return;
    }
    const emu = this.emulator;
    if (this.tapeFile?.game !== key) {
      const tape = await this.saves.tape(key);
      if (tape) {
        try {
          emu.load(tape.bytes, tape.name);
          this.tapeFile = { game: key, name: tape.name, bytes: tape.bytes };
          this.lastTape = { name: tape.name, bytes: tape.bytes };
          this.deck.inserted(s.title, this.shellOf(this.game));
        } catch {
          // The state goes back without its tape.
        }
      }
    }
    try {
      emu.loadState(s.state);
    } catch {
      // A state from another build of the core: the snapshot taken with it.
      try {
        if (!s.snapshot.length) throw new Error('no snapshot');
        emu.load(s.snapshot, 'slot.szx');
      } catch {
        toast(`What is in ${SLOT_NAMES[slot]} cannot be read by this version of the page.`, 'error');
        return;
      }
    }
    this.programLoaded = true;
    this.afterJump();
    this.resize();
    toast(`Back to ${SLOT_NAMES[slot]}.`);
  }

  saveSnapshot(format: SnapshotFormat): void {
    try {
      const bytes = this.emulator.saveSnapshot(format);
      this.rememberSnapshot(bytes);
      download(bytes, `${this.programName}.${format}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  /** Which game a snapshot this page saved was of, by its bytes (the last 40 kept in this browser). */
  private rememberSnapshot(bytes: Uint8Array): void {
    const id = this.game?.entry?.id;
    if (!id) return;
    try {
      const known = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) ?? '[]') as [string, string, string][];
      const hash = fnv(bytes);
      const kept = [[hash, id, this.game!.title] as [string, string, string], ...known.filter(([h]) => h !== hash)].slice(0, 40);
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(kept));
    } catch {
      // No storage: the snapshot opens as a file of its own.
    }
  }

  private snapshotGame(bytes: Uint8Array): { id: string; title: string } | null {
    try {
      const known = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) ?? '[]') as [string, string, string][];
      const hash = fnv(bytes);
      const found = known.find(([h]) => h === hash);
      return found ? { id: found[1], title: found[2] } : null;
    } catch {
      return null;
    }
  }

  /** What a SAVE recorded, as a TAP named for its first header's name ("squares.tap"). */
  private downloadSaved(): void {
    const tap = this.saved;
    // The first block: its length, the flag (0, a header), the type, then ten characters of name.
    const named = tap.length >= 14 && tap[2] === 0 ? String.fromCharCode(...tap.subarray(4, 14)).trim() : '';
    download(tap, `${fileName(named) !== 'spectrum' ? fileName(named) : this.programName === 'spectrum' ? 'saved' : this.programName}.tap`);
  }

  // --- Sound -------------------------------------------------------------------------------------------------------

  /** Sound, on the first gesture the browser counts; on later ones, the sound card asked for again if it has stopped. */
  startSound(): void {
    if (!this.soundAllowed) return;
    if (this.sound) return this.sound.resume();
    if (this.startingSound) return;
    this.startingSound = true;
    Sound.start((played) => this.loop.played(played))
      .then((sound) => {
        this.sound = sound;
        sound.setVolume(this.settings.volume);
        sound.setMuted(this.settings.muted);
        this.applyLevel();
        sound.onState(() => this.followSound());
        this.followSound();
      })
      .catch((e: Error) => {
        this.startingSound = false;
        console.warn('No sound:', e);
      });
  }

  /** The sound card's rate while it is running, else null: frames then run on the display's clock, silently. */
  private audioRate(): number | null {
    return this.sound?.running ? this.sound.rate : null;
  }

  /**
   * Frames follow the sound card while it runs, and the display's clock while it does not (not yet allowed, or
   * stopped by the system: a phone call, a hidden tab on some phones), so that the machine neither stops nor runs
   * into a queue nothing plays; when it runs again, it starts afresh, with nothing stale queued.
   */
  private followSound(): void {
    const sound = this.sound;
    if (!sound) return;
    const rate = this.audioRate();
    if (rate !== this.scheduler.audioRate) {
      if (rate !== null) sound.clear();
      this.scheduler.setAudio(rate);
      this.sampleRate = 0;
    }
    document.body.classList.toggle('sound-on', rate !== null);
    this.veil.hidden = rate !== null;
  }

  // --- The screen read, and the whole screen -----------------------------------------------------------------------

  /** The screen read as text into a live region, for a screen reader to say (F8). */
  readScreen(): void {
    const rows = this.emulator
      .screenText()
      .split('\n')
      .map((r) => r.replace(/▒/g, ' ').trim())
      .filter(Boolean);
    this.reader.textContent = '';
    this.reader.textContent = rows.length ? `The screen reads: ${rows.join('. ')}` : 'The screen has no text the Spectrum’s font can read (a game’s own lettering, or pictures).';
  }

  /** The screen as large as the display: the page fills it (on a phone held sideways, a console), and stays awake. */
  async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      toast('This browser would not go full screen.');
    }
  }

  private async followFullscreen(): Promise<void> {
    const full = !!document.fullscreenElement;
    document.body.classList.toggle('fullscreen', full);
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (full && wl && !this.wakeLock) this.wakeLock = await wl.request('screen');
      if (!full && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      this.wakeLock = null;
    }
    this.resize();
  }

  // --- The page ----------------------------------------------------------------------------------------------------

  private build(canvas: HTMLCanvasElement): void {
    const root = byId('app');
    canvas.classList.add('screen');
    canvas.addEventListener('animationend', (e) => {
      if (e.animationName.startsWith('warm')) canvas.classList.remove('warming');
      else canvas.classList.remove('switching');
    });

    // The bar along the top.
    const brand = h(
      'div',
      { class: 'brand' },
      s('svg', { class: 'brand-stripe', viewBox: '0 0 40 24', 'aria-hidden': 'true' }, ...STRIPE.map((c, i) => s('path', { d: `M${6 + i * 7} 24 L${16 + i * 7} 0 H${23 + i * 7} L${13 + i * 7} 24 Z`, fill: c }))),
      h('span', { class: 'wordmark' }, 'ZX Spectrum'),
    );
    this.modelChip = h('button', { type: 'button', class: 'chip model-chip', title: 'The machine (in Settings)' }, MODELS[this.emulator.model].short);
    this.modelChip.addEventListener('click', () => this.openSettings());
    // Where the keys go: the machine's, or the page's controls (Shift+Tab goes to them, Escape back).
    this.keysChip = h('span', { class: 'chip keys-chip', title: 'Where the PC’s keys go: to the Spectrum, or to the page’s controls (Shift+Tab; Escape gives them back). F1 lists them.' }, icon('keyboard'), h('span', {}, 'Keys: Spectrum'));
    this.speedControl = segmented<string>(
      'Speed',
      [
        { value: 'pause', icon: 'pause', title: 'Pause (F9)' },
        { value: '1', label: '1×', title: 'At its own speed' },
        { value: '2', label: '2×', title: 'Twice as fast' },
        { value: 'max', icon: 'forward', title: 'Flat out' },
      ],
      '1',
      (v) => {
        this.userSpeed = v === 'pause' || v === 'max' ? v : (Number(v) as 1 | 2);
        this.scheduler.speed = this.effectiveSpeed();
      },
      'speed',
    );
    this.displayControl = segmented<string>(
      'Display',
      [
        { value: 'sharp', icon: 'screen', label: 'Sharp', title: 'Sharp pixels' },
        { value: 'tv', icon: 'screen', label: 'TV', title: 'A television' },
      ],
      this.settings.display,
      (v) => this.change({ display: v as Settings['display'] }),
      'display',
    );
    this.soundButton = button({
      icon: this.settings.muted ? 'mute' : 'sound',
      title: 'Sound on or off',
      className: 'sound-button',
      onClick: () => {
        // The first press starts the sound (and unmutes it); after that it mutes and unmutes.
        if (!this.sound) {
          this.startSound();
          if (this.settings.muted) this.change({ muted: false });
        } else this.change({ muted: !this.settings.muted });
      },
    });
    this.pauseButton = button({ icon: 'pause', title: 'Pause, or carry on (F9)', className: 'only-narrow', onClick: () => this.togglePause() });
    this.fileInput = h('input', { type: 'file', accept: '.tap,.tzx,.z80,.sna,.szx,.slt,.scr,.zip,.csw,.pzx', hidden: true });
    const fileInput = this.fileInput;
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (file) this.loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
      fileInput.value = '';
    });
    const snapMenu = h('div', { class: 'menu', hidden: true, role: 'menu' });
    for (const [format, label] of [
      ['z80', 'Save as .z80'],
      ['szx', 'Save as .szx'],
      ['sna', 'Save as .sna'],
    ] as const) {
      const item = h('button', { type: 'button', role: 'menuitem', class: 'menu-item' }, icon('save'), label);
      item.addEventListener('click', () => {
        snapMenu.hidden = true;
        this.saveSnapshot(format);
      });
      snapMenu.append(item);
    }
    const snapButton = button({ icon: 'save', label: 'Snapshot', title: 'Save the machine as a snapshot', className: 'hide-narrow' });
    snapButton.addEventListener('click', (e) => {
      e.stopPropagation();
      snapMenu.hidden = !snapMenu.hidden;
    });
    document.addEventListener('click', () => (snapMenu.hidden = true));
    const tools = h(
      'div',
      { class: 'tools' },
      this.speedControl.el,
      this.pauseButton,
      this.displayControl.el,
      this.soundButton,
      button({ icon: 'keyboard', title: 'Show or hide the keyboard', className: 'hide-narrow', onClick: () => this.change({ keyboard: !this.settings.keyboard }) }),
      button({ icon: 'open', label: 'Open', title: 'Open a tape, a snapshot or a screen', onClick: () => fileInput.click() }),
      h('div', { class: 'menu-host' }, snapButton, snapMenu),
      button({ icon: 'fullscreen', title: 'The screen as large as the display', onClick: () => void this.toggleFullscreen() }),
      button({ icon: 'power', title: 'Switch it off and on again', onClick: () => this.reset() }),
      button({ icon: 'help', title: 'Keys (F1)', className: 'hide-narrow help-button', onClick: () => this.help.open() }),
      button({ icon: 'settings', title: 'Settings', onClick: () => this.openSettings() }),
      fileInput,
    );
    const bar = h('header', { class: 'bar' }, h('div', { class: 'bar-left' }, brand, this.modelChip, this.keysChip), tools);

    // The screen.
    this.veil = h('button', { type: 'button', class: 'veil', title: 'Browsers keep sound off until you click or press a key' }, icon('sound'), h('span', {}, this.touchFirst ? 'Tap for sound' : 'Click for sound'));
    this.veil.addEventListener('click', () => this.startSound());
    this.osd = createOsd();
    const restart = h('button', { type: 'button', class: 'btn btn-primary' }, icon('power'), h('span', { class: 'btn-label' }, 'Start it again'));
    restart.addEventListener('click', () => void this.restart());
    this.stoppedCard = h('div', { class: 'screen-card stopped', role: 'alert', hidden: true }, h('strong', {}, 'The machine stopped'), h('p', { class: 'stopped-why' }), h('p', {}, 'Started again, it goes back to the last moment kept, with its tape.'), restart);
    this.overlay = createOverlay(
      {
        dismissed: () => {
          this.overlay.hide();
          if (this.game) rememberDismissed(this.game.key);
        },
        toggle: () => this.toggleControls(),
        start: () => this.startGame(this.gamePanel.choice()),
      },
      this.touchFirst,
    );
    const frame = h('div', { class: 'tv-frame' }, canvas, this.osd.el, this.overlay.el);
    this.screenWrap = h('div', { class: 'screen-wrap' }, frame, this.stoppedCard, this.veil);
    this.tapeBar = createTapeBar(
      () => this.emulator.tape,
      () => {
        this.fastLoad = true;
        this.scheduler.speed = this.effectiveSpeed();
      },
    );
    this.timeline = createTimeline({
      moments: () => this.rewind.list(),
      frameRate: () => this.emulator.frameRate,
      now: () => this.history,
      palette: () => paletteById(this.settings.palette).rgb,
      preview: (m, ago) => {
        const picture = m && this.pictureOf(m);
        this.preview = picture ? m : null;
        if (picture) this.renderer.draw(picture);
        else this.newFrame = true;
        this.osd.show(picture ? { kind: 'preview', ago } : { kind: 'none' });
        this.scheduler.speed = this.effectiveSpeed();
      },
      goBack: (i) => this.goBack(i),
    });
    const touch = createTouchPad(
      (bits) => {
        this.touchBits = bits;
        this.touched = true;
      },
      (code, down) => (down ? this.feeder.hold(`touch-${code}`, [code], this.emulator.frameCount, 'free') : this.feeder.release(`touch-${code}`, this.emulator.frameCount)),
    );
    this.keyboardView = createKeyboard((code, down) => {
      this.startSound();
      this.touched = true;
      const now = this.emulator.frameCount;
      if (down) this.feeder.hold(`drawn-${code}`, [code], now, 'free');
      // A latched shift goes up with the key it was for, not before it: a click is down and up in one frame, and the
      // key's release waits a frame for the machine to see it.
      else if (code === CAPS_SHIFT || code === SYMBOL_SHIFT) this.feeder.release(`drawn-${code}`, Math.max(now, this.drawnUntil));
      else this.drawnUntil = this.feeder.release(`drawn-${code}`, now);
    });

    this.deck = createDeck(
      () => this.emulator.tape,
      (style) => this.change({ loading: style }),
      this.settings.loading,
      () => this.downloadSaved(),
      () => fileInput.click(),
    );
    this.library = createLibrary((entry) => void this.loadEntry(entry));
    this.gamePanel = createGamePanel({
      save: (i) => void this.saveSlot(i),
      load: (i) => void this.loadSlot(i),
      share: () => void this.share(),
      start: (c) => this.startGame(c),
      chose: (c) => this.chose(c),
      showControls: () => this.showControls(false),
    });
    this.inspector = createInspector({
      emulator: () => this.emulator,
      paused: () => this.userSpeed === 'pause',
      pause: () => this.setSpeed('pause'),
      resume: () => this.setSpeed(1),
      step: () => this.stepOne(),
    });
    this.settingsPanel = createSettings(this.settings, (patch) => this.change(patch), () => this.about(), this.inspector.el);
    this.help = createHelp();

    // On a phone, the way to a game from the first screen.
    const chooseGame = h('button', { type: 'button', class: 'btn btn-primary choose-game only-narrow' }, icon('shelf'), h('span', { class: 'btn-label' }, 'Choose a game'));
    chooseGame.addEventListener('click', () => this.library.el.scrollIntoView({ behavior: 'smooth', block: 'start' }));

    this.mainCol = h('div', { class: 'main-col' }, this.screenWrap, this.tapeBar.el, this.timeline.el, chooseGame, touch.el, h('div', { class: 'keyboard-wrap' }, this.keyboardView.el));
    this.side = h('aside', { class: 'side' }, this.deck.el, this.gamePanel.el, this.library.el);
    const main = h('main', { class: 'stage', id: 'machine' }, this.mainCol, this.side);
    const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    const foot = h(
      'footer',
      { class: 'foot' },
      h('p', { class: 'foot-amstrad' }, 'The machines’ ROMs are Sinclair Research’s and Amstrad’s. Amstrad have kindly given their permission for the redistribution of their copyrighted material but retain that copyright.'),
      h('p', {}, 'Games, their inlays and their manuals come from the ', link('https://spectrumcomputing.co.uk', 'Spectrum Computing'), ' archive, found through the ', link('https://zxinfo.dk', 'ZXDB'), ' (by way of ZXInfo), and only those the ZXDB lists as available. Thank you to everyone who keeps them.'),
      h('p', {}, h('a', { href: './how.html' }, 'How this Spectrum was built'), ', overnight, by a team of agents, and how we know it is faithful.'),
    );
    const drop = h('div', { class: 'drop', hidden: true }, h('div', { class: 'drop-card' }, icon('tape'), h('strong', {}, 'Drop it in'), h('span', {}, 'A tape (TAP, TZX, CSW, PZX), a snapshot (Z80, SNA, SZX), a screen (SCR), or a .zip of one')));
    this.reader = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
    // The first paint's stand-in (index.html) gives way to the page.
    document.querySelector('.boot')?.remove();
    root.append(bar, main, foot, drop, this.settingsPanel.el, this.help.el, this.reader);
    this.deck.inserted(null);
    this.updateVeil();
  }

  /** Settings, showing the machine as it is now (a snapshot or a game may have switched it). */
  private openSettings(): void {
    this.settingsPanel.sync({ ...this.settings, model: this.emulator.model });
    this.settingsPanel.open();
  }

  /** The keys to the page's controls, from the first in the bar. */
  private focusControls(): void {
    document.querySelector<HTMLElement>('.bar .tools button')?.focus();
  }

  private updateVeil(): void {
    this.veil.hidden = !this.soundAllowed || !!this.sound?.running;
  }

  private listen(): void {
    // The page's own keys: F1 the keys, F2 and F4 the quick slot, F3 the game's controls over the screen, F8 the screen
    // read aloud, F9 pause (not while typing into the page's own fields).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
      // From the machine, Shift+Tab goes to the page's controls, the first of them first.
      if (e.key === 'Tab' && e.shiftKey && (document.activeElement === document.body || document.activeElement === null)) {
        e.preventDefault();
        this.focusControls();
        return;
      }
      if (!['F1', 'F2', 'F3', 'F4', 'F8', 'F9'].includes(e.code)) return;
      if (e.target instanceof Element && e.target.closest('dialog[open]') && e.code !== 'F1') return;
      e.preventDefault();
      if (e.code === 'F1') this.help.open();
      else if (e.code === 'F2') void this.saveSlot(0);
      else if (e.code === 'F3') this.toggleControls();
      else if (e.code === 'F4') void this.loadSlot(0);
      else if (e.code === 'F8') this.readScreen();
      else this.togglePause();
    });
    listenToKeyboard({
      feeder: this.feeder,
      frame: () => this.emulator.frameCount,
      mapping: () => this.mapping(),
      // A game with a key map has the arrows whatever joystick is chosen: they press its keys.
      joystick: () => ({ on: arrowsAreJoystick({ ...this.settings, joystick: this.padKeys.keymap ? 'kempston' : this.settings.joystick, programLoaded: this.programLoaded }), fire: this.settings.fireKey }),
      joystickBits: (bits) => (this.keyBits = bits),
      gesture: () => this.startSound(),
      typed: () => (this.touched = true),
    });
    window.addEventListener('pointerdown', () => this.startSound(), { capture: true });
    // A control clicked or tapped keeps no focus, so the keys are the machine's again at once (a game's Space must not
    // land on the button last clicked, nor its focus ring show while playing). Focus the keyboard moved stays, and the
    // keys that work a control are then its (input/pc-keyboard.ts). A click made by the keyboard has no detail.
    window.addEventListener('click', (e) => {
      if (e.detail === 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !active.closest('dialog') && !active.matches('input, select, textarea, summary')) active.blur();
    });
    // Where the keys go, said in the bar.
    const keysTo = () => {
      const a = document.activeElement;
      const page = !!a && a !== document.body;
      this.keysChip.classList.toggle('page', page);
      this.keysChip.lastElementChild!.textContent = page ? 'Keys: page' : 'Keys: Spectrum';
    };
    document.addEventListener('focusin', keysTo);
    document.addEventListener('focusout', () => setTimeout(keysTo, 0));
    // Closing the tab (Ctrl+W meant as SYMBOL SHIFT and W, say) asks first, once something would be lost.
    window.addEventListener('beforeunload', (e) => {
      if (!this.touched) return;
      e.preventDefault();
      e.returnValue = '';
    });
    document.addEventListener('fullscreenchange', () => void this.followFullscreen());
    new ResizeObserver(() => this.resize()).observe(this.screenWrap);
    window.addEventListener('resize', () => this.resize());

    // Files dropped anywhere on the page.
    const drop = document.querySelector<HTMLElement>('.drop');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth++;
      if (drop) drop.hidden = false;
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth && drop) drop.hidden = true;
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0;
      if (drop) drop.hidden = true;
      const file = e.dataTransfer?.files[0];
      if (file) this.loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
    });
  }

  private about(): string {
    const core = this.kind === 'wasm' ? 'the emulator (crates/spectrum, compiled to WebAssembly)' : 'the stand-in emulator, which runs no Z80 (?emulator=stub): games stop at their loading screens';
    return `Running ${core}, drawn with ${this.renderer.kind === 'webgl2' ? 'WebGL 2' : 'a 2D canvas'}${this.sound ? `, sound at ${this.sound.rate} Hz` : this.soundAllowed ? ', sound not started yet' : ', with no sound (?sound=off)'}.`;
  }
}

/** A name for files from a title: "Saboteur!" → "Saboteur!", "Saboteur.tzx" → "Saboteur". */
function fileName(title: string): string {
  return title.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- !()]+/g, '').trim() || 'spectrum';
}

/** FNV-1a, 32 bits, as hex: which snapshot a file is. */
function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return `${(h >>> 0).toString(16)}:${bytes.length}`;
}
