// A part that leaves its page changed, one that fails on it, and the one after each.
import { group } from "../../../harness.ts";

const test = group("left", { why: "what a part leaves" });
test("leaves the title", ({ page }) => page.evaluate(`document.title = "changed"`));
test("fails on a page", async ({ page }) => {
  await page.evaluate("window.left = 1");
  throw new Error("a part that failed");
});
test("finds its page as it should", async ({ page }) => {
  if ((await page.evaluate("window.left")) !== undefined) throw new Error("it started on the page of a part that failed");
  if ((await page.title()) !== "stand-in") throw new Error("it started on a page left changed");
});

const given = group("unopened", { why: "a page that does not open", open: () => Promise.reject(new Error("the page would not open")) });
given("cannot run", () => undefined);
