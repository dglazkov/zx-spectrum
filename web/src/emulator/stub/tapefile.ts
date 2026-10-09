// Tapes for the stand-in: TAP and TZX read into blocks, and the blocks turned back into the pulses a cassette plays,
// so that the stand-in's border, sound and screen behave as a loading Spectrum's do. The timings are the ROM's and the
// TZX format's (TZX 1.20, World of Spectrum: pilot 2168 T, sync 667 and 735 T, bits 855 and 1710 T, 8063 pilot pulses
// before a header and 3223 before data). The real core has its own reader (crates/tape) that does all of TZX.

import type { TapeBlock } from '../emulator';

export type Segment =
  | { readonly kind: 'tone'; readonly pulse: number; readonly count: number }
  | { readonly kind: 'pulses'; readonly lengths: readonly number[] }
  | { readonly kind: 'data'; readonly bytes: Uint8Array; readonly zero: number; readonly one: number; readonly lastBits: number }
  | { readonly kind: 'pause'; readonly ms: number }
  | { readonly kind: 'stop' };

export interface StubBlock {
  readonly info: TapeBlock;
  readonly segments: readonly Segment[];
  /** The bytes a loader would read (flag first, checksum last), for blocks of data. */
  readonly data?: Uint8Array;
  /** Loaded by the ROM's standard timings, which instant loading takes at once. */
  readonly standard: boolean;
}

const CLOCK = 3_500_000;
const PILOT = 2168;
const SYNC1 = 667;
const SYNC2 = 735;
const ZERO = 855;
const ONE = 1710;

function tStates(segments: readonly Segment[]): number {
  let t = 0;
  for (const s of segments) {
    if (s.kind === 'tone') t += s.pulse * s.count;
    else if (s.kind === 'pulses') t += s.lengths.reduce((a, b) => a + b, 0);
    else if (s.kind === 'pause') t += (s.ms * CLOCK) / 1000;
    else if (s.kind === 'data') {
      for (let i = 0; i < s.bytes.length; i++) {
        const bits = i === s.bytes.length - 1 ? s.lastBits : 8;
        for (let b = 0; b < bits; b++) t += 2 * (s.bytes[i] & (0x80 >> b) ? s.one : s.zero);
      }
    }
  }
  return t;
}

const ascii = (b: Uint8Array) => Array.from(b, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : c === 0x7f ? '©' : ' ')).join('').trimEnd();

/** What the ROM would call a block of `data` (flag first). */
function describe(data: Uint8Array): { kind: TapeBlock['kind']; label: string } {
  if (data.length === 19 && data[0] === 0x00 && data[1] <= 3) {
    const type = ['Program', 'Number array', 'Character array', 'Bytes'][data[1]];
    return { kind: 'header', label: `${type}: ${ascii(data.subarray(2, 12))}` };
  }
  return { kind: 'data', label: `Bytes: ${Math.max(0, data.length - 2)}` };
}

function romBlock(data: Uint8Array, pauseMs: number): StubBlock {
  const segments: Segment[] = [
    { kind: 'tone', pulse: PILOT, count: data[0] < 0x80 ? 8063 : 3223 },
    { kind: 'pulses', lengths: [SYNC1, SYNC2] },
    { kind: 'data', bytes: data, zero: ZERO, one: ONE, lastBits: 8 },
  ];
  if (pauseMs) segments.push({ kind: 'pause', ms: pauseMs });
  const { kind, label } = describe(data);
  return { info: { kind, label, bytes: data.length, seconds: tStates(segments) / CLOCK }, segments, data, standard: true };
}

/** A TAP: blocks of data, each with its 2-byte length. */
export function parseTap(bytes: Uint8Array): StubBlock[] {
  const blocks: StubBlock[] = [];
  let p = 0;
  while (p + 2 <= bytes.length) {
    const len = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    if (len === 0) continue;
    if (p + len > bytes.length) throw new Error('TAP: a block runs past the end of the file');
    blocks.push(romBlock(bytes.subarray(p, p + len), 1000));
    p += len;
  }
  return blocks;
}

/** Whether `bytes` read as a TAP: block lengths that add up to the file exactly. */
export function looksLikeTap(bytes: Uint8Array): boolean {
  let p = 0;
  let n = 0;
  while (p + 2 <= bytes.length) {
    p += 2 + (bytes[p] | (bytes[p + 1] << 8));
    n++;
  }
  return n > 0 && p === bytes.length;
}

export const isTzx = (b: Uint8Array): boolean => b.length >= 10 && ascii(b.subarray(0, 7)) === 'ZXTape!' && b[7] === 0x1a;

