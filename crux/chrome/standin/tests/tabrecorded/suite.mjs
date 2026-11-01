// Recordings answer a group's tab as a page's context: only for as long as the tab, and heard by the part it came in.
import { serve } from "../../serve.mjs";

const open = { "access-control-allow-origin": "*" };
export default {
  chrome: { reader: true },
  serve,
  open: (page, base) => page.goto(base),
  recordings: [{ url: "https://api.example/first", body: "the first", headers: open }],
};
