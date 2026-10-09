// A stand-in for the emulator, for building and testing the page before the real core (Rust compiled to WebAssembly)
// is wired in. It runs no Z80. It keeps a 48K's memory and draws it as the ULA would (bitmap, attributes, BRIGHT,
// FLASH, the border), in the ROM's own font (3D00h in roms/48.rom), and acts out what a person sees of a Spectrum:
// the RAM test and the copyright message at power on (or the 128's menu), keys echoed on the bottom line in the
// ROM's keywords, LOAD "" (or the menu's tape loader) starting the tape, the border's stripes and the tape's sound
// while it loads, the header's name, a loading screen appearing line by line, snapshots' screens. It is plausible
// rather than right: everything a game does after it has loaded is beyond it.

import romUrl from '../../../roms/48.rom?url';
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  LoadError,
  MODELS,
  type Emulator,
  type JoystickKind,
  type LoadResult,
  type Model,
  type Options,
  type Registers,
  type SnapshotFormat,
  type Tape,
  type TapeBlock,
  type TapeState,
} from './emulator';
import { CAPS_SHIFT, ENTER, SPACE, SYMBOL_SHIFT } from './keys';
import { blankRegisters, isSzx, readSna, readSzx, readZ80, writeSna, writeSzx, writeZ80, type StubSnapshot } from './stub/snapfile';
import { isTzx, looksLikeTap, parseTap, parseTzx, Signal, type StubBlock } from './stub/tapefile';
import { isZip, unzip } from './stub/zip';

/** The stand-in, with the 48K ROM fetched (for its font and its keyword table). */
export async function createStub(): Promise<StubEmulator> {
  const response = await fetch(romUrl);
  if (!response.ok) throw new Error(`could not fetch the 48K ROM (${response.status})`);
  return new StubEmulator(new Uint8Array(await response.arrayBuffer()));
}

type Scene = 'boot' | 'copyright' | 'editor' | 'menu' | 'loading' | 'running';

/** Frames from power on to the copyright message: the ROM's RAM test takes about a second and a half. */
const BOOT_FRAMES = 70;

const ATTR_WHITE = 0x38; // black ink on white paper
const COPYRIGHT_48 = '\x7f 1982 Sinclair Research Ltd';

const STATE_MAGIC = 0x5a585354; // "ZXST", for the stand-in's own states

interface SavedState {
  model: Model;
  scene: Scene;
  bootFrame: number;
  line: string[];
  cursor: 'K' | 'L' | 'E';
  capsLock: boolean;
  menuItem: number;
  border: number;
  playing: boolean;
  tape: ReturnType<Signal['save']> | null;
  registers: Registers;
}

export class StubEmulator implements Emulator {
  readonly frameWidth = FRAME_WIDTH;
  readonly frameHeight = FRAME_HEIGHT;
  model: Model = '48k';
  frameCount = 0;
  /** Every key the page put down or up, with the frame: for tests. */
  readonly keyLog: { code: number; down: boolean; frame: number }[] = [];
  /** The joystick as last set: for tests. */
  joystickState: { kind: JoystickKind; bits: number } = { kind: 'none', bits: 0 };
  readonly tape: Tape;

  private readonly rom: Uint8Array;
  private readonly tokens: string[];
  private ram = new Uint8Array(0xc000);
  private readonly pixels = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  private samples = new Float32Array(0);
  private sampleRate = 48_000;
  private sampleOwed = 0;
  private lowPass = 0;
  private readonly keys = new Uint8Array(40);
  private readonly seen = new Uint8Array(40);
  private border = 7;
  private scene: Scene = 'boot';
  private bootFrame = 0;
  private line: string[] = [];
  private cursor: 'K' | 'L' | 'E' = 'K';
  private capsLock = false;
  private menuItem = 0;
  private click = 0;
  private registersNow: Registers = blankRegisters();
  private opts: Options = { instantLoad: false, acceleratedLoad: true, autoTape: true, issue2: false, ayStereo: 'acb' };

  private blocks: StubBlock[] = [];
  private signal: Signal | null = null;
  private playing = false;
  private readonly borderLines = new Uint8Array(312);
  private readonly edges: number[] = [];

