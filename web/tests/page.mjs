// The page in Chrome, against the stand-in emulator: it becomes ready, renders, takes keys from the drawn keyboard,
// the PC's keyboard and a touch pad, loads tapes and snapshots from files and games from the library (the ZXInfo API
// and the archive answered from recordings, so the test needs no network), saves snapshots, rewinds, remembers its
// settings, sounds, and fits a phone. Time is the page's own clock (Playwright's page.clock), moved on by the test:
// frames are counted, not waited for. Each part is reported to nerd ($NERD_REPORT).
//
//   node tests/page.mjs [words in a part's name...]      CHROME says which Chrome (/usr/bin/google-chrome)

import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const only = process.argv.slice(2).join(' ').toLowerCase();
const report = (line) => process.env.NERD_REPORT && appendFileSync(process.env.NERD_REPORT, `${JSON.stringify(line)}\n`);

// --- Files the test makes ------------------------------------------------------------------------------------------

function tapBlock(flag, data) {
  const out = Buffer.alloc(data.length + 4);
  out.writeUInt16LE(data.length + 2, 0);
  out[2] = flag;
  Buffer.from(data).copy(out, 3);
  out[out.length - 1] = data.reduce((x, b) => x ^ b, flag);
  return out;
}

/** A tape of a Bytes header and a SCREEN$: the bitmap 10101010, the attributes white ink on bright blue paper. */
function screenTape(name = 'TEST') {
  const header = Buffer.alloc(17);
  header[0] = 3;
  header.write(name.padEnd(10), 1, 'latin1');
  header.writeUInt16LE(6912, 11);
  header.writeUInt16LE(16384, 13);
  const screen = Buffer.alloc(6912, 0xaa);
  screen.fill(0x4f, 6144);
  return Buffer.concat([tapBlock(0x00, header), tapBlock(0xff, screen)]);
}

