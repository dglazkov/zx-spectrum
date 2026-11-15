// What a change touches of the part's own test, `nerd test chrome` (crux#227): its cases run only for what they test,
// and the rest are reported skipped, as the harness runs a product's parts. The harness's way does not fit it: its cases
// are node:test's, in four files, and two files, harness.ts and harness.test.mts, are what nearly every change touches.
// So those two are read as they were at NERD_BASE and as they are, a top-level block at a time:
//
// - a case of harness.test.mts that changed runs; a helper of it that changed runs each case whose code names it, by
//   way of the helpers that name it; a name imported or no longer imported runs what names it;
// - a declaration of harness.ts that changed runs the cases that claim it: those that name it in their code, as a unit
//   test of `within` does, and those that say it, as a stand-in's run says the part of the harness it is there to test;
// - a type, a comment before the imports and a block of comments alone stand for nothing: tsx runs none of them, and
//   chrome-types holds the types;
// - a block that is none of these (`describe`, `after`, a destructuring) and what is said shared runs every case.
//
// Every other file is claimed as a whole: by the cases of harness.test.mts that say it (the stand-in's suites), or by a
// test file whose every case tests it (`FILES`). One that every file runs on (`SHARED`), one no case claims, one gone or
// new, and a file read where git cannot read NERD_BASE, run all of what they could touch.
//
// Held to it as a granular suite is: `granular` names each file, declaration and helper that no case claims, or that more
// than a quarter of harness.test.mts's cases claim and is not said to be shared, counting cases and no clock.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

const here = import.meta.dirname;

/** Each test file of the part but harness.test.mts, and what all of its cases test: a change to one runs that file. */
export const FILES: Record<string, string[]> = {
  "launch.test.mts": ["launch.ts", "dies.mts", "launch.test.mts"],
  "ready.test.mts": ["ready.sh", "ready.test.mts"],
  "report.test.mts": ["report.mjs", "report.test.mts", "standin/reported"],
  "touches.test.mts": ["touches.test.mts"],
};

/** What every test file runs on: a change to one runs every case. */
export const SHARED = ["package.json", "package-lock.json", "touches.mts"];

/** The two files read a block at a time. */
const HARNESS = "harness.ts";
const TESTS = "harness.test.mts";

/** Whether `path`, from the part's directory, is `claim` or in it. */
export const holds = (claim: string, path: string) => path === claim || path.startsWith(`${claim}/`);

/** A claim that names a file or directory of the part, not a declaration of harness.ts. */
export const isPath = (claim: string) => /[./]/.test(claim);

export type Block = { kind: "import" | "type" | "case" | "named" | "comment" | "other"; name: string; from: number; to: number; text: string };

/** A module's top-level blocks, by its lines (from 0): each starts at a line that starts with neither a space nor a
 * closing bracket, the comment lines right above it with it, and runs to the next. A file's comments before its first
 * import are that import's; those with no code after them are a block of their own. */
export function blocks(text: string): Block[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  let pending: number | null = null;
  for (const [i, line] of lines.entries()) {
    if (!/^\S/.test(line) || /^[}\])]/.test(line)) continue;
    if (/^(\/\/|\/\*)/.test(line)) {
      pending ??= i;
      continue;
    }
    starts.push(pending ?? i);
    pending = null;
  }
  if (pending !== null) starts.push(pending);
  if (starts[0] !== 0 && lines.length) starts.unshift(0);
  return starts.map((from, n) => {
    const to = (starts[n + 1] ?? lines.length) - 1;
    const text = lines.slice(from, to + 1).join("\n");
    const code = text.split("\n").find((l) => /^\S/.test(l) && !/^(\/\/|\/\*| \*)/.test(l));
    return { from, to, text, ...kindOf(code) };
  });
}

