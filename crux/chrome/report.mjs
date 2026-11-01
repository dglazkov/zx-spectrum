// node:test's own tests as parts of `nerd test` (crux#134): each, as it ends, a line in the file NERD_REPORT names, so
// that a failure is named by what failed and a flake registered by itself. A runner's second reporter, beside the one
// that prints, and plain JavaScript, as the runner reads it before tsx is there to:
//
//   tsx --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./report.mjs --test-reporter-destination=stdout a.test.mts
//
// A part is "<file, less .test.mts> › <its name>". A file that failed with no part failed in it, as one that could not be
// read, is a part too. It reads test:complete, not test:pass and test:fail: those come in the order the tests were
// written, so that one that hangs would hold back all that ended beside it, and a test stopped at its limit would name
// none of them.

import { appendFileSync } from "node:fs";
import { basename } from "node:path";

const short = (file) => basename(file).replace(/\.test\.[cm]?[jt]s$/, "");

export default async function* report(source) {
  const to = process.env.NERD_REPORT;
  const part = (fields) => to && appendFileSync(to, `${JSON.stringify(fields)}\n`);
  const seconds = ({ duration_ms }) => Math.round(duration_ms / 10) / 100;
  const said = ({ error }) => (error ? { said: error.message.replace(/\s*\n\s*/g, " ") } : {});
  const failed = new Set();
  const files = [];
  for await (const { type, data } of source) {
    if (type !== "test:complete" || data.details.type === "suite") continue;
    const { details } = data;
    // A file ends as a test named for itself, failed where any test in it did, which may be said after it.
    if (data.file?.endsWith(data.name)) {
      if (!details.passed) files.push(data);
      continue;
    }
    if (!details.passed) failed.add(data.file);
    const outcome = !details.passed ? "failed" : data.skip === undefined ? "passed" : "skipped";
    part({ part: `${short(data.file)} › ${data.name}`, seconds: seconds(details), outcome, ...said(details) });
  }
  for (const { file, details } of files) if (!failed.has(file)) part({ part: `${short(file)} › its file`, seconds: seconds(details), outcome: "failed", ...said(details) });
}