  constructor(rom: Uint8Array) {
    this.rom = rom;
    this.tokens = readTokens(rom);
    const self = this;
    this.tape = {
      play: () => {
        if (self.signal && !self.signal.done) self.playing = true;
      },
      stop: () => {
        self.playing = false;
      },
      rewind: () => {
        self.playing = false;
        self.signal?.seek(0);
      },
      eject: () => {
        self.playing = false;
        self.blocks = [];
        self.signal = null;
      },
      seek: (index: number) => self.signal?.seek(Math.max(0, Math.min(index, self.blocks.length))),
      state: (): TapeState => ({
        loaded: !!self.signal,
        playing: self.playing,
        block: self.signal?.block ?? 0,
        position: (self.signal?.position ?? 0) / 3_500_000,
        length: self.blocks.reduce((t, b) => t + b.info.seconds, 0),
      }),
      blocks: (): readonly TapeBlock[] => self.blocks.map((b) => b.info),
    };
    this.reset();
  }

  get frameRate(): number {
    return MODELS[this.model].frameRate;
  }

  setModel(model: Model): void {
    this.model = model;
    this.reset();
  }

  reset(): void {
    this.scene = 'boot';
    this.bootFrame = 0;
    this.line = [];
    this.cursor = 'K';
    this.capsLock = false;
    this.menuItem = 0;
    this.border = 7;
    this.playing = false;
    this.registersNow = blankRegisters();
    // Power-on RAM holds whatever it holds.
    let seed = 0x2f6b;
    for (let i = 0; i < this.ram.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      this.ram[i] = seed >>> 24;
    }
  }

  setSampleRate(hz: number): void {
    this.sampleRate = hz;
  }

  // --- A frame -------------------------------------------------------------------------------------------------

  runFrame(): void {
    const info = MODELS[this.model];
    const lineT = info.frameTStates / (this.model === 'pentagon' ? 320 : info.menu ? 311 : 312);
    const lines = Math.round(info.frameTStates / lineT);
    this.boot();
    this.readKeys();
    this.instantLoad();

    // The tape, a line at a time: the border shows the loader's colours when the ROM is loading.
    this.edges.length = 0;
    const startLevel = this.signal?.level ?? false;
    const loading = this.scene === 'loading';
    for (let l = 0; l < lines; l++) {
      let colour = this.border;
      if (this.playing && this.signal) {
        const base = l * lineT;
        const more = this.signal.run(
          lineT,
          (at) => this.edges.push(base + at),
          (block, i, v) => this.byte(block, i, v),
        );
        if (!more) this.playing = false; // the tape said stop
        if (this.signal.done) this.playing = false;
        if (loading) {
          const phase = this.signal.phase;
          if (phase === 'lead') colour = this.signal.level ? 2 : 5;
          else if (phase === 'data') colour = this.signal.level ? 1 : 6;
        }
      }
      if (l < this.borderLines.length) this.borderLines[l] = colour;
    }
    if (loading && this.signal?.done) this.loaded();

    this.draw(lines);
    this.sound(info.frameTStates, startLevel);
    this.frameCount++;
    for (let i = 0; i < 40; i++) this.seen[i] = this.keys[i];
  }

  frame(): Uint8Array {
    return this.pixels;
  }

  audio(): Float32Array {
    return this.samples;
  }

  private draw(lines: number): void {
    const top = lines - FRAME_HEIGHT; // lines above the picture (16 on the 48K)
    const flash = (this.frameCount >> 4) & 1;
    const { ram, pixels } = this;
    for (let y = 0; y < FRAME_HEIGHT; y++) {
      const row = y * FRAME_WIDTH;
      const b = this.borderLines[Math.min(this.borderLines.length - 1, y + top)];
      if (y < 48 || y >= 240) {
        pixels.fill(b, row, row + FRAME_WIDTH);
        continue;
      }
      pixels.fill(b, row, row + 48);
      pixels.fill(b, row + 304, row + FRAME_WIDTH);
      const py = y - 48;
      const addr = ((py >> 6) << 11) | ((py & 7) << 8) | (((py >> 3) & 7) << 5);
      const attrs = 0x1800 + (py >> 3) * 32;
      for (let cx = 0; cx < 32; cx++) {
        const bits = ram[addr + cx];
        const a = ram[attrs + cx];
        const bright = a & 0x40 ? 8 : 0;
        let ink = (a & 7) | bright;
        let paper = ((a >> 3) & 7) | bright;
        if (a & 0x80 && flash) [ink, paper] = [paper, ink];
        const p = row + 48 + cx * 8;
        for (let i = 0; i < 8; i++) pixels[p + i] = bits & (0x80 >> i) ? ink : paper;
      }
    }
  }

