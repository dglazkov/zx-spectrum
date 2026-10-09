// The page as a visitor gets it, from a running server (the deployed one, or `node server.mjs`): it is handed out,
// the archive and the ZXInfo API come through it, and the page starts in Chrome with no errors. It needs the
// network, as the server does.
//
//   node tests/smoke.mjs https://zx-spectrum.lab.glazkov.ai      (or NERD_URL)

import { chromium } from 'playwright-core';

const url = (process.argv[2] ?? process.env.NERD_URL ?? '').replace(/\/$/, '');
if (!url) {
  console.error('usage: node tests/smoke.mjs URL');
  process.exit(2);
}
let failed = 0;
const check = async (name, fn) => {
  try {
    console.log(`ok    ${name}${(await fn()) ?? ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
};
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

await check('the page is handed out, compressed', async () => {
  const res = await fetch(`${url}/`, { headers: { 'Accept-Encoding': 'br, gzip' } });
  assert(res.ok && (res.headers.get('content-type') ?? '').startsWith('text/html'), `${res.status} ${res.headers.get('content-type')}`);
  const html = await res.text();
  assert(html.includes('<div id="app">'), 'not the page');
});

await check('the archive comes through /archive', async () => {
  const res = await fetch(`${url}/archive/pub/sinclair/games/s/Saboteur.tzx.zip`);
  const body = new Uint8Array(await res.arrayBuffer());
  assert(res.ok && body[0] === 0x50 && body[1] === 0x4b, `${res.status}, ${body.length} bytes`);
  return `  — Saboteur.tzx.zip, ${body.length} bytes`;
});

await check('only the archive’s game paths come through', async () => {
  const res = await fetch(`${url}/archive/index.php`);
  assert(res.status === 403, `${res.status}`);
});

await check('the ZXDB comes through /zxinfo', async () => {
  const res = await fetch(`${url}/zxinfo/v3/search?query=saboteur&mode=tiny&size=1&availability=Available`);
  const body = await res.json();
  assert(res.ok && body.hits?.hits?.[0]?._source?.title, `${res.status}`);
  return `  — ${body.hits.hits[0]._source.title}`;
});

await check('the page starts in Chrome, with no errors', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    await page.goto(url);
    await page.waitForSelector('body[data-ready]', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(() => window.zx.emulator.frameCount > 25, null, { timeout: 30_000 });
    assert(!problems.length, problems.join('; '));
    return `  — ${await page.evaluate(() => `${document.body.dataset.emulator} emulator, ${document.body.dataset.renderer}`)}`;
  } finally {
    await browser.close();
  }
});

process.exit(failed ? 1 : 0);
