// The part load in Chrome, headless (crux#8): nerd-load.js is what load.ts builds to; and each load of the pages of
// examples/page.rs, served by the part server and sending to the part telemetry, sends what it measured, once, as one
// request as the page is first hidden, and arrives whole, a telemetry line each, though the tab is closed the moment
// it is hidden, as `nerd look` closes it (blog's lost some of theirs so, one request each, on Oct 23). Each load, as a
// desktop and as a phone (touch emulated): each name once, of its kind, its own field alone; ready no earlier than
// the page was whole; and nothing the page's policy refused, which allows the script inline by its hash alone. Each
// as a reader's browser says itself; and a load in Chrome as a probe drives it, saying `HeadlessChrome`, as blog's
// probe/weigh.mjs does, sends its beacon all the same, and telemetry prints nothing of it (crux#23).
//
// npx --yes tsx@4.20.6 load.test.mts   (from anywhere: it runs `cargo run -p load --example page` in its directory)
// Prints what it checked and exits 0 where all is so; else says what was not, and exits 1.

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const here = import.meta.dirname;
const problems: string[] = [];
// What end() stops, once each is started.
let server: ChildProcess | undefined, chrome: ChildProcess | undefined;
let ended: Promise<unknown> = Promise.resolve();
let ending: Promise<never> | undefined;
let deadline: NodeJS.Timeout | undefined;
const dir = mkdtempSync(join(tmpdir(), "crux-load-"));

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

