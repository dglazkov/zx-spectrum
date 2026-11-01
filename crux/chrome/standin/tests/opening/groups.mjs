// A page's opening, each way it ends: kept from running by the machine, and hung, on a wait and on the page's address.
import { setTimeout as sleep } from "node:timers/promises";
import { group } from "../../../harness.ts";
import { stall } from "../../serve.mjs";

const groupOpening = (name, open, also) => group(name, { why: "what opens its page", open, ...also });

// Alone, as its stall holds the process that serves the others' pages too.
groupOpening(
  "kept",
  async (page, base) => {
    await page.goto(base);
    const came = page.waitForFunction("window.came");
    await sleep(300); // room for the wait to begin, and be told its timeout, before the machine keeps it
    await stall(3000);
    await page.evaluate("window.came = 1");
    await came;
  },
  { alone: true },
)("opens", () => undefined);

groupOpening("waits", async (page, base) => {
  await page.goto(base);
  await page.waitForSelector("#never");
})("opens", () => undefined);

groupOpening("starts", (page, base) => page.goto(`${base}#hangs`))("opens", () => undefined);

groupOpening("navigates", (page, base) => page.goto(`${base}never`))("opens", () => undefined);
