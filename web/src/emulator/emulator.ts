// The emulator as the rest of the page sees it. Nothing else in the page touches the core: the real one (Rust compiled
// to WebAssembly, crates/wasm) is wrapped to this interface (wasm.ts), and so is the stand-in (stub.ts) the page was
// built against, kept for tests of the page alone. docs/web.md says what each member must do.
//
// Everything here is synchronous and runs on the page's main thread: a frame of the 48K is 69,888 T-states, a fifth
// of a millisecond of WebAssembly, and the page decides when to run one (the emulator never reads a clock).

/** The machines, as docs/architecture.md lists them. */
export type Model = '16k' | '48k' | '128k' | 'plus2' | 'plus2a' | 'plus3' | 'pentagon';

/** What the page needs to know of a model to schedule it and to talk to it. */
export interface ModelInfo {
  readonly id: Model;
  /** As the machine's case said it. */
  readonly name: string;
  /** Short, for a chip on the toolbar. */
  readonly short: string;
  /** The Z80's clock, Hz. */
  readonly clockHz: number;
  /** T-states in a video frame. */
  readonly frameTStates: number;
  /** Video frames a second: clock / frame. */
  readonly frameRate: number;
  /** Boots into the 128 menu (and so loads a tape with ENTER on its first item), rather than 48 BASIC. */
  readonly menu: boolean;
  /** Has an AY-3-8912. */
  readonly ay: boolean;
}

function model(id: Model, name: string, short: string, clockHz: number, frameTStates: number, menu: boolean): ModelInfo {
  return { id, name, short, clockHz, frameTStates, frameRate: clockHz / frameTStates, menu, ay: menu };
}

/** Frame lengths and clocks from docs/architecture.md (the 48K: 224 T a line, 312 lines; the 128K: 228 × 311). */
export const MODELS: Readonly<Record<Model, ModelInfo>> = {
  '16k': model('16k', 'ZX Spectrum 16K', '16K', 3_500_000, 69_888, false),
  '48k': model('48k', 'ZX Spectrum 48K', '48K', 3_500_000, 69_888, false),
  '128k': model('128k', 'ZX Spectrum 128', '128K', 3_546_900, 70_908, true),
  plus2: model('plus2', 'ZX Spectrum +2', '+2', 3_546_900, 70_908, true),
  plus2a: model('plus2a', 'ZX Spectrum +2A', '+2A', 3_546_900, 70_908, true),
  plus3: model('plus3', 'ZX Spectrum +3', '+3', 3_546_900, 70_908, true),
  pentagon: model('pentagon', 'Pentagon 128', 'Pentagon', 3_500_000, 71_680, true),
};

export const MODEL_IDS = Object.keys(MODELS) as Model[];

/** The picture the emulator hands out: one byte a pixel, a colour 0–15 (8–15 bright), paper at (48, 48). */
export const FRAME_WIDTH = 352;
export const FRAME_HEIGHT = 296;
export const PAPER_X = 48;
export const PAPER_Y = 48;

/**
 * How a joystick reaches the machine. Kempston is read at port 1F; Sinclair 1 is keys 6–0 (the right-hand port of
 * the +2, "Interface 2 left"), Sinclair 2 keys 1–5, cursor (Protek, AGF) keys 5–8 and 0.
 */
export type JoystickKind = 'none' | 'kempston' | 'sinclair1' | 'sinclair2' | 'cursor';

/** A joystick's state: five bits, as the Kempston interface reads them. */
export const JOY = { right: 1, left: 2, down: 4, up: 8, fire: 16 } as const;

/** What a tape block is, for the deck's list. */
export type TapeBlockKind =
  | 'header' // a standard ROM header (Program:, Bytes:, ...), whose name is in `label`
  | 'data' // a standard ROM data block
  | 'turbo' // a block with its own timings, often a custom loader's
  | 'tone' // a pure tone, pulses, or a raw signal (direct recording, CSW)
  | 'pause' // silence, or "stop the tape"
  | 'stop' // the tape stops here (TZX 20 with no length, 2A "stop if 48K")
  | 'group' // a group's start or end, a loop, a jump: structure, no signal
  | 'info'; // text: an archive info block, a message, a description

export interface TapeBlock {
  readonly kind: TapeBlockKind;
  /** What the deck shows: `Program: SABOTEUR`, `Bytes: 6912`, `Turbo data`, `Pause 1.0 s`. */
  readonly label: string;
  /** Bytes of data the block carries, where it carries any. */
  readonly bytes?: number;
  /** How long it plays, seconds, at 3.5 MHz (0 for one with no signal). */
  readonly seconds: number;
}

export interface TapeState {
  /** A tape is in the deck. */
  readonly loaded: boolean;
  /** Its motor runs (by the deck's buttons, or by the machine when tape starting and stopping is automatic). */
  readonly playing: boolean;
  /** The block under the head, an index into `blocks()`; `blocks().length` once it has all played. */
  readonly block: number;
  /** Seconds of tape behind the head, from the start: what the counter shows. */
  readonly position: number;
  /** Seconds the whole tape plays. */
  readonly length: number;
}

/** The cassette deck. Every call is harmless with no tape in it. */
export interface Tape {
  play(): void;
  stop(): void;
  /** Back to the start, stopped. */
  rewind(): void;
  /** Out of the deck. */
  eject(): void;
  /** The head to the start of block `index`, keeping the motor as it is. */
  seek(index: number): void;
  state(): TapeState;
  blocks(): readonly TapeBlock[];
}

