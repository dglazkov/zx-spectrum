// One group with `start`, `neutral` and `neutralName`, and one without, on a suite with none.
import { group } from "../../../harness.ts";

const kept = group("kept", {
  why: "what a part leaves on a kept page",
  start: (page) => page.evaluate(() => document.documentElement.getAttribute("data-mark") ?? ""),
  neutral: async (page, was) => {
    const now = await page.evaluate(() => document.documentElement.getAttribute("data-mark") ?? "");
    return now === was ? [] : [`data-mark is ${now}`];
  },
  neutralName: "the kept page",
});

kept("reads cleanly", () => undefined);
kept("leaves an attribute", ({ page }) => page.evaluate(() => document.documentElement.setAttribute("data-mark", "left")));
kept("finds its page as it should", async ({ page }) => {
  if (await page.evaluate(() => document.documentElement.hasAttribute("data-mark"))) throw new Error("it started on a page left changed");
});

const plain = group("plain", { why: "a group with no neutral of its own" });
plain("leaves an attribute", ({ page }) => page.evaluate(() => document.documentElement.setAttribute("data-mark", "left")));
