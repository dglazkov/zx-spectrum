import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FRAME_WIDTH, LoadError } from './emulator';
import { ENTER, KEY, SYMBOL_SHIFT } from './keys';
import { StubEmulator } from './stub';
import { inflate } from './stub/inflate';
import { parseTzx } from './stub/tapefile';
import { unzip } from './stub/zip';

const rom = new Uint8Array(readFileSync(new URL('../../../roms/48.rom', import.meta.url)));

/** A standard ROM block of a TAP: its length, then flag, data and the XOR checksum. */
function tapBlock(flag: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 4);
  out[0] = (data.length + 2) & 0xff;
  out[1] = (data.length + 2) >> 8;
  out[2] = flag;
  out.set(data, 3);
  out[out.length - 1] = data.reduce((x, b) => x ^ b, flag);
  return out;
}

/** A tape of a program header and a SCREEN$: the bitmap a pattern, the attributes bright white on blue. */
export function screenTape(name = 'TEST'): Uint8Array {
  const header = new Uint8Array(17);
  header[0] = 3; // Bytes:
  for (let i = 0; i < 10; i++) header[1 + i] = (name.padEnd(10).charCodeAt(i));
  header[11] = 6912 & 0xff;
  header[12] = 6912 >> 8;
  header[13] = 0x00;
  header[14] = 0x40; // 16384
  const screen = new Uint8Array(6912);
  screen.fill(0xaa, 0, 6144);
  screen.fill(0x4f, 6144); // bright, paper blue, ink white
  const a = tapBlock(0x00, header);
  const b = tapBlock(0xff, screen);
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** A .zip of one file, deflated. */
function zipOf(name: string, data: Uint8Array): Uint8Array {
  const packed = deflateRawSync(data);
  const nameBytes = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + nameBytes.length + packed.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(18, packed.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(packed, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(20, packed.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

const run = (emu: StubEmulator, frames: number) => {
  for (let i = 0; i < frames; i++) emu.runFrame();
};

/** Presses keys as the page's typer does: each held three frames, six between. */
function type(emu: StubEmulator, chords: number[][]): void {
  for (const chord of chords) {
    for (const k of chord) emu.key(k, true);
    run(emu, 3);
    for (const k of chord) emu.key(k, false);
    run(emu, 6);
  }
}

/** The character at a screen cell, matched against the ROM's font. */
function charAt(emu: StubEmulator, row: number, col: number): string {
  const cell = 0x4000 | ((row >> 3) << 11) | ((row & 7) << 5) | col;
  const bytes = Array.from({ length: 8 }, (_, i) => emu.peek(cell + (i << 8)));
  for (let c = 32; c < 128; c++) if (bytes.every((b, i) => rom[0x3d00 + (c - 32) * 8 + i] === b)) return c === 0x7f ? '©' : String.fromCharCode(c);
  return '?';
}
const line = (emu: StubEmulator, row: number, from = 0, n = 32) => Array.from({ length: n }, (_, i) => charAt(emu, row, from + i)).join('');

describe('the stand-in emulator', () => {
  it('switches on as a 48K does: the copyright on the bottom line, in the ROM’s font, on white', () => {
    const emu = new StubEmulator(rom);
    run(emu, 80);
    expect(line(emu, 23, 0, 28)).toBe('© 1982 Sinclair Research Ltd');
    const f = emu.frame();
    expect(f[0]).toBe(7); // the white border
    expect(f[100 * FRAME_WIDTH + 100]).toBe(7); // white paper
    expect(emu.frameRate).toBeCloseTo(50.08, 2);
  });

  it('echoes keys in the ROM’s keywords, and takes LOAD "" to start the tape', () => {
    const emu = new StubEmulator(rom);
    emu.load(screenTape(), 'test.tap');
    run(emu, 80);
    type(emu, [[KEY.J], [SYMBOL_SHIFT, KEY.P], [SYMBOL_SHIFT, KEY.P]]);
    expect(line(emu, 23, 0, 7)).toBe('LOAD ""');
    type(emu, [[ENTER]]);
    expect(emu.tape.state().playing).toBe(true);
  });

  it('loads a tape as the ROM would show it: stripes in the border, the header’s name, the screen line by line', () => {
    const emu = new StubEmulator(rom);
    const loaded = emu.load(screenTape('PICTURE'), 'picture.tap');
    expect(loaded.blocks?.map((b) => b.label)).toEqual(['Bytes: PICTURE', 'Bytes: 6912']);
    run(emu, 80);
    type(emu, [[KEY.J], [SYMBOL_SHIFT, KEY.P], [SYMBOL_SHIFT, KEY.P], [ENTER]]);
    const borders = new Set<number>();
    let sound = 0;
    let named = false;
    for (let i = 0; i < 3000 && emu.tape.state().playing; i++) {
      emu.runFrame();
      const f = emu.frame();
      for (let y = 0; y < 296; y += 4) borders.add(f[y * FRAME_WIDTH]);
      sound = Math.max(sound, ...emu.audio());
      if (i % 25 === 0 && line(emu, 22, 0, 15) === 'Bytes: PICTURE ') named = true;
    }
    expect(emu.tape.state().playing).toBe(false);
    expect([...borders].sort()).toEqual(expect.arrayContaining([1, 2, 5, 6])); // red and cyan, then blue and yellow
    expect(named).toBe(true);
    expect(sound).toBeGreaterThan(0.1);
    expect(emu.peek(0x4000)).toBe(0xaa);
    expect(emu.peek(0x5800)).toBe(0x4f);
    expect(emu.tape.state().position).toBeGreaterThan(45); // 48 seconds of tape: a screen is 55,000 bits at 1,365 a second
  });

  it('loads standard blocks at once when loading is instant', () => {
    const emu = new StubEmulator(rom);
    emu.setOptions({ instantLoad: true });
    emu.load(screenTape(), 'test.tap');
    run(emu, 80);
    type(emu, [[KEY.J], [SYMBOL_SHIFT, KEY.P], [SYMBOL_SHIFT, KEY.P], [ENTER]]);
    run(emu, 2);
    expect(emu.peek(0x5800)).toBe(0x4f);
  });

  it('shows the 128’s menu, whose ENTER is its tape loader', () => {
    const emu = new StubEmulator(rom);
    emu.setModel('128k');
    expect(emu.frameRate).toBeCloseTo(50.02, 2);
    emu.load(screenTape(), 'test.tap');
    run(emu, 80);
    expect(line(emu, 8, 8, 11)).toBe('Tape Loader');
    type(emu, [[ENTER]]);
    expect(emu.tape.state().playing).toBe(true);
  });

  it('reads tapes and snapshots out of a .zip', () => {
    const emu = new StubEmulator(rom);
    const r = emu.load(zipOf('GAMES/TEST.TAP', screenTape()), 'test.tap.zip');
    expect(r).toMatchObject({ kind: 'tape', name: 'TEST.TAP' });
    expect(unzip(zipOf('a.txt', new Uint8Array(5)))[0].read()).toEqual(new Uint8Array(5));
  });

  it('writes snapshots it can read back, in each format', () => {
    for (const format of ['z80', 'sna', 'szx'] as const) {
      const emu = new StubEmulator(rom);
      run(emu, 80);
      emu.poke(0x8000, 0x5a);
      emu.poke(0xffff, 0xa5);
      const bytes = emu.saveSnapshot(format);
      const other = new StubEmulator(rom);
      expect(other.load(bytes, `x.${format}`)).toMatchObject({ kind: 'snapshot', model: '48k' });
      expect(other.peek(0x8000), format).toBe(0x5a);
      expect(other.peek(0xffff), format).toBe(0xa5);
      expect(other.peek(0x4000 + 23 * 32), format).toBe(emu.peek(0x4000 + 23 * 32));
    }
  });

  it('puts a state back as it was', () => {
    const emu = new StubEmulator(rom);
    run(emu, 80);
    const state = emu.saveState();
    emu.poke(0x6000, 1);
    type(emu, [[KEY.J]]);
    emu.loadState(state);
    expect(emu.peek(0x6000)).toBe(0);
    expect(line(emu, 23, 0, 28)).toBe('© 1982 Sinclair Research Ltd');
  });

  it('says what it cannot load', () => {
    const emu = new StubEmulator(rom);
    expect(() => emu.load(new Uint8Array([1, 2, 3]), 'notes.txt')).toThrow(LoadError);
  });
});

describe('its tapes and archives', () => {
  it('inflates what zlib deflates, stored, fixed and dynamic', () => {
    const text = new TextEncoder().encode('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG. '.repeat(400));
    let seed = 1;
    const noise = Uint8Array.from({ length: 50_000 }, () => ((seed = (seed * 1103515245 + 12345) >>> 0), seed >>> 24));
    for (const data of [text, noise, new Uint8Array(0), new Uint8Array(70_000)]) {
      for (const level of [0, 1, 9]) expect(inflate(deflateRawSync(data, { level }))).toEqual(data);
    }
  });

  it('lists a TZX’s blocks as the deck shows them', () => {
    const parts: number[] = [...new TextEncoder().encode('ZXTape!'), 0x1a, 1, 20];
    const std = tapBlock(0x00, new Uint8Array(17).fill(0x20).fill(0, 0, 1)).subarray(2); // a Program: header
    parts.push(0x10, 0xe8, 0x03, std.length & 0xff, std.length >> 8, ...std);
    // A turbo block: pilot 2000 × 3000, sync 600/700, bits 500/1000, 8 bits, pause 0, 3 bytes.
    parts.push(0x11, 0xb8, 0x0b, 0x58, 0x02, 0xbc, 0x02, 0xf4, 0x01, 0xe8, 0x03, 0xd0, 0x07, 8, 0, 0, 3, 0, 0, 1, 2, 3);
    parts.push(0x12, 0x40, 0x0b, 0x10, 0x00); // a pure tone
    parts.push(0x20, 0xd0, 0x07); // a 2 s pause
    parts.push(0x20, 0x00, 0x00); // stop the tape
    parts.push(0x30, 5, ...new TextEncoder().encode('Hello'));
    const blocks = parseTzx(new Uint8Array(parts));
    expect(blocks.map((b) => b.info.kind)).toEqual(['header', 'turbo', 'tone', 'pause', 'stop', 'info']);
    expect(blocks[1].info.label).toBe('Turbo data: 1');
    expect(blocks[3].info.seconds).toBeCloseTo(2, 3);
    expect(blocks[5].info.label).toBe('Hello');
  });
});
