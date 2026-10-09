// The real machine: crates/wasm (spectrum::Machine behind a C interface) compiled to WebAssembly, as the Emulator the
// page talks to. Numbers go in and out of the module; files, states and answers go through its memory (zx_alloc,
// then the handle's out-buffer); the picture and the sound are read in place, as views into its memory. docs/web.md
// lists the interface; crates/wasm/src/lib.rs is its source.
//
// The page runs everything here on its main thread: a frame of the 48K is a fifth of a millisecond of WebAssembly.
//
// A view of the module's memory (the picture, the sound) is good only until the next call into the module: any call
// may grow the memory, which detaches every view made before. Pointers come back as signed 32-bit numbers, and are
// made unsigned before use (`>>> 0`), so that a module past 2 GB reads where it should. A trap in the module (a
// WebAssembly.RuntimeError: out of memory, a bug) leaves its memory in no state to trust: the emulator is then dead,
// every call refuses, and `revive()` makes a new instance of the same module (the page puts back where it was).

import wasmUrl from './zx.wasm?url';
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  LoadError,
  MODEL_IDS,
  MODELS,
  type Emulator,
  type Instruction,
  type JoystickKind,
  type LoadResult,
  type Model,
  type Options,
  type Registers,
  type SnapshotFormat,
  type StepResult,
  type Tape,
  type TapeBlock,
  type TapeState,
} from './emulator';

/** The module's exports (crates/wasm/src/lib.rs). Handles and pointers are numbers into its memory. */
export interface ZxExports {
  readonly memory: WebAssembly.Memory;
  zx_alloc(len: number): number;
  zx_dealloc(ptr: number, len: number): void;
  zx_out_ptr(h: number): number;
  zx_out_len(h: number): number;
  zx_new(model: number): number;
  zx_free(h: number): void;
  zx_power_on(h: number, model: number): number;
  zx_reset(h: number): void;
  zx_nmi(h: number): void;
  zx_model(h: number): number;
  zx_run_frame(h: number): number;
  zx_run_frames(h: number, n: number): number;
  zx_step(h: number): number;
  zx_frame_count(h: number): number;
  zx_tstate(h: number): number;
  zx_set_tstate(h: number, t: number): void;
  zx_frame_ptr(h: number): number;
  zx_frame_len(): number;
  zx_audio_ptr(h: number): number;
  zx_audio_len(h: number): number;
  zx_set_sample_rate(h: number, hz: number): void;
  zx_key(h: number, code: number, down: number): void;
  zx_key_down(h: number, code: number): number;
  zx_release_keys(h: number): void;
  zx_joystick(h: number, kind: number, bits: number): void;
  zx_type_text(h: number, ptr: number, len: number): number;
  zx_load(h: number, ptr: number, len: number, namePtr: number, nameLen: number): number;
  zx_tape_play(h: number): void;
  zx_tape_stop(h: number): void;
  zx_tape_rewind(h: number): void;
  zx_tape_seek(h: number, block: number): void;
  zx_tape_eject(h: number): void;
  zx_tape_state(h: number): number;
  zx_tape_active(h: number): number;
  zx_tape_blocks(h: number): number;
  zx_tape_name(h: number): number;
  zx_saved_tap(h: number): number;
  zx_options(h: number): number;
  zx_set_options(h: number, bits: number): void;
  zx_set_volume(h: number, volume: number): void;
  zx_save_state(h: number): number;
  zx_load_state(h: number, ptr: number, len: number): number;
  zx_save_snapshot(h: number, format: number): number;
  zx_registers(h: number): number;
  zx_set_register(h: number, index: number, value: number): number;
  zx_peek(h: number, addr: number): number;
  zx_poke(h: number, addr: number, value: number): void;
  zx_disassemble(h: number, addr: number, count: number): number;
  zx_add_breakpoint(h: number, pc: number): void;
  zx_remove_breakpoint(h: number, pc: number): void;
  zx_clear_breakpoints(h: number): void;
  zx_screen_text(h: number): number;
  zx_state_picture(h: number, ptr: number, len: number): number;
}

