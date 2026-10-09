// The page, put together: the emulator and its clock, the screen, the sound, the keyboards and joysticks, the tape
// deck, the library, rewinding, and the settings. Every part is made elsewhere; this decides how they meet.

import { FrameScheduler, type Speed } from './clock/scheduler';
import { Loop } from './clock/loop';
import { MODELS, LoadError, type Emulator, type LoadResult, type Model, type SnapshotFormat } from './emulator/emulator';
import { ENTER, SPACE } from './emulator/keys';
import { KeyFeeder } from './input/feeder';
import { readGamepads } from './input/gamepad';
import { arrowsAreJoystick, type Mapping } from './input/keymap';
import { listenToKeyboard } from './input/pc-keyboard';
import { BOOT_FRAMES, loadKeys } from './input/typer';
import { createKeyboard } from './keyboard/keyboard';
import { choose, Unloadable } from './library/choose';
import { fetchArchive, type ZxEntry } from './library/zxinfo';
import { Sound } from './audio/sound';
import { Rewind, type Moment } from './state/rewind';
import { loadSettings, saveSettings, type Settings } from './state/settings';
import { button, segmented } from './ui/controls';
import { createDeck } from './ui/deck';
import { byId, download, h, s } from './ui/dom';
import { icon } from './ui/icons';
import { createInspector } from './ui/inspector';
import { createLibrary } from './ui/library';
import { createSettings } from './ui/settings';
import { createTimeline } from './ui/timeline';
import { toast } from './ui/toast';
import { createTouchPad } from './ui/touch';
import { CROPS, fit } from './video/fit';
import { palette as paletteById } from './video/palette';
import type { Renderer } from './video/renderer';
import { STRIPE } from './keyboard/keyboard';

/** What a loading tape is waiting for, when the page loads it by itself: the machine to boot, then the keys typed. */
type AutoLoad = { stage: 'boot'; until: number } | { stage: 'typing'; until: number } | null;

export interface AppParts {
  readonly emulator: Emulator;
  readonly kind: 'wasm' | 'stub';
  readonly renderer: Renderer;
  readonly canvas: HTMLCanvasElement;
}

export class App {
  readonly emulator: Emulator;
  readonly renderer: Renderer;
  readonly settings: Settings;
  readonly scheduler: FrameScheduler;
  readonly loop: Loop;
  readonly feeder: KeyFeeder;
  readonly rewind = new Rewind();
  sound: Sound | null = null;
  /** Frames of the machine's history: frames run, less those undone by going back. */
  history = 0;
  /** A program has been loaded since the machine was switched on (the keyboard is then for games, when automatic). */
  programLoaded = false;
  /** The name of what is loaded, for a snapshot's file name. */
  programName = 'spectrum';
  private userSpeed: Speed = 1;
  private autoLoad: AutoLoad = null;
  /** The library's game being fetched. */
  private picking: { id: string; abort: AbortController } | null = null;
  private preview: Moment | null = null;
  private newFrame = true;
  private keyBits = 0;
  private touchBits = 0;
  private padBits = 0;
  private padEnter = false;
  private padSpace = false;
  private lastJoystick = '';
  private sampleRate = 0;
  private startingSound = false;
  private lit = new Uint8Array(40);
  private ambient = [0, 0, 0];
  private readonly kind: 'wasm' | 'stub';

  private keyboardView!: ReturnType<typeof createKeyboard>;
  private deck!: ReturnType<typeof createDeck>;
  private timeline!: ReturnType<typeof createTimeline>;
  private library!: ReturnType<typeof createLibrary>;
  private settingsPanel!: ReturnType<typeof createSettings>;
  private inspector!: ReturnType<typeof createInspector>;
  private speedControl!: ReturnType<typeof segmented<string>>;
  private displayControl!: ReturnType<typeof segmented<string>>;
  private modelChip!: HTMLButtonElement;
  private soundButton!: HTMLButtonElement;
  private screenWrap!: HTMLElement;
  private veil!: HTMLElement;

