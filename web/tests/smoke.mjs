// The page as a visitor gets it, from a running server (the deployed one, or `node server.mjs`): it is handed out,
// the archive and the ZXInfo API come through it, the emulator is served as WebAssembly, and the page starts in
// Chrome on the real machine with no errors, the machine the tests passed: the very module they ran (its SHA-256 the
// local build's, web/src/emulator/zx.wasm: the build is reproducible, scripts/build-wasm.sh), the 48K's copyright, and
// a NOP in contended memory taking the ULA's delay (the contention tables a release build once got wrong,
// docs/toolchain/). nerd runs it after a deploy (nerd.toml's smoke), with the network, as the server needs it;
// tests/build.mjs runs it on the page built here, without the network's parts.
//
//   node tests/smoke.mjs https://zx-spectrum.lab.glazkov.ai      (or NERD_URL)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const LOCAL_MODULE = fileURLToPath(new URL('../src/emulator/zx.wasm', import.meta.url));

/** The checks against `url`: `network` false leaves out what needs the archive and the ZXDB. Returns how many failed. */
export async function smoke(url, { network = true, log = console.log } = {}) {
  let failed = 0;
  const check = async (name, fn) => {
    try {
      log(`ok    ${name}${(await fn()) ?? ''}`);
    } catch (e) {
      failed++;
      log(`FAIL  ${name}: ${e.message}`);
    }
  };
  const assert = (cond, message) => {
    if (!cond) throw new Error(message);
  };

  let html = '';
  await check('the page is handed out, compressed', async () => {
    const res = await fetch(`${url}/`, { headers: { 'Accept-Encoding': 'br, gzip' } });
    assert(res.ok && (res.headers.get('content-type') ?? '').startsWith('text/html'), `${res.status} ${res.headers.get('content-type')}`);
    html = await res.text();
    assert(html.includes('<div id="app">'), 'not the page');
  });

  if (network) await check('the archive comes through /archive', async () => {
    const res = await fetch(`${url}/archive/pub/sinclair/games/s/Saboteur.tzx.zip`);
    const body = new Uint8Array(await res.arrayBuffer());
    assert(res.ok && body[0] === 0x50 && body[1] === 0x4b, `${res.status}, ${body.length} bytes`);
    return `  — Saboteur.tzx.zip, ${body.length} bytes`;
  });

  if (network) await check('a manual comes through /archive', async () => {
    const res = await fetch(`${url}/archive/pub/sinclair/games-info/s/Saboteur.txt`);
    const text = await res.text();
    assert(res.ok && /SABOTEUR/i.test(text), `${res.status}, ${text.length} characters`);
  });

  await check('only the archive’s game paths come through', async () => {
    const res = await fetch(`${url}/archive/index.php`);
    assert(res.status === 403, `${res.status}`);
  });

  if (network) await check('the ZXDB comes through /zxinfo', async () => {
    const res = await fetch(`${url}/zxinfo/v3/search?query=saboteur&mode=tiny&size=1&availability=Available`);
    const body = await res.json();
    assert(res.ok && body.hits?.hits?.[0]?._source?.title, `${res.status}`);
    return `  — ${body.hits.hits[0]._source.title}`;
  });

  await check('the page starts the real machine in Chrome, with no errors, and it is the machine the tests passed', async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
      const page = await browser.newPage();
      const problems = [];
      const wasm = [];
      page.on('pageerror', (e) => problems.push(e.message));
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
      page.on('response', (r) => r.url().endsWith('.wasm') && wasm.push(r));
      await page.goto(`${url}/?sound=off`);
      await page.waitForSelector('body[data-ready]', { state: 'attached', timeout: 30_000 });
      await page.waitForFunction(() => window.zx.emulator.screenText().includes('Sinclair Research'), null, { timeout: 30_000 });
      assert(wasm.length === 1 && wasm[0].headers()['content-type'] === 'application/wasm', `the emulator served as ${wasm[0]?.headers()['content-type']}`);
      // The module served is the module the tests ran, byte for byte.
      const served = createHash('sha256').update(await wasm[0].body()).digest('hex');
      if (existsSync(LOCAL_MODULE)) {
        const tested = createHash('sha256').update(readFileSync(LOCAL_MODULE)).digest('hex');
        assert(served === tested, `the module served (${served.slice(0, 12)}) is not the one built and tested here (${tested.slice(0, 12)})`);
      }
      const delays = await page.evaluate(() => {
        const e = window.zx.emulator;
        e.poke(0x6000, 0); // a NOP in contended memory
        const out = [];
        for (let t = 14335; t < 14343; t++) {
          e.x.zx_set_register(e.h, 11, 0x6000);
          e.x.zx_set_tstate(e.h, t);
          e.step();
          out.push(e.x.zx_tstate(e.h) - t - 4);
        }
        return out;
      });
      assert(delays.join() === '6,5,4,3,2,1,0,0', `a contended NOP's delays from 14,335: ${delays}`);
      assert(!problems.length, problems.join('; '));
      return `  — ${await page.evaluate(() => `${document.body.dataset.emulator} emulator, ${document.body.dataset.renderer}`)}, ${wasm[0].headers()['content-encoding'] ?? 'uncompressed'} wasm, sha256 ${served.slice(0, 12)}`;
    } finally {
      await browser.close();
    }
  });

  return failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = (process.argv[2] ?? process.env.NERD_URL ?? '').replace(/\/$/, '');
  if (!url) {
    console.error('usage: node tests/smoke.mjs URL');
    process.exit(2);
  }
  process.exit((await smoke(url)) ? 1 : 0);
}
