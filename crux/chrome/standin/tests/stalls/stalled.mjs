// A stall made on purpose: a judgment of real time it spoiled, and a part it only slowed, past its limit.
import { setTimeout as sleep } from "node:timers/promises";
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
test("is kept past three times its limit", async ({ page }) => {
  await stall(4000);
  await page.evaluate("0");
});
test("waits through a stall", async ({ page }) => {
  await stall(100);
  await sleep(300); // the machine looked at: the part's waits are stretched
  const came = page.waitForFunction("window.came");
  await stall(3000);
  await page.evaluate("window.came = 1");
  await came;
});
test("begins a wait before the machine is looked at", async ({ page }) => {
  const came = page.waitForFunction("window.came");
  await sleep(100); // room for the wait to begin, and be told its timeout, ahead of the first look a part used to have
  await stall(3000);
  await page.evaluate("window.came = 1");
  await came;
});
test("hangs after a stall", async ({ page }) => {
  await stall(100);
  await sleep(300); // the machine looked at, as above
  await page.waitForSelector("#never");
});
test("hangs through a long stall", async ({ page }) => {
  const never = page.waitForSelector("#never");
  await sleep(100); // room for the wait to begin
  await stall(8000); // its limit stretched to the end of its reach, and no wait to end ahead of that
  await never;
});
for (const turn of ["first", "second", "third", "fourth"]) {
  test(`judges real time as a stall ends, the ${turn} time`, async () => {
    await stallEnding(100);
    inTime(false, "the ticks came late");
  });
}
