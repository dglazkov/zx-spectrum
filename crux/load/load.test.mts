// The part load in Chrome, headless (crux#8): nerd-load.js is what load.ts builds to; and each load of the pages of
// examples/page.rs, served by the part server and sending to the part telemetry, sends what it measured, once, as one
// request as the page is first hidden, and arrives whole, a telemetry line each, though the tab is closed the moment
// it is hidden, as `nerd look` closes it (blog's lost some of theirs so, one request each, on Oct 23). Each load, as a
// desktop and as a phone (touch emulated): each name once, of its kind, its own field alone; ready no earlier than
// the page was whole; and nothing the page's policy refused, which allows the script inline by its hash alone. Each
// as a reader's browser says itself, navigator.webdriver false. A load in Chrome as automation drives it,
// navigator.webdriver true, headless as a probe, saying `HeadlessChrome` as blog's probe/weigh.mjs does, or saying
// itself a reader's, sends nothing (crux#86), and telemetry prints nothing of it. And a load opened in a tab hidden,
// shown once it is complete, or prerendering (its document.prerendering said so in the page, as Chrome's would be),
// sends no fcp and no lcp, its paints no reader's wait (crux#85).
//
// Chrome is the part chrome's reader (crux#117), which a product takes beside this one. Each page is a tab of that
// Chrome's first context, where a tab is hidden as a reader's is, and automation's are that same Chrome, told so.
//
// npm ci in ../chrome, then: CHROME=... npx --yes tsx@4.20.6 load.test.mts   (from anywhere: it runs `cargo run -p load
// --example page` in its directory)
// Prints what it checked and exits 0 where all is so; else says what was not, and exits 1.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Browser } from "playwright-core";

const here = import.meta.dirname;
const problems: string[] = [];
// What end() stops, once each is started.
let server: ChildProcess | undefined, browser: Browser | undefined;
let ending: Promise<never> | undefined;
let deadline: NodeJS.Timeout | undefined;

// nerd-load.js is what load.ts builds to, as load.ts says to build it.
{
  const built = spawnSync(
    "npx",
    ["--yes", "esbuild@0.28.2", "load.ts", "--minify", "--format=iife", "--target=es2020", "--log-level=error"],
    { cwd: here, encoding: "utf8" },
  );
  if (built.status !== 0) await fail(`esbuild could not build load.ts: ${built.stderr}`);
  if (built.stdout !== readFileSync(join(here, "nerd-load.js"), "utf8")) {
    problems.push(
      "nerd-load.js is not what load.ts builds to: build it again, as load.ts says " +
        "(npx --yes esbuild@0.28.2 load.ts --minify --format=iife --target=es2020 --outfile=nerd-load.js)",
    );
  }
}

// A product that runs this test and does not take the part chrome yet has what is above and no more, until its move
// onto it: blog's is dglazkov/blog#113 (crux#117), and once that is closed this goes.
if (!existsSync(join(here, "../chrome/launch.ts"))) {
  if (problems.length) await fail(problems.join("\n"));
  console.log("load: its script is what load.ts builds to; no load was tried, as this product does not take the part chrome");
  process.exit(0);
}
const { hide: hidden, launch, readerAgent } = await import("../chrome/launch.ts");

// The pages' server, and the telemetry lines it prints, as they come.
server = spawn("cargo", ["run", "--locked", "-q", "-p", "load", "--example", "page"], {
  cwd: here,
  env: { ...process.env, PORT: "0" },
  stdio: ["ignore", "pipe", "inherit"],
  detached: true,
});
const lines: Record<string, unknown>[] = [];
const base = await new Promise<string>((resolve) => {
  // Built first where it is not, which can take minutes on a machine kept busy; a server that never listens fails.
  const deadline = setTimeout(() => fail("the pages' server never said it was listening, in 5 minutes"), 300_000);
  server!.on("exit", (code) => ending || fail(`the pages' server ended, ${code}`));
  createInterface({ input: server!.stdout! }).on("line", (line) => {
    const at = line.match(/^listening on (http:\/\/\S+)/);
    if (at) {
      clearTimeout(deadline);
      resolve(at[1].replace("0.0.0.0", "127.0.0.1"));
    } else if (line.startsWith("{")) lines.push(JSON.parse(line));
  });
});

deadline = setTimeout(() => fail(["Chrome's part took longer than a minute", ...problems].join("\n")), 60_000);

// Chrome's own user agent, as it says itself headless and as automation leaves it.
const HEADLESS = await launch().then(async (automation) => {
  const page = await (await automation.newContext()).newPage();
  const agent = await page.evaluate<string>("navigator.userAgent");
  await automation.close();
  return agent;
}, (e) => fail(e.message));
if (!HEADLESS.includes("HeadlessChrome/")) await fail(`Chrome says itself ${HEADLESS}, not HeadlessChrome: a probe's loads would be counted`);

browser = await launch({ reader: true }).catch((e) => fail(e.message));
const pages = browser.contexts()[0];

