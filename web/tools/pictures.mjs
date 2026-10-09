// The page's pictures, as the owner will see it, into out/ (git-ignored): the machine switched on, and Saboteur
// loaded from a link and started from its panel, on a desktop (1440 × 900: a rewind preview, paused, the settings
// beside the screen) and a phone (390 × 844 at 3×, and held sideways), on the television. Saboteur's tape,
// manual and inlay come from the fixture cache (scripts/fixture), the ZXDB's answers from the recordings the tests use;
// the page's clock is moved by the tool, and the tape loaded flat out (accelerated), as the page loads it when asked.
//
//   node tools/pictures.mjs [desktop] [phone] [--sharp]      CHROME says which Chrome (/usr/bin/google-chrome)

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node tools/pictures.mjs [desktop] [phone] [--sharp]: pictures of the page and of Saboteur into out/');
  process.exit(0);
}
const which = args.filter((a) => !a.startsWith('--'));
const want = (name) => !which.length || which.includes(name);
const display = args.includes('--sharp') ? 'sharp' : 'tv';
const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../../out/', import.meta.url));
mkdirSync(out, { recursive: true });
execFileSync('bash', ['../scripts/build-wasm.sh'], { cwd: root, stdio: 'inherit' });
const fixture = (name) => readFileSync(execFileSync('../scripts/fixture', [name], { cwd: root, encoding: 'utf8' }).trim());
const zip = fixture('saboteur.tzx.zip');
const manual = fixture('saboteur-manual.txt');
const inlay = fixture('saboteur-inlay.jpg');
const recording = (name) => readFileSync(`${root}tests/fixtures/zxinfo/${name}.json`);

