// What the page test's parts share, the Spectrum's: the tapes it makes and the fixtures it is given, what the network
// answers (the recordings, and ZXInfo down), a page opened on them with the test's clock, and how a part reads the
// machine. crux's harness (crux/chrome/harness.ts) runs the parts, in page/*.mjs; a change here runs every one.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { current, inTime, pause } from '../../crux/chrome/harness.ts';
import { buildFile } from '../tools/zxdb-index.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));

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

// --- What the network answers --------------------------------------------------------------------------------------

// ZXInfo as it was on Oct 18 2026, for a part that lets the page's ZXDB requests through to the server (the others
// answer them in the page): every path its nginx's 502 page. The server answers from the ZXDB's own index in its
// place, built here from the dump's excerpt (tests/fixtures/zxdb/).
const zxinfo = { asked: [] };
const zxinfoDown = createHttpServer((req, res) => {
  zxinfo.asked.push(req.url);
  res.writeHead(502, { Server: 'nginx', 'Content-Type': 'text/html' });
  res.end('<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n');
});

/** ZXInfo down, and the index the server answers from in its place: told to the server by its environment, so before it starts. */
async function startStandIns() {
  await new Promise((r) => zxinfoDown.listen(0, '127.0.0.1', r));
  zxinfoDown.unref();
  process.env.ZXINFO_ORIGIN = `http://127.0.0.1:${zxinfoDown.address().port}/v3`;
  process.env.ZXDB_INDEX = join(mkdtempSync(join(tmpdir(), 'zx-page-zxdb-')), 'zxdb-index.txt.gz');
  await buildFile(fileURLToPath(new URL('./fixtures/zxdb/excerpt.sql', import.meta.url)), process.env.ZXDB_INDEX, 'the excerpt');
}

const pageOf = (request) => request.frame().page();

/** What the page asks of other servers, and of its own for what the server would fetch from them. */
const recordings = [
  {
    // What the page tells nerd (/nerd/event, /nerd/feedback), as the server would take it: each body, in order.
    url: '**/nerd/*',
    answer: (request) => {
      pageOf(request).nerd.push({ path: new URL(request.url()).pathname, body: JSON.parse(request.postData() ?? 'null') });
      return { status: 204 };
    },
  },
  { url: '**/zxinfo/v3/search?**', contentType: 'application/json', body: recording('search-saboteur') },
  { url: '**/zxinfo/v3/games/**', answer: (request) => ({ contentType: 'application/json', body: entryRecording(request.url()) }) },
  {
    url: '**/archive/**',
    answer: (request) => {
      const page = pageOf(request);
      const path = decodeURIComponent(new URL(request.url()).pathname);
      page.archive.push(path);
      if (path.endsWith('.txt')) return { contentType: 'text/plain', body: path.endsWith('/Saboteur.txt') ? SABOTEUR_MANUAL : OTHER_MANUAL };
      if (/\.(jpe?g|png|gif)$/i.test(path)) return SABOTEUR_INLAY && path.endsWith('/Saboteur.jpg') ? { contentType: 'image/jpeg', body: SABOTEUR_INLAY } : { contentType: 'image/png', body: PNG };
      if (path.endsWith('/Saboteur.tzx.zip') && page.realSaboteur) return { contentType: 'application/zip', body: SABOTEUR_ZIP };
      return { contentType: 'application/zip', body: zipOf('SABOTEUR.TAP', programTape('SABOTEUR')) };
    },
  },
  { url: /^https:\/\/(zxinfo\.dk|spectrumcomputing\.co\.uk)\//, contentType: 'image/png', body: PNG },
];

// --- A page ---------------------------------------------------------------------------------------------------------

/** A phone held upright, as a part's `context`. */
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/** The part's page on the real machine (or `query` for another), its clock the test's. */
async function open(page, options = {}) {
  page.archive = [];
  // What the page tells nerd.
  page.nerd = [];
  page.realSaboteur = options.realSaboteur;
  // Leaving a page something was done on asks first (beforeunload): the test's reloads say yes.
  page.on('dialog', (d) => d.accept());
  if (process.env.PAGE_LOG) page.on('console', (m) => console.log('  console', m.type(), m.text()));
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
  await page.goto(`${current().base}${query.size ? `?${query}` : ''}`);
  if (options.ready !== false) await ready(page, options.clock !== false);
}

async function ready(page, clock = true) {
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  // From here the page's time moves only when the test moves it.
  if (clock) await pause(page);
}

/**
 * Waits on the wall clock for `condition`, for a part on the sound card's clock (which page.clock does not move). Past
 * `timeout`, on a machine that kept it waiting, the part could not judge: inconclusive, not failed.
 */
async function waitReal(page, condition, arg, timeout, what) {
  try {
    await page.waitForFunction(condition, arg, { timeout });
  } catch (e) {
    if (e.name === 'TimeoutError') inTime(false, `no ${what} within ${timeout / 1000} s of real time`);
    throw e;
  }
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

export { zxinfo, header, programTape, SABOTEUR_ZIP, AMSTRAD, PHONE, recordings, startStandIns, open, ready, waitReal, assert, wait, until, pixel, borderColours, SHARP, keyLog, screen, playing, openFile };