chrome = spawn(
  process.env.CHROME || "google-chrome",
  [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"], detached: true },
);
chrome.on("error", (e) => fail(`Chrome could not start: ${e.message}`));
// Chrome leads a process group of its own, its renderers and services in it, so that the end can kill them all and
// wait for them: they write in its profile until they are gone.
ended = new Promise((resolve) => {
  chrome!.on("exit", resolve);
  chrome!.on("error", resolve);
});
deadline = setTimeout(() => fail(["Chrome's part took longer than a minute", ...problems].join("\n")), 60_000);

const ws = await new Promise<string>((resolve) => {
  let err = "";
  chrome!.stderr!.on("data", (d) => {
    err += d;
    const m = err.match(/DevTools listening on (ws:\S+)/);
    if (m) resolve(m[1]);
  });
  ended.then(() => ending || fail(`Chrome ended: ${err}`));
});

const socket = new WebSocket(ws);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let next = 0;
type Waiting = { resolve: (v: any) => void; reject: (e: Error) => void; method: string };
const waiting = new Map<number, Waiting>();
const listeners: ((m: any) => void)[] = [];
socket.onmessage = ({ data }) => {
  const m = JSON.parse(String(data));
  if (m.id !== undefined) {
    const w = waiting.get(m.id)!;
    waiting.delete(m.id);
    if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`));
    else w.resolve(m.result);
  } else for (const l of listeners) l(m);
};
function send(method: string, params = {}, sessionId?: string): Promise<any> {
  const id = ++next;
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject, method }));
}

// Recorded in the page before anything of it runs: what its policy refused, and whether its largest paint has been
// presented, as someone looking at it would wait for before doing anything.
const RECORD = `
  window.__refused = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__refused.push(e.violatedDirective + ' ' + e.blockedURI));
  new PerformanceObserver(() => { window.__painted = true; }).observe({ type: 'largest-contentful-paint', buffered: true });
`;

// Chrome's own user agent, as it says itself headless, and the same Chrome as a reader's, on a desktop and a phone.
const { userAgent: HEADLESS } = await send("Browser.getVersion");
const version = HEADLESS.match(/HeadlessChrome\/(\S+)/)?.[1];
if (!version) await fail(`Chrome says itself ${HEADLESS}, not HeadlessChrome: a probe's loads would be counted`);
const READER = {
  desktop: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
  phone: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`,
};

/** A tab of its own, as a phone where asked, as a reader's browser says itself unless a probe drives it, and the
 * requests it makes to /nerd/event, as they are made: each by its type, as Chrome has it, its body, and its status
 * once answered. */
async function tab(phone: boolean, probe = false) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method: string, params = {}) => send(method, params, sessionId);
  const beacons: { id: string; type: string; body: string; status?: number }[] = [];
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Network.requestWillBeSent" && m.params.request.url.endsWith("/nerd/event")) {
      beacons.push({ id: m.params.requestId, type: m.params.type, body: m.params.request.postData });
    }
    const beacon = beacons.find((b) => b.id === m.params?.requestId);
    if (beacon && m.method === "Network.responseReceived") beacon.status = m.params.response.status;
  });
  await s("Network.enable");
  await s("Page.enable");
  await s("Page.addScriptToEvaluateOnNewDocument", { source: RECORD });
  if (!probe) await s("Emulation.setUserAgentOverride", { userAgent: phone ? READER.phone : READER.desktop });
  if (phone) {
    await s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  const run = async (expression: string) => {
    const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  return { s, run, targetId, beacons };
}
type Tab = Awaited<ReturnType<typeof tab>>;

/** Waits for `what` to be true in the tab. */
async function until(t: Tab, what: string) {
  for (let i = 0; !(await t.run(what)); i++) {
    if (i === 400) throw new Error(`${what} never was, at ${await t.run("location.href")}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Hides the tab, as another opened over it does. */
async function hide(t: Tab) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  await send("Target.activateTarget", { targetId });
  await until(t, 'document.visibilityState === "hidden"');
  await send("Target.closeTarget", { targetId });
}

/** Clicks as a person would, so that the browser counts it an interaction. */
async function press(t: Tab) {
  const { x, y } = await t.run(
    `(() => { const r = document.getElementById("press").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await t.s("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

// What a load sends where no one did anything in it; and where someone did, how long it took.
const LOADED = ["load.ttfb", "load.fcp", "load.lcp", "load.cls", "load.ready"];

/** A load of `path`: hidden and its tab closed at once; then what reached the server of it, a line each of `names`
 * once, of `kind`, with its own field alone, a whole number; sent as one request; ready no earlier than `whole` in
 * the page; and nothing its policy refused. */
async function load(path: string, kind: string, phone: boolean, names: string[], whole: string, act?: (t: Tab) => Promise<void>, again = false) {
  const what = `${path} as ${kind}`;
  const t = await tab(phone);
  await t.s("Page.navigate", { url: base + path });
  await until(t, "!!window.__painted && document.readyState === 'complete'");
  if (act) await act(t);
  const at: number = await t.run(whole);
  const refused: string[] = await t.run("window.__refused");
  const ran: boolean = await t.run("!!window.nerdLoad");
  const from = lines.length;
  await hide(t);
  if (again) {
    // A page hidden again is not a load again.
    await t.s("Page.bringToFront");
    await until(t, 'document.visibilityState === "visible"');
    await hide(t);
  }
  await send("Target.closeTarget", { targetId: t.targetId });

  if (!ran) problems.push(`${what}: the script never ran`);
  if (refused.length) problems.push(`${what}: the policy refused ${refused.join(", ")}`);
  for (let i = 0; lines.length - from < names.length; i++) {
    if (i === 200) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const sent = lines.slice(from) as { nerd: string; name: string; kind: string; ms?: number; n?: number }[];
  const types = t.beacons.map((b) => b.type);
  if (JSON.stringify(types) !== JSON.stringify(["Ping"])) problems.push(`${what}: sent ${JSON.stringify(types)}, not one beacon`);
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

/** A load of `path` in Chrome as a probe drives it, headless and saying so: the script runs and sends its beacon, as
 * it would for a reader, and the server answers it; what it printed of it is judged once the readers' loads after it
 * have arrived, as it printed it before it answered. */
async function probed(path: string, kind: string, phone: boolean) {
  const what = `${path} as ${kind}, by a probe`;
  const t = await tab(phone, true);
  await t.s("Page.navigate", { url: base + path });
  await until(t, "!!window.__painted && document.readyState === 'complete'");
  const agent: string = await t.run("navigator.userAgent");
  if (!agent.includes("HeadlessChrome")) problems.push(`${what}: Chrome said itself ${agent}`);
  if (!(await t.run("!!window.nerdLoad"))) problems.push(`${what}: the script never ran`);
  await hide(t);
  for (let i = 0; !t.beacons.some((b) => b.status); i++) {
    if (i === 200) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  await send("Target.closeTarget", { targetId: t.targetId });
  const sent = t.beacons.map((b) => `${b.type} ${b.status}`);
  if (JSON.stringify(sent) !== JSON.stringify(["Ping 204"])) problems.push(`${what}: sent ${JSON.stringify(sent)}, not one beacon answered 204`);
  if (!t.beacons.some((b) => b.body?.includes(`"kind":"${kind}"`))) problems.push(`${what}: its beacon was ${t.beacons[0]?.body}, not its load`);
}

// When a page rendered whole is whole: its HTML parsed.
const PARSED = 'performance.getEntriesByType("navigation")[0].domContentLoadedEventStart';

let counted = 0;
try {
  // A probe's loads first, so that whatever telemetry printed of them is among the lines before the readers' arrive.
  await probed("/post/", "post.phone", true);
  await probed("/", "home.desktop", false);
  const loads = [
    () => load("/", "home.desktop", false, LOADED, PARSED),
    () => load("/", "home.phone", true, LOADED, PARSED),
    () => load("/post/", "post.desktop", false, [...LOADED, "load.inp"], PARSED, press),
    () => load("/post/", "post.phone", true, LOADED, PARSED),
    // Built by script: ready is the frame its view was shown in, and the later call is not another load.
    () => load("/app/", "app.desktop", false, LOADED, "window.framed", undefined, true),
    () => load("/app/", "app.phone", true, [...LOADED, "load.inp"], "window.framed", press),
  ];
  for (const l of loads) counted += (await l()).length;
  // Every line printed is a reader's load's: none is the probe's.
  if (lines.length !== counted) problems.push(`telemetry printed ${lines.length} lines, where the readers' loads sent ${counted}`);
} catch (e) {
  problems.push(e instanceof Error ? e.stack || e.message : String(e));
}
if (problems.length) await fail(problems.join("\n"));
console.log(
  `load: ${lines.length} events from 6 loads, each one beacon that arrived whole as its tab closed; ` +
    "and 2 loads by a probe, each its beacon answered, and none of it printed",
);
await end(0);

/** Kills Chrome and the server, every process of their groups, and removes Chrome's profile once the last is gone. */
function end(code: number): Promise<never> {
  ending ??= (async () => {
    clearTimeout(deadline);
    for (const p of [server, chrome]) {
      try { process.kill(-p!.pid!, "SIGKILL"); } catch {}
    }
    await ended;
    for (let i = 0; chrome; i++) {
      try { process.kill(-chrome.pid!, 0); } catch { break; }
      if (i === 1000) {
        console.error(`load: Chrome's processes were still there 10s after it was killed; its profile is left in ${dir}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    rmSync(dir, { recursive: true, force: true });
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
