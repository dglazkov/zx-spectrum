// Pictures of the page, for looking at while it is made: each a viewport, after the page is ready.
//
//   node tests/shot.mjs [--phone] [--path ?emulator=stub] [--out ../out/desktop.png] [--frames 150] [--eval 'js']
//                       [--file tape.tzx] [--settings '{"display":"sharp"}'] [--full]
//
// --phone is 390 × 844 at 3× with touch; otherwise 1440 × 900 at 1× (--dpr 2 for a retina display). --frames runs that many frames of the machine
// (at 50 a second of the page's clock) before the picture; --eval runs script in the page first (after the frames).
// --full takes the whole page rather than the viewport. Pictures go to out/ at the repository's root, which git ignores.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const phone = args.includes('--phone');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, opt('out', `../out/${phone ? 'phone' : 'desktop'}.png`));
mkdirSync(dirname(out), { recursive: true });

const server = await createServer({ root, server: { port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const context = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(opt('dpr', '1')) },
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`console ${m.type()}:`, m.text());
  });
  await page.clock.install();
  const settings = opt('settings', '');
  if (settings) await page.addInitScript((s) => localStorage.setItem('zx-spectrum.settings', s), settings);
  await page.goto(server.resolvedUrls.local[0] + opt('path', ''));
  await page.waitForSelector('body[data-ready]', { state: 'attached', timeout: 30_000 });
  // Paused a moment ahead of the page's clock; asked again if a busy machine let the clock pass it first.
  for (let paused = false; !paused; ) {
    try {
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
      paused = true;
    } catch (e) {
      if (!/to the past/.test(e.message)) throw e;
    }
  }
  const file = opt('file', '');
  if (file) {
    await page.clock.runFor(2500); // past the machine's start
    await page.setInputFiles('input[type=file]', file);
  }
  const frames = Number(opt('frames', '150'));
  // The page's clock, moved on a refresh at a time: the machine runs a frame for every 20 ms or so.
  for (let ms = 0; ms < (frames / 50) * 1000; ms += 1000) await page.clock.runFor(1000);
  const script = opt('eval', '');
  if (script) {
    await page.evaluate(script);
    await page.clock.runFor(Number(opt('after', '600')));
  }
  await page.clock.runFor(100);
  await page.screenshot({ path: out, fullPage: args.includes('--full') });
  console.log('saved', out);
} finally {
  await browser.close();
  await server.close();
}
