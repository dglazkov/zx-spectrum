// One group uses the suite's `start` and `neutral`, and one overrides them.
import { group } from "../../../harness.ts";

const inherited = group("inherited", { why: "a group using the suite's neutral" });
inherited("leaves the title", ({ page }) => page.evaluate(`document.title = "changed"`));

const own = group("own", {
  why: "a group overriding the suite's neutral",
  start: (page) => page.evaluate(() => document.documentElement.getAttribute("data-mark") ?? ""),
  neutral: async (page, was) => {
    const now = await page.evaluate(() => document.documentElement.getAttribute("data-mark") ?? "");
    return now === was ? [] : [`data-mark is ${now}`];
  },
  neutralName: "the group's page",
});

own("leaves the title", ({ page }) => page.evaluate(`document.title = "changed"`));
own("leaves an attribute", ({ page }) => page.evaluate(() => document.documentElement.setAttribute("data-mark", "left")));
