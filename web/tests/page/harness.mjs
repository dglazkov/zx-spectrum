// The page test's harness: the machine built, a Vite server and Chrome, a page opened on recordings with the test's
// clock, the parts queued and run (four at a time, the slowest first, those a change cannot touch skipped), and the
// helpers the parts share. page.mjs runs it, with the parts in page/*.mjs; a change here runs every part.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { buildFile } from '../../tools/zxdb-index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const repository = fileURLToPath(new URL('../../..', import.meta.url));
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

const recording = (name) => readFileSync(new URL(`../fixtures/zxinfo/${name}.json`, import.meta.url));
/** An entry's recorded answer, by its id in the address; Saboteur's for one with none recorded. */
const entryRecording = (url) => {
  const id = (/\/games\/(\d+)/.exec(url)?.[1] ?? '4293').padStart(7, '0');
  return existsSync(new URL(`../fixtures/zxinfo/game-${id}.json`, import.meta.url)) ? recording(`game-${id}`) : recording('game-0004293');
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

// ZXInfo as it was on Oct 18 2026, for a part that lets the page's ZXDB requests through to the server (the others
// answer them in the page): every path its nginx's 502 page. The server answers from the ZXDB's own index in its
// place, built here from the dump's excerpt (tests/fixtures/zxdb/).
const zxinfo = { asked: [] };
const zxinfoDown = createHttpServer((req, res) => {
  zxinfo.asked.push(req.url);
  res.writeHead(502, { Server: 'nginx', 'Content-Type': 'text/html' });
  res.end('<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n');
});
await new Promise((r) => zxinfoDown.listen(0, '127.0.0.1', r));
zxinfoDown.unref();
process.env.ZXINFO_ORIGIN = `http://127.0.0.1:${zxinfoDown.address().port}/v3`;
process.env.ZXDB_INDEX = join(mkdtempSync(join(tmpdir(), 'zx-page-zxdb-')), 'zxdb-index.txt.gz');
await buildFile(fileURLToPath(new URL('../fixtures/zxdb/excerpt.sql', import.meta.url)), process.env.ZXDB_INDEX, 'the excerpt');

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
const SHARED = ['web/src/app.ts', 'web/src/main.ts', 'web/src/style.css', 'web/index.html', 'web/vite.config.ts', 'web/tests/page.mjs', 'web/tests/page/harness.mjs', 'web/src/emulator/', 'web/src/video/', 'web/src/ui/dom.ts', 'web/src/ui/controls.ts', 'web/src/ui/toast.ts', 'web/src/clock/', 'web/package-lock.json', 'roms/', 'crates/', 'scripts/build-wasm.sh', 'Cargo.toml', 'Cargo.lock', 'fixtures.txt'];
const claims = (covers, path) => covers.some((c) => path === c || path.startsWith(c));

/** A page on the real machine (or `query` for another), its clock the test's, the network answered from recordings; its console errors fail the test. */
async function open(options = {}) {
  const context = await browser.newContext({
    ...(options.phone ? { viewport: options.viewport ?? { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, acceptDownloads: true }),
    ...(options.reducedMotion ? { reducedMotion: 'reduce' } : {}),
    // The browser's language (navigator.languages), which the page opens in when nothing else says (i18n.ts).
    ...(options.locale ? { locale: options.locale } : {}),
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.problems = [];
  page.archive = [];
  // What the page tells nerd (/nerd/event, /nerd/feedback), as the server would take it: each body, in order.
  page.nerd = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  // Leaving a page something was done on asks first (beforeunload): the test's reloads say yes.
  page.on('dialog', (d) => d.accept());
  if (process.env.PAGE_LOG) page.on('console', (m) => console.log('  console', m.type(), m.text()));
  page.on('console', (m) => {
    if (m.type() === 'error') page.problems.push(`console: ${m.text()}`);
  });
  await page.route('**/nerd/*', (r) => {
    page.nerd.push({ path: new URL(r.request().url()).pathname, body: JSON.parse(r.request().postData() ?? 'null') });
    return r.fulfill({ status: 204 });
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

/** The `test` of a file of parts (page/*.mjs, given its import.meta.url): each part it makes covers that file too. */
function parts(url) {
  const file = relative(repository, fileURLToPath(url));
  return (name, covers, fn) => test(name, [...covers, file], fn);
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

export { zxinfo, header, programTape, SABOTEUR_ZIP, AMSTRAD, server, base, browser, failed, ran, open, ready, pause, parts, Skip, waitReal, runAll, assert, wait, until, clean, pixel, borderColours, SHARP, keyLog, screen, playing, openFile };