/** The option bits of zx_options / zx_set_options. */
export const OPT = {
  issue2: 1 << 0,
  lateTimings: 1 << 1,
  instantLoad: 1 << 2,
  autoTape: 1 << 3,
  tapeSound: 1 << 4,
  snow: 1 << 5,
  ayOn48k: 1 << 6,
  ghosting: 1 << 7,
  sound: 1 << 8,
  stereoShift: 12,
} as const;

const STEREO = ['mono', 'abc', 'acb'] as const;
/** The largest file the module takes (crates/wasm's MAX_FILE). */
const MAX_FILE = 16 << 20;
const JOYSTICKS: readonly JoystickKind[] = ['none', 'kempston', 'sinclair1', 'sinclair2', 'cursor'];
const FORMATS: Readonly<Record<SnapshotFormat, number>> = { z80: 0, szx: 1, sna: 2 };

/** The module, fetched and compiled once (streamed: compiled as it arrives, and cached by the browser compiled). */
let compiled: Promise<WebAssembly.Module> | null = null;

function compile(): Promise<WebAssembly.Module> {
  compiled ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`could not fetch the emulator (${response.status})`);
    // A server that does not say application/wasm cannot be streamed from: compiled from its bytes instead.
    if (typeof WebAssembly.compileStreaming === 'function' && (response.headers.get('content-type') ?? '').startsWith('application/wasm')) {
      return WebAssembly.compileStreaming(response);
    }
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  compiled.catch(() => (compiled = null));
  return compiled;
}

/** An instance of the module: a machine's worth of memory of its own. */
export async function instantiateZx(): Promise<ZxExports> {
  const instance = await WebAssembly.instantiate(await compile(), {});
  return instance.exports as unknown as ZxExports;
}

export async function createWasmEmulator(): Promise<WasmEmulator> {
  return new WasmEmulator(await instantiateZx(), '48k', instantiateZx);
}

/** Thrown by every call into an emulator whose module trapped, until it is revived. */
export class EmulatorStopped extends Error {
  override name = 'EmulatorStopped';
}

export class WasmEmulator implements Emulator {
  readonly frameWidth = FRAME_WIDTH;
  readonly frameHeight = FRAME_HEIGHT;
  readonly tape: Tape;
  /** The keys the page put down or up, with the frame: for tests, as the stand-in keeps them. */
  readonly keyLog: { code: number; down: boolean; frame: number }[] = [];
  /** The joystick as last set: for tests. */
  joystickState: { kind: JoystickKind; bits: number } = { kind: 'none', bits: 0 };
  breakpoint: number | null = null;

  private x: ZxExports;
  private h: number;
  private bytes8: Uint8Array;
  /** Why the module trapped, while it is dead. */
  private deadBecause: string | null = null;
  private readonly fresh: (() => Promise<ZxExports>) | null;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private blocksCache: readonly TapeBlock[] | null = null;
  private opts: Options = { instantLoad: false, acceleratedLoad: true, autoTape: true, issue2: false, ayStereo: 'acb' };
  private soundOn = true;
  private breakpointList: number[] = [];