  private sound(frameT: number, startLevel: boolean): void {
    const owed = this.sampleOwed + this.sampleRate / this.frameRate;
    const n = Math.floor(owed);
    this.sampleOwed = owed - n;
    if (this.samples.length !== n * 2) this.samples = new Float32Array(n * 2);
    let level = startLevel;
    let e = 0;
    const clickLen = Math.round(this.sampleRate * 0.004);
    for (let i = 0; i < n; i++) {
      const t = ((i + 0.5) * frameT) / n;
      while (e < this.edges.length && this.edges[e] <= t) {
        level = !level;
        e++;
      }
      let v = this.playing || this.edges.length ? (level ? 0.18 : -0.18) : 0;
      if (this.click > 0) {
        // The ROM's key click: a few milliseconds of the speaker toggled at about 1 kHz.
        v += (Math.floor((clickLen - this.click) / (this.sampleRate / 2000)) & 1 ? 0.12 : -0.12) * (this.click / clickLen);
        this.click--;
      }
      this.lowPass += (v - this.lowPass) * 0.45;
      this.samples[i * 2] = this.lowPass;
      this.samples[i * 2 + 1] = this.lowPass;
    }
  }

  // --- What the ROM would be doing ---------------------------------------------------------------------------------

  private boot(): void {
    if (this.scene !== 'boot') return;
    const f = this.bootFrame++;
    if (f === 18) {
      // The RAM test's first pass: every byte 2, which on the screen is a thin red line in each cell, on black.
      this.ram.fill(0x02, 0, 0x1b00);
    } else if (f === 30) {
      this.ram.fill(0);
    } else if (f >= BOOT_FRAMES) {
      this.ram.fill(0);
      this.ram.fill(ATTR_WHITE, 0x1800, 0x1b00);
      this.border = 7;
      if (MODELS[this.model].menu) {
        this.scene = 'menu';
        this.drawMenu();
      } else {
        this.scene = 'copyright';
        this.print(23, 0, COPYRIGHT_48);
      }
    }
  }

  private readKeys(): void {
    if (this.scene === 'boot' || this.scene === 'loading' || this.scene === 'running') return;
    const caps = !!this.keys[CAPS_SHIFT];
    const sym = !!this.keys[SYMBOL_SHIFT];
    const fresh: number[] = [];
    for (let code = 0; code < 40; code++) if (this.keys[code] && !this.seen[code] && code !== CAPS_SHIFT && code !== SYMBOL_SHIFT) fresh.push(code);
    const bothShiftsNew = caps && sym && (!this.seen[CAPS_SHIFT] || !this.seen[SYMBOL_SHIFT]) && fresh.length === 0;
    if (bothShiftsNew) {
      this.typed(-1, true, true);
      return;
    }
    if (fresh.length === 1) this.typed(fresh[0], caps, sym);
  }

  /** A key the ROM has taken (code -1: both shifts, extended mode). */
  private typed(code: number, caps: boolean, sym: boolean): void {
    this.click = Math.round(this.sampleRate * 0.004);
    if (this.scene === 'menu') return this.menuKey(code, caps);
    if (this.scene === 'copyright') {
      this.clearRows(22, 24);
      this.scene = 'editor';
    }
    const name = code >= 0 ? this.keyChar(code) : '';
    if (code < 0) {
      this.cursor = this.cursor === 'E' ? 'L' : 'E';
    } else if (code === ENTER) {
      this.enter();
      return;
    } else if (/^[0-9]$/.test(name)) {
      const d = Number(name);
      if (caps && !sym) {
        if (d === 0) this.line.pop();
        else if (d === 2) this.capsLock = !this.capsLock;
      } else if (this.cursor === 'E') {
        if (sym) this.line.push(` ${this.tokenAt(this.rom[0x0284 + d])} `);
        this.cursor = 'L';
      } else this.line.push(sym ? DIGIT_SYMBOLS[d] : name);
    } else if (code === SPACE) {
      if (!caps) this.line.push(' ');
    } else {
      const letter = name.charCodeAt(0) - 0x41;
      if (this.cursor === 'E') {
        this.line.push(` ${this.tokenAt(this.rom[(caps || sym ? 0x0246 : 0x022c) + letter])} `);
        this.cursor = 'L';
      } else if (sym) {
        this.line.push(this.tokenAt(this.rom[0x026a + letter]));
      } else if (this.cursor === 'K') {
        this.line.push(`${this.keyword(name)} `);
        this.cursor = 'L';
      } else {
        this.line.push(caps || this.capsLock ? name : name.toLowerCase());
      }
    }
    if (this.cursor === 'K' && this.line.length && !/^[0-9 ]+$/.test(this.line.join(''))) this.cursor = 'L';
    this.showLine();
  }

