// touches.mts (crux#227): how a module splits into blocks, what a change between two of its texts touched, which of the
// harness's cases that runs, and what `granular` holds the test to, each on small modules of its own. The part's own
// files, as they are, are judged by harness.test.mts, which fails a run where they are not granular.
//
// npx --yes tsx@4.20.6 --test touches.test.mts    (as `nerd test chrome` runs it)

import assert from "node:assert/strict";
import { suite, test as one, type TestContext } from "node:test";
import { blocks, changedLines, fileRuns, granular, harnessRuns, imported, names, type Shared, skipFor, told, touched } from "./touches.mts";

// Each case is skipped where what changed touches nothing this file tests.
const skip = skipFor("touches.test.mts");
const cases: [string, (t: TestContext) => void | Promise<void>][] = [];
const test = (name: string, fn: (t: TestContext) => void | Promise<void>) => void cases.push([name, fn]);

// A harness.ts of four declarations and a type, and a harness.test.mts of three cases and two helpers, one by way of the other.
const HARNESS = `// The header.
// Of two lines.

import { a } from "./a.ts";
import { b } from "./b.ts";

/** One. */
export function one() {
  return a;
}

type Shape = { x: number };

export const two = () => b;

// Three's comment.
function three() {
  return 3;
}

export async function run() {
  one();
}
`;
const TESTS = `import assert from "node:assert/strict";
import { one, two, three } from "./harness.ts";

const runs = () => 1;
const wrapped = () => runs();

test("the first", ["standin/tests/waits"], async () => {
  assert.equal(one(), 1);
});

test("the second's \\"name\\"", ["three"], async () => {
  wrapped();
});

test('the third', [], async () => {
  two();
});

describe("side by side", () => {});
`;
const files: Record<string, string> = { "harness.ts": HARNESS, "harness.test.mts": TESTS };
const text = (file: string) => files[file];
const cases3 = [
  { name: "the first", claims: ["standin/tests/waits"] },
  { name: 'the second\'s "name"', claims: ["three"] },
  { name: "the third", claims: [] },
];
const none: Shared = { files: [], declarations: [], helpers: [] };
/** A change to one file of the two, `was` to `now`, and what it runs of the three. */
const runs = (file: string, was: string | null, now: string | null, shared = none) =>
  harnessRuns(cases3, shared, [file], { was: (f) => (f === file ? was : files[f]), now: (f) => (f === file ? now : files[f]) }, text);
const ran = (r: { run: Set<string> }) => [...r.run].sort();

test("blocks: a declaration with the comments above it, a header with the first import, and what each is", () => {
  const found = blocks(HARNESS).map((b) => [b.kind, b.name, b.from]);
  assert.deepEqual(found, [
    ["import", "", 0],
    ["import", "", 4],
    ["named", "one", 6],
    ["type", "Shape", 11],
    ["named", "two", 13],
    ["named", "three", 15],
    ["named", "run", 20],
  ]);
  assert.deepEqual(
    blocks(TESTS).filter((b) => b.kind === "case").map((b) => b.name),
    ["the first", 'the second\'s "name"', "the third"],
    "a case's name, as node:test is given it",
  );
  assert.equal(blocks(TESTS).at(-1)!.kind, "other");
  assert.deepEqual(blocks("const a = 1;\n// left at the end\n").map((b) => b.kind), ["named", "comment"]);
});

test("changedLines: what is in no run the two share, on either side", () => {
  assert.deepEqual(changedLines("a\nb\nc", "a\nb\nc"), { was: new Set(), now: new Set() });
  assert.deepEqual(changedLines("a\nb\nc", "a\nx\nb\nc"), { was: new Set(), now: new Set([1]) }, "a line put in");
  assert.deepEqual(changedLines("a\nb\nc", "a\nc"), { was: new Set([1]), now: new Set() }, "a line taken out");
  assert.deepEqual(changedLines("a\nb\nc\nd\ne", "a\nB\nc\nD\ne"), { was: new Set([1, 3]), now: new Set([1, 3]) }, "two apart");
});

test("imported and names: the names a module binds, and a name in code, not in a string, a comment or as a property", () => {
  assert.deepEqual([...imported(`import x, { a, b as c, type T } from "./m.ts";\nimport type { U } from "u";\nimport * as ns from "n";`)].sort(), ["T", "U", "a", "c", "ns", "x"]);
  assert.equal(names("f(stand);", "stand"), true);
  assert.equal(names(`f("stand"); // stand`, "stand"), false);
  assert.equal(names("x.stand();", "stand"), false);
  assert.equal(names("standing();", "stand"), false);
});

