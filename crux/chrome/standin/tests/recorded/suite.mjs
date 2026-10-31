// What the page asks of other servers, from recordings: the first that matches answers, a file of the suite's or an
// answer made for the request, and what none answers is refused.
import { serve } from "../../serve.mjs";

const open = { "access-control-allow-origin": "*" };
export default {
  serve,
  parallel: 1,
  open: (page, base) => page.goto(base),
  recordings: [
    { url: "https://api.example/first", body: "the first", headers: open },
    { url: "https://api.example/*", body: "any other", headers: open },
    { url: /elsewhere\.example\/file/, path: "../../fixtures/recording.txt", headers: open },
    { url: "https://elsewhere.example/made/*", headers: open, answer: (request) => ({ body: `made for ${request.url().split("/").pop()}`, headers: open }) },
  ],
};
