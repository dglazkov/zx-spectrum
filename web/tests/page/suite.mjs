// The page in Chrome, running the real machine (the WebAssembly build of crates/spectrum, built first by
// scripts/build-wasm.sh): it becomes ready, switches on to the ROM's copyright, takes keys from the drawn keyboard,
// the PC's keyboard and a touch pad, loads tapes (LOAD "" typed, the 128's Tape Loader chosen when its menu shows)
// and snapshots, loads Saboteur from the library to its £100 REWARD screen flat out, opens a game from a link, keeps
// save slots, rewinds, records a SAVE as a TAP, stops at a breakpoint, remembers its settings, sounds, and fits a
// phone. The network is answered from recordings (the ZXInfo API's own answers; Saboteur's tape, manual and inlay from
// the fixture cache, scripts/fixture, or tapes the test makes). Time is the page's own clock (Playwright's page.clock),
// moved on by the test: frames are counted, not waited for. One whose fixture cannot be had says it was skipped.
//
// Every part has a page of its own, and opens it itself (harness.mjs's open), as each asks for another machine.

import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { vite } from '../../../crux/chrome/harness.ts';
import { recordings, root, startStandIns } from '../harness.mjs';

const serve = vite(createServer, { root });

export default {
  limit: 30,
  each: true,
  viewport: { width: 1440, height: 900 },
  context: { permissions: ['clipboard-read', 'clipboard-write'] },
  chrome: { args: ['--autoplay-policy=user-gesture-required'] },
  recordings,
  // What every part stands on, each as the page does: app.ts, which wires all of it, and what starts it (main.ts,
  // index.html, the dev server and web/app.mjs, which starts the server beside it); the machine, as every crate but the
  // server's is in the module, and what builds it; the clock each part's frames run on; what the page's controls are made
  // of; the parts' own harness. The rest is claimed by the parts that test it: the server (crates/app) is answered for by
  // the recordings but in the one part that lets a request through to it, the picture is judged by those that read it,
  // and style.css by those that measure the page.
  shared: ['web/src/app.ts', 'web/src/main.ts', 'web/index.html', 'web/vite.config.ts', 'web/app.mjs', 'web/tests/harness.mjs', 'web/src/emulator', '!web/src/emulator/stub.ts', '!web/src/emulator/stub', 'web/src/ui/dom.ts', 'web/src/ui/controls.ts', 'web/src/clock', 'web/package-lock.json', 'roms', 'crates', '!crates/app', 'crux/wasm', 'scripts/build-wasm.sh', 'Cargo.toml', 'Cargo.lock'],
  // What the suite tests: nerd.toml's covers of web-page, every file of it shared or claimed, none but what is shared
  // running more than a quarter of the parts (crux#168).
  granular: {
    files: ['web/src/**', '!web/src/**/*.test.ts', '!web/src/how/**', '!web/src/fonts/plex-mono-*', '!web/src/fonts/*.txt', 'web/index.html', 'web/public/**', 'web/tests/run.mjs', 'web/tests/harness.mjs', 'web/tests/page/**', 'web/tests/fixtures/**', 'web/vite.config.ts', 'web/app.mjs', 'web/zxdb.mjs', 'web/tools/zxdb-index.mjs', 'web/package-lock.json', 'crates/app/**', 'crux/chrome/**', '!crux/chrome/standin/**', '!crux/chrome/*.test.mts', 'crux/server/**', 'crux/telemetry/**', 'crux/widget/**', 'crux/load/**', 'crux/wasm/**', 'roms/**', 'crates/wasm/src/**', 'crates/wasm/Cargo.toml', 'crates/spectrum/src/**', 'crates/z80/src/**', 'crates/audio/src/**', 'crates/ay/src/**', 'crates/tape/src/**', 'crates/snapshot/src/**', 'crates/unzip/src/**', '!crates/**/tests.rs', 'Cargo.toml', 'Cargo.lock', 'scripts/build-wasm.sh', 'fixtures.txt'],
  },
  serve: async () => {
    // The machine, built if it is missing or stale (cargo is incremental: a moment when nothing changed): the module the
    // deploy serves, byte for byte (scripts/build-wasm.sh).
    execFileSync('bash', ['../scripts/build-wasm.sh'], { cwd: root, stdio: 'inherit' });
    await startStandIns();
    return serve();
  },
};
