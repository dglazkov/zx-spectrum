// Each kind of wait on a page, none of which ever ends: what the part's limit says it waited for.
import { group } from "../../../harness.ts";

const test = group("hung", { why: "a wait on a page that never ends", each: true });
test("a selector", ({ page }) => page.waitForSelector("#never"));
test("a locator's wait", ({ page }) => page.locator("#never").waitFor());
test("a click", ({ page }) => page.click("#never"));
test("a fill", ({ page }) => page.locator("#never").fill("x"));
test("a function", ({ page }) => page.waitForFunction("window.never"));
test("a url", ({ page }) => page.waitForURL("**/never"));
test("an event", ({ page }) => page.waitForEvent("popup"));
test("a request", ({ page }) => page.waitForRequest("**/never"));
test("a response", ({ page }) => page.waitForResponse("**/never"));
test("a navigation", ({ page, base }) => page.goto(`${base}never`, { waitUntil: "commit" }));
test("a load", async ({ page, base }) => {
  await page.goto(`${base}loading`, { waitUntil: "commit" });
  await page.waitForLoadState("load");
});
test("a context's event", ({ context }) => context.waitForEvent("page"));
test("a script", ({ page }) => page.evaluate("new Promise(() => undefined)"));