// Recorded in the page before anything of it runs: what its policy refused, and whether its largest paint has been
// presented, as someone looking at it would wait for before doing anything.
const RECORD = `
  window.__refused = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__refused.push(e.violatedDirective + ' ' + e.blockedURI));
  new PerformanceObserver(() => { window.__painted = true; }).observe({ type: 'largest-contentful-paint', buffered: true });
`;

/** A tab of its own, as a phone where asked, as a reader's browser says itself unless a probe drives it, as
 * automation drives it where asked (a probe's is), and the requests it makes to /nerd/event, as they are made: each
 * by its type, as Chrome has it, and its body. */
async function tab(phone: boolean, probe = false, automated = probe) {
  const page = await pages.newPage();
  const beacons: { type: string; body: string | null }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/nerd/event")) beacons.push({ type: request.resourceType(), body: request.postData() });
  });
  await page.addInitScript(RECORD);
  const cdp = await pages.newCDPSession(page);
  if (probe) await cdp.send("Emulation.setUserAgentOverride", { userAgent: HEADLESS });
  else if (phone) await cdp.send("Emulation.setUserAgentOverride", { userAgent: readerAgent(browser!.version(), true) });
  if (automated) await cdp.send("Emulation.setAutomationOverride", { enabled: true });
  if (phone) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  const run = <T = any>(expression: string) => page.evaluate<T>(expression);
  return { page, run, beacons };
}
type Tab = Awaited<ReturnType<typeof tab>>;

