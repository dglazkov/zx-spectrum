// The WebAssembly build of the machine (web/src/emulator/zx.wasm, scripts/build-wasm.sh), in Node, through the page's
// own wrapper (src/emulator/wasm.ts): the same machine as the native build, frame for frame (crates/wasm's
// examples/digest.rs run natively against the same steps here); the contention tables a release build once got wrong
// (docs/toolchain/); every model booting; a tape loaded from its edges and at once; states and snapshots round-tripped;
// SAVE; damaged files and states refused with an error, never a trap. Time is frames counted. The speed is said,
// never judged.
//
//   nerd test wasm      (which builds the module and runs crates/wasm's own tests first)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { WasmEmulator, type ZxExports } from '../../src/emulator/wasm';
import { MODEL_IDS, type Model } from '../../src/emulator/emulator';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const wasmPath = `${repo}web/src/emulator/zx.wasm`;
let exports: ZxExports;

/** A fixture from the cache (scripts/fixture), or null where it cannot be had. */
function fixture(name: string): string | null {
  try {
    const path = execFileSync(`${repo}scripts/fixture`, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

beforeAll(async () => {
  if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: scripts/build-wasm.sh makes it`);
  const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
  exports = instance.exports as unknown as ZxExports;
});

const run = (emu: WasmEmulator, n: number) => {
  for (let i = 0; i < n; i++) emu.runFrame();
};

/** Chords pressed one after another, held 4 frames with 6 between (as the page's feeder paces the ROM). */
function press(emu: WasmEmulator, chords: number[][]): void {
  for (const chord of chords) {
    for (const k of chord) emu.key(k, true);
    run(emu, 4);
    for (const k of chord) emu.key(k, false);
    run(emu, 6);
  }
}

const LOAD = [[33], [36, 25], [36, 25], [30]]; // J, SYMBOL SHIFT + P twice, ENTER: LOAD ""

function tapBlock(flag: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 4);
  out[0] = (data.length + 2) & 0xff;
  out[1] = (data.length + 2) >> 8;
  out[2] = flag;
  out.set(data, 3);
  out[out.length - 1] = data.reduce((x, b) => x ^ b, flag);
  return out;
}

/** A tape of a Bytes header and a SCREEN$ of 10101010, white ink on bright blue paper. */
function screenTape(): Uint8Array {
  const header = new Uint8Array(17);
  header[0] = 3;
  header.set(new TextEncoder().encode('PICTURE   '), 1);
  header[11] = 6912 & 0xff;
  header[12] = 6912 >> 8;
  header[14] = 0x40;
  const screen = new Uint8Array(6912).fill(0xaa);
  screen.fill(0x4f, 6144);
  const a = tapBlock(0, header);
  const b = tapBlock(0xff, screen);
  const tap = new Uint8Array(a.length + b.length);
  tap.set(a);
  tap.set(b, a.length);
  return tap;
}

/** FNV-1a, 32 bits, of the picture, the 64K the CPU sees and the registers: examples/digest.rs's. */
function digest(emu: WasmEmulator): string {
  let h = 0x811c9dc5;
  const add = (b: number) => {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const b of emu.frame()) add(b);
  for (let a = 0; a < 0x10000; a++) add(emu.peek(a));
  const x = exports;
  const p = x.zx_registers((emu as unknown as { h: number }).h) >> 2;
  const regs = new Uint32Array(x.memory.buffer, p * 4, 20);
  for (const r of regs) for (let i = 0; i < 4; i++) add(r >>> (i * 8));
  return h.toString(16).padStart(8, '0');
}

describe('the machine in WebAssembly', () => {
  it('is the native build, frame for frame: seven models booting, and Saboteur’s tape playing', () => {
    const tape = fixture('saboteur.tzx');
    const native = JSON.parse(
      execFileSync('cargo', ['run', '-q', '-p', 'zx-wasm', '--example', 'digest', ...(tape ? [tape] : [])], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? `${repo}target/wasm-native` },
      }),
    ) as { boot: Record<string, string[]>; saboteur: string[] | null };
    MODEL_IDS.forEach((m, i) => {
      const emu = new WasmEmulator(exports, m);
      emu.setSound(true);
      const got: string[] = [];
      for (const target of [50, 150, 300]) {
        while (emu.frameCount < target) emu.runFrame();
        got.push(digest(emu));
      }
      expect(got, m).toEqual(native.boot[String(i)]);
    });
    if (tape && native.saboteur) {
      const emu = new WasmEmulator(exports, '48k');
      emu.setOptions({ autoTape: true, instantLoad: false, ayStereo: 'mono' });
      run(emu, 100);
      emu.load(readFileSync(tape), 'saboteur.tzx');
      const typed = new TextEncoder().encode('j""\n');
      const x = exports;
      const h = (emu as unknown as { h: number }).h;
      const p = x.zx_alloc(typed.length);
      new Uint8Array(x.memory.buffer).set(typed, p);
      x.zx_type_text(h, p, typed.length);
      x.zx_dealloc(p, typed.length);
      const got: string[] = [];
      for (const target of [1000, 2000, 2700]) {
        while (emu.frameCount < target) emu.runFrame();
        got.push(digest(emu));
      }
      expect(got).toEqual(native.saboteur);
    }
  });

  it('has the contention tables a release build once got wrong: a NOP in contended memory, from every T-state of a line', () => {
    // The pattern from the first contended T-state, for a line's contended part, then nothing to the line's end.
    const cases: [Model, number, number[], number, number][] = [
      ['48k', 14335, [6, 5, 4, 3, 2, 1, 0, 0], 128, 224],
      ['128k', 14361, [6, 5, 4, 3, 2, 1, 0, 0], 128, 228],
      ['plus3', 14361, [1, 0, 7, 6, 5, 4, 3, 2], 129, 228],
    ];
    for (const [model, first, pattern, contended, line] of cases) {
      const emu = new WasmEmulator(exports, model);
      run(emu, 100);
      const h = (emu as unknown as { h: number }).h;
      const x = exports;
      emu.poke(0x6000, 0x00);
      const wrong: string[] = [];
      // The line before the first and after the last (nothing contended), and the first two and the last.
      for (const row of [-1, 0, 1, 191, 192]) {
        for (let k = 0; k < line; k++) {
          const t = first + row * line + k;
          x.zx_set_register(h, 11, 0x6000);
          x.zx_set_tstate(h, t);
          emu.step();
          const took = x.zx_tstate(h) - t;
          const want = 4 + (row >= 0 && row < 192 && k < contended ? pattern[k % 8] : 0);
          if (took !== want) wrong.push(`T ${t}: ${took}, not ${want}`);
        }
      }
      expect(wrong.slice(0, 5), model).toEqual([]);
    }
  });

  it('boots every model to its ROM, the 128s to their menus', () => {
    for (const m of MODEL_IDS) {
      const emu = new WasmEmulator(exports, m);
      let frames = 0;
      const want = m === '16k' || m === '48k' ? 'Sinclair Research' : 'Loader';
      while (!emu.screenText().includes(want) && frames < 400) {
        emu.runFrame();
        frames++;
      }
      expect(frames, `${m}: ${emu.screenText()}`).toBeLessThan(200);
      expect(emu.model).toBe(m);
    }
  });

  it('loads a tape by LOAD "" from its edges, and at once with the trap', () => {
    for (const instant of [false, true]) {
      const emu = new WasmEmulator(exports, '48k');
      emu.setOptions({ instantLoad: instant, autoTape: true });
      run(emu, 120);
      const r = emu.load(screenTape(), 'picture.tap');
      expect(r.kind).toBe('tape');
      expect(r.blocks?.map((b) => b.kind)).toEqual(['header', 'data']);
      // LOAD ""CODE: J, the quotes, extended mode and I, ENTER.
      press(emu, [[33], [36, 25], [36, 25], [0, 36], [27], [30]]);
      let frames = 0;
      while (emu.peek(0x5800) !== 0x4f && frames < 3000) {
        emu.runFrame();
        frames++;
      }
      expect(emu.peek(0x4000), `instant ${instant}`).toBe(0xaa);
      if (instant) expect(frames).toBeLessThan(10);
      else expect(frames).toBeGreaterThan(1500);
    }
  });

  it('puts a state back to the bit, in a machine of another model too, and shows the picture a state holds', () => {
    const emu = new WasmEmulator(exports, '128k');
    run(emu, 150);
    press(emu, [[30]]); // the menu's Tape Loader
    const state = emu.saveState();
    expect(state.length).toBeLessThan(40_000);
    const picture = emu.frame().slice();
    run(emu, 60);
    const later = emu.frame().slice();
    const other = new WasmEmulator(exports, '16k');
    other.loadState(state);
    expect(other.model).toBe('128k');
    expect(other.statePicture(state)).toEqual(picture);
    run(other, 60);
    expect(other.frame()).toEqual(later);
    expect(() => other.loadState(state.subarray(0, state.length >> 1))).toThrow(/state/);
    expect(() => other.loadState(new Uint8Array([1, 2, 3]))).toThrow(/state/);
    run(other, 1);
  });

  it('writes snapshots in each format that load back as the machine', () => {
    for (const m of ['48k', '128k', 'plus3'] as Model[]) {
      const emu = new WasmEmulator(exports, m);
      run(emu, 160);
      emu.poke(0x8000, 0x5a);
      for (const format of ['z80', 'szx', 'sna'] as const) {
        const file = emu.saveSnapshot(format);
        const back = new WasmEmulator(exports, '16k');
        const r = back.load(file, `snap.${format}`);
        expect(r.kind).toBe('snapshot');
        if (format !== 'sna' || m !== 'plus3') expect(r.model, `${m} as .${format}`).toBe(m);
        expect(back.peek(0x8000)).toBe(0x5a);
      }
    }
  });

  it('turns what SAVE writes into a TAP', () => {
    const emu = new WasmEmulator(exports, '48k');
    run(emu, 100);
    const x = exports;
    const h = (emu as unknown as { h: number }).h;
    const typed = new TextEncoder().encode('10 ehello\ns"hello"\n');
    const p = x.zx_alloc(typed.length);
    new Uint8Array(x.memory.buffer).set(typed, p);
    x.zx_type_text(h, p, typed.length);
    x.zx_dealloc(p, typed.length);
    run(emu, 300);
    press(emu, [[30]]);
    run(emu, 600);
    const tap = emu.savedTap();
    expect(Array.from(tap.subarray(0, 4))).toEqual([19, 0, 0, 0]);
    expect(new TextDecoder().decode(tap.subarray(4, 9))).toBe('hello');
  });

  it('refuses what is not a file it knows, and damaged files, with a reason and never a trap', () => {
    const emu = new WasmEmulator(exports, '48k');
    expect(() => emu.load(new TextEncoder().encode('hello'), 'notes.txt')).toThrow(/notes\.txt/);
    let seed = 12345;
    const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
    const good = [screenTape(), emu.saveSnapshot('z80'), emu.saveSnapshot('szx')];
    let refused = 0;
    for (let i = 0; i < 600; i++) {
      const base = good[i % good.length].slice();
      for (let k = 0; k < 1 + (i % 9); k++) base[((random() << 16) | (random() << 8) | random()) % base.length] = random();
      const cut = i % 4 === 0 ? base.subarray(0, (random() * base.length) >> 8) : base;
      try {
        emu.load(cut, ['x.tap', 'x.z80', 'x.szx'][i % 3]);
      } catch (e) {
        expect((e as Error).name).toBe('LoadError');
        refused++;
      }
      run(emu, 1);
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('refuses files that would only fill its memory: a file of zeros, a recording that inflates past any tape, one over 16 MB', async () => {
    // A machine of its own, in an instance of its own, so that its memory is its alone to measure.
    const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
    const x = instance.exports as unknown as ZxExports;
    const emu = new WasmEmulator(x, '48k');
    run(emu, 10);
    const before = x.memory.buffer.byteLength;
    // Zeros: half a million empty TAP blocks, were they taken.
    expect(() => emu.load(new Uint8Array(1 << 20), 'zeros.tap')).toThrow(/not a tape|damaged/i);
    // A CSW of 12 million one-sample pulses, in 12 KB of Z-RLE.
    const { deflateSync } = await import('node:zlib');
    const packed = deflateSync(Buffer.alloc(12 << 20, 1), { level: 9 });
    const header = Buffer.concat([Buffer.from('Compressed Square Wave\x1a', 'latin1'), Buffer.from([2, 0]), Buffer.from(new Uint32Array([44_100]).buffer), Buffer.alloc(4), Buffer.from([2, 0, 0]), Buffer.alloc(16)]);
    expect(() => emu.load(new Uint8Array(Buffer.concat([header, packed])), 'bomb.csw')).toThrow(/pulses/);
    expect(() => emu.load(new Uint8Array((16 << 20) + 1), 'huge.tap')).toThrow(/16 MB/);
    // Nothing went into the deck, the machine runs on, and its memory grew by no more than the files handed in.
    expect(emu.tape.state().loaded).toBe(false);
    run(emu, 150);
    expect(emu.screenText()).toContain('Sinclair Research');
    expect(x.memory.buffer.byteLength - before).toBeLessThan(80 << 20);
  });

  it('says how fast it runs (measured, not judged)', () => {
    const lines: string[] = [];
    for (const m of ['48k', '128k'] as Model[]) {
      const emu = new WasmEmulator(exports, m);
      emu.setSound(false);
      run(emu, 100);
      const t0 = performance.now();
      run(emu, 2000);
      lines.push(`${m} ${Math.round(2000 / ((performance.now() - t0) / 1000))} fps flat out`);
    }
    console.log(`wasm in Node: ${lines.join(', ')}`);
  });

  it('loads Saboteur at once to its £100 REWARD screen', (ctx) => {
    const tape = fixture('saboteur.tzx');
    if (!tape) return ctx.skip('no saboteur.tzx in the fixture cache');
    const emu = new WasmEmulator(exports, '48k');
    emu.setOptions({ instantLoad: true, autoTape: true });
    emu.setSound(false);
    run(emu, 120);
    emu.load(readFileSync(tape), 'saboteur.tzx');
    press(emu, LOAD);
    let frames = 0;
    while (!emu.screenText().includes('REWARD') && frames < 9000) {
      run(emu, 25);
      frames += 25;
    }
    expect(emu.screenText().split('\n')[0]).toBe('          £100  REWARD          ');
    expect(frames).toBeLessThan(7500);
  });
});
