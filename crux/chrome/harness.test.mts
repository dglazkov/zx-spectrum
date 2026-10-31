// The harness, over a stand-in product of the part's own (standin/, its runner at tests/ and another in web/tests), run as
// nerd runs a product's page test, with real Chrome: what each part reported, and how the run ended. Then what takes no
// run to judge. No check here holds the wall clock to a number, so that `nerd test chrome --stalls` passes.
//
// npm ci && CHROME=... npx --yes tsx@4.20.6 --test harness.test.mts    (as `nerd test chrome` runs it)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { chooseGroups, covered, longestFirst, ordered, RealTime, Skip, STRETCH, took, verdict, vite, within } from "./harness.ts";

const here = import.meta.dirname;
const scratch = mkdtempSync(join(tmpdir(), "crux-harness-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Under node's test runner, a child's test would report to it, not print.
const { NODE_TEST_CONTEXT: _, NERD_CHANGED: _c, NERD_USUAL: _u, NERD_REPORT: _r, ...env } = process.env;

type Reported = { part: string; seconds: number; outcome: string; said?: string };
let runs = 0;

/** The stand-in's runner, with these words and environment, as nerd runs it: how it ended, what it printed, and what it
 * reported, in the order it did. */
async function stand(args: string[], given: Record<string, string> = {}, runner = "tests/run.mjs") {
  const report = join(scratch, `report-${++runs}`);
  const child = spawn(process.execPath, [...process.execArgv, join(here, "standin", runner), ...args], {
    env: { ...env, NERD_TEST: "stand-in", NERD_REPORT: report, ...given },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise((resolve) => child.on("close", resolve));
  const lines = existsSync(report) ? readFileSync(report, "utf8").split("\n").filter(Boolean) : [];
  const parts: Reported[] = lines.map((l) => JSON.parse(l));
  const one = (name: string) => {
    const found = parts.filter((p) => p.part === name);
    assert.equal(found.length, 1, `${name} in ${out}`);
    return found[0];
  };
  return { code, out, parts, one, outcomes: Object.fromEntries(parts.map((p) => [p.part, p.outcome])) };
}

// The stand-in's suite of every way a part ends, run once: each case reads it.
const seed = "34";
let pages: ReturnType<typeof stand> | undefined;
const whole = () => (pages ??= stand(["pages", "--seed", seed]));

test("an error thrown in the page fails the part it came in, saying it", async () => {
  const { one } = await whole();
  assert.equal(one("errors › throws in its page").outcome, "failed");
  assert.match(one("errors › throws in its page").said!, /pageerror: thrown in the page/);
});

test("an error written to the console fails the part it came in, saying it", async () => {
  const { one } = await whole();
  assert.equal(one("errors › writes a console error").outcome, "failed");
  assert.match(one("errors › writes a console error").said!, /console error: written to the console/);
});

test("an error in a page the part opened is the part's too", async () => {
  const { one } = await whole();
  assert.match(one("errors › opens a popup that throws").said!, /thrown in the page/);
});

test("what a part means its page to say passes, and only that", async () => {
  const { one } = await whole();
  assert.equal(one("errors › makes its page throw on purpose").outcome, "passed");
  assert.equal(one("errors › makes its page say something else").outcome, "failed");
});

test("a warning fails only where the group says", async () => {
  const { one } = await whole();
  assert.equal(one("errors › writes a warning").outcome, "passed");
  assert.equal(one("warnings › writes a warning, where they count").outcome, "failed");
  assert.match(one("warnings › writes a warning, where they count").said!, /console warning: a warning/);
});

test("a part past its limit fails saying what it waited for, and the next part runs on a fresh page", async () => {
  const { one } = await whole();
  const part = one("limits › waits for what never comes");
  assert.equal(part.outcome, "failed");
  assert.match(part.said!, /#never/);
});

test("a wait that outlives its part's limit is said too", async () => {
  const { one } = await whole();
  assert.equal(one("limits › begins a wait late").outcome, "failed");
  assert.match(one("limits › begins a wait late").said!, /still going after [\d.]+s.*waiting for locator\('#late'\)/);
});

test("a part past its limit with nothing to wait for says so, and the part after one is on a fresh page", async () => {
  const { one, parts } = await whole();
  assert.equal(one("limits › never ends").outcome, "failed");
  assert.match(one("limits › never ends").said!, /still going after [\d.]+s/);
  const limits = parts.filter((p) => p.part.startsWith("limits ›")).map((p) => p.part);
  assert.equal(limits.indexOf("limits › comes after one"), 1, `the seed has to put it after a part past its limit: ${limits}`);
  assert.equal(one("limits › comes after one").outcome, "passed");
});

test("a part that leaves its page changed fails, and one on a page a part failed on is on a fresh one", async () => {
  const { one, parts } = await whole();
  assert.equal(one("left › leaves the title").outcome, "failed");
  assert.match(one("left › leaves the title").said!, /it left the stand-in not as it found it: the title is changed/);
  assert.equal(one("left › fails on a page").outcome, "failed");
  const left = parts.filter((p) => p.part.startsWith("left ›")).map((p) => p.part);
  assert.equal(left.indexOf("left › finds its page as it should"), 2, `the seed has to put it after them: ${left}`);
  assert.equal(one("left › finds its page as it should").outcome, "passed");
});

test("a group whose page does not open fails each part, saying why", async () => {
  const { one } = await whole();
  assert.equal(one("unopened › cannot run").outcome, "failed");
  assert.match(one("unopened › cannot run").said!, /its page did not open: the page would not open/);
});

test("pause stops the page's clock, and asks again from a time gone by", async () => {
  const { one } = await whole();
  assert.equal(one("ways › pause stops the page's clock").outcome, "passed");
  assert.equal(one("ways › pause asks again from where the clock is").outcome, "passed", one("ways › pause asks again from where the clock is").said);
});

test("a part that cannot run says so, and a part may say its context", async () => {
  const { one, code } = await whole();
  assert.deepEqual(one("ways › cannot run here"), { part: "ways › cannot run here", seconds: one("ways › cannot run here").seconds, outcome: "skipped", said: "its fixture cannot be had" });
  assert.equal(one("errors › a context of its own").outcome, "passed", one("errors › a context of its own").said);
  assert.equal(code, 1, "what failed fails the run");
});

test("a suite that says its Chrome is a reader's has one", async () => {
  const { outcomes, out } = await stand(["reader"]);
  assert.deepEqual(outcomes, { "reader › a reader's says no webdriver": "passed" }, out);
});

test("what a page asks of other servers is answered from recordings, and what none answers fails the part", async () => {
  const { one, code, out } = await stand(["recorded"]);
  assert.equal(code, 1);
  assert.equal(one("answers › answers from recordings").outcome, "passed", out);
  assert.equal(one("answers › answers some itself").outcome, "passed", out);
  assert.equal(one("answers › asks what none answers").outcome, "failed");
  assert.match(one("answers › asks what none answers").said!, /it asked https:\/\/unrecorded\.example\/x, which no recording answers/);
});

const narrow = (changed: string) => stand(["narrow"], { NERD_CHANGED: `${changed}\n` });

test("a change to what one group covers runs it, and the rest are reported skipped", async () => {
  for (const file of ["src/one/a.ts", "tests/narrow/one.mjs"]) {
    const { code, outcomes } = await narrow(file);
    assert.equal(code, 0);
    assert.deepEqual(outcomes, { "two › runs": "skipped", "one › runs": "passed" }, file);
  }
  assert.deepEqual((await narrow("src/two/b.ts")).outcomes, { "one › runs": "skipped", "two › runs": "passed" });
});

test("a shared file runs all, as does what no group claims, which is said", async () => {
  const all = { "one › runs": "passed", "two › runs": "passed" };
  for (const [file, why] of [
    ["src/shared.ts", "which they all share"],
    ["tests/narrow/suite.mjs", "which they all share"],
    ["tests/run.mjs", "which they all share"],
    ["src/nobody.ts", "which no group covers"],
    ["src/one/README.md", "which no group covers"],
  ]) {
    const { outcomes, out } = await narrow(file);
    assert.deepEqual(outcomes, all, file);
    assert.ok(out.includes(`every group, for ${file}, ${why}`), `${file} in ${out}`);
  }
});

test("the harness's own files are shared, as a product's copy of it is: a change to one runs all", async () => {
  // A root that holds the harness in a directory of its own, as a product's crux/chrome/harness.ts does.
  const file = `${basename(here)}/harness.ts`;
  const { outcomes, out } = await stand(["narrow"], { NERD_CHANGED: `${file}\n`, STANDIN_ROOT: dirname(here) });
  assert.deepEqual(outcomes, { "one › runs": "passed", "two › runs": "passed" });
  assert.ok(out.includes(`every group, for ${file}, which they all share`), out);
});

test("nothing changed runs all, and words run the parts that have them", async () => {
  const all = await stand(["narrow"], { NERD_CHANGED: "" });
  assert.deepEqual(all.outcomes, { "one › runs": "passed", "two › runs": "passed" });
  const word = await stand(["narrow", "TWO"]);
  assert.deepEqual(word.outcomes, { "one › runs": "skipped", "two › runs": "passed" });
  const none = await stand(["narrow", "nothing-has-this"]);
  assert.equal(none.code, 1);
  assert.match(none.out, /No part of narrow has the words "nothing-has-this"\. Its groups: one, two/);
});

test("a harness in web/tests works as one at tests/, its covers from the product's root", async () => {
  const changed = { NERD_CHANGED: "web/src/library/a.ts\n" };
  const { code, outcomes } = await stand(["nested"], changed, "web/tests/run.mjs");
  assert.equal(code, 0);
  assert.deepEqual(outcomes, { "playback › opens": "skipped", "library › opens": "passed" });
  const shared = await stand(["nested"], { NERD_CHANGED: "web/tests/run.mjs\n" }, "web/tests/run.mjs");
  assert.deepEqual(shared.outcomes, { "library › opens": "passed", "playback › opens": "passed" });
});

const order = async (seed: string) => (await stand(["order", "--seed", seed])).parts.map((p) => p.part);

test("the same seed gives the same order, of groups and of the parts in each, and says it", async () => {
  const first = await order("7");
  assert.deepEqual(await order("7"), first);
  assert.equal(first.length, 16);
  assert.notDeepEqual(await order("8"), first);
  const said = await stand(["order"]);
  const given = said.out.match(/Seed (\d+) \(`nerd test stand-in -- --seed \1`/)?.[1];
  assert.ok(given, said.out);
  assert.deepEqual(await order(given), said.parts.map((p) => p.part));
});

test("a group's parts go in the order they went among the rest, with words too", async () => {
  const of = (parts: string[]) => parts.filter((p) => p.startsWith("east ›"));
  const among = of(await order("7"));
  const alone = await stand(["order", "east", "--seed", "7"]);
  assert.deepEqual(of(alone.parts.filter((p) => p.outcome === "passed").map((p) => p.part)), among);
});

test("about four side by side on one Chrome, each on a page of its own, what goes alone first, the longest first", async () => {
  const sides = async (name: string, given: Record<string, string> = {}) => {
    const log = join(scratch, name);
    const { code, out, outcomes } = await stand(["sides", "--seed", "1"], { STANDIN_LOG: log, ...given });
    assert.equal(code, 0, out);
    assert.equal(Object.values(outcomes).filter((o) => o === "passed").length, 8);
    return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  };
  const began = await sides("sides");
  assert.deepEqual(began.slice(0, 2).map((b) => b.name), ["first", "first"]);
  assert.equal(Math.max(...began.slice(2).map((b) => b.running)), 4);
  assert.equal(new Set(began.filter((b) => b.chrome).map((b) => b.chrome)).size, 1, "one Chrome");
  // The two that have to wait for the first four. Said to be the longest, as nerd hands it over, they are not left to
  // the end; the others have not passed yet, and count as their limit, ten seconds. The first four begin at once.
  const last = began.slice(-2).map((b) => b.name);
  const usual = join(scratch, "usual");
  writeFileSync(usual, last.map((name, i) => `${JSON.stringify({ part: `${name} › meets`, seconds: 100 - i })}\n`).join(""));
  const longest = await sides("longest", { NERD_USUAL: usual });
  assert.deepEqual(longest.slice(2, 6).map((b) => b.name).filter((name) => last.includes(name)).sort(), [...last].sort(), "the longest first");
});

test("a stall made on purpose reports inconclusive, and fails nothing", async () => {
  const { code, out, one } = await stand(["stalls", "judges"]);
  assert.equal(code, 0, out);
  const part = one("stalled › judges real time");
  assert.equal(part.outcome, "inconclusive", out);
  assert.match(part.said!, /the ticks came late.*kept it from running \d+ ms, so this measured the machine/);
});

test("a stall that has only just ended is counted", async () => {
  const { code, out, parts } = await stand(["stalls", "as a stall ends"]);
  assert.equal(code, 0, out);
  assert.deepEqual([...new Set(parts.filter((p) => p.outcome !== "skipped").map((p) => p.outcome))], ["inconclusive"], out);
});

test("a part a stall only slowed passes past its limit", async () => {
  const { code, out, one } = await stand(["stalls", "slowed"]);
  assert.equal(code, 0, out);
  assert.equal(one("stalled › is only slowed").outcome, "passed", out);
});

test("a stall does not excuse what is no judgment of real time", async () => {
  const { code, one } = await stand(["stalls", "fails beside"]);
  assert.equal(code, 1);
  assert.equal(one("failing › fails beside a stall").outcome, "failed");
});

test("run outside nerd, it says so; --list needs no nerd", async () => {
  const { NERD_TEST: _, ...outside } = env;
  const run = (args: string[]) =>
    new Promise<{ code: number; out: string }>((resolve) => {
      const child = spawn(process.execPath, [...process.execArgv, join(here, "standin/tests/run.mjs"), ...args], { env: outside, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code: code!, out }));
    });
  const refused = await run(["narrow"]);
  assert.equal(refused.code, 2);
  assert.match(refused.out, /`nerd test narrow`/);
  const listed = await run(["narrow", "--list"]);
  assert.equal(listed.code, 0);
  assert.match(listed.out, /narrow: 2 groups, 2 parts/);
  assert.match(listed.out, /covers src\/one\/\*\*, !src\/one\/README\.md, tests\/narrow\/one\.mjs/);
});

// What takes no run to judge.

const suite = {
  shared: ["src/shared.ts", "crux/chrome"],
  groups: [
    { name: "one", own: ["src/one/**"] },
    { name: "two", own: ["src/{two,three}.ts", "!src/two.ts"] },
  ],
};
const names = (changed: string[]) => chooseGroups(suite, changed).groups.map((g) => g.name);

test("chooseGroups: the harness's own files are shared, and patterns read as nerd's", () => {
  assert.deepEqual(names(["src/one/deep/a.ts"]), ["one"]);
  assert.deepEqual(names(["src/three.ts"]), ["two"]);
  assert.deepEqual(names(["crux/chrome/harness.ts"]), ["one", "two"]);
  assert.deepEqual(names(["src/two.ts"]), ["one", "two"], "taken back by !, it is claimed by no group");
  assert.deepEqual(names([]), ["one", "two"]);
  assert.deepEqual(names(["src/one/a.ts", "src/three.ts"]), ["one", "two"]);
});

test("covered: as nerd.toml's", () => {
  assert.equal(covered(["src/*.ts"], "src/a.ts"), true);
  assert.equal(covered(["src/*.ts"], "src/deep/a.ts"), false);
  assert.equal(covered(["src/**/*.ts"], "src/deep/a.ts"), true);
  assert.equal(covered(["src"], "src/deep/a.ts"), true);
  assert.equal(covered(["src", "!src/deep"], "src/deep/a.ts"), false);
  assert.equal(covered(["src", "!src/deep", "src/deep/a.ts"], "src/deep/a.ts"), true);
  assert.equal(covered(["src.ts"], "srcxts"), false);
});

test("longestFirst: by what nerd says, and one not timed by its limit", () => {
  const unit = (name: string, ...titles: string[]) => ({ group: { name }, parts: titles.map((title) => ({ title })) });
  const units = [unit("short", "a"), unit("new", "a"), unit("long", "a", "b")];
  const usual = { "short › a": 1, "long › a": 40, "long › b": 41 };
  assert.deepEqual(longestFirst(units, usual, () => 10).map((u) => u.group.name), ["long", "new", "short"]);
});

test("ordered: a seed's order, whichever parts are left of a group", () => {
  const parts = ["a", "b", "c", "d", "e", "f"];
  const group = { name: "g", parts };
  const some = ["b", "c", "d", "e"];
  for (const seed of [1, 2, 3, 4, 5]) {
    const all = ordered([{ group, parts }], seed)[0].parts;
    assert.deepEqual(ordered([{ group, parts: some }], seed)[0].parts, all.filter((p) => some.includes(p)));
  }
});

test("verdict: only a judgment of real time, only on a machine that stalled", () => {
  assert.equal(verdict(null, 500), "passed");
  assert.equal(verdict(new RealTime("late"), 500), "inconclusive");
  assert.equal(verdict(new RealTime("late"), 30), "inconclusive");
  assert.equal(verdict(new RealTime("late"), 29), "failed");
  assert.equal(verdict(new RealTime("late"), 0), "failed");
  assert.equal(verdict(new Error("wrong"), 500), "failed");
  assert.equal(verdict(new Skip("no fixture"), 0), "skipped");
});

test("within: a limit stretches on a machine that kept the run, and a hang past that still fails", async () => {
  const never = new Promise<void>(() => undefined);
  await assert.rejects(within(never, 0.01, "still going", () => 0), /still going after 0\.01s, its limit/);
  let kept = 0;
  const stalled = within(never, 0.01, "still going", () => (kept += 40));
  await assert.rejects(stalled, new RegExp(`stretched ${STRETCH} times`));
  assert.equal(await within(Promise.resolve("done"), 1, "still going", () => 0), "done");
});

test("within: a stall counted just after the limit came still stretches it", async () => {
  // Limit 200 ms, stretched 600 ms, the work done in 400 ms; the thread has not counted the stall at the first look.
  let looks = 0;
  const work = sleep(400, "done");
  assert.equal(await within(work, 0.2, "still going", () => (looks++ < 2 ? 0 : 100)), "done");
});

test("took: as nerd says it", () => {
  assert.equal(took(1900), "1.9s");
  assert.equal(took(24_000), "24s");
  assert.equal(took(185_000), "3m05s");
});

test("vite: on a port it chooses, watching nothing and reloading nothing, whatever the product says", async () => {
  let config: any;
  let closed = false;
  const stand = async (given: unknown) => {
    config = given;
    return { listen: async () => undefined, resolvedUrls: { local: ["http://localhost:5199/"] }, close: () => (closed = true) };
  };
  const served = await vite(stand, { root: "web", server: { port: 5190, strictPort: true, fs: { strict: false } } })();
  assert.equal(config.root, "web");
  assert.deepEqual(config.server, { port: 0, strictPort: false, fs: { strict: false }, watch: null, hmr: false });
  assert.equal(served.base, "http://localhost:5199/");
  served.close();
  assert.equal(closed, true);
});
