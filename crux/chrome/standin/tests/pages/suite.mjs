// Each way a part ends. Whatever a part leaves in `document.title` the suite's check finds.
import { serve } from "../../serve.mjs";

export default {
  serve,
  limit: 20,
  open: (page, base) => page.goto(base),
  start: (page) => page.title(),
  neutral: async (page, title) => ((await page.title()) === title ? [] : [`the title is ${await page.title()}`]),
  neutralName: "the stand-in",
};
