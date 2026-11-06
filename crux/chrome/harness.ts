// A test of pages made of many parts (crux#118), the generic half of synth-exp's runner and what zx-spectrum's came to:
// nothing of a product here. A product's runner says where its suites are, and each suite is a directory: suite.mjs says
// how its pages open and what a part must leave as it found it, and every other .mjs in it is a group of parts.
//
//   // tests/run.mjs, or web/tests/run.mjs, run as `npx tsx tests/run.mjs SUITE` from a test in nerd.toml
//   import { run } from "../crux/chrome/harness.ts";
//   await run({ root: new URL("..", import.meta.url), tests: new URL(".", import.meta.url) });
//
//   // tests/SUITE/suite.mjs
//   import { vite } from "../../crux/chrome/harness.ts";
//   export default { limit: 10, serve: vite(createServer, { root: "web" }), open: (page, base) => page.goto(base) };
//
//   // a suite whose Chrome is a reader's, in its suite.mjs or as the default of a runner's suites: what launch takes
//   export default { chrome: { reader: true }, open: (page, base) => page.goto(base) };
//
//   // tests/SUITE/library.mjs
//   import { group } from "../../crux/chrome/harness.ts";
//   const test = group("library", { covers: ["web/src/library"], why: "what a person does with it" });
//   test("a search narrows the list", async ({ page }) => { ... });
//
//   // a part of an `each` group that tests other files than its group: it says them, in place of the group's
//   test("the tape deck plays", { covers: ["web/src/tape"] }, async ({ page }) => { ... });
//
//   // a suite whose parts are each a reader's tab, as a test of what a page sends as it is hidden needs
//   export default { chrome: { reader: true }, tab: true, each: true, open: (page, base) => page.goto(base) };
//   test("its load is sent as it is hidden", async ({ page }) => { const over = await hide(page); ... }); // launch's hide
//
//   tests/run.mjs SUITE [words…] [--seed N] [--list]
//
// - words: only the parts whose group and title have every one of them.
// - Without words, NERD_CHANGED chooses the parts that cover what changed, each by its group's covers, or by its own where
//   it says them, and always its file; a change to what every group shares, or to a file no part claims, runs them all,
//   and those not run are reported skipped. A suite's `granular` fails instead where a file that is there would run too much.
//   A suite's `narrow` says what a change to a file stands for, read against NERD_BASE: a list of imports runs for its lines.
//   Of the harness's own directory, what every group shares is `runsOn`; the rest, the part's own tests, stands for nothing.
// - One Chrome for the run. Each group starts on a fresh page in a context of its own, or each part does (`each`). A page
//   a part failed on, or left otherwise than it found it, is closed, and the next part starts on a fresh one.
// - Groups, and the parts in each, go in an order shuffled from a seed the run says, to run it again.
// - Groups run side by side (`parallel`, four when not said), the longest first by NERD_USUAL, a part not timed yet by
//   its limit, in one process. A group that says `alone` runs first, with nothing beside it.
// - A group that says `tab` opens a tab of a reader's Chrome, in the context it starts with, which the rest of its suite
//   may run beside. Those tabs share a window, and only one of them is shown, so they go one at a time, of the four side
//   by side; a tab, and what it opened, is closed where a page would be, and its context's routes go with it. The context
//   stays, with its cookies and storage: what a part leaves there is the next tab's.
// - What a suite's module keeps for the group running, as its page, it takes from `current()`.
// - An error thrown in a page or written to its console fails the part it came in, in any page of the part's context.
// - Each part is held to a limit of its own, seconds, its suite's unless it says. On a machine that kept the run from
//   running it has three times that and all the machine kept from it, up to ten times its limit, where one that hangs
//   on a busy machine still fails. A wait on the page ends with the part, saying what it waited for.
// - A page's opening is held to `opening`, seconds, in the same way, and says what it waited for where it ran out.
// - A judgment of real time (`inTime`) that fails while the machine kept the run from running is inconclusive, and fails
//   nothing: it measured the machine.
// - Each part is reported as it ends, in the file NERD_REPORT names. The options a suite can say are `Options`, below;
//   a runner's are the defaults of all its suites, and suite.mjs says what is its own.

import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { Browser, BrowserContext, BrowserContextOptions, ConsoleMessage, Page, Request, Route, WebError } from "playwright-core";
import { launch, type Options as ChromeOptions } from "./launch.ts";

type Fulfilled = NonNullable<Parameters<Route["fulfill"]>[0]>;

/** What answers a request to another server: `url`, as `page.route` takes it, and how Playwright's `route.fulfill` is
 * told to answer, or `answer`, which says that for each request. A `path` is read from the suite's directory. */
export type Recording = Fulfilled & { url: string | RegExp; answer?: (request: Request) => Fulfilled | Promise<Fulfilled> };

/** What a part is given: its page (null in a suite with no browser), that page's context, the Chrome of the run, and
 * the address its pages are served at. */
export type Here = { page: Page; context: BrowserContext; browser: Browser; base: string };

type Served = { base: string; close: () => unknown };