/** A TZX, its blocks as the deck lists them; blocks with no signal here (CSW, generalized data) are silence of their length. */
export function parseTzx(bytes: Uint8Array): StubBlock[] {
  const blocks: StubBlock[] = [];
  const u16 = (p: number) => bytes[p] | (bytes[p + 1] << 8);
  const u24 = (p: number) => bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
  const u32 = (p: number) => (u24(p) | (bytes[p + 3] << 24)) >>> 0;
  const text = (p: number, n: number) => ascii(bytes.subarray(p, p + n));
  const info = (kind: TapeBlock['kind'], label: string, segments: Segment[] = [], extra: Partial<StubBlock> = {}): void => {
    blocks.push({ info: { kind, label, seconds: tStates(segments) / CLOCK, bytes: extra.data?.length }, segments, standard: false, ...extra });
  };
  let p = 10;
  while (p < bytes.length) {
    const id = bytes[p++];
    switch (id) {
      case 0x10: {
        const len = u16(p + 2);
        blocks.push(romBlock(bytes.subarray(p + 4, p + 4 + len), u16(p)));
        p += 4 + len;
        break;
      }
      case 0x11: {
        const len = u24(p + 15);
        const data = bytes.subarray(p + 18, p + 18 + len);
        const segments: Segment[] = [
          { kind: 'tone', pulse: u16(p), count: u16(p + 10) },
          { kind: 'pulses', lengths: [u16(p + 2), u16(p + 4)] },
          { kind: 'data', bytes: data, zero: u16(p + 6), one: u16(p + 8), lastBits: bytes[p + 12] || 8 },
        ];
        if (u16(p + 13)) segments.push({ kind: 'pause', ms: u16(p + 13) });
        const d = describe(data);
        info(d.kind === 'header' ? 'header' : 'turbo', d.kind === 'header' ? d.label : `Turbo data: ${Math.max(0, len - 2)}`, segments, { data });
        p += 18 + len;
        break;
      }
      case 0x12:
        info('tone', `Tone: ${u16(p + 2)} pulses`, [{ kind: 'tone', pulse: u16(p), count: u16(p + 2) }]);
        p += 4;
        break;
      case 0x13: {
        const n = bytes[p];
        const lengths = Array.from({ length: n }, (_, i) => u16(p + 1 + 2 * i));
        info('tone', `Pulses: ${n}`, [{ kind: 'pulses', lengths }]);
        p += 1 + 2 * n;
        break;
      }
      case 0x14: {
        const len = u24(p + 7);
        const data = bytes.subarray(p + 10, p + 10 + len);
        const segments: Segment[] = [{ kind: 'data', bytes: data, zero: u16(p), one: u16(p + 2), lastBits: bytes[p + 4] || 8 }];
        if (u16(p + 5)) segments.push({ kind: 'pause', ms: u16(p + 5) });
        info('turbo', `Pure data: ${len}`, segments, { data });
        p += 10 + len;
        break;
      }
      case 0x15: {
        const len = u24(p + 5);
        const ms = ((len * 8 * u16(p)) / CLOCK) * 1000 + u16(p + 2);
        info('tone', 'Direct recording', [{ kind: 'pause', ms }]);
        p += 8 + len;
        break;
      }
      case 0x18:
      case 0x19: {
        const len = u32(p);
        info(id === 0x18 ? 'tone' : 'turbo', id === 0x18 ? 'CSW recording' : 'Generalized data', [{ kind: 'pause', ms: u16(p + 4) }]);
        p += 4 + len;
        break;
      }
      case 0x20: {
        const ms = u16(p);
        info(ms ? 'pause' : 'stop', ms ? `Pause ${(ms / 1000).toFixed(1)} s` : 'Stop the tape', [ms ? { kind: 'pause', ms } : { kind: 'stop' }]);
        p += 2;
        break;
      }
      case 0x21:
        info('group', `Group: ${text(p + 1, bytes[p])}`);
        p += 1 + bytes[p];
        break;
      case 0x22: // group end, loop end, return: no body
      case 0x25:
      case 0x27:
        break;
      case 0x23:
      case 0x24:
        info('group', id === 0x23 ? 'Jump' : `Loop ${u16(p)} times`);
        p += 2;
        break;
      case 0x26:
        p += 2 + 2 * u16(p);
        break;
      case 0x28:
        p += 2 + u16(p);
        break;
      case 0x2a:
        info('stop', 'Stop the tape on a 48K', []);
        p += 4;
        break;
      case 0x2b:
        p += 5;
        break;
      case 0x30:
        info('info', text(p + 1, bytes[p]));
        p += 1 + bytes[p];
        break;
      case 0x31:
        info('info', text(p + 2, bytes[p + 1]));
        p += 2 + bytes[p + 1];
        break;
      case 0x32: {
        // Archive info: the title, if it gives one, says what the tape is.
        const end = p + 2 + u16(p);
        let q = p + 3;
        for (let n = 0; n < bytes[p + 2] && q < end; n++) {
          const type = bytes[q];
          const len = bytes[q + 1];
          if (type === 0x00) info('info', text(q + 2, len));
          q += 2 + len;
        }
        p = end;
        break;
      }
      case 0x33:
        p += 1 + 3 * bytes[p];
        break;
      case 0x35:
        p += 20 + u32(p + 16);
        break;
      case 0x5a:
        p += 9;
        break;
      default:
        // Every block since TZX 1.10 starts with its length: skip what is not known.
        p += 4 + u32(p);
    }
  }
  return blocks;
}

