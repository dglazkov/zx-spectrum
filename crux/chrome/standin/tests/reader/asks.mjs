import assert from "node:assert/strict";
import { group } from "../../../harness.ts";

const test = group("reader", { why: "only Chrome says what it says of itself" });

test("a reader's says no webdriver", async ({ page }) => {
  assert.equal(await page.evaluate(() => navigator.webdriver), false);
});
