// A reader's tabs: each part on one, and each finding that tab alone in its context, with one of the harness's ears on
// it, whatever the part before it left there.
import { serve } from "../../serve.mjs";

export default {
  chrome: { reader: true },
  serve,
  tab: true,
  each: true,
  parallel: 2,
  limit: 20,
  open: async (page, base) => {
    const context = page.context();
    const found = { tabs: context.pages().length, thrown: context.listenerCount("weberror"), written: context.listenerCount("console") };
    if (JSON.stringify(found) !== '{"tabs":1,"thrown":1,"written":1}') throw new Error(`the part before left ${JSON.stringify(found)}`);
    await page.goto(base);
  },
};
