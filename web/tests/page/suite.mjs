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
  // What every group runs on, the machine itself among it. The server (crates/app, beside the dev server: web/app.mjs) is
  // answered for by the recordings but where a part lets a request through to it: starting is its test.
  shared: ['web/src/app.ts', 'web/src/main.ts', 'web/src/style.css', 'web/index.html', 'web/vite.config.ts', 'web/app.mjs', 'web/tests/harness.mjs', 'web/src/emulator', 'web/src/video', 'web/src/ui/dom.ts', 'web/src/ui/controls.ts', 'web/src/ui/toast.ts', 'web/src/clock', 'web/package-lock.json', 'roms', 'crates', 'scripts/build-wasm.sh', 'Cargo.toml', 'Cargo.lock', 'fixtures.txt'],
  serve: async () => {
    // The machine, built if it is missing or stale (cargo is incremental: a moment when nothing changed): the module the
    // deploy serves, byte for byte (scripts/build-wasm.sh).
    execFileSync('bash', ['../scripts/build-wasm.sh'], { cwd: root, stdio: 'inherit' });
    await startStandIns();
    return serve();
  },
};