  /** `fresh` makes another instance of the module, for `revive()` (none: the emulator cannot be revived). */
  constructor(exports: ZxExports, model: Model = '48k', fresh: (() => Promise<ZxExports>) | null = null) {
    this.fresh = fresh;
    this.x = exports;
    this.h = exports.zx_new(MODEL_IDS.indexOf(model));
    if (!this.h) throw new Error('the emulator would not start');
    this.bytes8 = new Uint8Array(exports.memory.buffer);
    this.applyOptions();
    const self = this;
    this.tape = {
      play: () => this.call((x) => x.zx_tape_play(this.h)),
      stop: () => this.call((x) => x.zx_tape_stop(this.h)),
      rewind: () =>
        this.call((x) => {
          x.zx_tape_stop(this.h);
          x.zx_tape_rewind(this.h);
        }),
      eject: () => {
        this.call((x) => x.zx_tape_eject(this.h));
        this.blocksCache = null;
      },
      seek: (index: number) => this.call((x) => x.zx_tape_seek(this.h, Math.max(0, Math.floor(index)))),
      state: (): TapeState => {
        if (this.deadBecause) return { loaded: false, playing: false, block: 0, position: 0, length: 0 };
        return this.call((x) => {
          const p = (x.zx_tape_state(this.h) >>> 0) >>> 3;
          const f = new Float64Array(x.memory.buffer);
          return { loaded: f[p] !== 0, playing: f[p + 1] !== 0, block: f[p + 2], position: f[p + 3], length: f[p + 4] };
        });
      },
      blocks: (): readonly TapeBlock[] => {
        if (self.deadBecause) return [];
        if (!self.blocksCache) self.blocksCache = JSON.parse(self.outText(self.call((x) => x.zx_tape_blocks(self.h)))) as TapeBlock[];
        return self.blocksCache;
      },
    };
  }

  // --- A trap, and coming back from one --------------------------------------------------------------------------

  /** Why the module stopped (a trap), or null while it runs. */
  get stopped(): string | null {
    return this.deadBecause;
  }

  /** A call into the module: refused while it is dead, and a trap in it kills it. */
  private call<T>(f: (x: ZxExports) => T): T {
    if (this.deadBecause) throw new EmulatorStopped(`The machine stopped: ${this.deadBecause}`);
    try {
      return f(this.x);
    } catch (e) {
      if (e instanceof WebAssembly.RuntimeError) {
        this.deadBecause = e.message || 'it trapped';
        this.breakpoint = null;
      }
      throw e;
    }
  }

  /**
   * A new instance of the module, after a trap: switched on as the model it was, with the options and breakpoints
   * it had. The tape and the moment are the page's to put back (it keeps both). The old instance's memory is let go.
   */
  async revive(): Promise<void> {
    if (!this.fresh) throw new Error('this emulator cannot be started again');
    const model = this.deadBecause ? '48k' : this.model;
    const x = await this.fresh();
    const h = x.zx_new(MODEL_IDS.indexOf(model));
    if (!h) throw new Error('the emulator would not start');
    this.x = x;
    this.h = h;
    this.bytes8 = new Uint8Array(x.memory.buffer);
    this.blocksCache = null;
    this.breakpoint = null;
    this.deadBecause = null;
    this.applyOptions();
    this.setBreakpoints(this.breakpointList);
  }

  // --- The module's memory -------------------------------------------------------------------------------------------

  /** The module's memory as bytes: a fresh view once it has grown (the old one is then detached). */
  private mem(): Uint8Array {
    if (this.bytes8.buffer !== this.x.memory.buffer) this.bytes8 = new Uint8Array(this.x.memory.buffer);
    return this.bytes8;
  }

  /** `bytes` copied into the module for the length of `use`. */
  private withBytes<T>(bytes: Uint8Array, use: (ptr: number, len: number) => T): T {
    const len = bytes.length;
    const ptr = this.call((x) => x.zx_alloc(len)) >>> 0;
    try {
      this.mem().set(bytes, ptr);
      return use(ptr, len);
    } finally {
      if (!this.deadBecause) this.x.zx_dealloc(ptr, len);
    }
  }

  /** The out-buffer's first `len` bytes, copied out. */
  private out(len: number): Uint8Array {
    const ptr = this.call((x) => x.zx_out_ptr(this.h)) >>> 0;
    return this.mem().slice(ptr, ptr + Math.max(0, len));
  }

  private outText(len: number): string {
    const ptr = this.call((x) => x.zx_out_ptr(this.h)) >>> 0;
    return this.decoder.decode(this.mem().subarray(ptr, ptr + Math.max(0, len)));
  }

  /** The message a failed call left. */
  private why(): string {
    return this.outText(this.call((x) => x.zx_out_len(this.h)) >>> 0);
  }