  private enter(): void {
    const text = this.line.join('').trim();
    this.line = [];
    this.cursor = 'K';
    if (/^LOAD\s*""$/.test(text)) {
      this.startLoading();
      return;
    }
    this.clearRows(22, 24);
    if (text) this.print(23, 0, '0 OK, 0:1');
    else this.showLine();
  }

  private menuKey(code: number, caps: boolean): void {
    const name = code >= 0 ? this.keyChar(code) : '';
    const items = this.menuItems();
    if (name === '6' || (caps && name === '6')) this.menuItem = (this.menuItem + 1) % items.length;
    else if (name === '7') this.menuItem = (this.menuItem + items.length - 1) % items.length;
    else if (code === ENTER) {
      if (this.menuItem === 0) return this.startLoading();
      this.ram.fill(0, 0, 0x1800);
      this.ram.fill(ATTR_WHITE, 0x1800, 0x1b00);
      this.scene = this.menuItem === 3 ? 'copyright' : 'editor';
      if (this.scene === 'copyright') this.print(23, 0, COPYRIGHT_48);
      else this.showLine();
      return;
    }
    this.drawMenu();
  }

  private startLoading(): void {
    this.ram.fill(0, 0, 0x1800);
    this.ram.fill(ATTR_WHITE, 0x1800, 0x1b00);
    this.scene = 'loading';
    if (this.opts.autoTape && this.signal && !this.signal.done) this.playing = true;
  }

  /** The tape has all been read: what was loaded runs (which the stand-in cannot do). */
  private loaded(): void {
    this.scene = 'running';
    this.playing = false;
  }

  /** A byte read from the tape while the ROM loads: a header's name is shown, a block the size of the screen goes to it. */
  private byte(block: number, index: number, value: number): void {
    if (this.scene !== 'loading') return;
    const data = this.blocks[block]?.data;
    if (!data) return;
    if (data.length === 6914 && index >= 1 && index <= 6912) this.ram[index - 1] = value;
    else if (data.length === 6912) this.ram[index] = value;
    else if (data.length === 19 && data[0] === 0 && index === 18) this.header(data);
  }

  private header(data: Uint8Array): void {
    const type = ['Program: ', 'Number array: ', 'Character array: ', 'Bytes: '][data[1]] ?? 'Bytes: ';
    const name = Array.from(data.subarray(2, 12), (c) => (c >= 32 && c < 128 ? String.fromCharCode(c) : ' ')).join('');
    this.clearRows(22, 23);
    this.print(22, 0, type + name.trimEnd());
  }

  /** Standard blocks taken at once, when instant loading is on and the ROM is loading. */
  private instantLoad(): void {
    if (!this.opts.instantLoad || this.scene !== 'loading' || !this.playing || !this.signal) return;
    while (!this.signal.done && this.blocks[this.signal.block].standard) {
      const b = this.blocks[this.signal.block];
      const data = b.data;
      if (data) for (let i = 0; i < data.length; i++) this.byte(this.signal.block, i, data[i]);
      this.signal.seek(this.signal.block + 1);
    }
    if (this.signal.done) this.loaded();
  }

  // --- The screen, in the ROM's font -------------------------------------------------------------------------------

  private print(row: number, col: number, text: string, attr = ATTR_WHITE): void {
    for (const ch of text) {
      if (col > 31) break;
      const code = ch === '©' ? 0x7f : ch.charCodeAt(0);
      const glyph = 0x3d00 + ((code >= 32 && code < 128 ? code : 63) - 32) * 8;
      const cell = ((row >> 3) << 11) | ((row & 7) << 5) | col;
      for (let i = 0; i < 8; i++) this.ram[cell + (i << 8)] = this.rom[glyph + i];
      this.ram[0x1800 + row * 32 + col] = attr;
      col++;
    }
  }

  private clearRows(from: number, to: number): void {
    for (let row = from; row < to; row++) this.print(row, 0, ' '.repeat(32));
  }