function zipOf(name, data) {
  const packed = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
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

const fixture = (name) => readFileSync(new URL(`./fixtures/zxinfo/${name}.json`, import.meta.url));
// A picture for every card: one grey pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+/btfwAJYAPhYrRk8QAAAABJRU5ErkJggg==', 'base64');

// --- The harness ---------------------------------------------------------------------------------------------------

const server = await createServer({ root, server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'],
});

let failed = 0;
let ran = 0;
const queue = [];

// What changed (nerd's NERD_CHANGED, one path a line): a part runs if a file it covers changed, all of them if a file
// they share did, or one no part claims; with nothing given, all of them.
const changed = (process.env.NERD_CHANGED ?? '').split('\n').filter(Boolean);
const SHARED = ['web/src/app.ts', 'web/src/main.ts', 'web/src/style.css', 'web/index.html', 'web/vite.config.ts', 'web/tests/page.mjs', 'web/src/emulator/', 'web/src/video/', 'web/src/ui/dom.ts', 'web/src/ui/controls.ts', 'web/package-lock.json', 'roms/'];
const claims = (covers, path) => covers.some((c) => path === c || path.startsWith(c));

/** A page on the stand-in, its clock the test's, the network answered from recordings; its console errors fail the test. */
async function open(options = {}) {
  const context = await browser.newContext(options.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') page.problems.push(`console: ${m.text()}`);
  });
  await page.route('**/zxinfo/v3/search?**', (r) => r.fulfill({ contentType: 'application/json', body: fixture('search-saboteur') }));
  await page.route('**/zxinfo/v3/games/**', (r) => r.fulfill({ contentType: 'application/json', body: fixture('game-0004293') }));
  await page.route('**/archive/**', (r) => r.fulfill({ contentType: 'application/zip', body: zipOf('SABOTEUR.TAP', screenTape('SABOTEUR')) }));
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
  await page.goto(`${base}${options.query ?? '?emulator=stub'}`);
  await page.waitForSelector('body[data-ready]', { state: 'attached', timeout: 30_000 });
  // From here the page's time moves only when the test moves it.
  if (options.clock !== false) await pause(page);
  return page;
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

function wanted(part, all) {
  if (only) return part.name.toLowerCase().includes(only);
  if (!changed.length) return true;
  const unclaimed = changed.filter((p) => !claims(SHARED, p) && !all.some((t) => claims(t.covers, p)));
  return changed.some((p) => claims(SHARED, p)) || unclaimed.length > 0 || changed.some((p) => claims(part.covers, p));
}

/** Runs the parts, a few side by side (each on pages of its own). */
async function runAll(width) {
  const parts = queue.filter((p) => {
    const run = wanted(p, queue);
    if (!run) report({ part: `page › ${p.name}`, seconds: 0, outcome: 'skipped' });
    return run;
  });
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
    outcome = 'failed';
    said = e.message.split('\n')[0];
    failed++;
  }
  const seconds = (performance.now() - t0) / 1000;
  console.log(`${outcome === 'passed' ? 'ok  ' : 'FAIL'}  ${name}${said ? `  — ${said}` : ''}`);
  report({ part: `page › ${name}`, seconds: Number(seconds.toFixed(2)), outcome, ...(outcome === 'failed' ? { said } : {}) });
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Runs the page's clock on by `ms`, a second at a time (the machine runs a frame for each 20 ms of it). */
async function wait(page, ms) {
  for (let left = ms; left > 0; left -= 1000) await page.clock.runFor(Math.min(1000, left));
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

const SHARP = { display: 'sharp', crop: 'full', palette: 'ula' };
const keyLog = (page) => page.evaluate(() => window.zx.emulator.keyLog.map((k) => [k.code, k.down]));

// --- The tests -----------------------------------------------------------------------------------------------------

try {
  test('becomes ready on the stand-in, drawn in WebGL 2', ['web/src/keyboard/', 'web/src/ui/library.ts', 'web/src/library/'], async () => {
    const page = await open();
    const ready = await page.evaluate(() => ({ emulator: document.body.dataset.emulator, renderer: document.body.dataset.renderer, keys: document.querySelectorAll('.kb-key').length, cards: document.querySelectorAll('.card').length }));
    assert(ready.emulator === 'stub' && ready.renderer === 'webgl2', JSON.stringify(ready));
    assert(ready.keys === 40, `${ready.keys} keys drawn`);
    assert(ready.cards >= 20, `${ready.cards} cards on the shelf`);
    await wait(page, 2000);
    clean(page);
    await page.context().close();
    return `${ready.keys} keys, ${ready.cards} games on the shelf`;
  });

  test('renders the machine: the white border, the copyright in black, read back from the canvas', ['web/src/clock/'], async () => {
    const page = await open({ storage: SHARP });
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await wait(page, 3000);
    const border = await pixel(page, 4, 4);
    assert(border.join() === '216,216,216', `border ${border}`);
    // The © at the bottom left of the paper: some of its pixels are ink.
    const ink = await page.evaluate(() => {
      const p = window.zx.renderer.readPixels();
      const scale = p.width / 352;
      let dark = 0;
      for (let y = 232; y < 240; y++) for (let x = 48; x < 56; x++) {
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
    const flat = await open({ query: '?emulator=stub&renderer=2d', storage: SHARP });
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
    await wait(page, 2000);
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
    clean(page);
    await page.context().close();
  });

  test('the PC keyboard types BASIC: j is LOAD, a typed " is SYMBOL SHIFT and P', ['web/src/input/'], async () => {
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
    const text = await page.evaluate(() => {
      const e = window.zx.emulator;
      let s = '';
      for (let col = 0; col < 7; col++) {
        const cell = 0x4000 | (2 << 11) | (7 << 5) | col;
        const bytes = Array.from({ length: 8 }, (_, i) => e.peek(cell + (i << 8)));
        for (let c = 32; c < 128; c++) if (bytes.every((b, i) => e.peek(0x3d00 + (c - 32) * 8 + i) === b)) { s += String.fromCharCode(c); break; }
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
    await page.keyboard.up('ArrowLeft');
    // CAPS SHIFT (0) and 5 (19) at BASIC; the joystick's left (2) once a program is in.
    assert(cursor.bits === 0 && cursor.down.includes(0) && cursor.down.includes(19), `at BASIC: joystick ${cursor.bits}, keys down ${cursor.down}`);
    assert(joy === 2, `with a program loaded: joystick ${joy}`);
    clean(page);
    await page.context().close();
  });

  test('a tape from a file loads: LOAD "" typed, stripes in the border, then its screen', ['web/src/ui/deck.ts', 'web/src/input/', 'web/src/clock/'], async () => {
    const page = await open({ storage: SHARP });
    await wait(page, 1000);
    await page.setInputFiles('input[type=file]', { name: 'test.tap', mimeType: 'application/octet-stream', buffer: screenTape('PICTURE') });
    await wait(page, 100);
    const blocks = await page.locator('.block').count();
    assert(blocks === 2, `${blocks} blocks in the deck`);
    let playing = false;
    for (let i = 0; i < 20 && !playing; i++) {
      await wait(page, 500);
      playing = await page.evaluate(() => window.zx.emulator.tape.state().playing);
    }
    assert(playing, 'the tape did not start');
    const log = (await keyLog(page)).filter(([, d]) => d).map(([c]) => c);
    assert(log.join() === '33,36,25,36,25,30', `typed ${log}`);
    await wait(page, 3000);
    const colours = new Set();
    for (let y = 0; y < 296; y += 9) colours.add((await pixel(page, 2, y)).join());
    assert(colours.has('216,0,0') || colours.has('0,216,216'), `border colours while loading: ${[...colours].join(' ')}`);
    // The rest, flat out.
    await page.locator('.deck .seg', { hasText: 'Accelerated' }).click();
    for (let i = 0; i < 60 && (await page.evaluate(() => window.zx.emulator.tape.state().playing)); i++) await wait(page, 200);
    const paper = await pixel(page, 49, 49);
    const ink = await pixel(page, 48, 49);
    assert(paper.join() === '0,0,255' && ink.join() === '255,255,255', `the loaded screen: ink ${ink}, paper ${paper}`);
    clean(page);
    await page.context().close();
    return `border ${[...colours].length} colours, screen ink ${ink} on ${paper}`;
  });

  test('a game from the library: searched, fetched through /archive, typed in and played', ['web/src/library/', 'web/src/ui/library.ts', 'web/src/input/', 'web/tests/fixtures/'], async () => {
    const page = await open();
    await wait(page, 1000);
    await page.fill('.search', 'saboteur');
    await page.press('.search', 'Enter');
    await page.waitForFunction(() => document.querySelector('.library-status')?.textContent?.includes('found'));
    const titles = await page.locator('.card-title').allTextContents();
    assert(titles.includes('Saboteur!'), `cards: ${titles.join(', ')}`);
    const fetched = page.waitForRequest('**/archive/**');
    await page.locator('.card', { hasText: 'Saboteur!' }).first().click();
    const request = await fetched;
    assert(request.url().endsWith('/archive/pub/sinclair/games/s/Saboteur.tzx.zip'), request.url());
    await page.waitForFunction(() => window.zx.emulator.tape.blocks().length === 2);
    let playing = false;
    for (let i = 0; i < 20 && !playing; i++) {
      await wait(page, 500);
      playing = await page.evaluate(() => window.zx.emulator.tape.state().playing);
    }
    const label = await page.locator('.cs-title').textContent();
    assert(playing, 'the tape did not start');
    assert(label === 'Saboteur!', `the cassette says ${label}`);
    assert((await page.evaluate(() => window.zx.emulator.model)) === '48k', 'not on a 48K');
    clean(page);
    await page.context().close();
    return `${titles.length} found; ${request.url().split('/').pop()}`;
  });

  test('saves a snapshot, and loads one dropped on the page', [], async () => {
    const page = await open();
    await wait(page, 2000);
    await page.evaluate(() => window.zx.emulator.poke(0x8000, 0x5a));
    await page.getByRole('button', { name: 'Snapshot' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Save as .z80' }).click();
    const file = await download;
    const path = await file.path();
    const bytes = readFileSync(path);
    assert(file.suggestedFilename().endsWith('.z80') && bytes.length === 30 + 49152, `${file.suggestedFilename()}: ${bytes.length} bytes`);
    await page.evaluate(() => window.zx.emulator.poke(0x8000, 0));
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'saved.z80'));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
    }, bytes.toString('base64'));
    await page.waitForFunction(() => window.zx.emulator.peek(0x8000) === 0x5a);
    clean(page);
    await page.context().close();
    return `${file.suggestedFilename()}, ${bytes.length} bytes`;
  });

  test('rewinds: a moment kept every second, gone back to from the strip', ['web/src/state/rewind.ts', 'web/src/ui/timeline.ts'], async () => {
    const page = await open();
    await wait(page, 6000);
    const before = await page.evaluate(() => ({ moments: window.zx.app.rewind.length, history: window.zx.app.history }));
    assert(before.moments >= 5, `${before.moments} moments after 6 s`);
    await page.focus('.timeline-track');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    const after = await page.evaluate(() => ({ moments: window.zx.app.rewind.length, history: window.zx.app.history }));
    assert(after.history < before.history - 100, `history ${before.history} → ${after.history}`);
    clean(page);
    await page.context().close();
    return `back ${((before.history - after.history) / 50).toFixed(1)} s`;
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
    await page.waitForFunction(() => window.zx.app.sound?.running && document.body.classList.contains('sound-on'), null, { timeout: 10_000 });
    const frames0 = await page.evaluate(() => window.zx.emulator.frameCount);
    // Condition, not time: the sound card's clock runs frames until there have been 50 more.
    await page.waitForFunction((f) => window.zx.emulator.frameCount > f + 50, frames0, { timeout: 15_000 });
    const led = await page.evaluate(() => window.zx.app.scheduler.audioLed);
    assert(!before && led, `sound before the click: ${before}; frames led by the sound card: ${led}`);
    clean(page);
    await page.context().close();
  });

  test('follows the sound card when it stops and starts again: the display’s clock meanwhile, nothing stale queued', ['web/src/audio/', 'web/src/clock/'], async () => {
    const page = await open({ clock: false });
    await page.locator('.veil').click();
    await page.waitForFunction(() => window.zx.app.sound?.running && window.zx.app.scheduler.audioLed, null, { timeout: 10_000 });
    // The system takes the sound card away (a call, another app): frames go on by the display, silently, and the
    // page asks for sound again on the next gesture.
    await page.evaluate(() => window.zx.app.sound.context.suspend());
    await page.waitForFunction(() => !window.zx.app.scheduler.audioLed && !document.querySelector('.veil').hidden, null, { timeout: 10_000 });
    const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
    await page.waitForFunction((f) => window.zx.emulator.frameCount > f + 10, f0, { timeout: 15_000 });
    await page.locator('.veil').click();
    await page.waitForFunction(() => window.zx.app.sound.running && window.zx.app.scheduler.audioLed && document.querySelector('.veil').hidden, null, { timeout: 10_000 });
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
    await page.setInputFiles('input[type=file]', { name: 'test.tap', mimeType: 'application/octet-stream', buffer: screenTape('PICTURE') });
    await page.evaluate(() => window.scrollTo(0, 0));
    let block = 0;
    for (let i = 0; i < 40 && block < 1; i++) {
      await wait(page, 500);
      block = await page.evaluate(() => window.zx.emulator.tape.state().block);
    }
    const y = await page.evaluate(() => window.scrollY);
    assert(block >= 1, `the tape did not reach its second block (${block})`);
    assert(y === 0, `the window scrolled to ${y} as the tape went on`);
    clean(page);
    await page.context().close();
  });

  test('fits a phone: no sideways scroll, a touch pad that is the joystick', ['web/src/ui/touch.ts', 'web/src/input/gamepad.ts'], async () => {
    const page = await open({ phone: true });
    await wait(page, 1000);
    const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, pad: getComputedStyle(document.querySelector('.touchpad')).display }));
    assert(fit.scroll <= fit.width, `page ${fit.scroll} px wide in a ${fit.width} px window`);
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
  await runAll(4);
} finally {
  await browser.close();
  await server.close();
}

console.log(`${ran - failed} of ${ran} passed`);
process.exit(failed ? 1 : 0);
