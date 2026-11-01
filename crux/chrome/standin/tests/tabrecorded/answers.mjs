import { group } from "../../../harness.ts";

const asks = (url) => `fetch(${JSON.stringify(url)}).then((r) => r.text(), (e) => "refused")`;
const test = group("answers", { why: "what a tab asks of other servers", tab: true, each: true });
test("answers from recordings", async ({ page, context, browser }) => {
  if (context !== browser.contexts()[0]) throw new Error("it was not on a tab");
  if ((await page.evaluate(asks("https://api.example/first"))) !== "the first") throw new Error("not from the recording");
});
test("asks what none answers", ({ page }) => page.evaluate(asks("https://unrecorded.example/x")));
