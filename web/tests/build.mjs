// The page as it is deployed, before it is: built for production (vite build, the module as the tests ran it, no
// source maps), served by the production server (crates/app, by ../app.mjs) on a port of its own, and the smoke test's
// checks run against it (tests/smoke.mjs), all but the ones that need the archive and the ZXDB over the network. What
// only the production build can get wrong (an asset the dev server serves and the build does not emit, a module served
// as the wrong type, the compression) is found here, not after a deploy.
//
// Its seven parts each claim the files they test (PARTS, below), and run only for what nerd says changed of them
// (NERD_CHANGED): a file they all stand on (SHARED) runs every one, and so does one that none claims. The build is kept
// in target/web-build, under a hash of everything it reads, so that a change only the server's checks stand on serves
// the build as it was and reports the build skipped. The test holds itself to that before anything starts, as crux's
// harness holds a suite `granular` (crux#168): every file of its covers in nerd.toml shared or claimed, and none but
// what is shared claimed by more than MOST of the parts. It counts parts, and reads no clock.
//
//   nerd test web-build

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const repository = fileURLToPath(new URL('../..', import.meta.url));

// --- What each part tests ---------------------------------------------------------------------------------------------

// The files that the server's four checks stand on: every request they make goes through it.
const SERVER = ['crates/app/Cargo.toml', 'crates/app/src/lib.rs', 'crates/app/src/main.rs', 'crux/server', 'web/app.mjs', 'web/tests/smoke.mjs'];
// What goes into the module, which the build bundles and the Chrome check runs.
const MODULE = ['crux/wasm', 'roms', 'scripts/build-wasm.sh'];

/** Each part, by the name it is reported under, with the files it claims: a change to one of them runs it. */
export const PARTS = [
  { part: 'vite build', claims: ['web/src', 'web/index.html', 'web/how.html', 'web/public', ...MODULE] },
  { part: 'index.html sent tight', claims: ['web/index.html'] },
  { part: 'how.html sent tight', claims: ['web/how.html'] },
  // The page's HTML, with the load's tag the server puts at the end of its head.
  { part: 'the page is handed out, compressed', claims: [...SERVER, 'web/index.html', 'crux/load', 'crates/app/src/zxdb.rs'] },
  { part: 'the build log is handed out at /how.html, with its sheet and its fonts', claims: [...SERVER, 'web/how.html', 'web/src/how', 'web/src/fonts'] },
  { part: 'only the archive’s game paths come through', claims: [...SERVER, 'crates/app/src/pass.rs'] },
  // The page as a reader's browser runs it: all of it, and what the server adds to it (the load's script, the widget,
  // nerd's events, the pass-through the library asks), on crux's launch of Chrome.
  {
    part: 'the page starts the real machine in Chrome, with no errors, and it is the machine the tests passed',
    claims: [...SERVER, 'web/src', '!web/src/how', 'web/index.html', 'web/public', ...MODULE, 'crux/load', 'crux/widget', 'crux/telemetry', 'crates/app/src/pass.rs', 'crux/chrome/launch.ts', 'crux/chrome/package.json', 'crux/chrome/package-lock.json'],
  },
];
/** What every part stands on: how the page is built (vite and its config), the workspace's manifests (the module's and
 * the server's), and this test itself. */
export const SHARED = ['web/vite.config.ts', 'web/package.json', 'web/package-lock.json', 'web/tsconfig.json', 'Cargo.toml', 'Cargo.lock', 'web/tests/build.mjs'];
/** The most of the parts a file not shared may claim: the server's four checks, of seven. A quarter would let a file
 * claim one part alone, and the build stands under every check of what it built. */
export const MOST = 4 / 7;

/** A pattern as nerd matches it: * is any part of one name, ** any part of the path, {a,b} either, a directory covers
 * what is in it, and ! takes back what came before it. */
