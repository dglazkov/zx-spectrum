// A stall made on purpose: a judgment of real time it spoiled, and a part it only slowed, past its limit.
import { group, inTime } from "../../../harness.ts";
import { stall, stallEnding } from "../../serve.mjs";

const test = group("stalled", { why: "a machine that stops" });
test("judges real time", async () => {
  await stall(300);
  inTime(false, "the ticks came late");
});
test("is only slowed", async ({ page }) => {
  await stall(1500);
  await page.evaluate("0");
});
for (const turn of ["first", "second", "third", "fourth"]) {
  test(`judges real time as a stall ends, the ${turn} time`, async () => {
    await stallEnding(100);
    inTime(false, "the ticks came late");
  });
}