/** Waits for `what` to be true in the tab. */
async function until(t: Tab, what: string) {
  for (let i = 0; !(await t.run(what)); i++) {
    if (i === 400) throw new Error(`${what} never was, at ${await t.run("location.href")}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Hides the tab, as another opened over it does; and the tab over it, left open where asked. */
async function hide(t: Tab, leave = false) {
  const over = await hidden(t.page);
  if (!leave) await over.close();
  return over;
}

/** Shows the tab again. */
async function show(t: Tab) {
  await t.page.bringToFront();
  await until(t, 'document.visibilityState === "visible"');
}

/** Clicks as a person would, so that the browser counts it an interaction. */
async function press(t: Tab) {
  const { x, y } = await t.run(
    `(() => { const r = document.getElementById("press").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  await t.page.mouse.click(x, y);
}

// What a load sends where no one did anything in it; and where someone did, how long it took.
const LOADED = ["load.ttfb", "load.fcp", "load.lcp", "load.cls", "load.ready"];

/** A load of `path`: hidden and its tab closed at once; then what reached the server of it, a line each of `names`
 * once, of `kind`, with its own field alone, a whole number; sent as one request; ready no earlier than `whole` in
 * the page; and nothing its policy refused. Opened shown, as a reader opens it, or hidden, in a tab behind another
 * and shown once it is complete, or prerendering, as the page sees it. */
async function load(path: string, kind: string, phone: boolean, names: string[], whole: string, act?: (t: Tab) => Promise<void>, again = false, opened: "shown" | "hidden" | "prerendering" = "shown") {
  const what = `${path} as ${kind}${opened === "shown" ? "" : `, opened ${opened}`}`;
  const t = await tab(phone);
  if (opened === "prerendering") {
    await t.page.addInitScript("Object.defineProperty(Document.prototype, 'prerendering', { get: () => true, configurable: true });");
  }
  const over = opened === "hidden" ? await hide(t, true) : undefined;
  await t.page.goto(base + path, { waitUntil: "commit" });
  if (over) {
    await until(t, "document.readyState === 'complete' && document.visibilityState === 'hidden'");
    await over.close();
    await show(t);
  }
  await until(t, "!!window.__painted && document.readyState === 'complete'");
  if (act) await act(t);
  const at: number = await t.run(whole);
  const refused: string[] = await t.run("window.__refused");
  const ran: boolean = await t.run("!!window.nerdLoad");
  const from = lines.length;
  await hide(t);
  if (again) {
    // A page hidden again is not a load again.
    await show(t);
    await hide(t);
  }
  await t.page.close();

  if (!ran) problems.push(`${what}: the script never ran`);
  if (refused.length) problems.push(`${what}: the policy refused ${refused.join(", ")}`);
  for (let i = 0; lines.length - from < names.length; i++) {
    if (i === 200) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const sent = lines.slice(from) as { nerd: string; name: string; kind: string; ms?: number; n?: number }[];
  const types = t.beacons.map((b) => b.type);
  if (JSON.stringify(types) !== JSON.stringify(["ping"])) problems.push(`${what}: sent ${JSON.stringify(types)}, not one beacon`);
  // What the browser sent, before telemetry made its lines of it: the same events, and nothing else of the reader.
  for (const { body } of t.beacons) {
    const lines = sent.map(({ nerd, ...e }) => e);
    if (body !== JSON.stringify(lines)) problems.push(`${what}: sent ${body}, where telemetry printed ${JSON.stringify(lines)}`);
  }
  const got = sent.map((e) => e.name).sort();
  if (JSON.stringify(got) !== JSON.stringify([...names].sort())) problems.push(`${what}: sent ${got.join(", ")}, not ${names.join(", ")}`);
  for (const e of sent) {
    const field = e.name === "load.cls" ? "n" : "ms";
    const keys = Object.keys(e).sort().join(",");
    if (keys !== ["kind", "name", "nerd", field].sort().join(",")) problems.push(`${what}: ${e.name} came with ${keys}`);
    if (e.kind !== kind) problems.push(`${what}: ${e.name}'s kind is ${e.kind}, not ${kind}`);
    const n = e[field];
    if (!Number.isInteger(n) || n! < 0) problems.push(`${what}: ${e.name} is ${n}`);
  }
  const ready = sent.find((e) => e.name === "load.ready");
  if (ready && !(ready.ms! >= Math.floor(at))) problems.push(`${what}: ready at ${ready.ms}ms, before it was whole, at ${at}ms`);
  return sent;
}

/** A load of `path` in Chrome as automation drives it, navigator.webdriver true, headless and saying so where a
 * probe drives it, and saying itself a reader's otherwise: the page painted and complete, the script run, and hidden.
 * It sends nothing: its tab's beacons are judged by `judged`, once the readers' loads after it have arrived, so that
 * one sent late is seen. */
const automation: { what: string; t: Tab }[] = [];
async function automated(path: string, kind: string, phone: boolean, probe: boolean) {
  const what = `${path} as ${kind}, by ${probe ? "a probe" : "other automation"}`;
  const t = await tab(phone, probe, true);
  await t.page.goto(base + path, { waitUntil: "commit" });
  await until(t, "!!window.__painted && document.readyState === 'complete'");
  const agent: string = await t.run("navigator.userAgent");
  if (agent.includes("HeadlessChrome") !== probe) problems.push(`${what}: Chrome said itself ${agent}`);
  if ((await t.run("navigator.webdriver")) !== true) problems.push(`${what}: navigator.webdriver is not true`);
  if (!(await t.run("!!window.nerdLoad"))) problems.push(`${what}: the script never ran`);
  await hide(t);
  automation.push({ what, t });
}
async function judged() {
  for (const { what, t } of automation) {
    if (t.beacons.length) problems.push(`${what}: sent ${t.beacons.map((b) => b.body).join(", ")}, where automation sends nothing`);
    await t.page.close();
  }
}

// When a page rendered whole is whole: its HTML parsed.
const PARSED = 'performance.getEntriesByType("navigation")[0].domContentLoadedEventStart';

let counted = 0;
try {
  // Automation's loads first, so that whatever they sent is among the lines before the readers' arrive.
  await automated("/post/", "post.phone", true, true);
  await automated("/", "home.desktop", false, true);
  await automated("/post/", "post.phone", true, false);
  await automated("/app/", "app.desktop", false, false);
  const UNSHOWN = LOADED.filter((n) => n !== "load.fcp" && n !== "load.lcp");
  const loads = [
    () => load("/", "home.desktop", false, LOADED, PARSED),
    () => load("/", "home.phone", true, LOADED, PARSED),
    () => load("/post/", "post.desktop", false, [...LOADED, "load.inp"], PARSED, press),
    () => load("/post/", "post.phone", true, LOADED, PARSED),
    // Built by script: ready is the frame its view was shown in, and the later call is not another load.
    () => load("/app/", "app.desktop", false, LOADED, "window.framed", undefined, true),
    () => load("/app/", "app.phone", true, [...LOADED, "load.inp"], "window.framed", press),
    // Opened where no one saw it paint: its paints are not sent.
    () => load("/post/", "post.desktop", false, UNSHOWN, PARSED, undefined, false, "hidden"),
    () => load("/app/", "app.phone", true, UNSHOWN, "window.framed", undefined, false, "hidden"),
    () => load("/", "home.phone", true, UNSHOWN, PARSED, undefined, false, "prerendering"),
  ];
  for (const l of loads) counted += (await l()).length;
  await judged();
  // Every line printed is a reader's load's: none is automation's.
  if (lines.length !== counted) problems.push(`telemetry printed ${lines.length} lines, where the readers' loads sent ${counted}`);
} catch (e) {
  problems.push(e instanceof Error ? e.stack || e.message : String(e));
}
if (problems.length) await fail(problems.join("\n"));
console.log(
  `load: ${lines.length} events from 9 loads, each one beacon that arrived whole as its tab closed, 3 of them opened ` +
    "unseen and sending no paint; " +
    "and 4 loads as automation drives Chrome, 2 of them a probe's, sending nothing",
);
await end(0);

/** Stops the server, every process of its group, and closes Chrome, or leaves it to launch where it will not close. */
function end(code: number): Promise<never> {
  ending ??= (async () => {
    clearTimeout(deadline);
    try { process.kill(-server!.pid!, "SIGKILL"); } catch {}
    await Promise.race([browser?.close(), new Promise((r) => setTimeout(r, 10_000))]).catch(() => {});
    process.exit(code);
  })();
  return ending;
}

async function fail(why: string): Promise<never> {
  console.error(`load: ${why}`);
  try {
    return await end(1);
  } catch (e) {
    console.error(`load: ${e instanceof Error ? e.stack : e}`);
    process.exit(1);
  }
}
