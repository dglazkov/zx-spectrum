// The harness, over a stand-in product of the part's own (standin/, its runner at tests/ and another in web/tests), run as
// nerd runs a product's page test, with real Chrome: what each part reported, and how the run ended. Then what takes no
// run to judge. No check here holds the wall clock to a number, so that `nerd test chrome --stalls` passes. The cases
// share nothing but the runs that several read, each asked for once: a stand-in's run is a process and a Chrome of its own.
//
// npm ci && CHROME=... npx --yes tsx@4.20.6 --test harness.test.mts    (as `nerd test chrome` runs it)

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, describe, test as one, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { cannotTab, chooseGroups, claimable, coarse, counted, covered, FURTHEST, longestFirst, ordered, ranOn, reach, RealTime, runsOn, Skip, STALLED, STRETCH, standsFor, took, verdict, vite, within } from "./harness.ts";

// Held as the file is read, and run side by side at its end: node:test goes one at a time but in a suite that says otherwise.
const cases: [string, (t: TestContext) => void | Promise<void>][] = [];
const test = (name: string, fn: (t: TestContext) => void | Promise<void>) => void cases.push([name, fn]);

const here = import.meta.dirname;
const scratch = mkdtempSync(join(tmpdir(), "crux-harness-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Under node's test runner, a child's test would report to it, not print.
const { NODE_TEST_CONTEXT: _, NERD_CHANGED: _c, NERD_BASE: _b, NERD_USUAL: _u, NERD_REPORT: _r, ...env } = process.env;

type Reported = { part: string; seconds: number; outcome: string; said?: string };
let runs = 0;

/** How many stand-ins run at once, each with a Chrome. */
let free = 8;
const waiting: (() => void)[] = [];

/** The stand-in's runner, with these words and environment, as nerd runs it: how it ended, what it printed, and what it
 * reported, in the order it did. */
async function stand(args: string[], given: Record<string, string> = {}, runner = "tests/run.mjs") {
  if (free-- <= 0) await new Promise<void>((go) => waiting.push(go));
  const report = join(scratch, `report-${++runs}`);
  const child = spawn(process.execPath, [...process.execArgv, join(here, "standin", runner), ...args], {
    env: { ...env, NERD_TEST: "stand-in", NERD_REPORT: report, ...given },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const code = await new Promise((resolve) => child.on("close", resolve));
  free++;
  waiting.shift()?.();
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

test("every kind of wait a part's limit ends says what it waited for", async () => {
  const { code, out, one } = await stand(["waits"]);
  assert.equal(code, 1, out);
  for (const [name, waited] of [
    ["a selector", /waiting for locator\('#never'\)/],
    ["a locator's wait", /waiting for locator\('#never'\)/],
    ["a click", /waiting for locator\('#never'\)/],
    ["a fill", /waiting for locator\('#never'\)/],
    ["a function", /in page\.waitForFunction/],
    ["a url", /waiting for navigation to "\*\*\/never"/],
    ["an event", /waiting for event "popup"/],
    ["a request", /waiting for request "\*\*\/never"/],
    ["a response", /waiting for response "\*\*\/never"/],
    ["a navigation", /navigating to "[^"]*never"/],
    ["a load", /in page\.waitForLoadState/],
    ["a context's event", /in browserContext\.waitForEvent/],
    ["a script", /in page\.evaluate/],
  ] as const) {
    const part = one(`hung › ${name}`);
    assert.equal(part.outcome, "failed", out);
    assert.match(part.said!, /^still going after /, out);
    assert.match(part.said!, waited, out);
  }
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

// The stand-in's suite of a reader's tabs, run once: each case reads it. `open` fails any part whose tab finds another
// tab, or ears, left by the one before.
let tabs: ReturnType<typeof stand> | undefined;
const tabbed = () => (tabs ??= stand(["tabs", "--seed", "3"]));

test("an error thrown or written in a reader's tab fails the part it came in, saying it", async () => {
  const { one, code } = await tabbed();
  assert.equal(code, 1);
  assert.match(one("tabs › throws in its page").said!, /^the page reported: pageerror: thrown in the page$/);
  assert.match(one("tabs › writes a console error").said!, /^the page reported: console error: written to the console$/);
  assert.equal(one("tabs › makes its page throw on purpose").outcome, "passed", one("tabs › makes its page throw on purpose").said);
  assert.match(one("tabs › opens a popup that throws, and leaves it").said!, /^the page reported: pageerror: thrown in the page$/);
});

test("a tab is held to its limit, and neither it nor what it leaves is found by the next", async () => {
  const { one, parts } = await tabbed();
  assert.match(one("tabs › waits for what never comes").said!, /#never/);
  assert.match(one("tabs › never ends").said!, /still going after [\d.]+s/);
  assert.equal(one("tabs › is hidden, and leaves the tab over it").outcome, "passed", one("tabs › is hidden, and leaves the tab over it").said);
  const order = parts.map((p) => p.part);
  assert.ok(order.indexOf("tabs › leaves a route on its context") < order.indexOf("tabs › meets no route left"), `the seed has to put it after: ${order}`);
  assert.equal(one("tabs › meets no route left").outcome, "passed", one("tabs › meets no route left").said);
});

test("tabs go one at a time, each shown, and a group that says otherwise is on a page of its own beside them", async () => {
  const { one, out } = await tabbed();
  for (const name of ["a", "b", "c", "d", "e"]) assert.equal(one(`one at a time › tab ${name}`).outcome, "passed", one(`one at a time › tab ${name}`).said);
  for (const part of ["not a tab › is on a page of its own", "nor this › takes the other's turn", "beside › meets a group not on a tab"]) assert.equal(one(part).outcome, "passed", one(part).said);
  assert.match(out, /2 at a time, one of them a reader's tab/);
});

test("recordings answer a group's tab, what none answers fails its part, and tabs alone go one at a time", async () => {
  const { one, out } = await stand(["tabrecorded", "--seed", "1"]);
  assert.equal(one("answers › answers from recordings").outcome, "passed", one("answers › answers from recordings").said);
  assert.match(one("answers › asks what none answers").said!, /it asked https:\/\/unrecorded\.example\/x, which no recording answers/);
  assert.match(out, /2 parts in 1 groups: every group\./);
});

test("a suite that says a tab with no reader's Chrome is refused, not run on a page", async () => {
  const { code, out, parts } = await stand(["tabplain"]);
  assert.notEqual(code, 0);
  assert.match(out, /parts\.mjs: its group is on a tab, which only a reader's Chrome has: say `chrome: \{ reader: true \}`/);
  assert.deepEqual(parts, []);
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
    ["src/nobody.ts", "which no part covers"],
    ["src/one/README.md", "which no part covers"],
  ]) {
    const { outcomes, out } = await narrow(file);
    assert.deepEqual(outcomes, all, file);
    assert.ok(out.includes(`every group, for ${file}, ${why}`), `${file} in ${out}`);
  }
});

test("the harness's own files are shared, as a product's copy of it is: a change to one runs all", async () => {
  // A root that holds the harness in a directory of its own, as a product's crux/chrome/harness.ts does.
  await Promise.all(
    runsOn.map(async (name) => {
      const file = `${basename(here)}/${name}`;
      const { outcomes, out } = await stand(["narrow"], { NERD_CHANGED: `${file}\n`, STANDIN_ROOT: dirname(here) });
      assert.deepEqual(outcomes, { "one › runs": "passed", "two › runs": "passed" }, file);
      assert.ok(out.includes(`every group, for ${file}, which they all share`), out);
    }),
  );
});

test("the part's own tests and stand-ins run none of a product's parts, though its covers take the part whole", async () => {
  const files = ["harness.test.mts", "report.mjs", "standin/tests/narrow/one.mjs"].map((f) => `${basename(here)}/${f}`);
  const { code, outcomes, out } = await stand(["narrow"], { NERD_CHANGED: `${files.join("\n")}\n`, STANDIN_ROOT: dirname(here) });
  assert.equal(code, 0, out);
  assert.deepEqual(outcomes, { "one › runs": "skipped", "two › runs": "skipped" });
  assert.ok(out.includes("what changed stands for nothing"), out);
  const beside = await stand(["narrow"], { NERD_CHANGED: `${files[0]}\n${basename(here)}/launch.ts\n`, STANDIN_ROOT: dirname(here) });
  assert.deepEqual(beside.outcomes, { "one › runs": "passed", "two › runs": "passed" }, "beside one it runs on, all run");
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

test("a file the suite narrows runs for what its change stands for, read from git at NERD_BASE", async () => {
  const git = (...args: string[]) => execFileSync("git", ["-C", join(here, "standin"), ...args], { encoding: "utf8" }).trim();
  const head = git("rev-parse", "HEAD");
  const read = await stand(["narrow"], { NERD_CHANGED: "serve.mjs\n", NERD_BASE: head });
  assert.equal(read.code, 0, read.out);
  assert.deepEqual(read.outcomes, { "one › runs": "skipped", "two › runs": "passed" }, read.out);
  assert.ok(read.out.includes("what changed stands for src/two/b.ts, of serve.mjs"), read.out);
  // Before serve.mjs was as it is, its narrow is given what git had then, not the tree: it stands for itself, and runs all.
  const before = `${git("log", "-1", "--format=%H", "--", "serve.mjs")}^`;
  // No base, or one git cannot read: nothing stands for another, and serve.mjs, which no part claims, runs all.
  for (const given of [{}, { NERD_BASE: "0".repeat(40) }, { NERD_BASE: before }] as Record<string, string>[]) {
    const whole = await stand(["narrow"], { NERD_CHANGED: "serve.mjs\n", ...given });
    assert.deepEqual(whole.outcomes, { "one › runs": "passed", "two › runs": "passed" }, whole.out);
    assert.ok(whole.out.includes("every group, for serve.mjs, which no part covers"), whole.out);
  }
  // What stands for nothing runs nothing, and says so, every part skipped.
  const none = await stand(["narrow"], { NERD_CHANGED: "src/nothing.ts\n", NERD_BASE: head });
  assert.equal(none.code, 0, none.out);
  assert.deepEqual(none.outcomes, { "one › runs": "skipped", "two › runs": "skipped" }, none.out);
  assert.ok(none.out.includes("0 parts in 0 groups: nothing, for what changed stands for nothing"), none.out);
});

test("what a change stands for", () => {
  const was = (file: string) => ({ "list.ts": "a\n", "kept.ts": "k\n" })[file] ?? null;
  const now = (file: string) => ({ "list.ts": "a\nb\n", "kept.ts": "k\n" })[file] ?? null;
  const narrow = {
    "list.ts": (before: string | null, after: string | null) => (before === "a\n" && after === "a\nb\n" ? ["b.ts", "c.ts"] : ["wrong.ts"]),
    "kept.ts": () => null,
  };
  assert.deepEqual(standsFor(["list.ts", "other.ts"], narrow, was, now), ["b.ts", "c.ts", "other.ts"], "each file in place of its own, as it was and is");
  assert.deepEqual(standsFor(["kept.ts"], narrow, was, now), ["kept.ts"], "null keeps the file itself");
  assert.deepEqual(standsFor(["list.ts", "b.ts"], narrow, was, now), ["b.ts", "c.ts"], "a file said twice is said once");
  assert.deepEqual(standsFor(["list.ts"], undefined, was, now), ["list.ts"], "no narrow, nothing changes");
});

const granular = (held: string, given: Record<string, string> = {}, words: string[] = []) => stand(["granular", ...words], { STANDIN_GRANULAR: held, ...given });

test("a granular suite with every file claimed runs, and narrows as any suite", async () => {
  const whole = await granular("granular/**,!granular/loose.ts,!granular/wide.ts");
  assert.equal(whole.code, 0, whole.out);
  assert.deepEqual(Object.values(whole.outcomes), ["passed", "passed", "passed", "passed"]);
  const one = await granular("granular/**,!granular/loose.ts,!granular/wide.ts", { NERD_CHANGED: "granular/a.ts\n" });
  assert.equal(one.code, 0, one.out);
  assert.equal(Object.values(one.outcomes).filter((o) => o === "passed").length, 1);
});

test("a granular suite that holds the harness's directory whole faults none of the part's own files", async () => {
  // As a product's granular `files` of crux/** takes in the part's tests and stand-ins, which none of its parts claims.
  const { code, out } = await granular(`${basename(here)}/**`, { STANDIN_ROOT: dirname(here) });
  assert.equal(code, 0, out);
  assert.ok(!out.includes("claimed by no part"), out);
});

test("a granular suite fails on a file no part claims, whatever changed, before Chrome starts", async () => {
  for (const given of [{}, { NERD_CHANGED: "granular/a.ts\n" }, { NERD_CHANGED: "granular/loose.ts\n" }] as Record<string, string>[]) {
    const { code, out, parts } = await granular("granular/**,!granular/wide.ts", given);
    assert.equal(code, 1, out);
    assert.ok(out.includes("granular/loose.ts is claimed by no part"), out);
    assert.deepEqual(parts.map((r) => [r.part, r.outcome]), [["granular", "failed"]]);
    assert.match(parts[0].said!, /granular\/loose\.ts/);
  }
});

test("a granular suite fails on a file changed that its files do not name and no part claims", async () => {
  const { code, out } = await granular("granular/a.ts", { NERD_CHANGED: "granular/loose.ts\n" });
  assert.equal(code, 1, out);
  assert.ok(out.includes("granular/loose.ts is claimed by no part"), out);
});

test("a granular suite runs all for a file a change removed, as nothing is left to claim", async () => {
  const { code, outcomes, out } = await granular("granular/**,!granular/loose.ts,!granular/wide.ts", { NERD_CHANGED: "granular/gone.ts\n" });
  assert.equal(code, 0, out);
  assert.deepEqual(Object.values(outcomes), ["passed", "passed", "passed", "passed"]);
});

test("a granular suite fails on a file that runs more than its share, but for one it shares, or what it says it may", async () => {
  const wide = await granular("granular/**,!granular/loose.ts");
  assert.equal(wide.code, 1, wide.out);
  assert.ok(wide.out.includes("granular/wide.ts runs 2 of the 4 parts, more than 25%"), wide.out);
  const shared = await granular("granular/**,!granular/loose.ts", { STANDIN_SHARED: "granular/wide.ts" });
  assert.equal(shared.code, 0, shared.out);
  const more = await granular("granular/**,!granular/loose.ts", { STANDIN_MOST: "0.5" });
  assert.equal(more.code, 0, more.out);
});

test("words run what they say, however a granular suite stands", async () => {
  const { code, outcomes } = await granular("granular/**", {}, ["one"]);
  assert.equal(code, 0);
  assert.equal(Object.values(outcomes).filter((o) => o === "passed").length, 1);
});

test("what granular reads and judges", () => {
  const root = join(here, "standin");
  assert.deepEqual(claimable(root, ["granular/**", "!granular/loose.ts", "!granular/wide.ts"]).filter((f) => !f.endsWith("/")).sort(), ["granular/a.ts", "granular/b.ts", "granular/c.ts", "granular/d.ts"]);
  assert.deepEqual(claimable(here, ["node_modules/**"]), [], "what is installed is no file of a suite's");
  const suite = { shared: ["s"], groups: [{ parts: [{ own: ["a", "t"] }, { own: ["b", "t"] }, { own: ["c"] }, { own: ["d"] }] }] };
  assert.deepEqual(coarse(suite, ["a", "b", "c", "d", "s"]), []);
  assert.equal(coarse(suite, ["t"]).length, 1, "half of them");
  assert.deepEqual(coarse(suite, ["t"], 0.5), [], "exactly its share is allowed");
  assert.equal(coarse(suite, ["t", "t"]).length, 1, "a file said twice is said once");
  assert.equal(coarse(suite, ["nobody"]).length, 1);
});

test("granular makes each pattern once, however many files and parts it judges (crux#204)", () => {
  // Dawn's suite, as synth-exp's #580 profiled it: 267 parts, each with patterns of its own and some every part has.
  const parts = Array.from({ length: 267 }, (_, i) => ({ own: [`web/src/part${i}/**`, `web/tests/part${i}.mjs`, "web/src/common/{a,b}.ts", "!web/src/**/*.test.ts"] }));
  const suite = { shared: ["web/tests/suite.mjs", "web/tests/run.mjs"], groups: [{ parts }] };
  const files = parts.flatMap((_, i) => [`web/src/part${i}/x.ts`, `web/src/part${i}/y.ts`]);
  const Real = globalThis.RegExp;
  let made = 0;
  globalThis.RegExp = new Proxy(Real, { construct: (target, args) => (made++, Reflect.construct(target, args)) });
  try {
    assert.deepEqual(coarse(suite, files), []);
    coarse(suite, files);
  } finally {
    globalThis.RegExp = Real;
  }
  const distinct = new Set([...suite.shared, ...parts.flatMap((p) => p.own)]).size;
  assert.ok(made <= distinct, `made ${made} expressions of ${distinct} patterns, for ${files.length} files of ${parts.length} parts, twice`);
});

test("a harness in web/tests works as one at tests/, its covers from the product's root", async () => {
  const changed = { NERD_CHANGED: "web/src/library/a.ts\n" };
  const { code, outcomes } = await stand(["nested"], changed, "web/tests/run.mjs");
  assert.equal(code, 0);
  assert.deepEqual(outcomes, { "playback › opens": "skipped", "library › opens": "passed" });
  const shared = await stand(["nested"], { NERD_CHANGED: "web/tests/run.mjs\n" }, "web/tests/run.mjs");
  assert.deepEqual(shared.outcomes, { "library › opens": "passed", "playback › opens": "passed" });
});

const apart = (changed: string) => stand(["apart"], { NERD_CHANGED: `${changed}\n` });
const ofApart = (ran: string[]) => Object.fromEntries(["apart › says one file", "apart › says more", "apart › says none", "wide › says its own", "other › says its own"].map((p) => [p, ran.includes(p) ? "passed" : "skipped"]));

test("a change to what a part says runs that part of its group, and the group's others are reported skipped", async () => {
  for (const [file, ran] of [
    ["src/mine.ts", ["apart › says one file", "apart › says more"]],
    ["src/more/deep/a.ts", ["apart › says more"]],
    ["src/wide/a.ts", ["wide › says its own"]],
    ["src/apart/a.ts", ["apart › says none"]],
  ] as const) {
    const { code, outcomes, out } = await apart(file);
    assert.equal(code, 0, out);
    assert.deepEqual(outcomes, ofApart([...ran]), file);
  }
  const some = (await apart("src/more/deep/a.ts")).out;
  assert.ok(some.includes("1 parts in 1 groups") && some.includes("apart (1 of its 3), for src/more/deep/a.ts"), some);
  assert.ok((await apart("src/wide/a.ts")).out.includes("wide, for src/wide/a.ts"), "a group all of whose parts run is named alone");
});

test("a part's file is its own too: a change to it runs every part in it and no other, and what all share runs all", async () => {
  const all = ofApart(Object.keys(ofApart([])));
  assert.deepEqual((await apart("tests/apart/parts.mjs")).outcomes, ofApart(["apart › says one file", "apart › says more", "apart › says none", "wide › says its own"]));
  assert.deepEqual((await apart("tests/apart/other.mjs")).outcomes, ofApart(["other › says its own"]));
  for (const [file, why] of [
    ["src/shared.ts", "which they all share"],
    ["tests/apart/suite.mjs", "which they all share"],
    ["src/nobody.ts", "which no part covers"],
    ["src/more/README.md", "which no part covers"],
    // The group's covers, which its one part put aside: nothing would run for it.
    ["src/wide/b.ts", "which no part covers"],
  ]) {
    const { outcomes, out } = await apart(file);
    assert.deepEqual(outcomes, all, file);
    assert.ok(out.includes(`every group, for ${file}, ${why}`), `${file} in ${out}`);
  }
});

test("a part's covers hold in a suite that goes each, and words and nothing changed run it as ever", async () => {
  const { code, outcomes } = await stand(["apartall"], { NERD_CHANGED: "src/mine.ts\n" });
  assert.equal(code, 0);
  assert.deepEqual(outcomes, { "suite's › says none": "skipped", "suite's › says its own": "passed" });
  assert.deepEqual((await stand(["apartall"], { NERD_CHANGED: "" })).outcomes, { "suite's › says its own": "passed", "suite's › says none": "passed" });
  assert.deepEqual((await stand(["apartall", "says none"], { NERD_CHANGED: "src/mine.ts\n" })).outcomes, { "suite's › says its own": "skipped", "suite's › says none": "passed" });
});

test("a part that says its covers in a group that shares a page is refused, not run with the rest", async () => {
  for (const suite of ["together", "together-each"]) {
    const { code, out, parts } = await stand([suite], { NERD_CHANGED: "src/mine.ts\n" });
    assert.notEqual(code, 0, suite);
    assert.match(out, /shares\.mjs: a part says its covers, and its group shares one page: say `each`/, suite);
    assert.deepEqual(parts, [], suite);
  }
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

test("a part the machine kept past three times its limit passes", async () => {
  const { code, out, one } = await stand(["stalls", "kept past"]);
  assert.equal(code, 0, out);
  assert.equal(one("stalled › is kept past three times its limit").outcome, "passed", out);
});

test("a wait begun on a machine that kept the run is not held to less than the part is", async () => {
  const { code, out, one } = await stand(["stalls", "wait"]);
  assert.equal(code, 0, out);
  assert.equal(one("stalled › waits through a stall").outcome, "passed", out);
});

test("a wait begun before the machine is looked at is not held to less than the part is", async () => {
  const { code, out, one } = await stand(["stalls", "before the machine"]);
  assert.equal(code, 0, out);
  assert.equal(one("stalled › begins a wait before the machine is looked at").outcome, "passed", out);
});

test("a hang the machine kept still fails, saying what it waited for and what was kept", async () => {
  const { code, out, one } = await stand(["stalls", "hangs"]);
  assert.equal(code, 1, out);
  const part = one("stalled › hangs after a stall");
  assert.equal(part.outcome, "failed", out);
  assert.match(part.said!, /still going after [\d.]+s: its 1s limit, stretched as the machine kept it from running [\d.]+s, waiting for locator\('#never'\)/);
});

test("a hang the machine kept to the end of its limit's reach is ended by that limit, not by the wait's own timeout", async () => {
  const { code, out, one } = await stand(["stalls", "long stall"]);
  assert.equal(code, 1, out);
  const part = one("stalled › hangs through a long stall");
  assert.equal(part.outcome, "failed", out);
  assert.match(part.said!, /^still going after [\d.]+s: its 1s limit, stretched as the machine kept it from running [\d.]+s, waiting for locator\('#never'\)/);
});

test("a wait as a page opens is not held to less than the opening is, and a hung opening says what it waited for", async () => {
  const { code, out, one } = await stand(["opening"]);
  assert.equal(code, 1, out);
  assert.equal(one("kept › opens").outcome, "passed", out);
  const hung = /its page did not open: the page was still (?:opening|starting) after (?:[\d.]+s, its limit|[^,]+: its 2s limit, stretched as the machine kept it from running [\d.]+s), /;
  for (const [name, waited] of [
    ["waits › opens", /waiting for locator\('#never'\)/],
    ["starts › opens", /waiting for locator\('#never'\)/],
    ["navigates › opens", /navigating to "[^"]*never"/],
  ] as const) {
    const part = one(name);
    assert.equal(part.outcome, "failed", out);
    assert.match(part.said!, hung, out);
    assert.match(part.said!, waited, out);
  }
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
  const each = await run(["apart", "--list"]);
  assert.match(each.out, /says one file\n\s+why: a stand-in's; covers src\/mine\.ts, tests\/apart\/parts\.mjs\n/);
  assert.match(each.out, /says none\n\s+why: a stand-in's\n/);
});

// What takes no run to judge.

const suite = {
  shared: ["src/shared.ts", "crux/chrome"],
  groups: [
    { name: "one", parts: [{ own: ["src/one/**"] }] },
    { name: "two", parts: [{ own: ["src/{two,three}.ts", "!src/two.ts"] }] },
  ],
};
const names = (changed: string[]) => chooseGroups(suite, changed).chosen.map((c) => c.group.name);

test("chooseGroups: the harness's own files are shared, and patterns read as nerd's", () => {
  assert.deepEqual(names(["src/one/deep/a.ts"]), ["one"]);
  assert.deepEqual(names(["src/three.ts"]), ["two"]);
  assert.deepEqual(names(["crux/chrome/harness.ts"]), ["one", "two"]);
  assert.deepEqual(names(["src/two.ts"]), ["one", "two"], "taken back by !, it is claimed by no group");
  assert.deepEqual(names([]), ["one", "two"]);
  assert.deepEqual(names(["src/one/a.ts", "src/three.ts"]), ["one", "two"]);
});

test("ranOn: of the part's directory, only what a suite runs on; the rest of the root as it was", () => {
  const changed = ["crux/chrome/harness.ts", "crux/chrome/harness.test.mts", "crux/chrome/standin/web/index.html", "crux/chrome/package-lock.json", "crux/chromeless.ts", "src/a.ts"];
  assert.deepEqual(ranOn(changed, "crux/chrome"), ["crux/chrome/harness.ts", "crux/chrome/package-lock.json", "crux/chromeless.ts", "src/a.ts"]);
  assert.deepEqual(ranOn(changed, "../elsewhere"), changed, "a harness outside the root takes nothing of it");
});

test("runsOn: every file of the part's own that the harness imports, and each there", () => {
  for (const name of ["harness.ts", "launch.ts"]) {
    const imports = [...readFileSync(join(here, name), "utf8").matchAll(/^import [^;]*? from "\.\/([^"]+)";/gm)].map((m) => m[1]);
    for (const imported of imports) assert.ok(runsOn.includes(imported), `${name} imports ${imported}, which runsOn leaves out`);
  }
  for (const name of runsOn) assert.ok(existsSync(join(here, name)), name);
});

test("chooseGroups: each part by its own patterns, and only what a part claims is claimed", () => {
  const [wide, narrow, both, took] = [{ own: ["src/a"] }, { own: ["src/a/one.ts"] }, { own: ["src/a/one.ts", "src/b", "!src/b/old.ts"] }, { own: ["src/c.ts"] }];
  const suite = { shared: ["src/shared.ts"], groups: [{ name: "first", parts: [wide, narrow, both] }, { name: "second", parts: [took] }] };
  const parts = (...changed: string[]) => chooseGroups(suite, changed).chosen.flatMap((c) => c.parts);
  const all = [wide, narrow, both, took];
  assert.deepEqual(parts("src/a/one.ts"), [wide, narrow, both]);
  assert.deepEqual(parts("src/a/two.ts"), [wide]);
  assert.deepEqual(parts("src/b/new.ts"), [both]);
  assert.deepEqual(parts("src/a/two.ts", "src/c.ts"), [wide, took], "more than one file, each its parts");
  assert.deepEqual(parts("src/b/new.ts", "src/a/two.ts"), [wide, both], "and in the group's order");
  assert.deepEqual(parts("src/b/old.ts"), all, "taken back by !, it is claimed by no part");
  assert.deepEqual(parts("src/a/two.ts", "src/nobody.ts"), all, "one no part claims, beside one that is");
  assert.deepEqual(parts("src/a/two.ts", "src/shared.ts"), all, "one all share, beside one that is not");
  assert.deepEqual(parts(), all);
  assert.deepEqual(chooseGroups(suite, ["src/c.ts"]).chosen.map((c) => c.group.name), ["second"], "a group with no part called for is not chosen");
});

test("cannotTab: what a tab cannot be", () => {
  const [reader, group, size] = [{ chrome: { reader: true } }, { parts: [{}] }, { width: 390, height: 844 }];
  assert.equal(cannotTab(reader, group), null);
  assert.match(cannotTab({}, group)!, /only a reader's Chrome/);
  assert.match(cannotTab({ chrome: { reader: false } }, group)!, /only a reader's Chrome/);
  assert.match(cannotTab({ ...reader, browser: false }, group)!, /only a reader's Chrome/);
  for (const [suite, of] of [
    [{ ...reader, context: {} }, group],
    [{ ...reader, viewport: size }, group],
    [reader, { ...group, context: {} }],
    [reader, { ...group, viewport: size }],
    [reader, { parts: [{}, { context: {} }] }],
  ] satisfies Parameters<typeof cannotTab>[]) {
    assert.match(cannotTab(suite, of)!, /takes no context or viewport/);
  }
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
  await assert.rejects(stalled, /still going after [\d.]+s: its 0\.01s limit, stretched as the machine kept it from running [\d.]+s/);
  assert.equal(await within(Promise.resolve("done"), 1, "still going", () => 0), "done");
});

test("within: a stall counted just after the limit came still stretches it", async () => {
  // Limit 200 ms, stretched 600 ms, the work done in 400 ms; the thread has not counted the stall at the first look.
  let looks = 0;
  const work = sleep(400, "done");
  assert.equal(await within(work, 0.2, "still going", () => (looks++ < 2 ? 0 : 100)), "done");
});

test("within: a part the machine held past three times its limit, and then let run, ends", async () => {
  // Limit 100 ms, stretched 300 ms and a second kept: the work done at 600 ms, past 300 ms and short of the 1 s at the end.
  const t0 = performance.now();
  const work = sleep(600, "done");
  assert.equal(await within(work, 0.1, "still going", () => (performance.now() - t0 >= 50 ? 1000 : 0)), "done");
});

test("within: what was kept growing as fast as the clock, a hang still fails", async () => {
  const t0 = performance.now();
  await assert.rejects(within(new Promise<void>(() => undefined), 0.02, "still going", () => 10 * (performance.now() - t0)), /still going after/);
});

test("within: a stall counted as the stretched limit comes stretches it further", async () => {
  // Limit 100 ms, counted late, and stretched 340 ms; the work done at 500 ms, the rest counted late at that limit too.
  let looks = 0;
  const work = sleep(500, "done");
  assert.equal(await within(work, 0.1, "still going", () => (looks++ < 2 ? 0 : looks < 5 ? 40 : 700)), "done");
});

test("reach: the limit alone on a machine that kept nothing, then three times it and what was kept, up to its end", () => {
  assert.equal(reach(30, 0), 30_000);
  assert.equal(reach(30, STALLED - 1), 30_000);
  assert.equal(reach(30, STALLED), 30_000 * STRETCH + STALLED);
  assert.equal(reach(30, 60_000), 150_000);
  assert.equal(reach(30, 30_000 * (FURTHEST - STRETCH)), 30_000 * FURTHEST);
  assert.equal(reach(30, 3_600_000), 30_000 * FURTHEST);
});

test("counted: only once the thread has gone round twice, as its first turn from here may have read the clock before", async () => {
  await counted(null);
  const turns = new Int32Array(new SharedArrayBuffer(8));
  turns[1] = 7;
  let done = false;
  const waiting = counted(turns).then(() => (done = true));
  const round = async () => {
    await sleep(5); // room to end too soon, where it would
    assert.equal(done, false);
    Atomics.add(turns, 1, 1);
  };
  await round();
  await round();
  await waiting;
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

// As many as there are, as many wait on one run: `stand` counts what runs.
describe("side by side", { concurrency: cases.length }, () => {
  for (const [name, fn] of cases) one(name, fn);
});