  // --- The machine -----------------------------------------------------------------------------------------------------

  get model(): Model {
    if (this.deadBecause) return '48k';
    return MODEL_IDS[this.call((x) => x.zx_model(this.h))] ?? '48k';
  }

  get frameRate(): number {
    return MODELS[this.model].frameRate;
  }

  get frameCount(): number {
    if (this.deadBecause) return 0;
    return this.call((x) => x.zx_frame_count(this.h));
  }

  setModel(model: Model): void {
    this.call((x) => x.zx_power_on(this.h, MODEL_IDS.indexOf(model)));
    this.breakpoint = null;
  }

  /** Off and on again, as the same machine; the tape stays in the deck. */
  reset(): void {
    this.setModel(this.model);
  }

  runFrame(): void {
    this.breakpoint = null;
    if (this.call((x) => x.zx_run_frame(this.h)) === 1) this.breakpoint = this.registers().pc;
  }

  frame(): Uint8Array {
    return this.call((x) => new Uint8Array(x.memory.buffer, x.zx_frame_ptr(this.h) >>> 0, FRAME_WIDTH * FRAME_HEIGHT));
  }

  audio(): Float32Array {
    return this.call((x) => {
      const len = x.zx_audio_len(this.h) >>> 0;
      if (!len) return new Float32Array(0);
      return new Float32Array(x.memory.buffer, x.zx_audio_ptr(this.h) >>> 0, len);
    });
  }

  setSampleRate(hz: number): void {
    this.call((x) => x.zx_set_sample_rate(this.h, Math.max(1, Math.round(hz))));
  }

  setSound(on: boolean): void {
    if (on === this.soundOn) return;
    this.soundOn = on;
    this.applyOptions();
  }

  // --- Input -----------------------------------------------------------------------------------------------------------

  key(code: number, down: boolean): void {
    if (code < 0 || code >= 40 || this.deadBecause) return;
    this.call((x) => x.zx_key(this.h, code, down ? 1 : 0));
    this.keyLog.push({ code, down, frame: this.frameCount });
    if (this.keyLog.length > 2000) this.keyLog.splice(0, 1000);
  }

  releaseKeys(): void {
    if (!this.deadBecause) this.call((x) => x.zx_release_keys(this.h));
  }

  joystick(kind: JoystickKind, bits: number): void {
    this.joystickState = { kind, bits };
    this.call((x) => x.zx_joystick(this.h, Math.max(0, JOYSTICKS.indexOf(kind)), bits & 31));
  }

  // --- Files -----------------------------------------------------------------------------------------------------------

  load(bytes: Uint8Array, name: string): LoadResult {
    // Refused before it is copied in: the module's memory, once grown, is never given back.
    if (bytes.length > MAX_FILE) throw new LoadError(`${name} is ${Math.round(bytes.length / 1048576)} MB, larger than any Spectrum file (16 MB at most).`);
    const nameBytes = this.encoder.encode(name);
    const code = this.withBytes(bytes, (ptr, len) => this.withBytes(nameBytes, (np, nl) => this.call((x) => x.zx_load(this.h, ptr, len, np, nl))));
    // Whatever was refused, the deck may have changed (a tape taken out for the new one): its list is asked again.
    this.blocksCache = null;
    if (code < 0) throw new LoadError(sentence(this.why()));
    const result = JSON.parse(this.why()) as { kind: LoadResult['kind']; name: string; model: Model | null; others: string[] };
    // A tape goes in; a snapshot can bring one of its own (an .szx's embedded tape) or none.
    this.breakpoint = null;
    return { kind: result.kind, name: result.name, model: result.model ?? undefined, blocks: result.kind === 'tape' ? this.tape.blocks() : undefined };
  }

  options(): Options {
    return { ...this.opts };
  }

  setOptions(options: Partial<Options>): void {
    this.opts = { ...this.opts, ...options };
    this.applyOptions();
  }

