// How fast the emulator runs as the page runs it: the WebAssembly build (web/src/emulator/zx.wasm, through wasm.ts)
// in Chrome, frames a second for each model (with sound, as at 1×, and without, as flat out), and loading Saboteur's
// tape flat out from the fixture cache (as the accelerated style does). A measurement, judged by no test: the machine
// is shared, and what else runs on it shows in the numbers.
//
//   node tools/bench.mjs [--frames 3000] [--json]       CHROME and CHROME_ARGS say which Chrome and its flags

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node tools/bench.mjs [--frames N] [--json]: frames a second of the wasm build in Chrome, by model, and loading Saboteur flat out');
  process.exit(0);
}
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const frames = Number(opt('frames', '3000'));
const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync('bash', ['../scripts/build-wasm.sh'], { cwd: root, stdio: 'inherit' });
let tape = null;
try {
  tape = readFileSync(execFileSync('../scripts/fixture', ['saboteur.tzx'], { cwd: root }).toString().trim()).toString('base64');
} catch {
  console.error('bench: no saboteur.tzx in the fixture cache; the tape is left out');
}

const server = await createServer({ root, server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: [...(process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean)] });
try {
  const page = await browser.newPage();
  await page.goto(`${server.resolvedUrls.local[0]}favicon.svg`);
  const result = await page.evaluate(
    async ({ frames, tape }) => {
      const { instantiateZx, WasmEmulator } = await import('/src/emulator/wasm.ts');
      const exports = await instantiateZx();
      const models = ['16k', '48k', '128k', 'plus2', 'plus2a', 'plus3', 'pentagon'];
      const time = (emu, n) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) emu.runFrame();
        return n / ((performance.now() - t0) / 1000);
      };
      const out = { models: {}, tape: null };
      for (const m of models) {
        const emu = new WasmEmulator(exports, m);
        time(emu, 200);
        emu.setSound(true);
        const withSound = time(emu, frames);
        emu.setSound(false);
        const flat = time(emu, frames);
        out.models[m] = { withSound: Math.round(withSound), flatOut: Math.round(flat) };
      }
      if (tape) {
        const emu = new WasmEmulator(exports, '48k');
        emu.setSound(false);
        for (let i = 0; i < 120; i++) emu.runFrame();
        emu.load(Uint8Array.from(atob(tape), (c) => c.charCodeAt(0)), 'saboteur.tzx');
        // LOAD "" typed as the page types it, then the tape played by the ROM's own start.
        for (const chord of [[33], [36, 25], [36, 25], [30]]) {
          for (const k of chord) emu.key(k, true);
          for (let i = 0; i < 4; i++) emu.runFrame();
          for (const k of chord) emu.key(k, false);
          for (let i = 0; i < 6; i++) emu.runFrame();
        }
        let n = 0;
        const t0 = performance.now();
        while (n < 12_000 && (n < 100 || emu.tape.state().playing)) {
          emu.runFrame();
          n++;
        }
        const s = (performance.now() - t0) / 1000;
        out.tape = { frames: n, seconds: Number(s.toFixed(2)), fps: Math.round(n / s), reward: emu.screenText().includes('REWARD') };
      }
      return out;
    },
    { frames, tape },
  );
  result.chrome = browser.version();
  if (args.includes('--json')) console.log(JSON.stringify(result));
  else {
    console.log(`Chrome ${result.chrome}, ${frames} frames a model`);
    for (const [m, r] of Object.entries(result.models)) console.log(`  ${m.padEnd(9)} ${String(r.withSound).padStart(6)} fps with sound, ${String(r.flatOut).padStart(6)} flat out (${(r.flatOut / 50).toFixed(0)}× real time)`);
    if (result.tape) console.log(`  Saboteur's tape flat out: ${result.tape.frames} frames in ${result.tape.seconds} s, ${result.tape.fps} fps${result.tape.reward ? ', to the REWARD screen' : ''}`);
  }
} finally {
  await browser.close();
  await server.close();
}
