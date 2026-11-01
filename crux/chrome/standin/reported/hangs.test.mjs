// One case that never ends, written ahead of one that does, as a test stopped at its limit leaves them.
import { suite, test } from "node:test";

suite("side by side", { concurrency: 2 }, () => {
  test("never ends", () => new Promise(() => setInterval(() => undefined, 1000)));
  test("ends beside it", () => undefined);
});