  private showLine(): void {
    this.clearRows(22, 24);
    const text = this.line.join('');
    const shown = text.slice(-31);
    this.print(23, 0, shown);
    const mode = this.cursor === 'L' && (this.capsLock) ? 'C' : this.cursor;
    this.print(23, shown.length, mode, 0x80 | ATTR_WHITE); // FLASH: the ROM's cursor
  }

  private menuItems(): string[] {
    return this.model === 'plus2a' || this.model === 'plus3' ? ['Loader', '+3 BASIC', 'Calculator', '48 BASIC'] : ['Tape Loader', '128 BASIC', 'Calculator', '48 BASIC'];
  }

  private drawMenu(): void {
    const title = this.model === 'plus2a' ? '+2A' : this.model === 'plus3' ? '+3' : '128';
    const copyright = this.model === 'plus2a' || this.model === 'plus3' ? '\x7f1982, 1986, 1987 Amstrad plc.' : '\x7f 1986 Sinclair Research Ltd';
    this.print(7, 7, ` ${title}`.padEnd(12), 0x47); // bright white on black
    // The four stripes at the end of the title bar.
    [0x50, 0x70, 0x60, 0x68].forEach((attr, i) => this.print(7, 19 + i, ' ', attr));
    this.print(7, 23, ' ', 0x47);
    this.menuItems().forEach((item, i) => this.print(8 + i, 7, ` ${item}`.padEnd(17), i === this.menuItem ? 0x68 : ATTR_WHITE));
    this.print(12, 7, ' '.repeat(17), ATTR_WHITE);
    this.print(23, 0, copyright);
  }

  // --- Keys and their legends ----------------------------------------------------------------------------------------

  /** A key's own character, from the ROM's main key table (0205h: bit 4 to bit 0, half-rows 7 to 0). */
  private keyChar(code: number): string {
    const r = Math.floor(code / 5);
    const b = code % 5;
    return String.fromCharCode(this.rom[0x0205 + (4 - b) * 8 + (7 - r)]);
  }

  private tokenAt(code: number): string {
    if (code >= 0xa5) return this.tokens[code - 0xa5].trim();
    if (code === 0x60) return '£';
    if (code === 0x7f) return '©';
    return String.fromCharCode(code);
  }

  /** The keyword a letter gives in K mode: its token is the letter + A5h. */
  private keyword(letter: string): string {
    return this.tokenAt(letter.charCodeAt(0) + 0xa5);
  }

  key(code: number, down: boolean): void {
    if (code < 0 || code >= 40) return;
    this.keys[code] = down ? 1 : 0;
    this.keyLog.push({ code, down, frame: this.frameCount });
    if (this.keyLog.length > 2000) this.keyLog.splice(0, 1000);
  }

  releaseKeys(): void {
    for (let code = 0; code < 40; code++) if (this.keys[code]) this.key(code, false);
  }

  joystick(kind: JoystickKind, bits: number): void {
    this.joystickState = { kind, bits };
  }

  // --- Files -------------------------------------------------------------------------------------------------------

  load(bytes: Uint8Array, name: string): LoadResult {
    if (isZip(bytes)) {
      const entries = unzip(bytes);
      const rank = (n: string) => ['.tzx', '.tap', '.z80', '.sna', '.szx', '.scr'].findIndex((e) => n.toLowerCase().endsWith(e));
      const usable = entries.filter((e) => rank(e.name) >= 0).sort((a, b) => rank(a.name) - rank(b.name));
      if (!usable.length) throw new LoadError(`${name} has no tape, snapshot or screen in it (it has ${entries.map((e) => e.name).join(', ') || 'nothing'}).`);
      return this.load(usable[0].read(), usable[0].name.split('/').pop() ?? usable[0].name);
    }
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (isTzx(bytes) || ext === 'tap' || (ext !== 'z80' && ext !== 'sna' && ext !== 'scr' && looksLikeTap(bytes))) {
      try {
        this.blocks = isTzx(bytes) ? parseTzx(bytes) : parseTap(bytes);
      } catch (e) {
        throw new LoadError(`${name}: ${(e as Error).message}`);
      }
      this.signal = new Signal(this.blocks);
      this.playing = false;
      return { kind: 'tape', name, blocks: this.blocks.map((b) => b.info) };
    }
    if (isSzx(bytes) || ext === 'z80' || ext === 'sna') {
      let snap: StubSnapshot;
      try {
        snap = isSzx(bytes) ? readSzx(bytes) : ext === 'sna' ? readSna(bytes) : readZ80(bytes);
      } catch (e) {
        throw new LoadError(`${name}: ${(e as Error).message}`);
      }
      this.model = snap.model;
      this.reset();
      this.ram.set(snap.ram);
      this.registersNow = snap.registers;
      this.border = snap.border;
      this.scene = 'running';
      return { kind: 'snapshot', name, model: snap.model };
    }
    if (ext === 'scr' || bytes.length === 6912) {
      this.ram.set(bytes.subarray(0, 6912));
      return { kind: 'screen', name };
    }
    if (/^(csw|pzx)$/.test(ext)) throw new LoadError(`${name}: the stand-in emulator plays TAP and TZX tapes (the real one plays CSW and PZX too).`);
    throw new LoadError(`${name} is not a tape, a snapshot or a screen.`);
  }