export type Options = {
  /** How many seconds a part may take, unless it says: 10 when not given. */
  limit?: number;
  /** How many seconds a page may take to open, a limit that stretches as a part's does: 60 when not given. */
  opening?: number;
  /** How many groups run side by side: 4 when not given. */
  parallel?: number;
  /** Files every group shares, from the root: a change to one runs them all. */
  shared?: string[];
  /** What a change to a file stands for, by the file's path from the root: given it as it was at NERD_BASE (null where it
   * was not there) and as it is (null where it is gone), the files whose parts run in its place, or null for what its
   * claim or `shared` says. A shared file each of whose lines stands for one file, as a list of imports, runs only for
   * the lines that changed (crux#195). Where nerd gives no NERD_BASE, or one git cannot read, nothing stands for another. */
  narrow?: Record<string, (was: string | null, now: string | null) => string[] | null>;
  /** Holds the suite to run only what a change touches (crux#168): every file `files` says, patterns as nerd.toml's, is
   * claimed by a part or shared, and none but what is shared has more than `most` of the parts run for it, a quarter when
   * not said. Each is judged before Chrome starts, by what a change would run and not by how long that takes, and a run
   * that breaks one fails. */
  granular?: { files: string[]; most?: number };
  /** Starts what serves the pages, on a port it chooses, never one written down: `vite` for a dev server. */
  serve?: () => Promise<Served>;
  /** The page made ready, before each group's parts, or each part's. */
  open?: (page: Page, base: string) => unknown;
  /** Says how the page stands, after it opens, for `neutral`. */
  start?: (page: Page) => unknown;
  /** What a part left otherwise than `start` found it, a line each: none where it left all as it found it. */
  neutral?: (page: Page, start: unknown) => string[] | Promise<string[]>;
  /** What `neutral` looks after, in what a failure says. */
  neutralName?: string;
  viewport?: { width: number; height: number };
  /** The rest of what a context is made with. */
  context?: BrowserContextOptions;
  /** The page's console warnings fail a part too, not only its errors. */
  warnings?: boolean;
  /** Each part on a fresh page of its own, not one page for the group: then each part is run side by side. */
  each?: boolean;
  /** What the page asks of other servers: where a suite says this, what none of them answers fails the part. */
  recordings?: Recording[];
  /** No Chrome: its parts open their own, or none. */
  browser?: false;
  /** How launch starts Chrome, as `args` or `reader`. */
  chrome?: ChromeOptions;
  /** A tab of a reader's first context, not a context of its own: the only page launch's `hide` can hide. */
  tab?: boolean;
};

type GroupOptions = Pick<Options, "open" | "viewport" | "context" | "warnings" | "each" | "tab"> & {
  /** The files its parts test, from the root, patterns as nerd.toml's: a change to one has them run, but for a part that says its own. */
  covers?: string[];
  /** Why its parts need a browser, where each would say the same. */
  why?: string;
  /** What `open` made, put away, after its parts. */
  close?: () => unknown;
  /** Runs first, with nothing beside it, as what judges real time does. */
  alone?: boolean;
};

type PartOptions = {
  why?: string;
  limit?: number;
  /** Patterns of what the part makes the page say on purpose: whatever else it says fails it, as always. */
  reports?: RegExp[];
  /** The context of a part of an `each` group, over its suite's and group's. */
  context?: BrowserContextOptions;
  /** The files a part of an `each` group tests, in place of its group's: a change to one runs it, and not the group's other parts. */
  covers?: string[];
};

type Fn = (here: Here) => unknown;
type Part = { title: string; why: string; limit?: number; reports: RegExp[]; context?: BrowserContextOptions; covers?: string[]; own: string[]; fn: Fn };
type Group = GroupOptions & { name: string; file: string; covers: string[]; own: string[]; parts: Part[] };
type Suite = Options & { name: string; dir: string; shared: string[]; part: string; groups: Group[] };

/** The files of the harness's own directory that a suite runs on: itself, launch, which it imports, and what installs
 * their one dependency. The rest of the part, its own tests and their stand-ins, are its own test's, and run none of a
 * product's parts: a change to them alone stands for nothing, however wide the covers that gave it (crux#201). */
export const runsOn = ["harness.ts", "launch.ts", "ready.sh", "package.json", "package-lock.json"];

/** `changed`, less the files of the part at `part` (its directory from the root) that no suite runs on. */
export function ranOn(changed: string[], part: string): string[] {
  if (!part || part.startsWith("..")) return changed;
  return changed.filter((file) => !file.startsWith(`${part}/`) || runsOn.includes(file.slice(part.length + 1)));
}
type Unit = { group: Group; parts: Part[] };

const places = new AsyncLocalStorage<Here>();
/** The page, its context and the rest of the part running here, for what a suite's module cannot be handed: groups run
 * side by side in one process, so a module that kept the page in a variable would have the last group's. */
export const current = (): Here => {
  const here = places.getStore();
  if (!here) throw new Error("current() outside a part");
  return here;
};

/** The file being read, and the groups read: a group belongs to the file that made it. */
let reading: string | null = null;
const registered: Group[] = [];

/** A group of parts, in the file that calls it. Gives its `test`: test(title, { why, limit, reports, context, covers }, fn), or
 * test(title, fn) where the group says why, and fn takes what `Here` says and may give a line to say beside its ok. */
export function group(name: string, options: GroupOptions = {}) {
  const file = reading;
  if (!file) throw new Error(`group "${name}" made outside a suite's file: the harness reads each .mjs in a suite's directory`);
  const made: Group = { ...options, name, file, covers: options.covers ?? [], own: [], parts: [] };
  registered.push(made);
  return function test(title: string, given: PartOptions | Fn, fn?: Fn) {
    const options = typeof given === "function" ? {} : given;
    const run = typeof given === "function" ? given : fn!;
    const why = options.why ?? made.why;
    if (!why) throw new Error(`${file}: "${title}" does not say why it needs a browser ({ why: "…" }). If it does not need one, it is a unit test.`);
    if (made.parts.some((p) => p.title === title)) throw new Error(`${file}: two parts called "${title}"`);
    made.parts.push({ title, why, limit: options.limit, reports: options.reports ?? [], context: options.context, covers: options.covers, own: [], fn: run });
  };
}

