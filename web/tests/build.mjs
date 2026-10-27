// The page as it is deployed, before it is: built for production (vite build, the module as the tests ran it, no
// source maps) into a directory of the test's own, served by the production server (crates/app, by ../app.mjs) on a
// port of its own, and the smoke test's checks run against it (tests/smoke.mjs), all but the ones that need the archive
// and the ZXDB over the network. What only the production build can get wrong (an asset the dev server serves and the build does
// not emit, a module served as the wrong type, the compression) is found here, not after a deploy.
//
//   nerd test web-build

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { startApp } from '../app.mjs';
import { smoke } from './smoke.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const report = (line) => process.env.NERD_REPORT && appendFileSync(process.env.NERD_REPORT, `${JSON.stringify(line)}\n`);

execFileSync('bash', ['../scripts/build-wasm.sh'], { cwd: root, stdio: 'inherit' });
const out = mkdtempSync(join(tmpdir(), 'zx-build-'));
let failed = 0;
const t0 = performance.now();
try {
  await build({ root, logLevel: 'warn', build: { outDir: out, emptyOutDir: true, sourcemap: false } });
  report({ part: 'build › vite build', seconds: Number(((performance.now() - t0) / 1000).toFixed(2)), outcome: 'passed' });
  // Each page is sent with no comment and no indented line but inside a script or a style, whose bytes are the
  // reader's (#23).
  for (const page of ['index.html', 'how.html']) {
    const html = readFileSync(join(out, page), 'utf8');
    const outside = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
    const loose = [...(outside.match(/<!--[\s\S]*?-->/g) || []), ...(outside.match(/^[ \t]+\S.*$/gm) || [])];
    const l = `${page} sent tight, ${html.length} B`;
    console.log(loose.length ? `FAIL  ${l}: ${loose.length} comments or indented lines, the first ${JSON.stringify(loose[0].slice(0, 60))}` : `ok    ${l}`);
    report({ part: `build › ${page} sent tight`, seconds: 0, outcome: loose.length ? 'failed' : 'passed', ...(loose.length ? { said: loose[0].slice(0, 60) } : {}) });
    failed += loose.length ? 1 : 0;
  }
  const server = await startApp(out);
  const url = server.url;
  const t1 = performance.now();
  const lines = [];
  failed = await smoke(url, { network: false, log: (l) => (console.log(l), lines.push(l)) });
  for (const l of lines) {
    const ok = l.startsWith('ok');
    report({ part: `build › ${l.replace(/^(ok|FAIL)\s+/, '').split(/: |  — /)[0]}`, seconds: Number(((performance.now() - t1) / 1000 / lines.length).toFixed(2)), outcome: ok ? 'passed' : 'failed', ...(ok ? {} : { said: l }) });
  }
  await server.close();
} catch (e) {
  failed++;
  console.log(`FAIL  ${e.message}`);
  report({ part: 'build › vite build', seconds: 0, outcome: 'failed', said: e.message.split('\n')[0] });
} finally {
  rmSync(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
