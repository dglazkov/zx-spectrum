// A suite with `start`, `neutral` and `neutralName` of its own, which a group may override.
import { serve } from "../../serve.mjs";

export default {
  serve,
  open: (page, base) => page.goto(base),
  start: (page) => page.title(),
  neutral: async (page, title) => ((await page.title()) === title ? [] : [`the title is ${await page.title()}`]),
  neutralName: "the suite page",
};