  /** The machine's options from the page's: the rest are the machine's own defaults (snow, ghosting, the tape heard). */
  private applyOptions(): void {
    if (this.deadBecause) return;
    const o = this.opts;
    this.call((x) => {
      let bits = x.zx_options(this.h);
      const set = (bit: number, on: boolean) => (bits = on ? bits | bit : bits & ~bit);
      set(OPT.instantLoad, o.instantLoad);
      set(OPT.autoTape, o.autoTape);
      set(OPT.issue2, o.issue2);
      set(OPT.sound, this.soundOn);
      bits = (bits & ~(3 << OPT.stereoShift)) | (STEREO.indexOf(o.ayStereo) << OPT.stereoShift);
      x.zx_set_options(this.h, bits >>> 0);
    });
  }

  saveSnapshot(format: SnapshotFormat): Uint8Array {
    const n = this.call((x) => x.zx_save_snapshot(this.h, FORMATS[format]));
    if (n < 0) throw new Error(sentence(this.why()));
    return this.out(n);
  }

  saveState(): Uint8Array {
    return this.out(this.call((x) => x.zx_save_state(this.h)));
  }

  loadState(state: Uint8Array): void {
    const code = this.withBytes(state, (ptr, len) => this.call((x) => x.zx_load_state(this.h, ptr, len)));
    if (code < 0) throw new Error(sentence(this.why()));
    this.blocksCache = null;
    this.breakpoint = null;
  }

  /** The picture a saved state holds, read from the state alone (zx_state_picture): the machine goes on as it was. */
  statePicture(state: Uint8Array): Uint8Array | null {
    const n = this.withBytes(state, (ptr, len) => this.call((x) => x.zx_state_picture(this.h, ptr, len)));
    if (n < 0) return null;
    return this.out(n);
  }

  savedTap(): Uint8Array {
    return this.out(this.call((x) => x.zx_saved_tap(this.h)));
  }

  screenText(): string {
    return this.outText(this.call((x) => x.zx_screen_text(this.h)));
  }

  // --- The debugger ----------------------------------------------------------------------------------------------------

  peek(address: number): number {
    return this.call((x) => x.zx_peek(this.h, address & 0xffff));
  }

  poke(address: number, value: number): void {
    this.call((x) => x.zx_poke(this.h, address & 0xffff, value & 0xff));
  }

  registers(): Registers {
    return this.call((x) => {
      const p = (x.zx_registers(this.h) >>> 0) >>> 2;
      const r = new Uint32Array(x.memory.buffer, p * 4, 20);
      return {
        af: r[0], bc: r[1], de: r[2], hl: r[3], af_: r[4], bc_: r[5], de_: r[6], hl_: r[7], ix: r[8], iy: r[9], sp: r[10], pc: r[11],
        i: r[12], r: r[13], im: r[14], iff1: r[15] !== 0, iff2: r[16] !== 0, halted: r[17] !== 0, t: r[19],
      };
    });
  }

  disassemble(address: number, count: number): readonly Instruction[] {
    return JSON.parse(this.outText(this.call((x) => x.zx_disassemble(this.h, address & 0xffff, count)))) as Instruction[];
  }

  setBreakpoints(addresses: readonly number[]): void {
    this.breakpointList = [...new Set(addresses.map((a) => a & 0xffff))];
    this.call((x) => {
      x.zx_clear_breakpoints(this.h);
      for (const a of this.breakpointList) x.zx_add_breakpoint(this.h, a);
    });
  }

  breakpoints(): readonly number[] {
    return this.breakpointList;
  }

  /** One instruction: whether it was the frame's last (the picture and the sound are then the frame's), or a breakpoint stopped it. */
  step(): StepResult {
    this.breakpoint = null;
    const code = this.call((x) => x.zx_step(this.h));
    if (code === 1) {
      this.breakpoint = this.registers().pc;
      return 'breakpoint';
    }
    return code === 2 ? 'frame' : 'instruction';
  }
}

/** A message as the page shows it: a capital, a full stop. */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return 'The emulator could not do that.';
  return `${t[0].toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
}
