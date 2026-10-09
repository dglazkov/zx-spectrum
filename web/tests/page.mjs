// The page in Chrome, running the real machine (the WebAssembly build of crates/spectrum, built first by
// scripts/build-wasm.sh): it becomes ready, switches on to the ROM's copyright, takes keys from the drawn keyboard,
// the PC's keyboard and a touch pad, loads tapes (LOAD "" typed, the 128's Tape Loader chosen when its menu shows)
// and snapshots, loads Saboteur from the library to its £100 REWARD screen flat out, opens a game from a link, keeps
// save slots, rewinds, records a SAVE as a TAP, stops at a breakpoint, remembers its settings, sounds, and fits a
// phone. The network is answered from recordings (the ZXInfo API's own answers; Saboteur's tape, manual and inlay from
// the fixture cache, scripts/fixture, or tapes the test makes). Time is the page's own clock (Playwright's page.clock),
// moved on by the test: frames are counted, not waited for. Any console error fails a part. Each part is reported to
// nerd ($NERD_REPORT); one whose fixture cannot be had says it was skipped.
//
//   node tests/page.mjs [words in a part's name...]      CHROME and CHROME_ARGS say which Chrome and its flags

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const only = process.argv.slice(2).join(' ').toLowerCase();
const report = (line) => process.env.NERD_REPORT && appendFileSync(process.env.NERD_REPORT, `${JSON.stringify(line)}\n`);

// The machine, built if it is missing or stale (cargo is incremental: a moment when nothing changed): the module the
// deploy serves, byte for byte (scripts/build-wasm.sh).
execFileSync('bash', ['../scripts/build-wasm.sh'], { cwd: root, stdio: 'inherit' });

// --- Files the test makes, and fixtures it is given ----------------------------------------------------------------

function tapBlock(flag, data) {
  const out = Buffer.alloc(data.length + 4);
  out.writeUInt16LE(data.length + 2, 0);
  out[2] = flag;
  Buffer.from(data).copy(out, 3);
  out[out.length - 1] = data.reduce((x, b) => x ^ b, flag);
  return out;
}

function header(type, name, length, param1, param2) {
  const h = Buffer.alloc(17);
  h[0] = type;
  h.write(name.padEnd(10), 1, 'latin1');
  h.writeUInt16LE(length, 11);
  h.writeUInt16LE(param1, 13);
  h.writeUInt16LE(param2, 15);
  return h;
}

/**
 * A tape as a program would come: a BASIC loader, `10 LOAD ""SCREEN$`, run from line 10, then a SCREEN$ whose bitmap is
 * 10101010 and whose attributes are white ink on bright blue paper.
 */
function programTape(name = 'PICTURE') {
  const line = Buffer.from([0xef, 0x22, 0x22, 0xaa, 0x0d]); // LOAD "" SCREEN$ ENTER
  const program = Buffer.concat([Buffer.from([0x00, 0x0a, line.length, 0x00]), line]);
  const screen = Buffer.alloc(6912, 0xaa);
  screen.fill(0x4f, 6144);
  return Buffer.concat([
    tapBlock(0x00, header(0, name, program.length, 10, program.length)),
    tapBlock(0xff, program),
    tapBlock(0x00, header(3, name, 6912, 16384, 32768)),
    tapBlock(0xff, screen),
  ]);
}

/** A .zip of one file, deflated, as the archive hands them out (APPNOTE: its CRC-32 too, which the machine checks). */
function zipOf(name, data) {
  const packed = deflateRawSync(data);
  const n = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(30 + n.length + packed.length, 16);
  return Buffer.concat([local, n, packed, central, n, end]);
}

