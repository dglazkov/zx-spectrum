// What a page says fails the part it came in.
import { group } from "../../../harness.ts";

const test = group("errors", { why: "what a page says as it loads", each: true });
test("throws in its page", async ({ page, base }) => void (await page.goto(`${base}throws`)));
test("writes a console error", async ({ page, base }) => void (await page.goto(`${base}writes`)));
test("writes a warning", async ({ page, base }) => void (await page.goto(`${base}warns`)));
test("makes its page throw on purpose", { reports: [/thrown in the page/] }, async ({ page, base }) => void (await page.goto(`${base}throws`)));
test("makes its page say something else", { reports: [/nothing like it/] }, async ({ page, base }) => void (await page.goto(`${base}writes`)));
test("opens a popup that throws", async ({ context, page, base }) => {
  await page.goto(`${base}popup`);
  const opened = context.waitForEvent("page");
  await page.click("#open");
  await (await opened).waitForLoadState();
});
test("a context of its own", { context: { viewport: { width: 390, height: 844 } } }, async ({ page }) => {
  if ((await page.evaluate("innerWidth")) !== 390) throw new Error("the part's context was not used");
});

const warnings = group("warnings", { why: "what a page says as it loads", warnings: true });
warnings("writes a warning, where they count", async ({ page, base }) => void (await page.goto(`${base}warns`)));