function glob(given) {
  const back = given.startsWith('!');
  const p = back ? given.slice(1) : given;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    if (p.startsWith('**/', i)) (re += '(?:.*/)?'), (i += 2);
    else if (p.startsWith('**', i)) (re += '.*'), i++;
    else if (p[i] === '*') re += '[^/]*';
    else if (p[i] === '{') re += '(?:';
    else if (p[i] === '}') re += ')';
    else if (p[i] === ',') re += '|';
    else re += p[i].replace(/[.+?^$()|[\]\\]/g, '\\$&');
  }
  return { re: new RegExp(`^${re}(?:/.*)?$`), back };
}
/** Whether `patterns` cover `path`: the last of them that matches it says. */
export function covered(patterns, path) {
  let yes = false;
  for (const given of patterns) {
    const { re, back } = glob(given);
    if (re.test(path)) yes = !back;
  }
  return yes;
}

/** The parts `changed` runs, and why: every one for nothing changed (the test run whole), for a file they all share,
 * and for one no part claims. */
export function choose(changed) {
  if (!changed.length) return { chosen: PARTS, because: 'all of it' };
  const shared = changed.filter((f) => covered(SHARED, f));
  if (shared.length) return { chosen: PARTS, because: `every part, for ${shared.join(', ')}, which they all stand on` };
  const nobody = changed.filter((f) => !PARTS.some((p) => covered(p.claims, f)));
  if (nobody.length) return { chosen: PARTS, because: `every part, for ${nobody.join(', ')}, which no part claims` };
  const chosen = PARTS.filter((p) => changed.some((f) => covered(p.claims, f)));
  return { chosen, because: `${chosen.length} of ${PARTS.length} parts, for ${changed.join(', ')}` };
}

/** What keeps the test from running only what a change touches, a line each: of `files`, one neither shared nor
 * claimed, and one not shared that more than MOST of the parts claim. */
export function coarse(files) {
  return [...new Set(files)].flatMap((file) => {
    if (covered(SHARED, file)) return [];
    const claims = PARTS.filter((p) => covered(p.claims, file)).length;
    if (!claims) return [`${file} is claimed by no part: name it in the claims of the parts that test it`];
    if (claims > PARTS.length * MOST) return [`${file} runs ${claims} of the ${PARTS.length} parts: split what holds them, or say it is shared`];
    return [];
  });
}

/** web-build's covers, as nerd.toml has them. */
function covers() {
  const toml = readFileSync(join(repository, 'nerd.toml'), 'utf8');
  const table = toml.split(/^\[\[test\]\]$/m).find((t) => /^name = "web-build"$/m.test(t));
  const line = table && /^covers = (\[.*\])$/m.exec(table)?.[1];
  if (!line) throw new Error('nerd.toml has no covers for web-build');
  return JSON.parse(line);
}

/** The files under the repository that `patterns` take, what is built or installed left out. */
function claimable(patterns) {
  const walk = (from) =>
    readdirSync(join(repository, from), { withFileTypes: true }).flatMap((entry) => {
      const path = from ? `${from}/${entry.name}` : entry.name;
      if (!entry.isDirectory()) return [path];
      return ['node_modules', 'target', '.git', 'dist', 'out'].includes(entry.name) ? [] : walk(path);
    });
  return walk('').filter((path) => covered(patterns, path));
}

// --- The build, kept under a hash of what it reads -------------------------------------------------------------------

/** A hash of everything under web/ that the build can read (all of it but the tests, what is installed and what is
 * built, and the module among it), vite's installed versions, and this test. Taking in more than it reads only builds
 * again where it need not. */
function buildKey() {
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!(dir === root && ['node_modules', 'dist', 'tests'].includes(entry.name))) walk(path);
      } else {
        hash.update(`${path.slice(root.length)}\0`).update(readFileSync(path)).update('\0');
      }
    }
  };
  walk(root);
  for (const file of ['node_modules/.package-lock.json', 'tests/build.mjs']) hash.update(`${file}\0`).update(readFileSync(join(root, file)));
  return hash.digest('hex').slice(0, 16);
}

// --- The run -------------------------------------------------------------------------------------------------------------

