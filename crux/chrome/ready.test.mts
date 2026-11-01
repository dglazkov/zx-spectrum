// ready.sh, on a stand-in for npm, in a copy of the part with no node_modules (crux#128): several started side by side
// install once, and none ends before that install has; what is installed is left alone, and a lock moved since installs
// again; an install that fails fails it, and the next tries again; and it finds the part from wherever it is run.
// npm itself is the part's other tests', which ready.sh readies in `nerd test chrome`.
//
// npx --yes tsx@4.20.6 --test ready.test.mts    (as `nerd test chrome` runs it)

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { suite, test as one, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

// Held as the file is read, and run side by side at its end: node:test goes one at a time but in a suite that says otherwise.
const cases: [string, (t: TestContext) => void | Promise<void>][] = [];
const test = (name: string, fn: (t: TestContext) => void | Promise<void>) => void cases.push([name, fn]);

const here = dirname(fileURLToPath(import.meta.url));

/** A copy of what ready.sh stands beside, and an npm that says each run in `runs`, waits for `release` where there is
 * one to wait for, and fails where `broken` says, as npm ci makes its hidden lock last. */
function standIn(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "crux-ready-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const part = join(root, "crux/chrome");
  const bin = join(root, "bin");
  mkdirSync(part, { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(here, "ready.sh"), join(part, "ready.sh"));
  writeFileSync(join(part, "package-lock.json"), "{}\n");
  const runs = join(root, "runs");
  const release = join(root, "release");
  const broken = join(root, "broken");
  const npm = join(bin, "npm");
  writeFileSync(
    npm,
    `#!/bin/sh
echo "$* in $PWD" >> ${runs}
while [ -e ${release}.wait ] && [ ! -e ${release} ]; do sleep 0.02; done
[ ! -e ${broken} ] || { echo "npm stood in failing" >&2; exit 7; }
mkdir -p node_modules && touch node_modules/.package-lock.json
`,
  );
  chmodSync(npm, 0o755);
  const start = (cwd = root, script = "crux/chrome/ready.sh") =>
    spawn("sh", [script], { cwd, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "ignore", "pipe"] });
  return {
    root,
    part,
    release,
    broken,
    start,
    runs: () => (existsSync(runs) ? readFileSync(runs, "utf8").trim().split("\n") : []),
    hold: () => writeFileSync(`${release}.wait`, ""),
  };
}

const ended = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once("close", (code) => resolve(code));
  });

test("several side by side install once, and none ends before it has", async (t) => {
  const s = standIn(t);
  s.hold();
  const children = Array.from({ length: 6 }, () => s.start());
  const out = new Set<ChildProcess>();
  for (const child of children) child.once("close", () => out.add(child));
  while (!s.runs().length) await new Promise((r) => setTimeout(r, 10));
  // A moment for the others to reach the guard: one that has not yet only makes this test pass for it, never fail.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(out.size, 0, "one ended while the install it needs was still going");
  writeFileSync(s.release, "");
  assert.deepEqual(await Promise.all(children.map(ended)), children.map(() => 0));
  assert.equal(s.runs().length, 1, `installed more than once: ${s.runs().join("; ")}`);
  assert.match(s.runs()[0], /^ci --no-audit --no-fund --loglevel=error in .*crux\/chrome$/);
});

test("what is installed is left alone, and a lock moved since installs again", async (t) => {
  const s = standIn(t);
  assert.equal(await ended(s.start()), 0);
  assert.equal(await ended(s.start()), 0);
  assert.equal(s.runs().length, 1, "installed over what was installed");
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(s.part, "package-lock.json"), later, later);
  utimesSync(join(s.part, "node_modules/.package-lock.json"), new Date(0), new Date(0));
  assert.equal(await ended(s.start()), 0);
  assert.equal(s.runs().length, 2, "a lock newer than what is installed installed nothing");
});

test("an install that fails fails it, and the next tries again", async (t) => {
  const s = standIn(t);
  writeFileSync(s.broken, "");
  const child = s.start();
  let said = "";
  child.stderr?.on("data", (d) => (said += d));
  assert.equal(await ended(child), 7);
  assert.match(said, /npm stood in failing/);
  rmSync(s.broken);
  assert.equal(await ended(s.start()), 0);
  assert.equal(s.runs().length, 2);
});

test("it finds the part from wherever it is run", async (t) => {
  const s = standIn(t);
  const elsewhere = join(s.root, "tests/page");
  mkdirSync(elsewhere, { recursive: true });
  assert.equal(await ended(s.start(elsewhere, relative(elsewhere, join(s.part, "ready.sh")))), 0);
  assert.ok(existsSync(join(s.part, "node_modules/.package-lock.json")));
  assert.equal(s.runs().length, 1);
});

suite("side by side", { concurrency: 4 }, () => {
  for (const [name, fn] of cases) one(name, fn);
});
