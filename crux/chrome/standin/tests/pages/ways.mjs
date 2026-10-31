// What a part has besides its page: pause, and a way to say it cannot run.
import { group, pause, Skip } from "../../../harness.ts";

const test = group("ways", { why: "the page's own clock", each: true });
test("pause stops the page's clock", async ({ page, base }) => {
  await page.clock.install();
  await page.goto(base);
  await pause(page);
  const from = await page.evaluate("Date.now()");
  await page.clock.runFor(1000);
  const moved = (await page.evaluate("Date.now()")) - from;
  if (moved !== 1000) throw new Error(`the clock moved ${moved} ms`);
});
test("pause asks again from where the clock is", async ({ page, base }) => {
  await page.clock.install();
  await page.goto(base);
  // A clock that passed the moment before the pause arrived: Chrome's own refusal, the first time.
  let asked = 0;
  const late = new Proxy(page, {
    get: (real, key) =>
      key === "evaluate" ? async (what) => (asked++ ? real.evaluate(what) : (await real.evaluate("Date.now()")) - 60_000) : Reflect.get(real, key).bind?.(real) ?? Reflect.get(real, key),
  });
  await pause(late);
  if (asked !== 2) throw new Error(`it asked ${asked} times`);
});
test("cannot run here", () => {
  throw new Skip("its fixture cannot be had");
});
