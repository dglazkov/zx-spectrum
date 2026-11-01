// report.mjs, as node:test runs it over the stand-in files of standin/reported: what each way a test ends puts in the file
// NERD_REPORT names; and that a test that ended beside one that hangs is there as it ends, as nerd stops such a test.
//
// npx --yes tsx@4.20.6 --test report.test.mts    (as `nerd test chrome` runs it)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, suite, test as one, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

// Held as the file is read, and run side by side at its end: node:test goes one at a time but in a suite that says otherwise.
const cases: [string, (t: TestContext) => void | Promise<void>][] = [];
const test = (name: string, fn: (t: TestContext) => void | Promise<void>) => void cases.push([name, fn]);
const scratch = mkdtempSync(join(tmpdir(), "crux-report-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Under node's test runner, a child's test would report to it, not print.
const { NODE_TEST_CONTEXT: _, NERD_REPORT: _r, ...env } = process.env;

/** node:test over these stand-in files, reporting to `report`. */
function reporting(report: string | undefined, ...files: string[]) {
  const args = ["--test", "--test-reporter=./report.mjs", "--test-reporter-destination=stdout", ...files.map((f) => `standin/reported/${f}.test.mjs`)];
  return spawn(process.execPath, [...process.execArgv, ...args], { cwd: import.meta.dirname, env: { ...env, ...(report ? { NERD_REPORT: report } : {}) }, stdio: "ignore", detached: true });
}

const read = (report: string) => (existsSync(report) ? readFileSync(report, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

test("each test is a part, as it ended and with what it said, and neither a suite nor a file whose tests say for it", async () => {
  const report = join(scratch, "parts");
  await new Promise((resolve) => reporting(report, "parts", "clean").on("close", resolve));
  const parts = read(report);
  for (const part of parts) assert.ok(part.seconds >= 0, JSON.stringify(part));
  const ended = parts.map(({ part, outcome, said }) => ({ part, outcome, said })).sort((a, b) => a.part.localeCompare(b.part));
  assert.deepEqual(ended, [
    { part: "clean › passes too", outcome: "passed", said: undefined },
    { part: "parts › fails", outcome: "failed", said: "said over two lines" },
    { part: "parts › in a suite", outcome: "passed", said: undefined },
    { part: "parts › is skipped", outcome: "skipped", said: undefined },
    { part: "parts › passes", outcome: "passed", said: undefined },
  ]);
});

test("a file no test of which ended is a part that failed", async () => {
  const report = join(scratch, "broken");
  const code = await new Promise((resolve) => reporting(report, "broken").on("close", resolve));
  assert.equal(code, 1);
  assert.deepEqual(read(report).map(({ part, outcome }) => ({ part, outcome })), [{ part: "broken › its file", outcome: "failed" }]);
});

test("a test is there as it ends, whatever hangs ahead of it", async (t) => {
  const report = join(scratch, "hangs");
  const child = reporting(report, "hangs");
  t.after(() => process.kill(-child.pid!, "SIGKILL")); // the runner, and the process of the file it started
  for (let waited = 0; !read(report).length && waited < 60_000; waited += 10) await sleep(10);
  assert.deepEqual(read(report).map(({ part }) => part), ["hangs › ends beside it"]);
});

test("run outside nerd, it reports nowhere and prints as ever", async () => {
  assert.equal(await new Promise((resolve) => reporting(undefined, "clean").on("close", resolve)), 0);
});

suite("side by side", { concurrency: 2 }, () => {
  for (const [name, fn] of cases) one(name, fn);
});