const report = (line) => process.env.NERD_REPORT && appendFileSync(process.env.NERD_REPORT, `${JSON.stringify(line)}\n`);
const seconds = (s) => Number(s.toFixed(2));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NERD_REPORT) writeFileSync(process.env.NERD_REPORT, '');
  const told = (process.env.NERD_CHANGED ?? '').split('\n').filter(Boolean);

  // Whether what a change touches is all it runs: asked before anything starts, as it says what is wrong with the test.
  // A file a change removed is claimed by nothing and is no fault: it runs all, as choose says.
  const wrong = coarse([...claimable(covers()), ...told.filter((f) => existsSync(join(repository, f)))]);
  if (wrong.length) {
    console.error(`web-build runs more than a change touches:\n${wrong.map((l) => `  ${l}`).join('\n')}`);
    report({ part: 'granular', seconds: 0, outcome: 'failed', said: wrong.join('; ') });
    process.exit(1);
  }

  const { chosen, because } = choose(told);
  console.log(`web-build: ${because}`);
  const runs = (part) => chosen.some((p) => p.part === part);
  // The build is said below, as it may be made for the others where its own part does not run.
  for (const { part } of PARTS.slice(1)) if (!runs(part)) report({ part: `build › ${part}`, seconds: 0, outcome: 'skipped' });
  if (!chosen.length) process.exit(0);

  const { build } = await import('vite');
  const { startApp } = await import('../app.mjs');
  const { smoke } = await import('./smoke.mjs');
  let failed = 0;
  let server;
  try {
    execFileSync('bash', ['../scripts/build-wasm.sh'], { cwd: root, stdio: 'inherit' });
    // The build: made again where its part runs, else the one kept for what it reads now, where there is one.
    const kept = join(repository, 'target/web-build');
    const key = buildKey();
    const out = join(kept, key);
    if (runs('vite build') || !existsSync(out)) {
      const making = `${out}.${process.pid}`;
      rmSync(making, { recursive: true, force: true });
      const t0 = performance.now();
      try {
        await build({ root, logLevel: 'warn', build: { outDir: making, emptyOutDir: true, sourcemap: false } });
      } catch (e) {
        report({ part: 'build › vite build', seconds: seconds((performance.now() - t0) / 1000), outcome: 'failed', said: e.message.split('\n')[0] });
        throw e;
      }
      report({ part: 'build › vite build', seconds: seconds((performance.now() - t0) / 1000), outcome: 'passed' });
      console.log(`ok    vite build${runs('vite build') ? '' : ', as none was kept for what it reads'}`);
      rmSync(out, { recursive: true, force: true });
      renameSync(making, out);
      // Only the latest is kept, but one another run may still be serving: an hour old.
      for (const other of readdirSync(kept)) {
        const at = join(kept, other);
        if (other !== key && Date.now() - statSync(at).mtimeMs > 3600_000) rmSync(at, { recursive: true, force: true });
      }
    } else {
      report({ part: 'build › vite build', seconds: 0, outcome: 'skipped' });
      console.log(`web-build: the build kept for what it reads now (target/web-build/${key}), as nothing of it changed`);
    }

    // Each page is sent with no comment and no indented line but inside a script or a style, whose bytes are the
    // reader's (#23).
    for (const page of ['index.html', 'how.html']) {
      if (!runs(`${page} sent tight`)) continue;
      const html = readFileSync(join(out, page), 'utf8');
      const outside = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
      const loose = [...(outside.match(/<!--[\s\S]*?-->/g) || []), ...(outside.match(/^[ \t]+\S.*$/gm) || [])];
      const l = `${page} sent tight, ${html.length} B`;
      console.log(loose.length ? `FAIL  ${l}: ${loose.length} comments or indented lines, the first ${JSON.stringify(loose[0].slice(0, 60))}` : `ok    ${l}`);
      report({ part: `build › ${page} sent tight`, seconds: 0, outcome: loose.length ? 'failed' : 'passed', ...(loose.length ? { said: loose[0].slice(0, 60) } : {}) });
      failed += loose.length ? 1 : 0;
    }

    const checks = PARTS.slice(3).map((p) => p.part);
    if (checks.some(runs)) {
      server = await startApp(out);
      failed += await smoke(server.url, {
        network: false,
        only: (name) => {
          if (!checks.includes(name)) throw new Error(`smoke.mjs has a check no part here names: ${name}`);
          return runs(name);
        },
        done: (name, said, s) => report({ part: `build › ${name}`, seconds: seconds(s), outcome: said ? 'failed' : 'passed', ...(said ? { said } : {}) }),
      });
    }
  } catch (e) {
    failed++;
    console.log(`FAIL  ${e.message}`);
  } finally {
    await server?.close();
  }
  process.exit(failed ? 1 : 0);
}