function kindOf(code: string | undefined): Pick<Block, "kind" | "name"> {
  if (code === undefined) return { kind: "comment", name: "" };
  if (/^import\b/.test(code)) return { kind: "import", name: "" };
  let m = code.match(/^(?:export\s+)?(?:declare\s+)?(?:type|interface)\s+([\w$]+)/);
  if (m) return { kind: "type", name: m[1] };
  m = code.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/);
  if (m) return { kind: "named", name: m[1] };
  m = code.match(/^(?:test|one)\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$\\]*)`)\s*,/);
  if (m) return { kind: "case", name: m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3]) };
  return { kind: "other", name: "" };
}

/** The lines, from 0, of `was` and of `now` that are in no longest run the two have in common. */
export function changedLines(was: string, now: string): { was: Set<number>; now: Set<number> } {
  const a = was.split("\n");
  const b = now.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const [x, y] = [a.slice(start, a.length - end), b.slice(start, b.length - end)];
  const out = { was: new Set<number>(), now: new Set<number>() };
  // What is between is diffed by its longest common subsequence; one too big to diff is all changed, which runs more.
  if (x.length * y.length > 4_000_000) {
    x.forEach((_, i) => out.was.add(start + i));
    y.forEach((_, j) => out.now.add(start + j));
    return out;
  }
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  let [i, j] = [0, 0];
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) [i, j] = [i + 1, j + 1];
    else if (j < y.length && (i === x.length || lcs[i][j + 1] >= lcs[i + 1][j])) out.now.add(start + j++);
    else out.was.add(start + i++);
  }
  return out;
}

/** The names a module's imports bind. */
export function imported(text: string): Set<string> {
  const names = new Set<string>();
  for (const [, what] of text.matchAll(/^import\s+(?:type\s+)?([^;]*?)\s+from\s+["'][^"']+["']/gms)) {
    for (const piece of what.replace(/[{}]/g, ",").split(",")) {
      const name = piece.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()!.replace(/^\*\s*/, "").trim();
      if (/^[\w$]+$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** `text` with its comments and the words of its plain strings taken out: what its code names. */
export function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (m) => (m.startsWith("/") ? " " : '""'));
}

/** Whether `text`'s code names `name`, not as another's property. */
export const names = (text: string, name: string) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(code(text));

/** What a change from `was` to `now` touched, of a module's blocks: the cases and named declarations whose blocks changed,
 * the names whose import came or went, and whether it touched what runs everything (`all`). A file new or gone is all. */
export function touched(was: string | null, now: string | null): { cases: Set<string>; named: Set<string>; imports: Set<string>; all: boolean } {
  const out = { cases: new Set<string>(), named: new Set<string>(), imports: new Set<string>(), all: false };
  if (was === null || now === null) return { ...out, all: true };
  const lines = changedLines(was, now);
  const hit = (text: string, at: Set<number>) => blocks(text).filter((b) => [...at].some((l) => l >= b.from && l <= b.to));
  for (const b of [...hit(was, lines.was), ...hit(now, lines.now)]) {
    if (b.kind === "case") out.cases.add(b.name);
    else if (b.kind === "named") out.named.add(b.name);
    else if (b.kind === "other") out.all = true;
    else if (b.kind === "import") {
      const [before, after] = [imported(was), imported(now)];
      const moved = [...before].filter((n) => !after.has(n)).concat([...after].filter((n) => !before.has(n)));
      for (const n of moved) out.imports.add(n);
      // The same names, from somewhere else: what each of them is may have changed.
      const sources = (text: string) => [...text.matchAll(/^import\s[^;]*?from\s+(["'][^"']+["'])/gms)].map((m) => m[1]).sort().join();
      if (!moved.length && sources(was) !== sources(now)) out.all = true;
    }
  }
  return out;
}

export type Case = { name: string; claims: string[] };

/** What the harness's cases say every one of them runs on: a change to one runs them all. */
export type Shared = { files: string[]; declarations: string[]; helpers: string[] };

type Read = { was: (file: string) => string | null; now: (file: string) => string | null } | undefined;

/** The part's directory from the root of its repository, as NERD_CHANGED names its files: "ts/chrome/" in crux. */
function prefix(): string {
  const shown = spawnSync("git", ["-C", here, "rev-parse", "--show-prefix"], { encoding: "utf8" });
  return shown.status === 0 ? shown.stdout.trim() : "";
}

/** The changed files of the part, from its directory, as nerd gives them: none when the test runs whole. */
export function told(changed = process.env.NERD_CHANGED ?? "", at = prefix()): string[] {
  return changed
    .split("\n")
    .filter(Boolean)
    .filter((f) => f.startsWith(at))
    .map((f) => f.slice(at.length));
}

/** The part's files as they were at `base` and as they are, or undefined where git cannot read `base`. */
export function reader(base = process.env.NERD_BASE): Read {
  const git = (...args: string[]) => spawnSync("git", ["-C", here, ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (!base || git("cat-file", "-e", `${base}^{commit}`).status !== 0) return undefined;
  return {
    was: (file) => {
      const shown = git("show", `${base}:./${file}`);
      return shown.status === 0 ? shown.stdout : null;
    },
    now: (file) => (existsSync(join(here, file)) ? readFileSync(join(here, file), "utf8") : null),
  };
}

/** Of the part's files, those the harness's cases claim, as a whole or a block at a time: what is not another file's. */
const harnesses = (file: string) => file === HARNESS || file === TESTS || (holds("standin", file) && !Object.values(FILES).flat().some((c) => holds(c, file)));

/** Whether `file`'s cases run for `changed`: all of them where nothing changed. */
export function fileRuns(file: string, changed: string[]): boolean {
  if (!changed.length) return true;
  return changed.some((f) => SHARED.includes(f) || FILES[file].some((c) => holds(c, f)) || !(harnesses(f) || Object.values(FILES).flat().some((c) => holds(c, f))));
}

/** What node:test is told of each case of a test file the part claims whole: to skip it, where what changed touches
 * nothing it tests. */
export function skipFor(file: string): { skip?: string } {
  return fileRuns(file, told()) ? {} : { skip: "what changed touches nothing it tests" };
}

/** The harness's cases that `changed` runs, and why; the declarations of harness.ts and helpers of harness.test.mts each
 * case claims are its `claims` and what its code names. */
export function harnessRuns(cases: Case[], shared: Shared, changed: string[], read: Read, text = (file: string) => readFileSync(join(here, file), "utf8")) {
  const all = { run: new Set(cases.map((c) => c.name)), because: "every case" };
  if (!changed.length) return all;
  const claims = claimsOf(cases, text);
  const run = new Set<string>();
  for (const file of changed) {
    const whole = (why: string) => ({ ...all, because: `every case, for ${file}, ${why}` });
    if (SHARED.includes(file) || shared.files.some((s) => holds(s, file))) return whole("which they all share");
    if (file === HARNESS || file === TESTS) {
      if (!read) return whole("as git cannot read NERD_BASE");
      const t = touched(read.was(file), read.now(file));
      if (t.all) return whole("in what every case runs on");
      if (file === HARNESS) {
        const now = read.now(file)!;
        const named = new Set([...t.named, ...blocks(now).filter((b) => b.kind === "named" && [...t.imports].some((n) => names(b.text, n))).map((b) => b.name)]);
        const sharedHit = [...named].filter((n) => shared.declarations.includes(n));
        if (sharedHit.length) return whole(`whose ${sharedHit.join(", ")} they all share`);
        for (const c of cases) if (claims.get(c.name)!.declarations.some((d) => named.has(d))) run.add(c.name);
      } else {
        const helpers = new Set([...t.named, ...t.imports]);
        const sharedHit = [...helpers].filter((n) => shared.helpers.includes(n));
        if (sharedHit.length) return whole(`whose ${sharedHit.join(", ")} they all share`);
        for (const c of cases) if (t.cases.has(c.name) || claims.get(c.name)!.helpers.some((h) => helpers.has(h))) run.add(c.name);
      }
      continue;
    }
    const by = cases.filter((c) => claims.get(c.name)!.paths.some((p) => holds(p, file)));
    if (!by.length && harnesses(file)) return whole("which no case claims");
    if (!harnesses(file) && !Object.values(FILES).flat().some((c) => holds(c, file))) return whole("which no case claims");
    for (const c of by) run.add(c.name);
  }
  return { run, because: `what ${changed.length > 3 ? `${changed.slice(0, 3).join(", ")} and ${changed.length - 3} more` : changed.join(", ")} touches` };
}

/** What each case claims: the files its claims name, the declarations of harness.ts its claims say or its code names,
 * and the helpers of harness.test.mts its code names, by way of the helpers that name them. */
export function claimsOf(cases: Case[], text: (file: string) => string) {
  const declared = blocks(text(HARNESS)).filter((b) => b.kind === "named").map((b) => b.name);
  const tests = blocks(text(TESTS));
  const helpers = tests.filter((b) => b.kind === "named");
  const exported = imported(text(TESTS));
  // Each helper, with the helpers whose code names it, and theirs.
  const through = new Map(helpers.map((h) => [h.name, new Set([h.name])]));
  for (let more = true; more; ) {
    more = false;
    for (const h of helpers)
      for (const [name, set] of through)
        if (!set.has(h.name) && [...set].some((n) => n !== h.name && names(h.text, n))) {
          set.add(h.name);
          more = true;
        }
  }
  const out = new Map<string, { paths: string[]; declarations: string[]; helpers: string[] }>();
  for (const c of cases) {
    const block = tests.find((b) => b.kind === "case" && b.name === c.name);
    if (!block) throw new Error(`${TESTS}: no case "${c.name}" is a block of its own, from a line that starts test("…"`);
    for (const claim of c.claims) {
      if (isPath(claim) ? !existsSync(join(here, claim)) : !declared.includes(claim)) throw new Error(`${TESTS}: "${c.name}" claims ${claim}, which is not there`);
    }
    const named = [...exported].filter((n) => declared.includes(n) && names(block.text, n));
    const helped = [...through].filter(([, set]) => [...set].some((n) => names(block.text, n))).map(([name]) => name);
    out.set(c.name, {
      paths: c.claims.filter(isPath),
      declarations: [...new Set([...c.claims.filter((x) => !isPath(x)), ...named])],
      helpers: [...new Set([...helped, ...[...exported].filter((n) => names(block.text, n))])],
    });
  }
  return out;
}

/** Every file of the part, from its directory, what is installed left out. */
export function partFiles(dir = here): string[] {
  const walk = (from: string): string[] =>
    readdirSync(join(dir, from), { withFileTypes: true }).flatMap((entry) => {
      const path = from ? `${from}/${entry.name}` : entry.name;
      // What is installed, however it is there: a link to another's node_modules too.
      if (entry.name === "node_modules") return [];
      return entry.isDirectory() ? walk(path) : [path];
    });
  return walk("").map((p) => p.split(sep).join("/"));
}

/** What keeps the test from running only what a change touches, a line each: a file, declaration of harness.ts or helper
 * of harness.test.mts that no case claims, or that more than a quarter of the harness's cases claim and is not shared. */
export function granular(cases: Case[], shared: Shared, files: string[], text = (file: string) => readFileSync(join(here, file), "utf8")): string[] {
  const claims = claimsOf(cases, text);
  const most = cases.length / 4;
  const wrong: string[] = [];
  const judge = (what: string, count: number, unclaimed = true) => {
    if (!count && unclaimed) wrong.push(`${what} is claimed by no case: claim it in the cases that test it`);
    if (count > most) wrong.push(`${what} runs ${count} of the ${cases.length} cases, more than 25%: split what holds them, or say it is shared`);
  };
  const count = (has: (c: { paths: string[]; declarations: string[]; helpers: string[] }) => boolean) => cases.filter((c) => has(claims.get(c.name)!)).length;
  for (const file of files) {
    if (file === HARNESS || file === TESTS || SHARED.includes(file) || shared.files.some((s) => holds(s, file))) continue;
    if (Object.values(FILES).flat().some((c) => holds(c, file))) continue;
    if (Object.keys(FILES).includes(file)) continue;
    judge(file, count((c) => c.paths.some((p) => holds(p, file))));
  }
  for (const b of blocks(text(HARNESS))) if (b.kind === "named" && !shared.declarations.includes(b.name)) judge(`${HARNESS}'s ${b.name}`, count((c) => c.declarations.includes(b.name)));
  for (const b of blocks(text(TESTS))) if (b.kind === "named" && !shared.helpers.includes(b.name)) judge(`${TESTS}'s ${b.name}`, count((c) => c.helpers.includes(b.name)), false);
  return wrong;
}