  constructor(parts: AppParts) {
    this.emulator = parts.emulator;
    this.kind = parts.kind;
    this.renderer = parts.renderer;
    this.settings = loadSettings();
    this.scheduler = new FrameScheduler(this.emulator.frameRate);
    this.feeder = new KeyFeeder((code, down) => this.emulator.key(code, down));
    this.loop = new Loop(this.scheduler, {
      runFrame: () => this.runFrame(),
      present: (now) => this.present(now),
      now: () => performance.now(),
    });
    if (this.emulator.model !== this.settings.model) this.emulator.setModel(this.settings.model);
    this.applyOptions();
    this.build(parts.canvas);
    this.applyView();
    this.listen();
    this.loop.start();
  }

  // --- The machine's frames ----------------------------------------------------------------------------------------

  private runFrame(): void {
    const emu = this.emulator;
    this.feeder.tick(emu.frameCount);
    // The joystick, told only of a change (of its bits, or of the interface).
    const kind = this.settings.joystick;
    const bits = kind === 'none' ? 0 : this.keyBits | this.touchBits | this.padBits;
    const joystick = `${kind}:${bits}`;
    if (joystick !== this.lastJoystick) {
      emu.joystick(kind, bits);
      this.lastJoystick = joystick;
    }
    const audio = this.sound && this.scheduler.audioLed;
    if (audio) {
      const rate = this.scheduler.sampleRate() ?? 0;
      if (rate !== this.sampleRate) {
        emu.setSampleRate(rate);
        this.sampleRate = rate;
      }
    }
    emu.runFrame();
    this.history++;
    if (audio && this.sound) {
      const samples = emu.audio();
      this.sound.send(samples);
      this.scheduler.sentSamples(samples.length / 2);
    }
    if (this.rewind.due(this.history)) this.rewind.add({ frame: this.history, state: emu.saveState(), picture: emu.frame().slice() });
    this.stepAutoLoad();
    if (emu.tape.state().playing) this.programLoaded = true;
    this.newFrame = true;
    this.scheduler.speed = this.effectiveSpeed();
  }

  /** Flat out while the machine boots for a tape, and while a tape plays if it is to load fast. */
  private effectiveSpeed(): Speed {
    if (this.preview) return 'pause';
    if (this.autoLoad?.stage === 'boot') return 'max';
    if (this.userSpeed !== 'pause' && this.settings.loading !== 'authentic' && this.emulator.tape.state().playing) return 'max';
    return this.userSpeed;
  }

  private stepAutoLoad(): void {
    const a = this.autoLoad;
    if (!a) return;
    const now = this.emulator.frameCount;
    if (a.stage === 'boot' && now >= a.until) {
      const until = this.feeder.type(loadKeys(this.emulator.model), now);
      this.autoLoad = { stage: 'typing', until: until + 2 };
    } else if (a.stage === 'typing' && now >= a.until) {
      // With the motor left to the machine, the ROM has started the tape already; otherwise start it.
      if (!this.settings.autoTape) this.emulator.tape.play();
      this.autoLoad = null;
    }
  }

  // --- The display -------------------------------------------------------------------------------------------------

  private present(_now: number): void {
    const pad = readGamepads();
    this.padBits = pad.bits;
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
    this.scheduler.speed = this.effectiveSpeed();

    if (this.preview) {
      // While choosing a moment to go back to, its picture is shown, and the machine waits.
    } else if (this.newFrame) {
      this.renderer.draw(this.emulator.frame());
      this.newFrame = false;
      this.glow(this.emulator.frame());
    }
    this.deck.update();
    this.timeline.update();
    if (this.settingsPanel.el.open) this.inspector.update();
    for (let code = 0; code < 40; code++) {
      const on = this.feeder.isDown(code) ? 1 : 0;
      if (on !== this.lit[code]) {
        this.lit[code] = on;
        this.keyboardView.light(code, !!on);
      }
    }
    document.body.classList.toggle('loading-tape', this.emulator.tape.state().playing);
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

  private resize(): void {
    const crop = CROPS[this.settings.crop];
    const rect = this.screenWrap.getBoundingClientRect();
    const phone = window.innerWidth < 760;
    // The screen is the hero: as large as the column, and no taller than the window leaves room for.
    const maxHeight = phone ? window.innerHeight * 0.5 : window.innerHeight - 64 - 58 - 36;
    const pad = this.settings.display === 'tv' ? (phone ? 12 : 28) : 0;
    const size = fit(crop, this.settings.display, Math.max(64, rect.width - pad), Math.max(64, maxHeight - pad), devicePixelRatio || 1);
    this.renderer.setSize(size);
    this.renderer.present();
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
  }

  /** Changes settings, applies them and remembers them. */
  change(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch);
    saveSettings(this.settings);
    if (patch.model && patch.model !== this.emulator.model) this.switchModel(patch.model);
    this.applyOptions();
    if ('display' in patch || 'crop' in patch || 'palette' in patch || 'ambient' in patch || 'keyboard' in patch) this.applyView();
    this.settingsPanel.sync({ ...this.settings, model: this.emulator.model });
    this.deck.setLoading(this.settings.loading);
    this.displayControl.set(this.settings.display);
    this.soundButton.replaceChildren(icon(this.settings.muted ? 'mute' : 'sound'));
  }