/** What `load` found in a file. */
export interface LoadResult {
  /** A tape went into the deck (not played: the page or the machine starts it); a snapshot replaced the machine; a screen was put on it. */
  readonly kind: 'tape' | 'snapshot' | 'screen';
  /** The file's own name, or the name of the member of a .zip that was used. */
  readonly name: string;
  /** The model a snapshot needs; the machine has already been switched to it. */
  readonly model?: Model;
  /** A tape's blocks. */
  readonly blocks?: readonly TapeBlock[];
}

/** Thrown by `load` for a file the emulator cannot use, with a message a person can read. */
export class LoadError extends Error {
  override name = 'LoadError';
}

export type AyStereo = 'mono' | 'abc' | 'acb';

export interface Options {
  /** Standard ROM blocks are loaded at once by trapping LD-BYTES; other blocks play as usual. */
  instantLoad: boolean;
  /** The core may speed up what it recognises as a loader while the tape plays (the page also runs flat out). */
  acceleratedLoad: boolean;
  /** The machine starts the tape when it starts reading EAR and stops it when it stops. */
  autoTape: boolean;
  /** An Issue 2 keyboard (EAR read back as it was on the early boards: some old games need it). */
  issue2: boolean;
  /** Where the AY's three channels sit. */
  ayStereo: AyStereo;
}

/** The Z80's registers, for the debugger. */
export interface Registers {
  af: number;
  bc: number;
  de: number;
  hl: number;
  af_: number;
  bc_: number;
  de_: number;
  hl_: number;
  ix: number;
  iy: number;
  sp: number;
  pc: number;
  i: number;
  r: number;
  im: number;
  iff1: boolean;
  iff2: boolean;
  halted: boolean;
  /** T-states into the current frame. */
  t: number;
}

export type SnapshotFormat = 'z80' | 'szx' | 'sna';

/** What a step did: ran an instruction, ran the frame's last one (the picture and the sound are the frame's), or stopped at a breakpoint. */
export type StepResult = 'instruction' | 'frame' | 'breakpoint';

/** An instruction, as the debugger lists it. */
export interface Instruction {
  readonly addr: number;
  readonly len: number;
  /** `LD HL,#4000` */
  readonly text: string;
}

export interface Emulator {
  /** The picture's size: FRAME_WIDTH × FRAME_HEIGHT. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** The machine it is now. */
  readonly model: Model;
  /** Its frames a second (MODELS[model].frameRate): 50.08 on the 48K. */
  readonly frameRate: number;
  /** Frames run since the emulator was made: the page's count of emulated time. */
  readonly frameCount: number;

  /** Becomes another machine, switched on afresh (the tape stays in the deck). */
  setModel(model: Model): void;
  /** Off and on again. */
  reset(): void;

  /** Runs one video frame. */
  runFrame(): void;
  /** The last frame's picture, FRAME_WIDTH × FRAME_HEIGHT palette indices. It may be a view into the core's memory: valid until the next call. */
  frame(): Uint8Array;
  /** The last frame's sound: stereo, interleaved (L, R, L, R...), at the rate `setSampleRate` set. Valid until the next call. */
  audio(): Float32Array;
  /** The rate `audio()` is made at, Hz. A frame's length in samples follows from it (958 or 959 at 48 kHz on the 48K). */
  setSampleRate(hz: number): void;

  /** A key down or up: code = half-row × 5 + bit (keys.ts). */
  key(code: number, down: boolean): void;
  /** Every key up: when the page loses focus with keys held. */
  releaseKeys(): void;
  /** The joystick's five bits (JOY), through the interface `kind`. */
  joystick(kind: JoystickKind, bits: number): void;

  /** A tape (TAP, TZX, CSW, PZX), a snapshot (Z80, SNA, SZX), a screen (SCR), or a .zip of one. Throws LoadError. */
  load(bytes: Uint8Array, name: string): LoadResult;
  readonly tape: Tape;

  options(): Options;
  setOptions(options: Partial<Options>): void;

  /** The machine as a snapshot file. */
  saveSnapshot(format: SnapshotFormat): Uint8Array;
  /** The whole machine, fast, in the core's own format: for rewinding. Restored by `loadState` on the same build. */
  saveState(): Uint8Array;
  loadState(state: Uint8Array): void;

  /**
   * The picture a saved state holds (the frame it was taken after), without disturbing the machine; null if the
   * emulator cannot say (the page then keeps each moment's picture beside its state).
   */
  statePicture(state: Uint8Array): Uint8Array | null;
  /** Whether frames make sound: off while the page runs flat out, when nothing would play it. */
  setSound(on: boolean): void;
  /** What a SAVE has recorded on the MIC line, as a TAP file (empty while nothing has been saved). */
  savedTap(): Uint8Array;
  /** The screen read as text against the ROM's font: 24 rows of 32 characters, joined by newlines. */
  screenText(): string;

  /** Memory as the CPU sees it now (paging included). */
  peek(address: number): number;
  poke(address: number, value: number): void;
  registers(): Registers;
  /** `count` instructions from `address`, as the CPU sees memory now. */
  disassemble(address: number, count: number): readonly Instruction[];
  /** The addresses a frame stops at, before the instruction there (the machine goes on from it when run again). */
  setBreakpoints(addresses: readonly number[]): void;
  breakpoints(): readonly number[];
  /** Where a breakpoint stopped the last runFrame(), or null when it ran to the frame's end. */
  readonly breakpoint: number | null;
  /** One instruction. */
  step(): StepResult;

  /** Why the machine has stopped for good (the real core's module trapped), or null while it runs. */
  readonly stopped?: string | null;
  /** After it stopped: a new machine of the same build, switched on, its options as they were (the page puts back the tape and the moment). */
  revive?(): Promise<void>;
}
