// A part past its limit, with a wait on the page and with none, each on the page of the one before.
import { setTimeout as sleep } from "node:timers/promises";
import { group } from "../../../harness.ts";

const test = group("limits", { why: "a wait on a page that never ends" });
test("waits for what never comes", { limit: 1 }, async ({ page }) => {
  await page.evaluate("window.left = 1");
  await page.waitForSelector("#never");
});
test("begins a wait late", { limit: 2 }, async ({ page }) => {
  await sleep(1000);
  await page.waitForSelector("#late", { timeout: 60_000 });
});
test("never ends", { limit: 1 }, async ({ page }) => {
  await page.evaluate("window.left = 1");
  await new Promise(() => undefined);
});
test("comes after one", async ({ page }) => {
  if ((await page.evaluate("window.left")) !== undefined) throw new Error("it started on the page of a part that failed");
});
