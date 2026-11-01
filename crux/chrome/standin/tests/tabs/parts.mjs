// What a page says on a tab fails the part it came in, as on a page of its own, and the rest of what a part is held to.
import { hide } from "../../../launch.ts";
import { group } from "../../../harness.ts";

const test = group("tabs", { why: "a tab as a reader's is hidden" });
test("throws in its page", async ({ page, base }) => void (await page.goto(`${base}throws`)));
test("writes a console error", async ({ page, base }) => void (await page.goto(`${base}writes`)));
test("makes its page throw on purpose", { reports: [/thrown in the page/] }, async ({ page, base }) => void (await page.goto(`${base}throws`)));
test("opens a popup that throws, and leaves it", async ({ context, page, base }) => {
  await page.goto(`${base}popup`);
  const opened = context.waitForEvent("page");
  await page.click("#open");
  await (await opened).waitForLoadState();
});
test("is hidden, and leaves the tab over it", async ({ page }) => {
  await hide(page);
  if ((await page.evaluate("document.visibilityState")) !== "hidden") throw new Error("it was not hidden");
});
test("waits for what never comes", { limit: 0.5 }, ({ page }) => page.waitForSelector("#never"));
test("never ends", { limit: 0.5 }, () => new Promise(() => undefined));
test("leaves a route on its context", async ({ context }) => {
  await context.route("**/routed", (route) => route.fulfill({ body: "left", contentType: "text/html" }));
});
test("meets no route left", async ({ page, base }) => {
  await page.goto(`${base}routed`);
  if ((await page.textContent("body")).includes("left")) throw new Error("the route of the part before answered it");
});

// One at a time: each stays until the machine has had turns enough for a tab beside it to show, with no clock in it.
const running = [];
const turns = group("one at a time", { why: "tabs share a window", each: true });
for (const name of ["a", "b", "c", "d", "e"]) {
  turns(`tab ${name}`, async ({ context, page }) => {
    running.push(name);
    for (let i = 0; i < 20; i++) await page.evaluate("0");
    if (running.length !== 1) throw new Error(`beside it: ${running}`);
    if (context.pages().length !== 1) throw new Error(`${context.pages().length} tabs`);
    if ((await page.evaluate("document.visibilityState")) !== "visible") throw new Error("it was not shown");
    running.pop();
  });
}

// A tab beside a group on a page of its own, in the suite that says `tab`: each holds until the other has begun, so that
// neither can have gone before the other, with no clock in it.
const met = {};
const begun = (name) => (met[name] ??= Promise.withResolvers());

group("beside", { why: "a tab takes one of the four side by side" })("meets a group not on a tab", async () => {
  begun("tab").resolve();
  await begun("page").promise;
});

// The suite's two side by side are that tab's lane and one other, so these two are never beside each other.
let free = 0;
async function alone(page) {
  free++;
  for (let i = 0; i < 20; i++) await page.evaluate("0");
  if (free !== 1) throw new Error("more beside it than the suite's two");
  free--;
}
const notOne = group("not a tab", { why: "a group may say otherwise", tab: false });
notOne("is on a page of its own", async ({ context, browser, page }) => {
  begun("page").resolve();
  await begun("tab").promise;
  if (context === browser.contexts()[0]) throw new Error("it was on a tab");
  if (context.pages().length !== 1) throw new Error("not a page of its own");
  await alone(page);
});
group("nor this", { why: "a group may say otherwise", tab: false })("takes the other's turn", ({ page }) => alone(page));
