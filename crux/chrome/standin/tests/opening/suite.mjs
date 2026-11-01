import { serve } from "../../serve.mjs";

export default {
  serve,
  opening: 2,
  start: (page) => (page.url().endsWith("#hangs") ? page.waitForSelector("#never") : null),
};