/**
 * The cassette playing: the head's place on the tape, moved on by T-states, saying when the signal changes level and
 * what each byte under the head was. A pause holds the signal low.
 */
export class Signal {
  block = 0;
  private segment = 0;
  private index = 0; // pulses into a tone, or half-bits into data, or 0
  private left = 0; // T-states until the next edge (or the pause's end)
  level = false;
  /** T-states of tape behind the head. */
  position = 0;

  constructor(readonly blocks: readonly StubBlock[]) {
    this.left = this.pulse();
  }

  get done(): boolean {
    return this.block >= this.blocks.length;
  }

  /** In a block's pilot or sync (the ROM shows red and cyan), or its data (blue and yellow), or neither. */
  get phase(): 'lead' | 'data' | 'quiet' {
    const s = this.blocks[this.block]?.segments[this.segment];
    if (!s) return 'quiet';
    if (s.kind === 'tone' || s.kind === 'pulses') return 'lead';
    return s.kind === 'data' ? 'data' : 'quiet';
  }

  /** Where the head is, to put it back with restore(). */
  save(): { block: number; segment: number; index: number; left: number; level: boolean; position: number } {
    // JSON has no Infinity: the end of the tape is -1.
    const left = Number.isFinite(this.left) ? this.left : -1;
    return { block: this.block, segment: this.segment, index: this.index, left, level: this.level, position: this.position };
  }

  restore(s: ReturnType<Signal['save']>): void {
    ({ block: this.block, segment: this.segment, index: this.index, level: this.level, position: this.position } = s);
    this.left = s.left < 0 ? Infinity : s.left;
  }

  seek(block: number): void {
    this.block = block;
    this.segment = 0;
    this.index = 0;
    this.level = false;
    this.position = this.blocks.slice(0, block).reduce((t, b) => t + b.info.seconds * CLOCK, 0);
    this.left = this.pulse();
  }

  /** Runs `t` T-states of tape. `edge(at)` hears each change of level (at T-states from the start of this run), `byte(block, i, value)` each byte read. Returns false if the tape asked to be stopped. */
  run(t: number, edge: (at: number) => void, byte: (block: number, index: number, value: number) => void): boolean {
    let at = 0;
    while (!this.done) {
      if (this.left > t - at) {
        this.left -= t - at;
        this.position += t - at;
        return true;
      }
      at += this.left;
      this.position += this.left;
      const s = this.blocks[this.block].segments[this.segment];
      if (s && s.kind !== 'pause' && s.kind !== 'stop') {
        this.level = !this.level;
        edge(at);
      }
      if (s?.kind === 'data' && this.index % 16 === 15) byte(this.block, this.index >> 4, s.bytes[this.index >> 4]);
      this.index++;
      if (s?.kind === 'stop') {
        this.advance();
        this.left = this.pulse();
        return false;
      }
      this.left = this.pulse();
    }
    return true;
  }

  /** The length of the pulse under the head, moving on through segments and blocks as they end. */
  private pulse(): number {
    for (;;) {
      if (this.done) return Infinity;
      const s = this.blocks[this.block].segments[this.segment];
      if (!s) {
        this.advance();
        continue;
      }
      if (s.kind === 'tone' && this.index < s.count) return s.pulse;
      if (s.kind === 'pulses' && this.index < s.lengths.length) return s.lengths[this.index];
      if (s.kind === 'data') {
        const byte = this.index >> 4;
        const bit = (this.index >> 1) & 7;
        const bits = byte === s.bytes.length - 1 ? s.lastBits : 8;
        if (byte < s.bytes.length && bit < bits) return s.bytes[byte] & (0x80 >> bit) ? s.one : s.zero;
        if (byte < s.bytes.length - 1) {
          this.index = (byte + 1) << 4;
          continue;
        }
      }
      if (s.kind === 'pause' && this.index === 0) {
        this.level = false;
        return (s.ms * CLOCK) / 1000;
      }
      if (s.kind === 'stop' && this.index === 0) return 0;
      this.segment++;
      this.index = 0;
    }
  }

  private advance(): void {
    this.block++;
    this.segment = 0;
    this.index = 0;
  }
}
