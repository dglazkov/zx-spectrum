// The page in Chrome, running the real machine (the WebAssembly build of crates/spectrum, built first by
// scripts/build-wasm.sh): it becomes ready, switches on to the ROM's copyright, takes keys from the drawn keyboard,
// the PC's keyboard and a touch pad, loads tapes (LOAD "" typed, the 128's Tape Loader chosen when its menu shows)
// and snapshots, loads Saboteur from the library to its £100 REWARD screen flat out, opens a game from a link, keeps
// save slots, rewinds, records a SAVE as a TAP, stops at a breakpoint, remembers its settings, sounds, and fits a
// phone. The network is answered from recordings (the ZXInfo API's own answers; Saboteur's tape, manual and inlay from
// the fixture cache, scripts/fixture, or tapes the test makes). Time is the page's own clock (Playwright's page.clock),
// moved on by the test: frames are counted, not waited for. Any console error fails a part. Each part is reported to
// nerd ($NERD_REPORT); one whose fixture cannot be had says it was skipped.
//
//   node tests/page.mjs [words in a part's name...]      CHROME and CHROME_ARGS say which Chrome and its flags
//
// The harness is page/harness.mjs; the parts are in page/*.mjs, a file for each area, and each part covers its own
// file: a change to one runs that file's parts, and a change to the harness or here runs them all.

import { browser, failed, ran, runAll, server } from './page/harness.mjs';

try {
  await import('./page/machine.mjs');
  await import('./page/keys.mjs');
  await import('./page/tapes.mjs');
  await import('./page/library.mjs');
  await import('./page/state.mjs');
  await import('./page/phone.mjs');
  await runAll(4);
} finally {
  await browser.close();
  await server.close();
}

console.log(`${ran - failed} of ${ran} passed`);
process.exit(failed ? 1 : 0);