/** Why a group cannot be on a tab, where it cannot: said, as it would otherwise run on something else than it says. */
export function cannotTab(suite: Options, group: Pick<Options, "context" | "viewport"> & { parts: { context?: BrowserContextOptions }[] }): string | null {
  if (!suite.chrome?.reader || suite.browser === false) return "its group is on a tab, which only a reader's Chrome has: say `chrome: { reader: true }`";
  const said = suite.context ?? suite.viewport ?? group.context ?? group.viewport ?? group.parts.find((p) => p.context);
  return said ? "its group is on a tab, of a context Chrome made, which takes no context or viewport: say it to the page" : null;
}

/** A suite's options and groups, read from `dir`. `shared` gets what every group runs on. */
async function load(name: string, dir: string, root: string, defaults: Options, runner: string): Promise<Suite> {
  const fromRoot = (file: string) => relative(root, file).split("\\").join("/");
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();
  if (!files.includes("suite.mjs")) throw new Error(`${dir} has no suite.mjs`);
  const options: Options = { ...defaults, ...(await import(pathToFileURL(join(dir, "suite.mjs")).href)).default };
  const groups: Group[] = [];
  for (const file of files.filter((f) => f !== "suite.mjs")) {
    reading = join(dir, file);
    await import(pathToFileURL(reading).href);
    const read = registered.splice(0);
    if (!read.length) throw new Error(`${reading} registers no group: a file in a suite is a group of parts, or its suite.mjs`);
    for (const g of read) {
      const file = fromRoot(g.file);
      for (const p of g.parts) p.own = [...(p.covers ?? g.covers), file];
      groups.push({ ...g, own: [...g.covers, file] });
    }
  }
  reading = null;
  for (const [i, g] of groups.entries()) {
    if (groups.findIndex((other) => other.name === g.name) !== i) throw new Error(`${g.file}: two groups called "${g.name}"`);
    const shares = !(g.each ?? options.each);
    if (shares && g.parts.some((p) => p.context)) throw new Error(`${g.file}: a part says its context, and its group shares one page: say \`each\``);
    if (shares && g.parts.some((p) => p.covers)) throw new Error(`${g.file}: a part says its covers, and its group shares one page: say \`each\``);
    const refused = (g.tab ?? options.tab) && cannotTab(options, g);
    if (refused) throw new Error(`${g.file}: ${refused}`);
  }
  const shared = [...(options.shared ?? []), fromRoot(join(dir, "suite.mjs")), ...runsOn.map((f) => fromRoot(join(import.meta.dirname, f))), fromRoot(runner)];
  return { ...options, name, dir, shared, part: fromRoot(import.meta.dirname), groups };
}

const short = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(", ")} and ${list.length - 3} more` : list.join(", "));

/** The parts `changed` (the changed files a test covers, as nerd gives them) call for, by group, and why: those that
 * cover one of them; all of them for a file every group shares, or one no part claims, which is said, so that it is given
 * to the parts that test it. Nothing changed: all of them. */
export function chooseGroups<G extends { name: string; parts: { own: string[] }[] }>(suite: { shared: string[]; groups: G[] }, changed: string[]) {
  const whole = suite.groups.map((group) => ({ group, parts: group.parts as G["parts"] }));
  if (!changed.length) return { chosen: whole, because: "every group" };
  const everyone = changed.filter((p) => covered(suite.shared, p));
  const nobody = changed.filter((p) => !covered(suite.shared, p) && !suite.groups.some((g) => g.parts.some((part) => covered(part.own, p))));
  if (everyone.length) return { chosen: whole, because: `every group, for ${short(everyone)}, which they all share` };
  if (nobody.length) return { chosen: whole, because: `every group, for ${short(nobody)}, which no part covers: give it to the parts that test it (in their covers, or their group's)` };
  const chosen = whole.map((c) => ({ ...c, parts: c.parts.filter((part) => changed.some((p) => covered(part.own, p))) as G["parts"] })).filter((c) => c.parts.length);
  const said = chosen.map(({ group, parts }) => (parts.length < group.parts.length ? `${group.name} (${parts.length} of its ${group.parts.length})` : group.name));
  return { chosen, because: `${said.join(", ")}, for ${short(changed)}` };
}

/** `changed` with each file `narrow` names in place of what it says the file's change stands for, a file it gives null
 * for left as it is; `was` reads a file as it was at the base, null where it was not there. */
export function standsFor(changed: string[], narrow: Options["narrow"], was: (file: string) => string | null, now: (file: string) => string | null): string[] {
  const files = changed.flatMap((file) => (narrow?.[file] ? (narrow[file](was(file), now(file)) ?? [file]) : [file]));
  return [...new Set(files)];
}

/** A file of the root's as it was at `base`, by git: null where it was not there. Undefined where git cannot read `base`
 * itself, which then narrows nothing. */
function atBase(root: string, base: string | undefined): ((file: string) => string | null) | undefined {
  const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (!base || git("cat-file", "-e", `${base}^{commit}`).status !== 0) return undefined;
  return (file) => {
    const shown = git("show", `${base}:./${file}`);
    return shown.status === 0 ? shown.stdout : null;
  };
}

/** The files under `root` that `patterns` take, by their paths from there, what is built or installed left out. */
export function claimable(root: string, patterns: string[]): string[] {
  const walk = (from: string): string[] =>
    readdirSync(join(root, from), { withFileTypes: true }).flatMap((entry) => {
      const path = from ? `${from}/${entry.name}` : entry.name;
      if (!entry.isDirectory()) return [path];
      return ["node_modules", "target", ".git", "build", ".gradle"].includes(entry.name) ? [] : walk(path);
    });
  return walk("").filter((path) => covered(patterns, path));
}