const server = await createServer({ root, server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(phone, query, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext(phone ? { viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.route('**/zxinfo/v3/games/**', (r) => r.fulfill({ contentType: 'application/json', body: recording('game-0004293') }));
  await page.route('**/archive/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('.txt')) return r.fulfill({ contentType: 'text/plain', body: manual });
    if (path.endsWith('.jpg')) return r.fulfill({ contentType: 'image/jpeg', body: inlay });
    return r.fulfill({ contentType: 'application/zip', body: zip });
  });
  await page.clock.install();
  await page.addInitScript((s) => localStorage.setItem('zx-spectrum.settings', s), JSON.stringify({ display, crop: 'tv', loading: 'accelerated' }));
  await page.goto(`${server.resolvedUrls.local[0]}?sound=off${query}`);
  await page.waitForSelector('body[data-ready]', { state: 'attached', timeout: 30_000 });
  for (let paused = false; !paused; ) {
    try {
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
      paused = true;
    } catch (e) {
      if (!/to the past/.test(e.message)) throw e;
    }
  }
  return page;
}

const until = async (page, condition, step = 100, max = 60_000) => {
  for (let t = 0; t <= max; t += step) {
    if (await page.evaluate(condition)) return;
    await page.clock.runFor(step);
  }
  throw new Error(`waited for ${condition}: ${await page.evaluate(() => JSON.stringify([window.zx.emulator.tape.state(), window.zx.emulator.frameCount, location.search, document.querySelector('.toasts')?.textContent]))}`);
};

async function shoot(page, name, options = {}, settle = 100) {
  if (settle) await page.clock.runFor(settle);
  // Toasts fade on the page's clock: let them go first.
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.screenshot({ path: `${out}${name}.png`, ...options });
  console.log(`saved out/${name}.png`);
}

/** Saboteur from its link, flat out: its loading screen, the REWARD screen, then K, S, 1 and the game. */
async function saboteur(phone, prefix) {
  const page = await open(phone, '&game=4293');
  // The loading screen nearly in (the tape's block 6, its turbo data, from 30 s to 50 s), under the stripes.
  await until(page, () => window.zx.emulator.tape.state().block === 6 && window.zx.emulator.tape.state().position > 45, 16);
  // The last second of the loading screen at the tape's own speed, its attributes coming in under the stripes (flat
  // out a refresh is a second of tape).
  await page.evaluate(() => window.zx.app.change({ loading: 'authentic' }));
  await until(page, () => window.zx.emulator.tape.state().position > 49.8, 100);
  await shoot(page, `${prefix}-saboteur-loading`, {}, 0);
  await page.evaluate(() => window.zx.app.change({ loading: 'accelerated' }));
  await until(page, () => window.zx.emulator.screenText().includes('REWARD'), 250);
  await page.clock.runFor(1000);
  await shoot(page, `${prefix}-saboteur-reward`);
  // The game's own panel takes it from there: Start the mission, as the page drives its menu (library/start.ts).
  await page.evaluate(() => document.querySelector('.start-go').click());
  await until(page, () => document.querySelector('.panel.game')?.dataset.start === 'done', 100, 120_000);
  await page.clock.runFor(3000);
  await shoot(page, `${prefix}-saboteur-game`);
  // A moment a few seconds back chosen on the rewind strip: its picture, drained, and the words over it.
  if (!phone) {
    await page.focus('.timeline-track');
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
    await page.clock.runFor(200);
    await shoot(page, `${prefix}-rewind-preview`, {}, 0);
    await page.keyboard.press('Escape');
    // Paused: the words on the screen.
    await page.keyboard.press('F9');
    await page.clock.runFor(300);
    await shoot(page, `${prefix}-paused`, {}, 0);
    await page.keyboard.press('F9');
    // Settings beside the live screen.
    await page.locator('button[title="Settings"]').click();
    await page.clock.runFor(300);
    await shoot(page, `${prefix}-settings`, {}, 0);
    await page.keyboard.press('Escape');
  }
  // The game's panel: its inlay, how to start, its keys from the manual, its save slots (one kept), the manual open.
  await page.keyboard.press('F2');
  await page.clock.runFor(500);
  await page.evaluate(() => document.querySelector('.manual').setAttribute('open', ''));
  await page.clock.runFor(100);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  // Scrolled to, and taken as the viewport shows it: on a desktop, in a window tall enough for the side column to need
  // no scrolling of its own (a column scrolled by script draws stale tiles in software rendering).
  if (!phone) await page.setViewportSize({ width: 1440, height: 2100 });
  await page.clock.runFor(200);
  const clip = await page.evaluate(() => {
    const panel = document.querySelector('.panel.game');
    const side = document.querySelector('.side');
    if (getComputedStyle(side).overflowY === 'auto') {
      window.scrollTo(0, 0);
      side.scrollTop += panel.getBoundingClientRect().top - side.getBoundingClientRect().top;
    } else window.scrollTo(0, window.scrollY + panel.getBoundingClientRect().top - 8);
    const r = panel.getBoundingClientRect();
    return { x: r.x - 8, y: Math.max(0, r.y - 8), width: r.width + 16, height: Math.min(r.height + 16, innerHeight - Math.max(0, r.y - 8)) };
  });
  await page.clock.runFor(100);
  await page.screenshot({ path: `${out}${prefix}-saboteur-panel.png`, clip });
  console.log(`saved out/${prefix}-saboteur-panel.png`);
  await page.context().close();
}

try {
  if (want('desktop')) {
    const page = await open(false, '');
    await page.clock.runFor(4000);
    await shoot(page, 'desktop');
    await page.context().close();
    await saboteur(false, 'desktop');
  }
  if (want('phone')) {
    const page = await open(true, '');
    await page.clock.runFor(4000);
    await shoot(page, 'phone');
    await page.context().close();
    await saboteur(true, 'phone');
    // Held sideways, with Saboteur running: a console.
    const side = await open(true, '&game=4293', { width: 844, height: 390 });
    await until(side, () => window.zx.emulator.screenText().includes('REWARD'), 250);
    await side.evaluate(() => document.querySelector('.start-go').click());
    await until(side, () => document.querySelector('.panel.game')?.dataset.start === 'done', 100, 120_000);
    await side.clock.runFor(3000);
    await side.evaluate(() => window.scrollTo(0, 0));
    await shoot(side, 'phone-landscape');
    await side.context().close();
  }
} finally {
  await browser.close();
  await server.close();
}