/** A fixture from the cache (scripts/fixture), or null where it cannot be had (no network the first time). */
function fixtureFile(name) {
  try {
    const path = execFileSync('../scripts/fixture', [name], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return existsSync(path) ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

const recording = (name) => readFileSync(new URL(`./fixtures/zxinfo/${name}.json`, import.meta.url));
/** An entry's recorded answer, by its id in the address; Saboteur's for one with none recorded. */
const entryRecording = (url) => {
  const id = (/\/games\/(\d+)/.exec(url)?.[1] ?? '4293').padStart(7, '0');
  return existsSync(new URL(`./fixtures/zxinfo/game-${id}.json`, import.meta.url)) ? recording(`game-${id}`) : recording('game-0004293');
};
/** A manual for a game with no card, set out as manuals are: a heading, then keys and what they do. */
const OTHER_MANUAL = Buffer.from('A GAME\r\n\r\nCONTROLS\r\n\r\nQ        Up\r\nA        Down\r\nO        Left\r\nP        Right\r\nSPACE    Kick\r\n\r\nGood luck.\r\n');
// A picture for every card and inlay that is not Saboteur's: one grey pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+/btfwAJYAPhYrRk8QAAAABJRU5ErkJggg==', 'base64');
const SABOTEUR_ZIP = fixtureFile('saboteur.tzx.zip');
const SABOTEUR_MANUAL = fixtureFile('saboteur-manual.txt') ?? Buffer.from('CONTROLS\r\n\r\nKeys\r\n----\r\nA       up\r\nZ       down\r\nN       left\r\nM       right\r\nSPACE   fire\r\n');
const SABOTEUR_INLAY = fixtureFile('saboteur-inlay.jpg');
const AMSTRAD = 'Amstrad have kindly given their permission for the redistribution of their copyrighted material but retain that copyright.';

// --- The harness ---------------------------------------------------------------------------------------------------

// No file watching and no hot reload: a file saved while the test runs (another agent's) must not reload its pages.
const server = await createServer({ root, server: { port: 0, strictPort: false, watch: null, hmr: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: [...(process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean), '--autoplay-policy=user-gesture-required'],
});

let failed = 0;
let ran = 0;
const queue = [];

// What changed (nerd's NERD_CHANGED, one path a line): a part runs if a file it covers changed, all of them if a file
// they share did (the machine itself among them), or one no part claims; with nothing given, all of them.
const changed = (process.env.NERD_CHANGED ?? '').split('\n').filter(Boolean);
// web/server.mjs is only the dev server's pass-through, which the page's routes answer before it: starting is its test.
const SHARED = ['web/src/app.ts', 'web/src/main.ts', 'web/src/style.css', 'web/index.html', 'web/vite.config.ts', 'web/tests/page.mjs', 'web/src/emulator/', 'web/src/video/', 'web/src/ui/dom.ts', 'web/src/ui/controls.ts', 'web/src/ui/toast.ts', 'web/src/clock/', 'web/package-lock.json', 'roms/', 'crates/', 'scripts/build-wasm.sh', 'Cargo.toml', 'Cargo.lock', 'fixtures.txt'];
const claims = (covers, path) => covers.some((c) => path === c || path.startsWith(c));

/** A page on the real machine (or `query` for another), its clock the test's, the network answered from recordings; its console errors fail the test. */
async function open(options = {}) {
  const context = await browser.newContext({
    ...(options.phone ? { viewport: options.viewport ?? { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, acceptDownloads: true }),
    ...(options.reducedMotion ? { reducedMotion: 'reduce' } : {}),
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.problems = [];
  page.archive = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  // Leaving a page something was done on asks first (beforeunload): the test's reloads say yes.
  page.on('dialog', (d) => d.accept());
  if (process.env.PAGE_LOG) page.on('console', (m) => console.log('  console', m.type(), m.text()));
  page.on('console', (m) => {
    if (m.type() === 'error') page.problems.push(`console: ${m.text()}`);
  });
  await page.route('**/zxinfo/v3/search?**', (r) => r.fulfill({ contentType: 'application/json', body: recording('search-saboteur') }));
  await page.route('**/zxinfo/v3/games/**', (r) => r.fulfill({ contentType: 'application/json', body: entryRecording(r.request().url()) }));
  await page.route('**/archive/**', (r) => {
    const path = decodeURIComponent(new URL(r.request().url()).pathname);
    page.archive.push(path);
    if (path.endsWith('.txt')) return r.fulfill({ contentType: 'text/plain', body: path.endsWith('/Saboteur.txt') ? SABOTEUR_MANUAL : OTHER_MANUAL });
    if (/\.(jpe?g|png|gif)$/i.test(path)) return SABOTEUR_INLAY && path.endsWith('/Saboteur.jpg') ? r.fulfill({ contentType: 'image/jpeg', body: SABOTEUR_INLAY }) : r.fulfill({ contentType: 'image/png', body: PNG });
    if (path.endsWith('/Saboteur.tzx.zip') && options.realSaboteur) return r.fulfill({ contentType: 'application/zip', body: SABOTEUR_ZIP });
    return r.fulfill({ contentType: 'application/zip', body: zipOf('SABOTEUR.TAP', programTape('SABOTEUR')) });
  });
  await page.route(/^https:\/\/(zxinfo\.dk|spectrumcomputing\.co\.uk)\//, (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  if (options.clock !== false) await page.clock.install();
  // Sharp pixels unless a part asks for the television: Chrome draws WebGL in software here, and the television is the dearer.
  const storage = { display: 'sharp', crop: 'full', ...options.storage };
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('zx-spectrum.settings', s);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(storage));
  // No sound card unless the part is about sound: once a click or a key has started one, frames follow its clock, which
  // is the wall's, not the page's (?sound=off: the display's clock alone).
  const query = new URLSearchParams(options.query ?? '');
  if (options.clock !== false && !query.has('sound')) query.set('sound', 'off');
  if (options.route) await options.route(page);
  await page.goto(`${base}${query.size ? `?${query}` : ''}`);
  if (options.ready !== false) await ready(page, options.clock !== false);
  return page;
}

async function ready(page, clock = true) {
  await page.waitForSelector('body[data-ready]', { state: 'attached', timeout: 30_000 });
  // From here the page's time moves only when the test moves it.
  if (clock) await pause(page);
}

/**
 * Stops the page's clock a moment ahead of where it is. The moment is the page's own time plus a margin; on a busy
 * machine the page's clock can pass it before the pause arrives (pauseAt refuses a time gone by), so it is asked again
 * from where the clock is then: the pause waits on no wall clock.
 */
async function pause(page) {
  for (;;) {
    try {
      return await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
    } catch (e) {
      if (!/to the past/.test(e.message)) throw e;
    }
  }
}

/** A part of the test: `covers` are the paths (prefixes, from the repository's root) a change to which it is run for. */
function test(name, covers, fn) {
  queue.push({ name, covers, fn });
}

class Skip extends Error {}
/** A part that judges real time (the sound card's clock) and could not: the machine kept it waiting. */
class Inconclusive extends Error {}

/**
 * Waits on the wall clock for `condition`, for a part on the sound card's clock (which page.clock does not move). Past
 * `timeout` the part could not judge (a busy machine), and says so: inconclusive, not failed.
 */
async function waitReal(page, condition, arg, timeout, what) {
  try {
    await page.waitForFunction(condition, arg, { timeout });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Inconclusive(`no ${what} within ${timeout / 1000} s of real time: the machine may have kept it waiting`);
    throw e;
  }
}

function wanted(part, all) {
  if (only) return part.name.toLowerCase().includes(only);
  if (!changed.length) return true;
  const unclaimed = changed.filter((p) => !claims(SHARED, p) && !all.some((t) => claims(t.covers, p)));
  return changed.some((p) => claims(SHARED, p)) || unclaimed.length > 0 || changed.some((p) => claims(part.covers, p));
}

/** Runs the parts, a few side by side (each on pages of its own), the slowest first. */
async function runAll(width) {
  const parts = queue.filter((p) => {
    const run = wanted(p, queue);
    if (!run) report({ part: `page › ${p.name}`, seconds: 0, outcome: 'skipped' });
    return run;
  });
  const usual = new Map();
  try {
    for (const line of readFileSync(process.env.NERD_USUAL ?? '', 'utf8').split('\n').filter(Boolean)) {
      const u = JSON.parse(line);
      usual.set(u.part, u.seconds);
    }
  } catch {
    // No history: in the order they are written.
  }
  parts.sort((a, b) => (usual.get(`page › ${b.name}`) ?? 0) - (usual.get(`page › ${a.name}`) ?? 0));
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < parts.length) {
        const part = parts[next++];
        await runPart(part.name, part.fn);
      }
    }),
  );
}

async function runPart(name, fn) {
  ran++;
  const t0 = performance.now();
  let said = '';
  let outcome = 'passed';
  try {
    said = (await fn()) ?? '';
  } catch (e) {
    if (e instanceof Skip) {
      outcome = 'skipped';
      said = e.message;
    } else if (e instanceof Inconclusive) {
      outcome = 'inconclusive';
      said = e.message;
    } else {
      outcome = 'failed';
      said = e.message.split('\n')[0];
      failed++;
    }
  }
  const seconds = (performance.now() - t0) / 1000;
  console.log(`${{ passed: 'ok  ', failed: 'FAIL', skipped: 'skip', inconclusive: '??  ' }[outcome]}  ${name}${said ? `  — ${said}` : ''}`);
  report({ part: `page › ${name}`, seconds: Number(seconds.toFixed(2)), outcome, ...(outcome !== 'passed' ? { said } : {}) });
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Runs the page's clock on by `ms`, a second at a time (the machine runs a frame for each 20 ms of it). */
async function wait(page, ms) {
  for (let left = ms; left > 0; left -= 1000) await page.clock.runFor(Math.min(1000, left));
}

/** Runs the page's clock on until `condition` (a function run in the page) holds, `ms` at a time, at most `max` ms of it. */
async function until(page, condition, arg, { step = 250, max = 60_000 } = {}) {
  for (let t = 0; t <= max; t += step) {
    if (await page.evaluate(condition, arg)) return true;
    await page.clock.runFor(step);
  }
  return false;
}

function clean(page) {
  assert(page.problems.length === 0, page.problems.join('; '));
}

/** The canvas's pixel at (fx, fy) of the frame (in sharp mode with the full border, where frame pixels map exactly). */
const pixel = (page, fx, fy) =>
  page.evaluate(([x, y]) => {
    const { renderer } = window.zx;
    const p = renderer.readPixels();
    const scale = p.width / 352;
    const i = (Math.floor((y + 0.5) * scale) * p.width + Math.floor((x + 0.5) * scale)) * 4;
    return [p.data[i], p.data[i + 1], p.data[i + 2]];
  }, [fx, fy]);

/** The colours down the frame's left border (x = 2), every row, from one reading of the canvas. */
const borderColours = (page) =>
  page.evaluate(() => {
    const p = window.zx.renderer.readPixels();
    const scale = p.width / 352;
    const seen = new Set();
    for (let y = 0; y < 296; y++) {
      const i = (Math.floor((y + 0.5) * scale) * p.width + Math.floor(2.5 * scale)) * 4;
      seen.add(`${p.data[i]},${p.data[i + 1]},${p.data[i + 2]}`);
    }
    return [...seen];
  });

const SHARP = { display: 'sharp', crop: 'full', palette: 'ula' };
const keyLog = (page) => page.evaluate(() => window.zx.emulator.keyLog.map((k) => [k.code, k.down, k.frame]));
const screen = (page) => page.evaluate(() => window.zx.emulator.screenText());
const playing = (page) => page.evaluate(() => window.zx.emulator.tape.state().playing);

/** Puts a file in through the Open button's input. */
const openFile = (page, name, buffer) => page.setInputFiles('input[type=file]', { name, mimeType: 'application/octet-stream', buffer });

// --- The tests -----------------------------------------------------------------------------------------------------

try {
  test('becomes ready on the real machine, drawn in WebGL 2', ['web/src/keyboard/', 'web/src/ui/library.ts', 'web/src/library/', 'web/public/', 'web/server.mjs'], async () => {
    const page = await open();
    const ready = await page.evaluate(() => ({ emulator: document.body.dataset.emulator, renderer: document.body.dataset.renderer, keys: document.querySelectorAll('.kb-key').length, cards: document.querySelectorAll('.card').length }));
    assert(ready.emulator === 'wasm' && ready.renderer === 'webgl2', JSON.stringify(ready));
    assert(ready.keys === 40, `${ready.keys} keys drawn`);
    assert(ready.cards >= 20, `${ready.cards} cards on the shelf`);
    await wait(page, 2000);
    clean(page);
    await page.context().close();
    return `${ready.keys} keys, ${ready.cards} games on the shelf`;
  });

  test('switches on to the ROM’s copyright: the white border, “© 1982 Sinclair Research Ltd” read from the frame and the canvas', ['web/src/clock/', 'web/src/input/typer.ts'], async () => {
    const page = await open({ storage: SHARP });
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await wait(page, 3000);
    const text = (await screen(page)).split('\n');
    assert(text[23].startsWith('© 1982 Sinclair Research Ltd'), `the bottom line reads ${JSON.stringify(text[23])}`);
    const border = await pixel(page, 4, 4);
    assert(border.join() === '216,216,216', `border ${border}`);
    // The © at the bottom left of the paper: some of its pixels are ink.
    const ink = await page.evaluate(() => {
      const p = window.zx.renderer.readPixels();
      const scale = p.width / 352;
      let dark = 0;
      for (let y = 232; y < 240; y++)
        for (let x = 48; x < 56; x++) {
          const i = (Math.floor((y + 0.5) * scale) * p.width + Math.floor((x + 0.5) * scale)) * 4;
          if (p.data[i] < 40) dark++;
        }
      return dark;
    });
    assert(ink > 8, `${ink} dark pixels in the © cell`);
    const frames = (await page.evaluate(() => window.zx.emulator.frameCount)) - f0;
    assert(Math.abs(frames - 150) <= 2, `${frames} frames in 3 s of the page's clock`);
    clean(page);
    await page.context().close();
    return `${frames} frames in 3 s, border ${border}`;
  });

  test('the stand-in still runs for tests of the page alone (?emulator=stub)', ['web/src/emulator/stub.ts', 'web/src/emulator/stub/'], async () => {
    const page = await open({ query: '?emulator=stub' });
    await wait(page, 2000);
    const kind = await page.evaluate(() => document.body.dataset.emulator);
    const text = await screen(page);
    assert(kind === 'stub' && text.includes('Sinclair Research'), `${kind}: ${JSON.stringify(text.split('\n')[23])}`);
    clean(page);
    await page.context().close();
  });

  test('draws the television without errors, and the 2D canvas where there is no WebGL', [], async () => {
    const page = await open({ storage: { display: 'tv', crop: 'tv' } });
    await wait(page, 2000);
    const centre = await page.evaluate(() => {
      const p = window.zx.renderer.readPixels();
      const i = (Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2)) * 4;
      return [p.data[i], p.data[i + 1], p.data[i + 2]];
    });
    assert(centre[0] > 150, `the television's centre is ${centre}`);
    clean(page);
    await page.context().close();
    const flat = await open({ query: '?renderer=2d', storage: SHARP });
    await wait(flat, 2000);
    const kind = await flat.evaluate(() => document.body.dataset.renderer);
    const border = await pixel(flat, 4, 4);
    assert(kind === 'canvas2d' && border.join() === '216,216,216', `${kind}: border ${border}`);
    clean(flat);
    await flat.context().close();
    return `television centre ${centre}, 2D border ${border}`;
  });

  test('the television keeps BRIGHT brighter than normal: no colour clips at the beam', ['web/src/video/'], async () => {
    // The paper's top half white, its bottom half BRIGHT white (216 and 255 in the palette, 18% apart). A television
    // that lifts its beam's peak past full white shows them alike, and half the palette with them.
    const page = await open({ storage: { display: 'tv', crop: 'full', palette: 'ula' } });
    await wait(page, 2500);
    await page.evaluate(() => {
      const e = window.zx.emulator;
      for (let a = 0x4000; a < 0x5800; a++) e.poke(a, 0);
      for (let a = 0x5800; a < 0x5b00; a++) e.poke(a, a < 0x5980 ? 0x38 : 0x78);
    });
    await wait(page, 200);
    const [normal, bright] = await page.evaluate(() => {
      const p = window.zx.renderer.readPixels();
      const band = (y0, y1) => {
        let sum = 0;
        let n = 0;
        for (let y = Math.floor(y0 * p.height); y < y1 * p.height; y++)
          for (let x = Math.floor(0.35 * p.width); x < 0.65 * p.width; x++) {
            const i = (y * p.width + x) * 4;
            sum += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
            n++;
          }
        return sum / n;
      };
      // Frame rows 48–144 are the white half, 144–240 the bright half: well inside each.
      return [band(70 / 296, 125 / 296), band(165 / 296, 220 / 296)];
    });
    assert(bright / normal > 1.08, `normal white ${normal.toFixed(1)}, bright white ${bright.toFixed(1)}: ${((bright / normal - 1) * 100).toFixed(1)}% apart`);
    clean(page);
    await page.context().close();
    return `normal ${normal.toFixed(0)}, bright ${bright.toFixed(0)} (${((bright / normal - 1) * 100).toFixed(0)}% apart)`;
  });

  test('the keyboard is laid out as the case: no legend over another, each key’s on its face', ['web/src/keyboard/'], async () => {
    const page = await open();
    const r = await page.evaluate(() => {
      const box = (el) => {
        const b = el.getBBox();
        return { x: b.x, y: b.y, w: b.width, h: b.height, el };
      };
      const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      // The letters' own height, roughly: the font's box less its ascent over the capitals and its descent.
      const ink = (b) => ({ ...b, y: b.y + b.h * 0.18, h: b.h * 0.64 });
      const plate = [...document.querySelectorAll('.zx-keyboard text.kb-plate')].map((el) => ink(box(el)));
      const clashes = [];
      for (let i = 0; i < plate.length; i++) for (let j = i + 1; j < plate.length; j++) if (overlap(plate[i], plate[j])) clashes.push(`${plate[i].el.textContent} × ${plate[j].el.textContent}`);
      // The legends on each key, inside its face (the font's box may stand 2 units over its top), and none over another.
      const off = [];
      for (const key of document.querySelectorAll('.zx-keyboard .kb-key')) {
        const face = box(key.querySelector('.kb-face'));
        const texts = [...key.querySelectorAll('.kb-legends text, .kb-legends .graphic')].map(box);
        for (const t of texts) if (t.x < face.x || t.x + t.w > face.x + face.w || t.y < face.y - 2.5 || t.y + t.h > face.y + face.h + 1) off.push(`${key.dataset.key}: ${t.el.textContent || 'graphic'}`);
        const inked = texts.map(ink);
        for (let i = 0; i < inked.length; i++) for (let j = i + 1; j < inked.length; j++) if (overlap(inked[i], inked[j])) off.push(`${key.dataset.key}: ${inked[i].el.textContent} × ${inked[j].el.textContent || 'graphic'}`);
      }
      return { plate: plate.length, clashes, off };
    });
    assert(r.plate === 76, `${r.plate} legends on the plate (26 letters × 2, 10 digits × 2 and 4 under the colours)`);
    assert(r.clashes.length === 0, `legends over one another: ${r.clashes.join(', ')}`);
    assert(r.off.length === 0, `legends off their keys or over one another: ${r.off.join(', ')}`);
    clean(page);
    await page.context().close();
    return `${r.plate} legends on the plate, none over another`;
  });

  test('a drawn key presses the key, lit while it is down; a shift latches', ['web/src/keyboard/', 'web/src/input/'], async () => {
    const page = await open();
    await wait(page, 2000);
    const key = page.locator('.kb-key[data-key="J"]');
    await key.scrollIntoViewIfNeeded();
    const box = await key.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await wait(page, 200);
    const lit = await key.evaluate((g) => g.classList.contains('lit'));
    await page.mouse.up();
    await wait(page, 200);
    const log = await keyLog(page);
    assert(lit, 'J is not lit while held');
    assert(log.some(([c, d]) => c === 33 && d) && log.some(([c, d]) => c === 33 && !d), `key log ${JSON.stringify(log)}`);
    // SYMBOL SHIFT, tapped, stays down for the next key.
    await page.locator('.kb-key[data-key="SYMBOL SHIFT"]').click();
    await wait(page, 100);
    const latched = await page.locator('.kb-key[data-key="SYMBOL SHIFT"]').evaluate((g) => g.classList.contains('latched'));
    await page.locator('.kb-key[data-key="P"]').click();
    await wait(page, 200);
    const after = await keyLog(page);
    const symDown = after.findIndex(([c, d]) => c === 36 && d);
    const pDown = after.findIndex(([c, d]) => c === 25 && d);
    assert(latched && symDown >= 0 && pDown > symDown, `latched ${latched}, SYMBOL SHIFT at ${symDown}, P at ${pDown}`);
    // The machine took them: LOAD (J in K mode), then a quote.
    const line = (await screen(page)).split('\n')[23];
    assert(line.startsWith('LOAD "'), `the bottom line reads ${JSON.stringify(line)}`);
    clean(page);
    await page.context().close();
  });

  test('the PC keyboard types BASIC: j is LOAD, a typed " is SYMBOL SHIFT and P, and the ROM shows LOAD ""', ['web/src/input/'], async () => {
    const page = await open();
    await wait(page, 2000);
    await page.mouse.click(5, 300); // the page, not a field
    await page.keyboard.press('j');
    await wait(page, 300);
    await page.keyboard.press('Shift+Quote');
    await wait(page, 300);
    await page.keyboard.press('Shift+Quote');
    await wait(page, 300);
    const log = await keyLog(page);
    const downs = log.filter(([, d]) => d).map(([c]) => c);
    assert(downs[0] === 33, `first key ${downs[0]}`);
    assert(downs.filter((c) => c === 36).length === 2 && downs.filter((c) => c === 25).length === 2, `downs ${downs}`);
    assert(!downs.includes(0), 'CAPS SHIFT went down for a quote');
    // Read from the screen's memory against the ROM's font, as the ROM drew it.
    const text = await page.evaluate(() => {
      const e = window.zx.emulator;
      let s = '';
      for (let col = 0; col < 7; col++) {
        const cell = 0x4000 | (2 << 11) | (7 << 5) | col;
        const bytes = Array.from({ length: 8 }, (_, i) => e.peek(cell + (i << 8)));
        for (let c = 32; c < 128; c++)
          if (bytes.every((b, i) => e.peek(0x3d00 + (c - 32) * 8 + i) === b)) {
            s += String.fromCharCode(c);
            break;
          }
      }
      return s;
    });
    assert(text === 'LOAD ""', `the bottom line reads ${JSON.stringify(text)}`);
    clean(page);
    await page.context().close();
    return text;
  });

  test('the page works from the keyboard, and a clicked button does not keep the keys', ['web/src/input/', 'web/src/ui/'], async () => {
    const page = await open();
    await wait(page, 1000);
    await page.mouse.click(5, 300);
    // From the machine, Shift+Tab is the way to the page's controls; there Tab moves on and Enter presses.
    await page.keyboard.press('Shift+Tab');
    const first = await page.evaluate(() => document.activeElement !== document.body);
    const toggle = page.locator('button[title="Show or hide the keyboard"]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await wait(page, 100);
    const hidden = await page.evaluate(() => document.body.classList.contains('no-keyboard'));
    await page.keyboard.press('Tab');
    const moved = await page.evaluate(() => document.activeElement?.getAttribute('title') !== 'Show or hide the keyboard' && document.activeElement !== document.body);
    // Escape gives the keys back to the machine.
    await page.keyboard.press('Escape');
    const back = await page.evaluate(() => document.activeElement === document.body);
    // Clicked, the button lets go of the focus: Space after it is the machine's SPACE, not a second press.
    await toggle.click();
    await wait(page, 100);
    const shown = await page.evaluate(() => !document.body.classList.contains('no-keyboard') && document.activeElement === document.body);
    await page.keyboard.down('Space');
    await wait(page, 100);
    await page.keyboard.up('Space');
    await wait(page, 200);
    const still = await page.evaluate(() => !document.body.classList.contains('no-keyboard'));
    const space = (await keyLog(page)).some(([c, d]) => c === 35 && d);
    assert(first, 'Shift+Tab from the machine reached no control');
    assert(hidden && moved && back, `Enter on the focused toggle hid the keyboard: ${hidden}; Tab moved on: ${moved}; Escape back to the machine: ${back}`);
    assert(shown && still && space, `after a click: focus let go ${shown}, Space left the button alone ${still}, Space reached the machine ${space}`);
    clean(page);
    await page.context().close();
  });

  test('the arrows edit a BASIC line until a program loads, then are the joystick', ['web/src/input/'], async () => {
    const page = await open({ storage: { joystick: 'kempston', arrowsJoystick: true, mapping: 'auto' } });
    await wait(page, 1000);
    await page.mouse.click(5, 300);
    await page.keyboard.down('ArrowLeft');
    await wait(page, 200);
    const cursor = await page.evaluate(() => ({ bits: window.zx.emulator.joystickState.bits, down: window.zx.emulator.keyLog.filter((k) => k.down).map((k) => k.code) }));
    await page.keyboard.up('ArrowLeft');
    await wait(page, 200);
    await page.evaluate(() => (window.zx.app.programLoaded = true));
    await page.keyboard.down('ArrowLeft');
    await wait(page, 200);
    const joy = await page.evaluate(() => window.zx.emulator.joystickState.bits);
    // The Kempston port reads it: IN 31 has bit 1 (left) set while it is held.
    const port = await page.evaluate(() => {
      const e = window.zx.emulator;
      // IN A,(31) at 8000h: DB 1F, then HALT.
      [0xdb, 0x1f, 0x76].forEach((b, i) => e.poke(0x8000 + i, b));
      // Mid-frame, where no interrupt comes first.
      e.x.zx_set_tstate(e.h, 20_000);
      e.x.zx_set_register(e.h, 11, 0x8000);
      e.step();
      return e.registers().af >> 8;
    });
    await page.keyboard.up('ArrowLeft');
    // CAPS SHIFT (0) and 5 (19) at BASIC; the joystick's left (2) once a program is in.
    assert(cursor.bits === 0 && cursor.down.includes(0) && cursor.down.includes(19), `at BASIC: joystick ${cursor.bits}, keys down ${cursor.down}`);
    assert(joy === 2 && port === 2, `with a program loaded: joystick ${joy}, IN 31 reads ${port}`);
    clean(page);
    await page.context().close();
  });

  test('a tape from a file loads: LOAD "" typed when the ROM is ready, stripes in the border, then its screen, flat out', ['web/src/ui/deck.ts', 'web/src/input/', 'web/src/clock/'], async () => {
    const page = await open({ storage: SHARP });
    await wait(page, 1000);
    await openFile(page, 'test.tap', programTape('PICTURE'));
    await wait(page, 100);
    const blocks = await page.locator('.block').count();
    assert(blocks === 4, `${blocks} blocks in the deck`);
    assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 250, max: 10_000 }), 'the tape did not start');
    const log = (await keyLog(page)).filter(([, d]) => d).map(([c]) => c);
    assert(log.join() === '33,36,25,36,25,30', `typed ${log}`);
    await wait(page, 3000);
    const colours = new Set(await borderColours(page));
    assert(colours.has('216,0,0') && colours.has('0,216,216'), `border colours in the pilot: ${[...colours].join(' ')}`);
    // The rest, flat out.
    await page.locator('.deck .seg', { hasText: 'Accelerated' }).click();
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    assert(await until(page, () => !window.zx.emulator.tape.state().playing, null, { step: 200, max: 15_000 }), 'the tape did not stop');
    const loadedIn = (await page.evaluate(() => window.zx.emulator.frameCount)) - f0;
    await wait(page, 200);
    const paper = await pixel(page, 49, 49);
    const ink = await pixel(page, 48, 49);
    assert(paper.join() === '0,0,255' && ink.join() === '255,255,255', `the loaded screen: ink ${ink}, paper ${paper}`);
    const speed = await page.evaluate(() => window.zx.app.scheduler.speed);
    assert(speed === 1, `back at ${speed} once the tape stopped`);
    clean(page);
    await page.context().close();
    return `border ${colours.size} colours; the rest in ${loadedIn} frames flat out; the screen ink ${ink} on ${paper}`;
  });

  test('a 128 loads a tape from its menu: ENTER on Tape Loader once the menu shows', ['web/src/input/typer.ts'], async () => {
    const page = await open({ storage: { ...SHARP, model: '128k', loading: 'accelerated' } });
    await wait(page, 500);
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await openFile(page, 'test.tap', programTape('PICTURE'));
    assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 100, max: 10_000 }), 'the tape did not start');
    const enter = (await keyLog(page)).filter(([, d]) => d);
    assert(enter.length === 1 && enter[0][0] === 30, `typed ${JSON.stringify(enter)}`);
    const after = enter[0][2] - f0;
    // The menu shows about 61 frames after switching on: ENTER is pressed then, not after a fixed wait.
    assert(after > 55 && after < 100, `ENTER ${after} frames after switching on`);
    assert(await until(page, () => window.zx.emulator.peek(0x5800) === 0x4f && !window.zx.emulator.tape.state().playing, null, { step: 200, max: 15_000 }), 'the screen did not load');
    clean(page);
    await page.context().close();
    return `ENTER ${after} frames after switching on`;
  });

  test('Saboteur from the library: searched, fetched, loaded flat out to its £100 REWARD screen, with its inlay, manual and card; its Start button to play, and the controls over the screen', ['web/src/library/', 'web/src/ui/library.ts', 'web/src/ui/game.ts', 'web/src/ui/overlay.ts', 'web/src/ui/howto.ts', 'web/tests/fixtures/'], async () => {
    if (!SABOTEUR_ZIP) throw new Skip('no saboteur.tzx.zip in the fixture cache');
    const page = await open({ storage: { ...SHARP, loading: 'accelerated' }, realSaboteur: true });
    await wait(page, 500);
    await page.fill('.search', 'saboteur');
    await page.press('.search', 'Enter');
    await page.waitForFunction(() => document.querySelector('.library-status')?.textContent?.includes('found'));
    const fetched = page.waitForRequest((r) => r.url().endsWith('.zip'));
    await page.locator('.card', { hasText: 'Saboteur!' }).first().click();
    const request = await fetched;
    assert(request.url().endsWith('/archive/pub/sinclair/games/s/Saboteur.tzx.zip'), request.url());
    await page.waitForFunction(() => window.zx.emulator.tape.blocks().length > 8);
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    // The game's own loader's stripes in the border, black and red, while its 38,500 bytes come in (the tape's block 8,
    // after an archive info block and the loaders).
    assert(await until(page, () => window.zx.emulator.tape.state().block === 8, null, { step: 50, max: 10_000 }), 'the game block did not play');
    const stripes = await borderColours(page);
    assert(stripes.length === 2 && stripes.includes('0,0,0') && stripes.includes('216,0,0'), `the border while the game loads: ${stripes.join(' ')}`);
    const reached = await until(page, () => window.zx.emulator.screenText().includes('REWARD'), null, { step: 250, max: 20_000 });
    const after = await page.evaluate(() => ({ frames: window.zx.emulator.frameCount, text: window.zx.emulator.screenText().split('\n'), speed: window.zx.app.scheduler.speed, label: document.querySelector('.cs-title')?.textContent, inlay: document.querySelector('.deck')?.classList.contains('has-inlay'), keys: [...document.querySelectorAll('.controls-table td:last-child kbd')].map((t) => t.textContent), goal: document.querySelector('.game-goal')?.textContent ?? '', fallback: !document.querySelector('.game-fallback').hidden, model: window.zx.emulator.model, url: location.search }));
    assert(reached, `no REWARD screen: ${JSON.stringify(after.text.slice(0, 3))}`);
    const frames = after.frames - f0;
    // The tape plays 9,039 frames (180.5 s); the 48K boots, LOAD "" is typed, the game prints its screen.
    assert(frames < 9_400, `the REWARD screen ${frames} frames after the tape went in`);
    assert(after.text[0] === '          £100  REWARD          ' && after.text[23] === '   PRESS ANY KEY TO CONTINUE    ', JSON.stringify([after.text[0], after.text[23]]));
    assert(after.speed === 1, `the page at ${after.speed} once the tape stopped`);
    assert(after.label === 'Saboteur!' && after.model === '48k', `the cassette says ${after.label}, on a ${after.model}`);
    assert(after.inlay, 'no inlay on the cassette');
    assert(after.keys.includes('Space') && after.keys.includes('A') && after.keys.includes('N'), `keys on the card: ${after.keys}`);
    assert(/helicopter/.test(after.goal) && !after.fallback, `the card's goal: ${after.goal}; the fallback shown: ${after.fallback}`);
    assert(new URLSearchParams(after.url).get('game') === '4293', `the address: ${after.url}`);
    // The joystick is the card's choice to begin with, and no key is marked on the drawn keyboard for it; the game's own
    // keys are once Keys is chosen. Then the Start button takes it from the REWARD screen to the game by the keyboard,
    // the menu's keys pressed for the person (the card's route).
    const marks = () => page.evaluate(() => [...document.querySelectorAll('.kb-key.marked')].map((k) => k.dataset.key).sort().join(' '));
    const chosen = await page.evaluate(() => document.querySelector('.start-how .seg.on')?.textContent);
    const unmarked = await marks();
    assert(chosen === 'Joystick' && unmarked === '', `chosen at first: ${chosen}; keys marked: ${unmarked}`);
    const s0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await page.locator('.start-how .seg', { hasText: 'Keys' }).click();
    const marked = await marks();
    assert(marked === 'A M N SPACE Z', `keys marked on the keyboard with Keys chosen: ${marked}`);
    // The way in is on the picture too while the REWARD screen waits: pressed, it starts the game as the panel's would.
    assert(await until(page, () => !document.querySelector('.start-prompt').hidden && document.querySelector('.panel.game').dataset.start === 'ready', null, { step: 100, max: 5_000 }), 'no start button on the picture at the REWARD screen');
    await page.locator('.start-prompt').click();
    assert(await until(page, () => document.querySelector('.panel.game').dataset.start === 'done', null, { step: 250, max: 120_000 }), `the game did not begin: ${await page.evaluate(() => document.querySelector('.panel.game').dataset.start)}`);
    const started = await page.evaluate(() => {
      const e = window.zx.emulator;
      const row = (r) => Array.from({ length: 32 }, (_, c) => e.peek(0x5800 + r * 32 + c));
      return { frames: e.frameCount, panel: row(18).every((a) => a === 2) && row(23).every((a) => a === 2) };
    });
    assert(started.panel, 'no game panel on the screen after the Start button');
    assert(await page.evaluate(() => document.querySelector('.start-prompt').hidden), 'the start button stayed on the picture once the game began');
    // Play has begun: the controls over the screen, as the keys chosen press them, for a few seconds of the game.
    const overlay = () =>
      page.evaluate(() => {
        const o = document.querySelector('.controls-overlay');
        return { shown: !o.hidden, mode: o.querySelector('.ov-mode')?.textContent, caps: [...o.querySelectorAll('.ov-row kbd')].map((k) => k.textContent), button: document.querySelector('.controls-button').getAttribute('aria-expanded') };
      });
    const first = await overlay();
    assert(first.shown && first.mode === 'Keys' && ['N', 'M', 'A', 'Z', 'Space'].every((k) => first.caps.includes(k)), `the controls when play began: ${JSON.stringify(first)}`);
    await wait(page, 9000);
    const gone = await overlay();
    assert(!gone.shown, 'the controls stayed over the screen past their few seconds');
    // F3 brings them back, as they are pressed now (the joystick chosen: the arrows and Left Alt); F3 again hides them.
    await page.locator('.start-how .seg', { hasText: 'Joystick' }).click();
    await page.mouse.click(5, 400);
    await page.keyboard.press('F3');
    const asked = await overlay();
    assert(asked.shown && asked.mode === 'Joystick' && asked.caps.includes('Left Alt') && asked.caps.includes('←') && asked.button === 'true', `F3: ${JSON.stringify(asked)}`);
    await wait(page, 9000);
    assert((await overlay()).shown, 'the controls asked for went by themselves');
    await page.keyboard.press('F3');
    assert(!(await overlay()).shown, 'F3 did not hide the controls');
    // The button on the set shows them; their × closes them, and that is remembered for the game.
    await page.locator('.controls-button').click();
    assert((await overlay()).shown, 'the button did not show the controls');
    await page.locator('.ov-close').click();
    const closed = await page.evaluate(() => ({ shown: !document.querySelector('.controls-overlay').hidden, kept: localStorage.getItem('zx-spectrum.controls-closed') }));
    assert(!closed.shown && JSON.parse(closed.kept ?? '[]').includes('zxdb:0004293'), `after the ×: ${JSON.stringify(closed)}`);
    clean(page);
    await page.context().close();
    return `REWARD ${frames} frames after the tape went in; keys ${after.keys.join(' ')}; the game ${started.frames - s0} frames after Start; the controls over it`;
  });

  test('a link to a game loads it straight away (?game=4293), and the share button gives that link', ['web/src/ui/game.ts', 'web/src/library/'], async () => {
    const page = await open({ query: '?game=4293', storage: { loading: 'accelerated' } });
    assert(await until(page, () => window.zx.emulator.tape.state().loaded && document.querySelector('.cs-title')?.textContent === 'Saboteur!', null, { step: 200, max: 10_000 }), `Saboteur did not go into the deck: ${await page.evaluate(() => JSON.stringify([window.zx.emulator.tape.state(), document.querySelector('.cs-title')?.textContent, document.querySelector('.toasts')?.textContent, location.href]))}; ${page.problems}; archive ${page.archive}`);
    assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 200, max: 10_000 }), 'the tape did not start');
    assert(page.archive.some((p) => p.endsWith('/Saboteur.tzx.zip')) && page.archive.some((p) => p.endsWith('/Saboteur.txt')), `fetched ${page.archive.join(', ')}`);
    const panel = await page.evaluate(() => ({ title: document.querySelector('.game-title')?.textContent, start: document.querySelector('.game-start')?.textContent ?? '', shown: !document.querySelector('.panel.game').hidden }));
    assert(panel.shown && panel.title === 'Saboteur!' && panel.start.includes('REWARD'), JSON.stringify(panel));
    await page.locator('.game button', { hasText: 'Share' }).click();
    await wait(page, 100);
    const shared = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return document.querySelector('.toasts')?.textContent ?? '';
      }
    });
    assert(shared.includes(`${new URL(base).host}/?game=4293`), `shared ${shared}`);
    // A snapshot saved of the game, opened again, is the game again: its panel, not a file's.
    await page.getByRole('button', { name: 'Snapshot' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Save as .szx' }).click();
    const file = await download;
    const bytes = readFileSync(await file.path());
    await page.evaluate(() => window.zx.app.reset());
    await openFile(page, file.suggestedFilename(), bytes);
    assert(await until(page, () => document.querySelector('.game-title')?.textContent === 'Saboteur!' && window.zx.app.game?.entry?.id === '0004293', null, { step: 100, max: 5_000 }), `the snapshot opened as ${await page.evaluate(() => document.querySelector('.game-title')?.textContent)}`);
    clean(page);
    await page.context().close();
    return `${shared}; ${file.suggestedFilename()} opened as Saboteur!`;
  });

  test('a game with no card (found by searching) shows what is known: ZXDB’s controls, the manual’s keys, the honest line; F3 puts them over the screen', ['web/src/ui/game.ts', 'web/src/ui/overlay.ts', 'web/src/ui/howto.ts', 'web/src/library/'], async () => {
    // International Match Day: on no shelf, so with no card; its manual (the test's) has a table of keys.
    const page = await open({ query: '?game=2514', storage: { loading: 'accelerated' } });
    assert(await until(page, () => document.querySelector('.game-title')?.textContent === 'International Match Day' && document.querySelector('.game-fallback .keys-table'), null, { step: 200, max: 10_000 }), `no panel for the game: ${await page.evaluate(() => document.querySelector('.panel.game')?.textContent?.slice(0, 200))}`);
    const panel = await page.evaluate(() => ({
      start: !document.querySelector('.game-start').hidden,
      card: !document.querySelector('.game-howto').hidden,
      said: document.querySelector('.fallback-said').textContent,
      honest: document.querySelector('.fallback-honest').textContent,
      keys: [...document.querySelectorAll('.game-fallback .keys-table th')].map((t) => t.textContent),
      model: window.zx.emulator.model,
    }));
    assert(!panel.start && !panel.card, `a card's parts shown for a game with none: ${JSON.stringify(panel)}`);
    assert(panel.said === 'The ZXDB says it takes a cursor joystick (5, 6, 7, 8 and 0), a Sinclair joystick or a Kempston joystick.', panel.said);
    assert(panel.honest.startsWith('Most games of the time take a Kempston joystick from their menu: choose it there, then play with the arrow keys and Left Alt.'), panel.honest);
    assert(panel.keys.join(' ') === 'Q A O P SPACE' && panel.model === '128k', `the manual's keys ${panel.keys}, on a ${panel.model}`);
    await page.mouse.click(5, 400);
    await page.keyboard.press('F3');
    const over = await page.evaluate(() => {
      const o = document.querySelector('.controls-overlay');
      return { shown: !o.hidden, mode: o.querySelector('.ov-mode').textContent, caps: [...o.querySelectorAll('.ov-row kbd')].map((k) => k.textContent), note: o.querySelector('.ov-note').textContent };
    });
    assert(over.shown && over.mode === 'Controls' && over.caps.join(' ') === 'Q A O P SPACE' && /Kempston joystick from their menu/.test(over.note), JSON.stringify(over));
    // Its keys outlined on the drawn keyboard, from the manual.
    const marked = await page.evaluate(() => [...document.querySelectorAll('.kb-key.marked')].map((k) => k.dataset.key).sort().join(' '));
    assert(marked === 'A O P Q SPACE', `keys marked: ${marked}`);
    clean(page);
    await page.context().close();
    return panel.said;
  });

  test('a card’s key map: for a game with no joystick, the arrows and the fire key press its keys, and let them go', ['web/src/input/', 'web/src/ui/touch.ts'], async () => {
    const page = await open({ storage: { joystick: 'kempston', arrowsJoystick: true, mapping: 'auto' } });
    await wait(page, 1000);
    // As a card's key map would put them (Manic Miner's, say): left on O, fire on SPACE.
    await page.evaluate(() => {
      const app = window.zx.app;
      app.programLoaded = true;
      app.padKeys.set({ LEFT: 'O', FIRE: 'SPACE' }, window.zx.emulator.frameCount);
    });
    await page.mouse.click(5, 300);
    const at = () => page.evaluate(() => ({ bits: window.zx.emulator.joystickState.bits, down: window.zx.emulator.keyLog.filter((k) => k.down).map((k) => k.code), up: window.zx.emulator.keyLog.filter((k) => !k.down).map((k) => k.code) }));
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('AltLeft');
    await wait(page, 200);
    const held = await at();
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('AltLeft');
    await wait(page, 200);
    const after = await at();
    // O is key 26 (half-row DFFE, bit 1), SPACE 35; the joystick itself left at rest.
    assert(held.bits === 0 && held.down.includes(26) && held.down.includes(35), `held: ${JSON.stringify(held)}`);
    assert(after.up.includes(26) && after.up.includes(35) && !(await page.evaluate(() => window.zx.app.feeder.isDown(26) || window.zx.app.feeder.isDown(35))), `let go: ${JSON.stringify(after)}`);
    // No key map: the arrows are the joystick again.
    await page.evaluate(() => window.zx.app.padKeys.set(null, window.zx.emulator.frameCount));
    await page.keyboard.down('ArrowLeft');
    await wait(page, 200);
    const joystick = await page.evaluate(() => window.zx.emulator.joystickState.bits);
    await page.keyboard.up('ArrowLeft');
    assert(joystick === 2, `without a key map, left is joystick bit ${joystick}`);
    clean(page);
    await page.context().close();
  });

  test('save slots: F2 keeps the machine, F4 puts it back, after a reload too, with the game’s tape in the deck', ['web/src/state/saves.ts', 'web/src/ui/game.ts'], async () => {
    const page = await open({ query: '?game=4293', storage: { loading: 'accelerated' } });
    assert(await until(page, () => window.zx.emulator.peek(0x5800) === 0x4f && !window.zx.emulator.tape.state().playing, null, { step: 200, max: 20_000 }), 'the game did not load');
    await page.evaluate(() => window.zx.emulator.poke(0x8000, 0x5a));
    await page.mouse.click(5, 300);
    await page.keyboard.press('F2');
    assert(await until(page, () => document.querySelectorAll('.slot.filled').length === 1, null, { step: 100, max: 5_000 }), 'the quick slot is not filled');
    await page.evaluate(() => window.zx.emulator.poke(0x8000, 0));
    await page.keyboard.press('F4');
    assert(await until(page, () => window.zx.emulator.peek(0x8000) === 0x5a, null, { step: 100, max: 5_000 }), 'F4 did not put it back');
    // Another visit: the link loads the game afresh; F4 brings back the moment, the tape where it was.
    await page.reload();
    await ready(page);
    assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 200, max: 10_000 }), 'the game did not load again');
    await page.mouse.click(5, 300);
    await page.keyboard.press('F4');
    assert(await until(page, () => window.zx.emulator.peek(0x8000) === 0x5a, null, { step: 100, max: 5_000 }), 'the slot did not come back after a reload');
    const after = await page.evaluate(() => ({ slots: document.querySelectorAll('.slot.filled').length, tape: window.zx.emulator.tape.state() }));
    assert(after.slots === 1 && after.tape.loaded && after.tape.position > 30, JSON.stringify(after));
    clean(page);
    await page.context().close();
    return `tape at ${after.tape.position.toFixed(1)} s`;
  });

  test('saves a snapshot, and loads one dropped on the page', [], async () => {
    const page = await open();
    await wait(page, 2000);
    await page.evaluate(() => window.zx.emulator.poke(0x8000, 0x5a));
    const files = [];
    for (const format of ['z80', 'szx', 'sna']) {
      await page.getByRole('button', { name: 'Snapshot' }).click();
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: `Save as .${format}` }).click();
      const file = await download;
      files.push({ name: file.suggestedFilename(), bytes: readFileSync(await file.path()) });
    }
    assert(files.every((f, i) => f.name.endsWith(['.z80', '.szx', '.sna'][i]) && f.bytes.length > 300), files.map((f) => `${f.name} ${f.bytes.length}`).join(', '));
    for (const f of files) {
      await page.evaluate(() => window.zx.emulator.poke(0x8000, 0));
      await page.evaluate(
        ([b64, name]) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const dt = new DataTransfer();
          dt.items.add(new File([bytes], name));
          window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
          window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
        },
        [f.bytes.toString('base64'), f.name],
      );
      await page.waitForFunction(() => window.zx.emulator.peek(0x8000) === 0x5a);
    }
    await wait(page, 500);
    const text = (await screen(page)).split('\n')[23];
    assert(text.includes('Sinclair Research'), `after the snapshots: ${JSON.stringify(text)}`);
    clean(page);
    await page.context().close();
    return files.map((f) => `${f.name} ${f.bytes.length} bytes`).join(', ');
  });

  test('rewinds: a moment every half second, its picture shown while choosing, and the machine put back to it', ['web/src/state/rewind.ts', 'web/src/ui/timeline.ts'], async () => {
    const page = await open();
    await wait(page, 4000);
    const before = await page.evaluate(() => ({ moments: window.zx.app.rewind.length, history: window.zx.app.history, first: Array.from(window.zx.app.rewind.list()[0].colours).reduce((a, b) => a + b, 0) }));
    assert(before.moments >= 7, `${before.moments} moments after 4 s`);
    // The first moment's colours were read before the module's memory grew (making the moments' reader grows it).
    assert(before.first > 1000, `the first moment's colours count ${before.first} pixels`);
    // Something to go back from: LOAD typed on the bottom line.
    await page.mouse.click(5, 300);
    await page.keyboard.press('j');
    await wait(page, 2000);
    assert((await screen(page)).split('\n')[23].startsWith('LOAD'), 'LOAD was not typed');
    await page.focus('.timeline-track');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
    const chosen = await page.evaluate(() => {
      const app = window.zx.app;
      const list = app.rewind.list();
      const m = list[list.length - 7];
      const picture = window.zx.emulator.statePicture(m.state);
      // What is on the screen now is the moment's picture, not the machine's.
      const p = window.zx.renderer.readPixels();
      return { previewing: !!app.preview, frame: m.frame, picture: picture && Array.from(picture.subarray(23 * 8 * 352 + 48 * 352 + 48, 23 * 8 * 352 + 48 * 352 + 100)), drawn: p.width > 0 };
    });
    const osd = await page.evaluate(() => ({ kind: document.querySelector('.osd')?.dataset.kind, hidden: document.querySelector('.osd')?.hidden, drained: document.body.classList.contains('previewing') }));
    await page.keyboard.press('Enter');
    const after = await page.evaluate(() => ({ history: window.zx.app.history, bottom: window.zx.emulator.screenText().split('\n')[23], frame: Array.from(window.zx.emulator.frame().subarray(23 * 8 * 352 + 48 * 352 + 48, 23 * 8 * 352 + 48 * 352 + 100)) }));
    assert(chosen.previewing, 'no moment shown while choosing');
    assert(osd.kind === 'preview' && !osd.hidden && osd.drained, `the screen while previewing: ${JSON.stringify(osd)}`);
    assert(after.history === chosen.frame && after.history < before.history + 100, `history ${before.history} → ${after.history}`);
    assert(!after.bottom.startsWith('LOAD'), `after going back the bottom line reads ${JSON.stringify(after.bottom)}`);
    assert(JSON.stringify(after.frame) === JSON.stringify(chosen.picture), 'the picture after going back is not the moment’s');
    clean(page);
    await page.context().close();
    return `back to frame ${after.history}`;
  });

  test('a SAVE from BASIC comes out of the deck as a TAP to download', ['web/src/ui/deck.ts'], async () => {
    const page = await open();
    await wait(page, 2000);
    await page.mouse.click(5, 300);
    // 10 REM hi (E is REM in K mode), then SAVE "hi" (S is SAVE), as the ROM is typed.
    await page.keyboard.type('10ehi', { delay: 0 });
    await page.keyboard.press('Enter');
    await wait(page, 2000);
    await page.keyboard.type('s"hi"');
    await page.keyboard.press('Enter');
    await wait(page, 2000);
    assert((await screen(page)).includes('Start tape'), `SAVE did not ask for the tape: ${JSON.stringify((await screen(page)).split('\n').filter((l) => l.trim()))}`);
    await page.keyboard.press('Enter');
    assert(await until(page, () => /2 blocks/.test(document.querySelector('.deck-saved')?.textContent ?? ''), null, { step: 500, max: 20_000 }), `nothing recorded: ${JSON.stringify((await screen(page)).split('\n').filter((l) => l.trim()))} ${await page.evaluate(() => document.querySelector('.deck-saved').textContent + ' ' + window.zx.emulator.savedTap().length)}`);
    const download = page.waitForEvent('download');
    await page.locator('.deck-saved button').click();
    const file = await download;
    const tap = readFileSync(await file.path());
    // Named for what was SAVEd: its header's name.
    assert(file.suggestedFilename() === 'hi.tap' && tap[0] === 19 && tap[2] === 0 && tap.subarray(4, 6).toString() === 'hi', `${file.suggestedFilename()}: ${[...tap.subarray(0, 8)]}`);
    clean(page);
    await page.context().close();
    return `${file.suggestedFilename()}, ${tap.length} bytes`;
  });

  test('a breakpoint stops the machine, and the inspector shows where, disassembled', ['web/src/ui/inspector.ts'], async () => {
    const page = await open();
    await wait(page, 2000);
    await page.locator('button[title="Settings"]').click();
    await page.fill('.inspector input[aria-label="Breakpoint address, in hex"]', '0038');
    await page.locator('.inspector button', { hasText: 'Break at' }).click();
    await page.keyboard.press('Escape');
    await wait(page, 200);
    const stopped = await page.evaluate(() => ({ pc: window.zx.emulator.registers().pc, at: window.zx.emulator.breakpoint, speed: window.zx.app.scheduler.speed, open: document.querySelector('dialog.settings').open, code: document.querySelector('.dump.code')?.textContent ?? '' }));
    assert(stopped.pc === 0x38 && stopped.at === 0x38 && stopped.speed === 'pause', JSON.stringify(stopped));
    assert(stopped.open && /▶ 0038 +F5 +PUSH AF/.test(stopped.code), stopped.code.split('\n')[0]);
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await page.locator('.inspector .bp').click();
    await page.locator('.inspector button', { hasText: 'Run' }).click();
    await page.keyboard.press('Escape');
    await wait(page, 1000);
    const ran = (await page.evaluate(() => window.zx.emulator.frameCount)) - f0;
    assert(ran >= 45, `${ran} frames after Run`);
    clean(page);
    await page.context().close();
    return stopped.code.split('\n')[0].trim();
  });

  test('switching on warms the tube up (a fade where motion is reduced), and the footer says Amstrad’s words', ['web/src/style.css', 'web/src/fonts/'], async () => {
    const page = await open();
    await page.evaluate(() => {
      window.warmed = 0;
      new MutationObserver(() => window.zx.renderer.canvas.classList.contains('warming') && window.warmed++).observe(window.zx.renderer.canvas, { attributes: true, attributeFilter: ['class'] });
    });
    await page.locator('button[title="Switch it off and on again"]').click();
    const anim = await page.evaluate(() => ({ warmed: window.warmed, name: getComputedStyle(window.zx.renderer.canvas).animationName }));
    const foot = await page.evaluate(() => document.querySelector('.foot')?.textContent ?? '');
    clean(page);
    await page.context().close();
    const still = await open({ reducedMotion: true });
    await still.locator('button[title="Switch it off and on again"]').click();
    const reduced = await still.evaluate(() => getComputedStyle(window.zx.renderer.canvas).animationName);
    clean(still);
    await still.context().close();
    assert(anim.warmed >= 1 && anim.name === 'warm-up', JSON.stringify(anim));
    assert(reduced === 'warm-fade', `with reduced motion: ${reduced}`);
    assert(foot.includes(AMSTRAD), `the footer: ${foot}`);
    assert(/Spectrum Computing/.test(foot) && /ZXDB/.test(foot), 'the archive is not credited');
    return `${anim.name}; ${reduced}`;
  });

  test('remembers its settings across a reload', ['web/src/state/settings.ts', 'web/src/ui/settings.ts'], async () => {
    const page = await open();
    await page.locator('.display .seg', { hasText: 'Sharp' }).click();
    await page.reload();
    await page.waitForSelector('body[data-ready]', { state: 'attached' });
    const display = await page.evaluate(() => document.body.dataset.display);
    assert(display === 'sharp', `display ${display} after a reload`);
    clean(page);
    await page.context().close();
  });

  test('sounds once clicked: the worklet plays the frames', ['web/src/audio/', 'web/src/clock/'], async () => {
    const page = await open({ clock: false });
    const before = await page.evaluate(() => !!window.zx.app.sound);
    await page.locator('.veil').click();
    await waitReal(page, () => window.zx.app.sound?.running && document.body.classList.contains('sound-on'), null, 10_000, 'sound card running');
    const frames0 = await page.evaluate(() => window.zx.emulator.frameCount);
    // Condition, not time: the sound card's clock runs frames until there have been 50 more.
    await waitReal(page, (f) => window.zx.emulator.frameCount > f + 50, frames0, 15_000, '50 frames on the sound card’s clock');
    const led = await page.evaluate(() => window.zx.app.scheduler.audioLed && window.zx.emulator.audio().length > 1500);
    assert(!before && led, `sound before the click: ${before}; frames led by the sound card, with their sound: ${led}`);
    clean(page);
    await page.context().close();
  });

  test('follows the sound card when it stops and starts again: the display’s clock meanwhile, nothing stale queued', ['web/src/audio/', 'web/src/clock/'], async () => {
    const page = await open({ clock: false });
    await page.locator('.veil').click();
    await waitReal(page, () => window.zx.app.sound?.running && window.zx.app.scheduler.audioLed, null, 10_000, 'sound card running');
    // The system takes the sound card away (a call, another app): frames go on by the display, silently, and the
    // page asks for sound again on the next gesture.
    await page.evaluate(() => window.zx.app.sound.context.suspend());
    await waitReal(page, () => !window.zx.app.scheduler.audioLed && !document.querySelector('.veil').hidden, null, 10_000, 'move to the display’s clock');
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await waitReal(page, (f) => window.zx.emulator.frameCount > f + 10, f0, 15_000, '10 frames on the display’s clock');
    await page.locator('.veil').click();
    await waitReal(page, () => window.zx.app.sound.running && window.zx.app.scheduler.audioLed && document.querySelector('.veil').hidden, null, 10_000, 'return to the sound card’s clock');
    // Started afresh: what is queued is what the scheduler has just sent, not what piled up meanwhile.
    const queued = await page.evaluate(() => window.zx.app.scheduler.queued(performance.now()) / window.zx.app.scheduler.samplesPerFrame());
    assert(queued < 8, `${queued.toFixed(1)} frames queued after the sound card came back`);
    clean(page);
    await page.context().close();
    return `${queued.toFixed(1)} frames queued on its return`;
  });

  test('a tape playing leaves the page where it is: the deck’s list follows the head, the window does not', ['web/src/ui/deck.ts'], async () => {
    // On a phone the deck is under the keyboard: the screen is what is watched while the tape loads.
    const page = await open({ phone: true });
    await wait(page, 1000);
    await openFile(page, 'test.tap', programTape('PICTURE'));
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(await until(page, () => window.zx.emulator.tape.state().block >= 1, null, { step: 500, max: 20_000 }), 'the tape did not reach its second block');
    const y = await page.evaluate(() => window.scrollY);
    assert(y === 0, `the window scrolled to ${y} as the tape went on`);
    clean(page);
    await page.context().close();
  });

  test('fits a phone: no sideways scroll, a touch pad that is the joystick', ['web/src/ui/touch.ts', 'web/src/input/gamepad.ts'], async () => {
    const page = await open({ phone: true, query: '?game=4293' });
    await wait(page, 1000);
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, pad: getComputedStyle(document.querySelector('.touchpad')).display }));
    assert(fit.scroll <= fit.width, `page ${fit.scroll} px wide in a ${fit.width} px window (with a game's panel)`);
    assert(fit.pad === 'flex', `touch pad display ${fit.pad}`);
    const fire = page.locator('.pad-fire');
    await fire.scrollIntoViewIfNeeded();
    const box = await fire.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    // A tap is a press and a release; hold it instead, through the pointer events a touch makes.
    await fire.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true });
    await wait(page, 100);
    const bits = await page.evaluate(() => window.zx.emulator.joystickState.bits);
    await fire.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
    assert(bits === 16, `joystick bits ${bits} with fire held`);
    clean(page);
    await page.context().close();
    return `${fit.scroll} px in ${fit.width} px`;
  });

  test('the Kempston stays plugged in: IN 31 reads nothing pressed after the power button, a game’s tape and going back', ['web/src/input/'], async () => {
    const page = await open({ query: '?game=4293', storage: { joystick: 'kempston', loading: 'accelerated' } });
    // IN A,(31) at 8000h mid-frame, as a game reads the joystick: 0 with nothing pressed; a port with no interface floats (FF).
    const in31 = () =>
      page.evaluate(() => {
        const e = window.zx.emulator;
        const keep = [0, 1, 2].map((i) => e.peek(0x8000 + i));
        [0xdb, 0x1f, 0x76].forEach((b, i) => e.poke(0x8000 + i, b));
        const pc = e.registers().pc;
        e.x.zx_set_tstate(e.h, 20_000);
        e.x.zx_set_register(e.h, 11, 0x8000);
        e.step();
        const a = e.registers().af >> 8;
        e.x.zx_set_register(e.h, 11, pc);
        keep.forEach((b, i) => e.poke(0x8000 + i, b));
        return a;
      });
    assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 100, max: 10_000 }), 'the tape did not start');
    await wait(page, 200);
    const loading = await in31();
    await page.locator('button[title="Switch it off and on again"]').click();
    await wait(page, 200);
    const afterPower = await in31();
    await page.evaluate(() => window.zx.app.goBack(0));
    await wait(page, 200);
    const afterRewind = await in31();
    assert(loading === 0 && afterPower === 0 && afterRewind === 0, `IN 31: loading ${loading}, after the power button ${afterPower}, after going back ${afterRewind}`);
    clean(page);
    await page.context().close();
  });

  test('a frame that throws stops the machine and says so; started again, it goes back to the last moment, in a new module', ['web/src/clock/'], async () => {
    const page = await open({ storage: SHARP });
    await wait(page, 3000);
    // The module traps once, in a frame (as it would out of memory): every call into it is refused from then on.
    await page.evaluate(() => {
      const e = window.zx.emulator;
      const x = e.x;
      // The module's exports are frozen: a copy of them, its frame call trapping.
      e.x = {
        ...x,
        zx_run_frame: () => {
          throw new WebAssembly.RuntimeError('unreachable');
        },
      };
    });
    await wait(page, 500);
    const stopped = await page.evaluate(() => ({ broken: window.zx.app.broken, card: !document.querySelector('.screen-card.stopped').hidden, dead: window.zx.emulator.stopped, frames: window.zx.emulator.frameCount }));
    await wait(page, 1000);
    const still = await page.evaluate(() => window.zx.emulator.frameCount);
    assert(stopped.broken && stopped.card && stopped.dead && still === stopped.frames, `after the trap: ${JSON.stringify(stopped)}, frames ${still}`);
    await page.locator('.screen-card.stopped button').click();
    assert(await until(page, () => !window.zx.app.broken && document.querySelector('.screen-card.stopped').hidden, null, { step: 100, max: 5_000 }), 'it did not start again');
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await wait(page, 1000);
    const after = await page.evaluate(() => ({ frames: window.zx.emulator.frameCount, bottom: window.zx.emulator.screenText().split('\n')[23], alive: !window.zx.emulator.stopped }));
    assert(after.alive && after.frames - f0 >= 45 && after.bottom.includes('Sinclair Research'), JSON.stringify(after));
    // The trap was said on the console, as an error: that one, and nothing else.
    const others = page.problems.filter((p) => !/machine stopped/i.test(p));
    assert(others.length === 0, others.join('; '));
    await page.context().close();
    return `${after.frames - f0} frames in the second after it started again`;
  });

  test('a file the machine cannot load changes nothing: a tape with nothing to play, a file too large', ['web/src/ui/deck.ts'], async () => {
    const page = await open();
    await wait(page, 2000);
    await page.mouse.click(5, 300);
    await page.keyboard.press('j');
    await wait(page, 500);
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    // A TZX whose one block is cut short: nothing on it plays.
    await openFile(page, 'broken.tzx', Buffer.from('ZXTape!\x1a\x01\x14\x10\x00\x00\xff\xff', 'latin1'));
    await wait(page, 300);
    await openFile(page, 'huge.tap', Buffer.alloc(17 * 1024 * 1024));
    await wait(page, 300);
    const after = await page.evaluate(() => ({ bottom: window.zx.emulator.screenText().split('\n')[23], loaded: window.zx.emulator.tape.state().loaded, empty: document.querySelector('.deck').classList.contains('empty'), toasts: [...document.querySelectorAll('.toast-error .toast-text')].map((t) => t.textContent), frames: window.zx.emulator.frameCount }));
    assert(after.bottom.startsWith('LOAD') && !after.loaded && after.empty, `after the files: ${JSON.stringify(after)}`);
    assert(after.toasts.length === 2 && /nothing on it|no block that plays/.test(after.toasts[0]) && /larger than any Spectrum file/.test(after.toasts[1]), JSON.stringify(after.toasts));
    clean(page);
    await page.context().close();
  });

  test('typing <> as two characters gives the Spectrum’s own <>: a line of BASIC with it is taken', ['web/src/input/'], async () => {
    const page = await open();
    await wait(page, 2000);
    await page.mouse.click(5, 300);
    // 10 IF 1<>2 THEN PRINT 1: IF is U in K mode, THEN SYMBOL SHIFT and G (Alt+G), PRINT is P in K mode again.
    for (const ch of '10u') {
      await page.keyboard.type(ch);
      await wait(page, 200);
    }
    for (const ch of '1<>2') {
      await page.keyboard.type(ch);
      await wait(page, 200);
    }
    await page.keyboard.press('Alt+g');
    await wait(page, 300);
    await page.keyboard.type('p1');
    await wait(page, 300);
    await page.keyboard.press('Enter');
    await wait(page, 1000);
    const top = (await screen(page)).split('\n')[0];
    // As the ROM lists it: the line number, the current line's >, and <> one token (typed as < and >, it would be refused).
    assert(/^ *10.IF 1<>2 THEN PRINT 1 *$/.test(top), `the listing reads ${JSON.stringify(top)}`);
    clean(page);
    await page.context().close();
    return top.trim();
  });

  test('when the machine will not start, the page says so with a way to try again, and runs no stand-in', ['web/src/emulator/index.ts', 'web/src/main.ts', 'web/index.html'], async () => {
    const page = await open({ ready: false, route: (p) => p.route(/\/zx\.wasm$/, (r) => r.abort('failed')) });
    await page.waitForSelector('body[data-failed]', { state: 'attached', timeout: 30_000 });
    const said = await page.evaluate(() => ({ text: document.querySelector('.fatal')?.textContent ?? '', button: !!document.querySelector('.fatal button'), emulator: document.body.dataset.emulator ?? null }));
    assert(/would not start/.test(said.text) && said.button && said.emulator === null, JSON.stringify(said));
    await page.context().close();
  });

  test('a phone held sideways is a console: the screen the height of the display, the pad and fire beside it', ['web/src/ui/touch.ts'], async () => {
    const page = await open({ phone: true, viewport: { width: 844, height: 390 }, storage: { display: 'tv', crop: 'tv' } });
    await wait(page, 1000);
    const r = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel).getBoundingClientRect();
      const screen = box('.tv-frame');
      const pad = box('.pad');
      const fire = box('.pad-fire');
      return { scroll: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight, screen: [screen.left, screen.right, screen.bottom], pad: [pad.left, pad.right], fire: [fire.left, fire.right] };
    });
    assert(r.scroll <= r.width, `page ${r.scroll} px wide in ${r.width}`);
    assert(r.pad[1] <= r.screen[0] && r.fire[0] >= r.screen[1], `pad ${r.pad}, screen ${r.screen}, fire ${r.fire}`);
    assert(r.screen[2] <= r.height + 1 && r.screen[1] - r.screen[0] > 380, `the screen: ${r.screen} in a window ${r.height} high`);
    clean(page);
    await page.context().close();
    return `screen ${Math.round(r.screen[1] - r.screen[0])} px wide, pad and fire beside it`;
  });

  test('a loader’s stripes drawn calmly when asked: the border one colour while the tape plays; F8 reads the screen; F1 the keys', ['web/src/ui/settings.ts', 'web/src/ui/help.ts'], async () => {
    const page = await open({ storage: { ...SHARP, calmStripes: 'on' } });
    await wait(page, 2000);
    await page.mouse.click(5, 300);
    await page.keyboard.press('F8');
    const read = await page.evaluate(() => document.querySelector('[aria-live].visually-hidden:not(.osd *)')?.textContent ?? '');
    await page.keyboard.press('F1');
    const help = await page.evaluate(() => document.querySelector('dialog.help')?.open && document.querySelector('dialog.help').textContent.includes('Shift+Tab'));
    await page.keyboard.press('Escape');
    await openFile(page, 'test.tap', programTape('PICTURE'));
    assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 250, max: 10_000 }), 'the tape did not start');
    await wait(page, 2000);
    const calm = new Set(await borderColours(page));
    // The machine's own border has the stripes: only the picture is calmed.
    const machine = await page.evaluate(() => {
      const f = window.zx.emulator.frame();
      return new Set(Array.from({ length: 296 }, (_, y) => f[y * 352 + 2])).size;
    });
    assert(read.includes('Sinclair Research'), `the screen read: ${read}`);
    assert(help, 'F1 did not show the keys');
    assert(calm.size === 1 && machine > 1, `the border shown in ${calm.size} colours, the machine's in ${machine}`);
    clean(page);
    await page.context().close();
    return `${calm.size} colour shown of the border's ${machine}`;
  });
  await runAll(4);
} finally {
  await browser.close();
  await server.close();
}

console.log(`${ran - failed} of ${ran} passed`);
process.exit(failed ? 1 : 0);
