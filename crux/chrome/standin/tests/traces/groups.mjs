// Parts that take Chrome's trace, which Chrome keeps one of for the whole browser (crux#211): four groups that ask for it
// at once, held until all four are here, side by side or not at all, with no clock in it; and before them, alone, one
// that leaves its trace going and fails, and one that detaches with its trace going. Each notes in STANDIN_LOG as its
// trace begins and as it is about to end it.
import { appendFileSync } from "node:fs";
import { group } from "../../../harness.ts";

const note = (line) => appendFileSync(process.env.STANDIN_LOG, `${JSON.stringify(line)}\n`);

let arrived = 0;
const held = [];
async function arrive() {
  if (++arrived < 4) await new Promise((resolve) => held.push(resolve));
  else for (const go of held.splice(0)) go();
}

/** A trace of `page` begun, its mark written: the session and what Chrome sends of it. */
async function begin(page, name) {
  const chrome = await page.context().newCDPSession(page);
  const events = [];
  chrome.on("Tracing.dataCollected", (d) => events.push(...d.value));
  const complete = new Promise((resolve) => chrome.once("Tracing.tracingComplete", resolve));
  await chrome.send("Tracing.start", { categories: "devtools.timeline", transferMode: "ReportEvents" });
  note({ name, trace: "from" });
  await page.evaluate((mark) => console.timeStamp(mark), name);
  return { chrome, events, complete };
}

/** Chrome's trace of `page` while it is asked a few things, ended whole, and holding the page's own mark. */
async function traced(page, name) {
  const { chrome, events, complete } = await begin(page, name);
  for (let i = 0; i < 20; i++) await page.evaluate("0");
  note({ name, trace: "to" });
  await chrome.send("Tracing.end");
  await complete;
  await chrome.detach();
  if (!events.some((e) => e.name === "TimeStamp" && e.args?.data?.message === name)) throw new Error(`${name}'s trace has not its mark: ${events.length} events`);
}

for (const name of ["a", "b", "c", "d"]) {
  group(name, { why: "a stand-in's" })("traces", async ({ page }) => {
    await arrive();
    await traced(page, name);
  });
}

// Alone, so first: the four after them each find the trace free.
group("left", { why: "a stand-in's", alone: true })("leaves its trace going", async ({ page }) => {
  await begin(page, "left");
  note({ name: "left", trace: "to" });
  throw new Error("left going on purpose");
});

group("detached", { why: "a stand-in's", alone: true })("detaches with its trace going", async ({ page }) => {
  const { chrome } = await begin(page, "detached");
  note({ name: "detached", trace: "to" });
  await chrome.detach();
});