test("touched: the cases, declarations and imports a change is in, and what runs all", () => {
  const one = (was: string, now: string) => {
    const t = touched(was, now);
    return { cases: [...t.cases], named: [...t.named], imports: [...t.imports], all: t.all };
  };
  const nothing = { cases: [], named: [], imports: [], all: false };
  assert.deepEqual(one(HARNESS, HARNESS.replace("return 3", "return 4")), { ...nothing, named: ["three"] });
  assert.deepEqual(one(HARNESS, HARNESS.replace("// Three's comment.", "// Three's.")), { ...nothing, named: ["three"] }, "its comment is its own");
  assert.deepEqual(one(HARNESS, HARNESS.replace("// Of two lines.", "// Of three.")), nothing, "the header stands for nothing");
  assert.deepEqual(one(HARNESS, HARNESS.replace("x: number", "x: string")), nothing, "a type stands for nothing");
  assert.deepEqual(one(HARNESS, HARNESS.replace('import { a } from "./a.ts";', 'import { a, c } from "./a.ts";')), { ...nothing, imports: ["c"] });
  assert.deepEqual(one(HARNESS, HARNESS.replace('"./b.ts"', '"./c.ts"')).all, true, "the same names from elsewhere");
  assert.deepEqual(one(TESTS, TESTS.replace("assert.equal(one(), 1)", "assert.equal(one(), 2)")), { ...nothing, cases: ["the first"] });
  assert.deepEqual(one(TESTS, TESTS.replace('test("the first"', 'test("the first, renamed"')).cases.sort(), ["the first", "the first, renamed"]);
  assert.deepEqual(one(TESTS, TESTS.replace("() => {});", "() => { one(); });")).all, true, "what is neither");
  assert.equal(touched(null, HARNESS).all, true, "a file new");
  assert.equal(touched(HARNESS, null).all, true, "a file gone");
});

test("harnessRuns: a declaration runs the cases that claim it or name it, and nothing else", () => {
  assert.deepEqual(ran(runs("harness.ts", HARNESS, HARNESS.replace("return 3", "return 4"))), ['the second\'s "name"'], "claimed");
  assert.deepEqual(ran(runs("harness.ts", HARNESS, HARNESS.replace("return a;", "return a + 1;"))), ["the first"], "named in its code");
  assert.deepEqual(ran(runs("harness.ts", HARNESS, HARNESS.replace("x: number", "x: string"))), [], "a type");
  assert.deepEqual(ran(runs("harness.ts", HARNESS, HARNESS.replace('import { a } from "./a.ts";', 'import { a, c } from "./a.ts";').replace("return a;", "return c;"))), ["the first"]);
  const all = ["the first", 'the second\'s "name"', "the third"];
  assert.deepEqual(ran(runs("harness.ts", HARNESS, HARNESS.replace("  one();", "  one(); one();"))), [], "run, that no case claims");
  const shared = runs("harness.ts", HARNESS, HARNESS.replace("  one();", "  one(); one();"), { ...none, declarations: ["run"] });
  assert.deepEqual(ran(shared), all, "what they all share");
  assert.match(shared.because, /every case, for harness\.ts, whose run they all share/);
});

test("harnessRuns: a case runs itself, and a helper the cases that name it, by way of the helpers that name it", () => {
  assert.deepEqual(ran(runs("harness.test.mts", TESTS, TESTS.replace("assert.equal(one(), 1)", "assert.equal(one(), 2)"))), ["the first"]);
  assert.deepEqual(ran(runs("harness.test.mts", TESTS, TESTS.replace("const runs = () => 1;", "const runs = () => 2;"))), ['the second\'s "name"']);
  assert.deepEqual(ran(runs("harness.test.mts", TESTS, TESTS.replace("const runs = () => 1;", "const runs = () => 2;"), { ...none, helpers: ["runs"] })).length, 3, "shared");
  assert.deepEqual(ran(runs("harness.test.mts", TESTS, TESTS.replace("{ one, two, three }", "{ one, three }"))), ["the third"], "an import gone");
  assert.equal(ran(runs("harness.test.mts", TESTS, TESTS.replace("() => {});", "() => { one(); });"))).length, 3, "what is neither");
});

test("harnessRuns: a file by what claims it, and all for one shared, one no case claims, or one git cannot read", () => {
  const of = (changed: string[], read: Parameters<typeof harnessRuns>[3] = { was: text, now: text }, shared = none) => ran(harnessRuns(cases3, shared, changed, read, text));
  assert.deepEqual(of(["standin/tests/waits/hung.mjs"]), ["the first"]);
  assert.deepEqual(of(["launch.ts"]), [], "another file's");
  assert.deepEqual(of(["ready.sh", "standin/tests/waits/suite.mjs"]), ["the first"]);
  assert.equal(of(["package.json"]).length, 3, "what every test file shares");
  assert.equal(of(["standin/tests/waits/hung.mjs"], undefined, { ...none, files: ["standin/tests/waits"] }).length, 3, "what the cases share");
  assert.equal(of(["nobody.ts"]).length, 3, "no case's");
  assert.equal(of(["standin/tests/order/groups.mjs"]).length, 3, "a stand-in's no case claims");
  assert.equal(ran(harnessRuns(cases3, none, ["harness.ts"], undefined, text)).length, 3, "no NERD_BASE git reads");
  assert.equal(of([]).length, 3, "nothing changed");
});

