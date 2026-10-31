// The tests of pages in Chrome, on crux's harness (crux/chrome/harness.ts): page/ is the page on the real machine, its
// groups a file for each area, its options page/suite.mjs, and what its parts share ./harness.mjs.
//
//   nerd test web-page [words in a part's name...]      CHROME and CHROME_ARGS say which Chrome and its flags
//   node tests/run.mjs page --list                      its groups and parts

import { run } from '../../crux/chrome/harness.ts';

await run({ root: new URL('../..', import.meta.url), tests: new URL('.', import.meta.url) });