  // --- What the machine is -----------------------------------------------------------------------------------------

  private switchModel(model: Model): void {
    this.emulator.setModel(model);
    this.afterReset();
  }

  reset(): void {
    this.emulator.reset();
    this.afterReset();
  }

  private afterReset(): void {
    this.feeder.clear();
    this.autoLoad = null;
    this.programLoaded = false;
    this.scheduler.frameRate = this.emulator.frameRate;
    this.sound?.clear();
    this.scheduler.setAudio(this.audioRate());
    this.sampleRate = 0;
    this.modelChip.textContent = MODELS[this.emulator.model].short;
  }

  /** The keyboard's mapping now: automatic is for typing until a program is loaded, then for games. */
  mapping(): Mapping {
    if (this.settings.mapping === 'auto') return this.programLoaded ? 'positional' : 'natural';
    return this.settings.mapping;
  }

  // --- Files -------------------------------------------------------------------------------------------------------

  /**
   * A file in. A snapshot replaces the machine. A tape goes in the deck, and, if the machine is only at BASIC (nothing
   * loaded since it was switched on) or `autoload` says so, the page switches it on afresh and types LOAD "".
   */
  loadFile(bytes: Uint8Array, name: string, options: { model?: Model; autoload?: boolean; title?: string } = {}): LoadResult | null {
    let result: LoadResult;
    const wasLoaded = this.programLoaded;
    let switched = false;
    try {
      if (options.model && options.model !== this.emulator.model) {
        this.emulator.setModel(options.model);
        this.afterReset();
        switched = true;
      }
      result = this.emulator.load(bytes, name);
    } catch (e) {
      toast(e instanceof LoadError ? e.message : `${name} could not be loaded: ${(e as Error).message}`, 'error');
      return null;
    }
    this.programName = (options.title ?? result.name).replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- !()]+/g, '').trim() || 'spectrum';
    if (result.kind === 'snapshot') {
      this.afterReset();
      this.programLoaded = true;
      this.rewind.clear();
      toast(`${options.title ?? result.name}: a snapshot of a ${MODELS[result.model ?? this.emulator.model].name}.`);
    } else if (result.kind === 'tape') {
      this.deck.inserted(options.title ?? result.name);
      const auto = options.autoload ?? !wasLoaded;
      if (auto) {
        if (!switched) this.reset();
        this.autoLoad = { stage: 'boot', until: this.emulator.frameCount + BOOT_FRAMES };
        toast(`${options.title ?? result.name}: ${MODELS[this.emulator.model].menu ? 'Tape Loader' : 'LOAD ""'}…`);
      } else toast(`${options.title ?? result.name} is in the deck: press play when the program asks for it.`);
    } else {
      toast(`${result.name} is on the screen.`);
    }
    return result;
  }

  /** A game from the library: its best file fetched from the archive, and loaded on the machine it wants. */
  async loadEntry(entry: ZxEntry): Promise<void> {
    let choice;
    try {
      choice = choose(entry);
    } catch (e) {
      if (e instanceof Unloadable) return toast(e.message, 'error');
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
    try {
      const bytes = await fetchArchive(choice.file.path, (p) => this.library.progress(entry.id, p), picking.abort.signal);
      this.library.progress(entry.id, null);
      const name = choice.file.path.split('/').pop() ?? entry.title;
      this.loadFile(bytes, name, { model: choice.kind === 'tape' ? choice.model : undefined, autoload: true, title: entry.title });
      this.screenWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.library.progress(entry.id, (e as Error).message);
      toast(`${entry.title}: ${(e as Error).message}`, 'error');
    } finally {
      if (this.picking === picking) this.picking = null;
    }
  }

  saveSnapshot(format: SnapshotFormat): void {
    download(this.emulator.saveSnapshot(format), `${this.programName}.${format}`);
  }

  /** Back to a moment kept for rewinding. */
  goBack(index: number): void {
    const m = this.rewind.goBack(index);
    if (!m) return;
    this.emulator.loadState(m.state);
    this.history = m.frame;
    this.scheduler.frameRate = this.emulator.frameRate; // the moment may be of another model
    this.modelChip.textContent = MODELS[this.emulator.model].short;
    this.feeder.clear();
    this.sound?.clear();
    this.scheduler.setAudio(this.audioRate());
    this.newFrame = true;
  }

  // --- Sound -------------------------------------------------------------------------------------------------------

  /** Sound, on the first gesture the browser counts; on later ones, the sound card asked for again if it has stopped. */
  startSound(): void {
    if (this.sound) return this.sound.resume();
    if (this.startingSound) return;
    this.startingSound = true;
    Sound.start((played) => this.loop.played(played))
      .then((sound) => {
        this.sound = sound;
        sound.setVolume(this.settings.volume);
        sound.setMuted(this.settings.muted);
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

  // --- The page ----------------------------------------------------------------------------------------------------

  private build(canvas: HTMLCanvasElement): void {
    const root = byId('app');
    canvas.classList.add('screen');

    // The bar along the top.
    const brand = h(
      'div',
      { class: 'brand' },
      s('svg', { class: 'brand-stripe', viewBox: '0 0 40 24', 'aria-hidden': 'true' }, ...STRIPE.map((c, i) => s('path', { d: `M${6 + i * 7} 24 L${16 + i * 7} 0 H${23 + i * 7} L${13 + i * 7} 24 Z`, fill: c }))),
      h('span', { class: 'wordmark' }, 'ZX Spectrum'),
    );
    this.modelChip = h('button', { type: 'button', class: 'chip model-chip', title: 'The machine (in Settings)' }, MODELS[this.emulator.model].short);
    this.modelChip.addEventListener('click', () => this.openSettings());
    this.speedControl = segmented<string>(
      'Speed',
      [
        { value: 'pause', icon: 'pause', title: 'Pause' },
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
      onClick: () => {
        // The first press starts the sound (and unmutes it); after that it mutes and unmutes.
        if (!this.sound) {
          this.startSound();
          if (this.settings.muted) this.change({ muted: false });
        } else this.change({ muted: !this.settings.muted });
      },
    });
    const fileInput = h('input', { type: 'file', accept: '.tap,.tzx,.z80,.sna,.szx,.scr,.zip,.csw,.pzx', hidden: true });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (file) this.loadFile(new Uint8Array(await file.arrayBuffer()), file.name);
      fileInput.value = '';
    });
    const snapMenu = h('div', { class: 'menu', hidden: true, role: 'menu' });
    for (const [format, label] of [
      ['z80', 'Save as .z80'],
      ['szx', 'Save as .szx'],
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
      this.displayControl.el,
      this.soundButton,
      button({ icon: 'keyboard', title: 'Show or hide the keyboard', className: 'hide-narrow', onClick: () => this.change({ keyboard: !this.settings.keyboard }) }),
      button({ icon: 'open', label: 'Open', title: 'Open a tape, a snapshot or a screen', onClick: () => fileInput.click() }),
      h('div', { class: 'menu-host' }, snapButton, snapMenu),
      button({ icon: 'power', title: 'Switch it off and on again', onClick: () => this.reset() }),
      button({ icon: 'settings', title: 'Settings', onClick: () => this.openSettings() }),
      fileInput,
    );
    const bar = h('header', { class: 'bar' }, h('div', { class: 'bar-left' }, brand, this.modelChip), tools);

    // The screen.
    const touch0 = matchMedia('(pointer: coarse)').matches;
    this.veil = h('button', { type: 'button', class: 'veil', title: 'Browsers keep sound off until you click or press a key' }, icon('sound'), h('span', {}, touch0 ? 'Tap for sound' : 'Click for sound'));
    this.veil.addEventListener('click', () => this.startSound());
    const frame = h('div', { class: 'tv-frame' }, canvas);
    this.screenWrap = h('div', { class: 'screen-wrap' }, frame, this.veil);
    this.timeline = createTimeline({
      moments: () => this.rewind.list(),
      frameRate: () => this.emulator.frameRate,
      now: () => this.history,
      palette: () => paletteById(this.settings.palette).rgb,
      preview: (m) => {
        this.preview = m;
        if (m) this.renderer.draw(m.picture);
        else this.newFrame = true;
        this.scheduler.speed = this.effectiveSpeed();
      },
      goBack: (i) => this.goBack(i),
    });
    const touch = createTouchPad(
      (bits) => (this.touchBits = bits),
      (code, down) => (down ? this.feeder.hold(`touch-${code}`, [code], this.emulator.frameCount, 'free') : this.feeder.release(`touch-${code}`, this.emulator.frameCount)),
    );
    this.keyboardView = createKeyboard((code, down) => {
      this.startSound();
      if (down) this.feeder.hold(`drawn-${code}`, [code], this.emulator.frameCount, 'free');
      else this.feeder.release(`drawn-${code}`, this.emulator.frameCount);
    });

    this.deck = createDeck(() => this.emulator.tape, (style) => this.change({ loading: style }), this.settings.loading);
    this.library = createLibrary((entry) => void this.loadEntry(entry));
    this.inspector = createInspector(() => this.emulator);
    this.settingsPanel = createSettings(this.settings, (patch) => this.change(patch), () => this.about(), this.inspector.el);

    const main = h(
      'main',
      { class: 'stage' },
      h('div', { class: 'main-col' }, this.screenWrap, this.timeline.el, touch.el, h('div', { class: 'keyboard-wrap' }, this.keyboardView.el)),
      h('aside', { class: 'side' }, this.deck.el, this.library.el),
    );
    const foot = h(
      'footer',
      { class: 'foot' },
      h('p', {}, 'The ROMs are © Amstrad plc, who allow them to be shared with emulators. Games come from the ', h('a', { href: 'https://spectrumcomputing.co.uk', target: '_blank', rel: 'noopener' }, 'Spectrum Computing'), ' archive, as listed by the ', h('a', { href: 'https://zxinfo.dk', target: '_blank', rel: 'noopener' }, 'ZXDB'), ', and only those it lists as available.'),
    );
    const drop = h('div', { class: 'drop', hidden: true }, h('div', { class: 'drop-card' }, icon('tape'), h('strong', {}, 'Drop it in'), h('span', {}, 'A tape (TAP, TZX), a snapshot (Z80, SNA, SZX), a screen (SCR), or a .zip of one')));
    root.append(bar, main, foot, drop, this.settingsPanel.el);
    this.updateVeil();
  }

  /** Settings, showing the machine as it is now (a snapshot or a game may have switched it). */
  private openSettings(): void {
    this.settingsPanel.sync({ ...this.settings, model: this.emulator.model });
    this.settingsPanel.open();
  }

  private updateVeil(): void {
    this.veil.hidden = !!this.sound?.running;
  }

  private listen(): void {
    listenToKeyboard({
      feeder: this.feeder,
      frame: () => this.emulator.frameCount,
      mapping: () => this.mapping(),
      joystick: () => ({ on: arrowsAreJoystick({ ...this.settings, programLoaded: this.programLoaded }), fire: this.settings.fireKey }),
      joystickBits: (bits) => (this.keyBits = bits),
      gesture: () => this.startSound(),
    });
    window.addEventListener('pointerdown', () => this.startSound(), { capture: true });
    // A control clicked or tapped keeps no focus, so the keys are the machine's again at once (a game's Space must not
    // land on the button last clicked, nor its focus ring show while playing). Focus the keyboard moved stays, and the
    // keys that work a control are then its (input/pc-keyboard.ts). A click made by the keyboard has no detail.
    window.addEventListener('click', (e) => {
      if (e.detail === 0) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !active.closest('dialog') && !active.matches('input, select, textarea')) active.blur();
    });
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
    const core = this.kind === 'wasm' ? 'the emulator core (WebAssembly)' : 'the stand-in emulator: the real core is not wired in yet, so games do not run past their loading screens';
    return `Running ${core}, drawn with ${this.renderer.kind === 'webgl2' ? 'WebGL 2' : 'a 2D canvas'}${this.sound ? `, sound at ${this.sound.rate} Hz` : ', sound not started yet'}.`;
  }
}