test("fileRuns: a file claimed whole runs for what it claims, what all share and what no one claims", () => {
  assert.equal(fileRuns("launch.test.mts", []), true);
  assert.equal(fileRuns("launch.test.mts", ["launch.ts"]), true);
  assert.equal(fileRuns("launch.test.mts", ["dies.mts"]), true);
  assert.equal(fileRuns("launch.test.mts", ["package-lock.json"]), true);
  assert.equal(fileRuns("launch.test.mts", ["nobody.ts"]), true);
  assert.equal(fileRuns("launch.test.mts", ["harness.ts", "ready.sh", "standin/tests/waits/hung.mjs"]), false);
  assert.equal(fileRuns("report.test.mts", ["standin/reported/clean.test.mjs"]), true);
  assert.equal(fileRuns("launch.test.mts", ["standin/reported/clean.test.mjs"]), false, "a stand-in another file claims is not the harness's");
});

test("told: the part's files of what nerd gives, from its directory", () => {
  assert.deepEqual(told("ts/chrome/harness.ts\nts/chrome/standin/serve.mjs\nts/load/load.ts\n", "ts/chrome/"), ["harness.ts", "standin/serve.mjs"]);
  assert.deepEqual(told("", "ts/chrome/"), []);
});

test("granular: what no case claims, and what more than a quarter of them claim but is not shared", () => {
  const four = [...cases3, { name: "a fourth", claims: [] }];
  const fourth: Record<string, string> = { ...files, "harness.test.mts": `${TESTS}\ntest("a fourth", [], () => {});\n` };
  const judge = (claims: { name: string; claims: string[] }[], shared: Shared, on: string[] = []) => granular(claims, shared, on, (f) => fourth[f]);
  assert.deepEqual(judge(four, { ...none, declarations: ["run"] }), [], "two, each of one case, a shared one, and a type");
  const wrong = judge(four, none);
  assert.deepEqual(wrong, ["harness.ts's run is claimed by no case: claim it in the cases that test it"]);
  const wide = four.map((c) => ({ ...c, claims: c.name === "the third" || c.name === "a fourth" ? ["three"] : c.claims }));
  assert.match(judge(wide, { ...none, declarations: ["run"] }).join(), /harness\.ts's three runs 3 of the 4 cases, more than 25%/);
  assert.deepEqual(judge(wide, { ...none, declarations: ["run", "three"] }), [], "unless it is shared");
  assert.match(judge(four, { ...none, declarations: ["run"] }, ["standin/tests/order/groups.mjs"]).join(), /standin\/tests\/order\/groups\.mjs is claimed by no case/);
  assert.deepEqual(judge(four, { ...none, declarations: ["run"] }, ["standin/tests/waits/hung.mjs", "launch.ts", "package.json", "harness.ts", "launch.test.mts"]), []);
  assert.match(judge(four, { ...none, declarations: ["run"] }, ["new.test.mts"]).join(), /new\.test\.mts is claimed by no case/, "a test file not in FILES");
  // A helper is judged by the cases it runs, and none is no fault: that is a helper no longer used.
  assert.match(judge(four, { ...none, declarations: ["run"] }).join(), /^$/);
  const helped = four.map((c) => ({ ...c }));
  const widely: Record<string, string> = { ...fourth, "harness.test.mts": fourth["harness.test.mts"].replace("two();", "two(); wrapped();") };
  const said = granular(helped, { ...none, declarations: ["run"] }, [], (f) => widely[f]);
  assert.match(said.join(), /harness\.test\.mts's runs runs 2 of the 4 cases/, "by way of wrapped");
  assert.deepEqual(granular(helped, { ...none, declarations: ["run"], helpers: ["runs", "wrapped"] }, [], (f) => widely[f]), []);
});

test("a claim of what is not there is refused", () => {
  assert.throws(() => granular([{ name: "the first", claims: ["nowhere"] }], none, [], text), /claims nowhere, which is not there/);
  assert.throws(() => granular([{ name: "the first", claims: ["standin/nowhere.mjs"] }], none, [], text), /claims standin\/nowhere\.mjs, which is not there/);
  assert.throws(() => granular([{ name: "no such case", claims: [] }], none, [], text), /no case "no such case" is a block of its own/);
});

suite("side by side", { concurrency: 4 }, () => {
  for (const [name, fn] of cases) one(name, skip, fn);
});
