// A node:test file of every way a test ends, as report.test.mts runs it: its name to read, not a test of anything.
import { suite, test } from "node:test";

test("passes", () => undefined);
test("fails", () => {
  throw new Error("said\n  over two lines");
});
test("is skipped", { skip: "no fixture" }, () => undefined);
suite("a suite", () => {
  test("in a suite", () => undefined);
});
