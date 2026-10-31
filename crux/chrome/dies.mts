// A test that dies with Chrome open, as launch.test.mts starts it, its argument saying as a reader's or not and how:
// `reader throw` or `automation term`. It says Chrome's process and profile, once a page is open.

import { chromeProcess, launch } from "./launch.ts";

const [as, how] = process.argv.slice(2);
const browser = await launch({ reader: as === "reader" });
const page = await (await browser.newContext()).newPage();
await page.goto("data:text/html,<p>open");
console.log(JSON.stringify(await chromeProcess(browser)));
if (how === "throw") throw new Error("the test threw");
await new Promise((resolve) => setTimeout(resolve, 3_600_000));
