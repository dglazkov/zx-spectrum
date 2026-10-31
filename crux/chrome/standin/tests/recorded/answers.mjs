import { group } from "../../../harness.ts";

const asks = (url) => `fetch(${JSON.stringify(url)}).then((r) => r.text(), (e) => "refused")`;
const test = group("answers", { why: "what a page asks of other servers" });
test("answers from recordings", async ({ page }) => {
  const said = [];
  for (const url of ["https://api.example/first", "https://api.example/second", "https://elsewhere.example/file", "https://elsewhere.example/made/this"]) said.push(await page.evaluate(asks(url)));
  if (said.join("|") !== "the first|any other|recorded in a file\n|made for this") throw new Error(JSON.stringify(said));
});
test("asks what none answers", ({ page }) => page.evaluate(asks("https://unrecorded.example/x")));
test("answers some itself", async ({ page }) => {
  await page.route("https://unrecorded.example/own", (route) => route.fulfill({ body: "the part's", headers: { "access-control-allow-origin": "*" } }));
  if ((await page.evaluate(asks("https://unrecorded.example/own"))) !== "the part's") throw new Error("the part's own route was not asked first");
});