  options(): Options {
    return { ...this.opts };
  }

  setOptions(options: Partial<Options>): void {
    this.opts = { ...this.opts, ...options };
  }

  private snapshot(): StubSnapshot {
    return { model: this.model, ram: this.ram, registers: this.registers(), border: this.border };
  }

  saveSnapshot(format: SnapshotFormat): Uint8Array {
    const s = this.snapshot();
    return format === 'szx' ? writeSzx(s) : format === 'sna' ? writeSna(s) : writeZ80(s);
  }

  saveState(): Uint8Array {
    const saved: SavedState = {
      model: this.model,
      scene: this.scene,
      bootFrame: this.bootFrame,
      line: this.line,
      cursor: this.cursor,
      capsLock: this.capsLock,
      menuItem: this.menuItem,
      border: this.border,
      playing: this.playing,
      tape: this.signal?.save() ?? null,
      registers: this.registersNow,
    };
    const json = new TextEncoder().encode(JSON.stringify(saved));
    const out = new Uint8Array(8 + json.length + this.ram.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, STATE_MAGIC);
    v.setUint32(4, json.length);
    out.set(json, 8);
    out.set(this.ram, 8 + json.length);
    return out;
  }

  loadState(state: Uint8Array): void {
    const v = new DataView(state.buffer, state.byteOffset, state.byteLength);
    if (state.length < 8 || v.getUint32(0) !== STATE_MAGIC) throw new Error('not a state of the stand-in emulator');
    const len = v.getUint32(4);
    const saved = JSON.parse(new TextDecoder().decode(state.subarray(8, 8 + len))) as SavedState;
    this.model = saved.model;
    this.scene = saved.scene;
    this.bootFrame = saved.bootFrame;
    this.line = saved.line;
    this.cursor = saved.cursor;
    this.capsLock = saved.capsLock;
    this.menuItem = saved.menuItem;
    this.border = saved.border;
    this.registersNow = saved.registers;
    this.ram.set(state.subarray(8 + len, 8 + len + this.ram.length));
    if (saved.tape && this.signal) this.signal.restore(saved.tape);
    this.playing = saved.playing && !!this.signal;
  }

  peek(address: number): number {
    address &= 0xffff;
    return address < 0x4000 ? this.rom[address] : this.ram[address - 0x4000];
  }

  poke(address: number, value: number): void {
    address &= 0xffff;
    if (address >= 0x4000) this.ram[address - 0x4000] = value & 0xff;
  }

  registers(): Registers {
    const pc = { boot: 0x11dc, copyright: 0x10b0, editor: 0x10b0, menu: 0x2653, loading: 0x05ed, running: this.registersNow.pc }[this.scene];
    return { ...this.registersNow, pc };
  }
}

/** What SYMBOL SHIFT with each digit types (the ROM works these out in K-KLC-DGT). */
const DIGIT_SYMBOLS = ['_', '!', '@', '#', '$', '%', '&', "'", '(', ')'];

/** The ROM's keywords, RND (A5h) to COPY (FFh), from its token table at 0095h: each ends with bit 7 set. */
function readTokens(rom: Uint8Array): string[] {
  const out: string[] = [];
  let p = 0x0095;
  let word = '';
  while (out.length < 92 && p < 0x0400) {
    const b = rom[p++];
    word += String.fromCharCode(b & 0x7f);
    if (b & 0x80) {
      out.push(word);
      word = '';
    }
  }
  return out.slice(1); // the first is the '?' of the error message, not a token
}
