// Six groups and two that go alone, each noting itself in STANDIN_LOG as it begins, how many ran then and on which
// Chrome. The first four hold until all four are here: side by side or not at all, with no clock in it.
import { appendFileSync } from "node:fs";
import { chromeProcess } from "../../../launch.ts";
import { current, group } from "../../../harness.ts";

let running = 0;
let arrived = 0;
const held = [];
const note = (line) => appendFileSync(process.env.STANDIN_LOG, `${JSON.stringify(line)}\n`);

async function arrive() {
  if (++arrived < 4) await new Promise((resolve) => held.push(resolve));
  else for (const go of held.splice(0)) go();
}

for (const name of ["a", "b", "c", "d", "e", "f"]) {
  group(name, { why: "a stand-in's" })("meets", async ({ page, context, browser }) => {
    running++;
    note({ name, running, chrome: (await chromeProcess(browser)).pid });
    await page.evaluate(`window.mine = ${JSON.stringify(name)}`);
    await arrive();
    // After every other part has run its turns, what the harness holds for this one is still this one's.
    const here = current();
    if (here.page !== page || here.context !== context) throw new Error("current() is another part's");
    if ((await here.page.evaluate("window.mine")) !== name) throw new Error("two parts had one page");
    running--;
  });
}

for (const name of ["first", "second"]) {
  group(name, { why: "a stand-in's", alone: true })("goes alone", async ({ page }) => {
    note({ name: "first", running: ++running });
    for (let i = 0; i < 20; i++) await page.evaluate("0");
    if (running !== 1) throw new Error("something ran beside it");
    running--;
  });
}