/** What keeps a suite from running only what a change touches, a line each: of `files`, one neither shared nor claimed
 * by a part, and one not shared that more than `most` of the parts claim. */
export function coarse(suite: { shared: string[]; groups: { parts: { own: string[] }[] }[] }, files: string[], most = 0.25): string[] {
  const parts = suite.groups.flatMap((g) => g.parts);
  return [...new Set(files)].flatMap((file) => {
    if (covered(suite.shared, file)) return [];
    const claims = parts.filter((p) => covered(p.own, file)).length;
    if (!claims) return [`${file} is claimed by no part: name it in the covers of the parts that test it`];
    if (claims > parts.length * most) return [`${file} runs ${claims} of the ${parts.length} parts, more than ${Math.floor(most * 100)}%: split what holds them, or say it is shared`];
    return [];
  });
}

/** A generator of numbers in [0, 1) from a seed (mulberry32). */
function numbers(from: number) {
  let a = from >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const hash = (text: string) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** The groups chosen in an order from the seed. Each group's parts are in an order from the seed and its name alone, so
 * that one group run again, or the parts with some words, go in the order they went among the rest. */
export function ordered<U extends { group: { name: string; parts: P[] }; parts: P[] }, P>(chosen: U[], seed: number): U[] {
  return shuffled(chosen, numbers(seed)).map((c) => {
    const all = shuffled(c.group.parts, numbers(seed ^ hash(c.group.name)));
    return { ...c, parts: all.filter((p) => c.parts.includes(p)) };
  });
}

/** The units in the order side by side hands them out: the longest first, so that the last to end ends soonest. A part
 * is as long as it usually takes (`usual`, seconds by "<group> › <title>", as nerd hands them over); one not timed yet
 * as long as its limit (`limitOf`), which puts its group early. */
export function longestFirst<P extends { title: string }, U extends { group: { name: string }; parts: P[] }>(units: U[], usual: Record<string, number>, limitOf: (part: P) => number): U[] {
  const length = (u: U) => u.parts.reduce((s, p) => s + (usual[`${u.group.name} › ${p.title}`] ?? limitOf(p)), 0);
  return [...units].sort((a, b) => length(b) - length(a));
}

// --- The machine ---------------------------------------------------------------------------------------------------

/** A judgment of real time that did not hold: such a part measures the machine as well as the code. Failed while the
 * machine kept the run from running, it is inconclusive; failed on a machine that kept nothing from it, it fails. */
export class RealTime extends Error {}

/** `assert`, for a judgment of real time. */
export function inTime(cond: unknown, message: string) {
  if (!cond) throw new RealTime(message);
}

/** Thrown by a part that cannot run here, as one whose fixture cannot be had: reported skipped, with why. */
export class Skip extends Error {}

/** How long, in ms, the run may be kept from running before a judgment of real time it fails is inconclusive: synth-exp's
 * tightest margin, an event stamped 30 ms from now. A part on a quiet machine is kept a few ms. */
export const STALLED = 30;

/** How far a limit stretches at once on a machine that kept a part from running: with every core busy a chip also runs
 * slower, which no count sees. What the machine kept from it comes on top (`reach`). */
export const STRETCH = 3;

/** How far a limit stretches at its most: a page spinning on a busy machine keeps its own run waiting, so what was kept
 * grows as fast as the clock, and this is the end of it. zx-spectrum's web-page at 18:15 on Oct 31, waiting 76% of its
 * 8m33s, took 11 times what it takes on a quiet machine, which a part within its limit there would have just done. */
export const FURTHEST = 10;

/** How long, in ms, a limit of `seconds` gives a part the machine has kept from running for `waited` ms. */
export function reach(seconds: number, waited: number): number {
  const limit = seconds * 1000;
  return waited < STALLED ? limit : Math.min(limit * STRETCH + waited, limit * FURTHEST);
}

/** What this run has waited for a CPU, in ms: Linux's pressure stall information for its cgroup, which holds what nerd's
 * scope holds, its Chrome too. Null where the system does not say. */
function cpuWaited(): number | null {
  try {
    const cgroup = /^0::(.*)$/m.exec(readFileSync("/proc/self/cgroup", "utf8"))?.[1];
    const pressure = readFileSync(`/sys/fs/cgroup${cgroup}/cpu.pressure`, "utf8");
    return Number(/^some .*total=(\d+)/m.exec(pressure)![1]) / 1000;
  } catch {
    return null;
  }
}

/** What this process has overslept, in ms, and the turns taken at counting it, by the thread `watch` starts. */
let overslept: Int32Array | null = null;

/** Starts a thread that sleeps 10 ms at a time and counts what it overslept. A stall, as `nerd test --stalls` makes one
 * and a frozen machine does, holds a process with nothing waiting for a CPU, so the pressure above never sees it; and a
 * thread of its own is not late for what a part's synchronous code keeps the main thread from. */
function watch() {
  overslept = new Int32Array(new SharedArrayBuffer(8));
  const counts = `
    const { workerData: overslept } = require("node:worker_threads");
    const idle = new Int32Array(new SharedArrayBuffer(4));
    for (let from = performance.now(); ; ) {
      Atomics.wait(idle, 0, 0, 10);
      const now = performance.now();
      const late = now - from - 10;
      from = now;
      if (late >= 5) Atomics.add(overslept, 0, Math.round(late));
      Atomics.add(overslept, 1, 1);
    }`;
  new Worker(counts, { eval: true, workerData: overslept, execArgv: [] }).unref();
}

/** Once the thread has counted all that has kept this run so far: what wakes a part as a stall ends may wake ahead of
 * it, by as long as a busy machine likes. It counts a turn after it read the clock, so the first turn from here may have
 * read it before now, and the second has not. */
export async function counted(turns = overslept) {
  if (!turns) return;
  const from = Atomics.load(turns, 1);
  while (Atomics.load(turns, 1) - from < 2) await sleep(1); // the thread looked for, not a wait
}

/** How long, in ms, this run has been kept from running, all told. */
const kept = () => (cpuWaited() ?? 0) + (overslept?.[0] ?? 0);

/** How long something took, as nerd says it: 1.9s, 24s, 3m05s. */
export function took(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

/** What `within` fails with: past its limit. */
export class Overran extends Error {}

/** `work`, or a failure once it has had `seconds`, or as far as `reach` takes that where the machine has kept the run
 * from running since it began. What `work` does after that is left to it. */
export function within<T>(work: Promise<T>, seconds: number, what: string, waited: () => number = kept): Promise<T> {
  let timer: NodeJS.Timeout;
  work.catch(() => undefined);
  const from = waited();
  const t0 = performance.now();
  let looked = false;
  let settled = false;
  const late = new Promise<never>((_, reject) => {
    const look = () => {
      const stalled = waited() - from;
      const ran = performance.now() - t0;
      const left = reach(seconds, stalled) - ran;
      if (left > 0) {
        looked = false;
        timer = setTimeout(look, Math.min(left, 250)); // the limit, looked at again as the machine may stretch it
      } else if (!looked) {
        looked = true;
        void counted().then(() => settled || look()); // a stall that ended just now
      } else if (stalled >= STALLED) reject(new Overran(`${what} after ${took(ran)}: its ${seconds}s limit, stretched as the machine kept it from running ${took(stalled)}`));
      else reject(new Overran(`${what} after ${seconds}s, its limit`));
    };
    timer = setTimeout(look, seconds * 1000); // the limit, not a wait
  });
  return Promise.race([work, late]).finally(() => {
    settled = true;
    clearTimeout(timer);
  });
}

/** What became of a part that threw `failure` (null: nothing) while the run was kept from running for `waited` ms. */
export function verdict(failure: Error | null, waited: number): "passed" | "failed" | "inconclusive" | "skipped" {
  if (!failure) return "passed";
  if (failure instanceof Skip) return "skipped";
  return failure instanceof RealTime && waited >= STALLED ? "inconclusive" : "failed";
}

// --- Patterns of paths, as nerd matches them -------------------------------------------------------------------------

/** A pattern made a regular expression, as nerd makes it: * is any part of one name, ** any part of the path, ? one
 * character, {a,b} either, a directory covers what is in it, and ! takes back what the patterns before it took. */
function glob(given: string) {
  let p = given.trim();
  const back = p.startsWith("!");
  if (back) p = p.slice(1);
  p = p.replace(/^\.\//, "").replace(/^\//, "");
  let re = "^";
  let open = 0;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (p.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (p.startsWith("**", i)) {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      open++;
      re += "(?:";
    } else if (c === "}" && open > 0) {
      open--;
      re += ")";
    } else if (c === "," && open > 0) re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return { re: new RegExp(`${re}(?:/.*)?$`), back };
}

/** Each pattern made once (crux#204): a whole run of a suite of 267 parts asks `covered` of every file for every part,
 * and making each pattern again on every call spent 7.5 s of synth-exp's before Chrome started. */
const made = new Map<string, ReturnType<typeof glob>>();
const compiled = (given: string) => {
  let one = made.get(given);
  if (!one) made.set(given, (one = glob(given)));
  return one;
};

/** Whether `patterns` cover `path`: the last of them that matches it says. */
export function covered(patterns: string[], path: string): boolean {
  let yes = false;
  for (const given of patterns) {
    const { re, back } = compiled(given);
    if (re.test(path)) yes = !back;
  }
  return yes;
}

// --- What a part uses ------------------------------------------------------------------------------------------------

/** Stops the page's clock a moment ahead of where it is, once `page.clock.install` has given the test that clock. On a
 * busy machine the clock can pass that moment before the pause arrives, and pauseAt refuses a time gone by, so it is
 * asked again from where the clock is then: the pause waits on no wall clock. */
export async function pause(page: Page) {
  for (;;) {
    try {
      return await page.clock.pauseAt(await page.evaluate<number>("Date.now() + 500"));
    } catch (e) {
      if (!/to the past/.test((e as Error).message)) throw e;
    }
  }
}

/** `serve`, by Vite's createServer, which the product depends on: on a port of its own, as the product's other clones
 * run the same test at once, read from what the server says; and neither watching files nor reloading the page, as a
 * file another session saves must not reload a part's page. */
export function vite(createServer: (config: any) => Promise<any>, config: { server?: object; [key: string]: unknown } = {}) {
  return async (): Promise<Served> => {
    const server = await createServer({ logLevel: "error", ...config, server: { ...config.server, port: 0, strictPort: false, watch: null, hmr: false } });
    await server.listen();
    return { base: server.resolvedUrls.local[0], close: () => server.close() };
  };
}

/** A context whose every request to another server than `base`'s is answered from `recordings`, the first that matches,
 * and whose others are refused and said, as a test of the page is not one of the network. A part's own `page.route`
 * comes before these, and can let one through. */
async function answerFrom(context: BrowserContext, base: string, recordings: Recording[], dir: string, said: string[]) {
  const origin = base && new URL(base).origin;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin) return route.fallback();
    said.push(`it asked ${url}, which no recording answers`);
    return route.abort();
  });
  // Playwright tries the route added last first.
  for (const { url, answer, ...fulfilled } of [...recordings].reverse()) {
    await context.route(url, async (route) => {
      const how = answer ? await answer(route.request()) : fulfilled;
      await route.fulfill(how.path && !isAbsolute(how.path) ? { ...how, path: join(dir, how.path) } : how);
    });
  }
}

/** What a part stopped at its limit was waiting for, from the wait's own failure as `closing` takes its page away: its
 * log, under "Call log:" or a line of its own as a wait for an event writes it, or which call it was, for one with none. */
async function waitedFor(work: Promise<unknown>, closing: () => Promise<void>): Promise<string> {
  await closing();
  const ended = await Promise.race([work.then(() => null, (e: Error) => e), sleep(1000, null)]);
  const waiting = ended?.message.match(/^\s*(?:- )?((?:waiting for|navigating to) .*)$/m)?.[1];
  const call = ended?.message.match(/^(\w+\.\w+): /)?.[1];
  return waiting ? `, ${waiting}` : call ? `, in ${call}` : "";
}

// --- Running a suite -------------------------------------------------------------------------------------------------

type Result = { label: string; outcome: ReturnType<typeof verdict>; ms: number; message?: string };

const asPath = (at: string | URL) => (at instanceof URL || at.startsWith("file:") ? fileURLToPath(at) : at);

/** A runner of a product's suites: `root` is what every path in a group's covers is written from, and each directory
 * of `tests` with a suite.mjs is a suite. The rest are the defaults of every suite. Exits, 1 where a part failed. */
export async function run({ root: rootAt, tests, ...defaults }: Options & { root: string | URL; tests: string | URL }): Promise<never> {
  const root = asPath(rootAt);
  const runner = process.argv[1];
  const args = process.argv.slice(2);
  const take = (flag: string, value: boolean) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    return args.splice(i, value ? 2 : 1)[value ? 1 : 0];
  };
  const listing = take("--list", false) !== undefined;
  const given = take("--seed", true);
  const [name, ...words] = args;
  if (!name) {
    console.error("tests/run.mjs SUITE [words…] [--seed N] [--list]: run through nerd test");
    process.exit(2);
  }
  if (!listing && !process.env.NERD_TEST) {
    console.error(`Tests run through nerd: \`nerd test ${name}\`. It holds them to their limits and keeps their times.`);
    process.exit(2);
  }

  const suite = await load(name, join(asPath(tests), name), root, defaults, runner);
  const limitOf = (p: Part) => p.limit ?? suite.limit ?? 10;
  const parallel = suite.parallel ?? 4;

  if (listing) {
    const count = suite.groups.reduce((n, g) => n + g.parts.length, 0);
    console.log(`${name}: ${suite.groups.length} groups, ${count} parts; a part may take ${suite.limit ?? 10}s unless it says`);
    for (const g of suite.groups) {
      console.log(`\n${g.name}  (covers ${g.own.join(", ")})`);
      for (const p of g.parts) console.log(`  ${p.title}\n      why: ${p.why}${p.limit ? `; limit ${p.limit}s` : ""}${p.covers ? `; covers ${p.own.join(", ")}` : ""}`);
    }
    process.exit(0);
  }

  // What changed, as nerd gives it (only the changed files this test covers: none, when it is to run whole), each file the
  // suite narrows in place of what its change stands for, and none of the harness's own that it does not run on.
  const told = (process.env.NERD_CHANGED ?? "").split("\n").filter(Boolean);
  const was = suite.narrow && told.some((file) => suite.narrow![file]) ? atBase(root, process.env.NERD_BASE) : undefined;
  const now = (file: string) => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null);
  const changes = ranOn(was ? standsFor(told, suite.narrow, was, now) : told, suite.part);
  if (changes.join("\n") !== told.join("\n")) console.log(`${name}: what changed stands for ${changes.length ? short(changes) : "nothing"}, of ${short(told)}.`);

  // Whether what a change touches is all it runs: asked before anything starts, as it says what is wrong with the suite.
  if (suite.granular && !words.length) {
    // A file a change removed is claimed by nothing and is no fault: it runs all, as chooseGroups says.
    const changed = changes.filter((file) => existsSync(join(root, file)));
    const wrong = coarse(suite, ranOn([...claimable(root, suite.granular.files), ...changed], suite.part), suite.granular.most);
    if (wrong.length) {
      const said = `${name} runs more than a change touches:\n${wrong.map((line) => `  ${line}`).join("\n")}`;
      if (process.env.NERD_REPORT) writeFileSync(process.env.NERD_REPORT, `${JSON.stringify({ part: "granular", seconds: 0, outcome: "failed", said: wrong.join("; ") })}\n`);
      console.error(said);
      process.exit(1);
    }
  }

  // Which parts.
  let chosen: Unit[] = suite.groups.map((group) => ({ group, parts: group.parts }));
  let because = "every group";
  if (words.length) {
    const has = (g: Group, p: Part) => words.every((w) => `${g.name} ${p.title}`.toLowerCase().includes(w.toLowerCase()));
    chosen = chosen.map((c) => ({ ...c, parts: c.parts.filter((p) => has(c.group, p)) })).filter((c) => c.parts.length);
    if (!chosen.length) {
      console.log(`No part of ${name} has the words "${words.join(" ")}". Its groups: ${suite.groups.map((g) => g.name).join(", ")}.`);
      process.exit(1);
    }
    because = `the parts with "${words.join(" ")}"`;
  } else {
    const narrowed = told.length && !changes.length ? { chosen: [], because: "nothing, for what changed stands for nothing" } : chooseGroups(suite, changes);
    chosen = narrowed.chosen;
    because = narrowed.because;
  }

  // In what order, and in what units: a group that shares a page goes as one, and one that does not, part by part.
  const seed = given !== undefined ? Number(given) : Math.floor(Math.random() * 100000);
  const units = ordered(chosen, seed).flatMap((c) => ((c.group.each ?? suite.each) ? c.parts.map((p) => ({ group: c.group, parts: [p] })) : [c]));
  const tabs = units.filter((u) => (u.group.tab ?? suite.tab) && !u.group.alone);
  const free = units.filter((u) => !tabs.includes(u));
  const sideBySide = Math.min(parallel, free.length + Math.min(tabs.length, 1));

  const report = process.env.NERD_REPORT;
  const part = (label: string, seconds: number, outcome: string, said?: string) => {
    const line = { part: label, seconds: Math.round(seconds * 100) / 100, outcome, ...(said ? { said: said.replace(/\s*\n\s*/g, " ") } : {}) };
    if (report) appendFileSync(report, `${JSON.stringify(line)}\n`);
  };
  if (report) writeFileSync(report, "");
  for (const g of suite.groups) for (const p of g.parts) if (!units.some((u) => u.parts.includes(p))) part(`${g.name} › ${p.title}`, 0, "skipped");
  const count = units.reduce((n, u) => n + u.parts.length, 0);
  const alone = units.filter((u) => u.group.alone).map((u) => u.group.name);
  console.log(`${name}: ${count} parts in ${chosen.length} groups${sideBySide > 1 ? `, ${sideBySide} at a time${alone.length ? ` (${alone.join(", ")} first, alone)` : ""}${tabs.length ? ", one of them a reader's tab" : ""}` : ""}: ${because}. Seed ${seed} (\`nerd test ${process.env.NERD_TEST ?? name} -- --seed ${seed}\` runs each group's parts in this order again).`);
  if (!count) process.exit(0);

  // A part stopped at its limit may fail later, on its own, on a page closed by then.
  process.on("unhandledRejection", () => undefined);
  watch();

  const served = suite.serve ? await suite.serve() : null;
  const base = served?.base ?? "";
  const browser = suite.browser === false ? null : await launch(suite.chrome);

  const results: Result[] = [];
  const began = performance.now();

  /** A unit's parts, in their order, on a fresh page, and on another after a part that failed or left it changed. */
  async function runUnit({ group, parts }: Unit) {
    const here = { page: null, context: null, browser, base } as unknown as Here;
    /** Takes away what `fresh` made. */
    let away: (() => Promise<unknown>) | null = null;
    let start: unknown = null;
    let errors: string[] = [];
    /** Tells a wait on the page to wait past where a limit of `seconds` can stretch, as it is told its timeout as it begins,
     * before the machine can be looked at, and cannot be told more of what is kept after: the limit itself ends it, and
     * `waitedFor` says what it was. */
    const waitsPast = (seconds: number) => here.context?.setDefaultTimeout(seconds * (FURTHEST + 1) * 1000);
    const closing = async () => {
      await (away ? within(away(), 10, "the page was still closing") : null)?.catch(() => undefined);
      away = null;
      here.page = here.context = null as never;
    };
    const fresh = async () => {
      await closing();
      if (browser) {
        const tab = group.tab ?? suite.tab;
        const context = tab
          ? browser.contexts()[0]
          : await browser.newContext({
              viewport: group.viewport ?? suite.viewport ?? { width: 1280, height: 800 },
              ...suite.context,
              ...group.context,
              ...(parts.length === 1 ? parts[0].context : {}),
            });
        here.context = context;
        const said: string[] = (errors = []);
        const counted = (group.warnings ?? suite.warnings) ? ["error", "warning"] : ["error"];
        // By the context, not the page: the part's popups and its own pages are the part's too.
        const threw = (e: WebError) => said.push(`pageerror: ${e.error().message}`);
        const wrote = (m: ConsoleMessage) => {
          if (counted.includes(m.type()) && !/favicon/.test(`${m.text()} ${m.location().url}`)) said.push(`console ${m.type()}: ${m.text()}`);
        };
        context.on("weberror", threw);
        context.on("console", wrote);
        // A tab's context outlives it, and its tabs go one at a time: all it holds now is this unit's.
        away = !tab
          ? () => context.close()
          : async () => {
              await Promise.all(context.pages().map((tab) => tab.close()));
              await context.unrouteAll({ behavior: "ignoreErrors" });
              context.off("weberror", threw);
              context.off("console", wrote);
            };
        if (suite.recordings) await answerFrom(context, base, suite.recordings, suite.dir, said);
        here.page = await context.newPage();
      }
      const opening = suite.opening ?? 60;
      waitsPast(opening);
      const inOpening = async <T>(work: Promise<T>, what: string) => {
        try {
          return await within(work, opening, what);
        } catch (e) {
          if (e instanceof Overran) e.message += await waitedFor(work, closing);
          throw e;
        }
      };
      const open = group.open ?? suite.open;
      if (open) await inOpening(Promise.resolve(open(here.page, base)), "the page was still opening");
      start = suite.start ? await inOpening(Promise.resolve(suite.start(here.page)), "the page was still starting") : null;
    };

    let broken: Error | null = null;
    await places.run(here, async () => {
      try {
        await fresh();
      } catch (e) {
        broken = e as Error;
      }
      for (const [i, p] of parts.entries()) {
        const label = `${group.name} › ${p.title}`;
        if (broken) {
          const said = `its page did not open: ${(broken as Error).message}`;
          results.push({ label, outcome: "failed", ms: 0, message: said });
          part(label, 0, "failed", said);
          console.log(`FAIL  ${label}\n      ${said}`);
          continue;
        }
        const limit = limitOf(p);
        const t0 = performance.now();
        const kept0 = kept();
        waitsPast(limit);
        let detail: unknown;
        let failure: Error | null = null;
        const work = Promise.resolve().then(() => p.fn(here));
        try {
          detail = await within(work, limit, "still going");
        } catch (e) {
          failure = e as Error;
        }
        // A wait outlives the part's limit: it says what it waited for once its page is gone.
        if (failure instanceof Overran) failure.message += await waitedFor(work, closing);
        const ms = performance.now() - t0;
        if (failure instanceof RealTime) await counted();
        const waited = Math.round(kept() - kept0);
        const said = errors.splice(0).filter((e) => !p.reports.some((r) => r.test(e)));
        if (said.length) failure ??= new Error(`the page reported: ${[...new Set(said)].join("; ")}`);
        // An error the page reported is the part's, whatever it judged of real time.
        if (said.length && failure instanceof RealTime) failure = new Error(`${failure.message} (and the page reported: ${[...new Set(said)].join("; ")})`);
        if (!(failure instanceof Overran) && suite.neutral && here.page) {
          let left: string[];
          try {
            left = await within(Promise.resolve(suite.neutral(here.page, start)), 5, "the check of what it left was still going");
          } catch (e) {
            left = [(e as Error).message];
          }
          if (left.length) {
            const leftText = `it left ${suite.neutralName ?? "the page"} not as it found it: ${left.join("; ")}`;
            if (failure) failure.message += ` (and ${leftText})`;
            else failure = new Error(leftText);
          }
        }
        const outcome = verdict(failure, waited);
        const busy = `${waited ? `, kept from running ${waited} ms` : ""}${ms > limit * 1000 ? `: past its ${limit}s limit, stretched as the machine kept it` : ""}`;
        if (outcome === "inconclusive") {
          const message = `inconclusive: ${failure!.message}; while it ran, the machine kept it from running ${waited} ms, so this measured the machine`;
          results.push({ label, outcome, ms, message });
          part(label, ms / 1000, outcome, message);
          console.log(`INCONCLUSIVE  ${label}  (${took(ms)})\n      ${message}`);
        } else {
          results.push({ label, outcome, ms, message: failure?.message });
          part(label, ms / 1000, outcome, failure?.message);
          if (outcome === "skipped") console.log(`skip  ${label}: ${failure!.message}`);
          else console.log(failure ? `FAIL  ${label}  (${took(ms)}${busy})\n      ${failure.message.split("\n").join("\n      ")}` : `ok    ${label}${detail ? `  — ${detail}` : ""}  (${took(ms)}${busy})`);
        }
        // A page a part failed on is no page to start the next on.
        if (failure && !(failure instanceof Skip) && i < parts.length - 1) {
          try {
            await fresh();
          } catch (e) {
            broken = e as Error;
          }
        }
      }
      await closing();
      try {
        await within(Promise.resolve(group.close?.()), 10, "its close was still going");
      } catch (e) {
        const label = `${group.name} › its close`;
        const message = (e as Error).message;
        results.push({ label, outcome: "failed", ms: 0, message });
        part(label, 0, "failed", message);
        console.log(`FAIL  ${label}\n      ${message}`);
      }
    });
  }

  // How long each part usually takes, from nerd: what orders the units side by side.
  const usual: Record<string, number> = {};
  try {
    for (const line of readFileSync(process.env.NERD_USUAL ?? "", "utf8").split("\n").filter((l) => l.trim())) {
      const { part, seconds } = JSON.parse(line);
      usual[part] = seconds;
    }
  } catch {
    // None given: by their limits.
  }

  /** `list` run `n` side by side, each taking the next as it ends one, the longest first. */
  async function sideways(list: Unit[], n: number) {
    const queue = longestFirst(list, usual, limitOf);
    await Promise.all(
      Array.from({ length: Math.min(n, queue.length) }, async () => {
        for (let u = queue.shift(); u; u = queue.shift()) await runUnit(u);
      }),
    );
  }
  if (sideBySide > 1) {
    await sideways(units.filter((u) => u.group.alone), 1);
    await Promise.all([sideways(tabs, 1), sideways(free.filter((u) => !u.group.alone), sideBySide - Math.min(tabs.length, 1))]);
  } else {
    for (const u of units) await runUnit(u);
  }

  await within(Promise.resolve(browser?.close()), 10, "Chrome was still closing").catch((e) => console.log(e.message));
  await within(Promise.resolve(served?.close()), 10, "the server was still closing").catch((e) => console.log(e.message));

  const ended = (outcome: string) => results.filter((r) => r.outcome === outcome);
  const [failed, inconclusive] = [ended("failed"), ended("inconclusive")];
  const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log(`\nslowest: ${slowest.map((r) => `${took(r.ms)} ${r.label}`).join("\n         ")}`);
  console.log(`${name}: ${ended("passed").length} of ${results.length} passed${inconclusive.length ? `, ${inconclusive.length} inconclusive (the machine kept ${inconclusive.length === 1 ? "it" : "them"} from running)` : ""} in ${took(performance.now() - began)}, seed ${seed}`);
  for (const r of inconclusive) console.log(`INCONCLUSIVE  ${r.label}\n      ${r.message!.split("\n")[0]}`);
  for (const r of failed) console.log(`FAIL  ${r.label}\n      ${r.message!.split("\n")[0]}`);
  process.exit(failed.length ? 1 : 0);
}
