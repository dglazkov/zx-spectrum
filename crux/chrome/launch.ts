// Chrome as a product's tests start it (crux#117), with what the machine and the products have learned: launch and
// nothing else starts one, so that what one product learns of Chrome reaches them all.
//
//   import { launch } from "../crux/chrome/launch.ts";
//   const browser = await launch();
//   const page = await (await browser.newContext()).newPage();
//   await browser.close();
//
//   const reader = await launch({ reader: true }); // a reader's Chrome, as `reader` below says
//
// It reads the Chrome to run from CHROME and the flags that suit this machine from CHROME_ARGS, as `nerd test` gives
// them (`nerd guide chrome`), and depends on playwright-core alone, at the version package.json fixes, which brings no
// browser. Its node_modules are the part's own: `npm ci` in this directory.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Browser, chromium, type LaunchOptions, type Page } from "playwright-core";

export type Options = Omit<LaunchOptions, "executablePath" | "chromiumSandbox" | "handleSIGTERM" | "handleSIGHUP"> & {
  /** Chrome as a reader's, not as automation leaves it: `navigator.webdriver` false, not saying itself headless, and
   * its tabs hidden as a reader's are, as `hide` says. A page that sends what it measured to readers alone, as crux's
   * load does, sends it here. */
  reader?: boolean;
};

// A test told to stop ends as it would have, by exit, whose handler is Playwright's, taking Chrome and its profile with
// it. Left to Playwright, these close Chrome and leave the test running, to wait for a page that will never come.
for (const [signal, code] of [["SIGTERM", 143], ["SIGHUP", 129]] as const) process.once(signal, () => process.exit(code));

/** The Chrome to run, and its major version: fails, saying so, where it is not there, as Playwright would otherwise
 * say to fetch a browser of its own, which no test here wants. */
function find(): { chrome: string; major: string } {
  const chrome = process.env.CHROME;
  if (!chrome) throw new Error("CHROME is not set: `nerd test` gives a test the Chrome to run, and `nerd browser` says where it is");
  const { error, stdout } = spawnSync(chrome, ["--version"], { encoding: "utf8" });
  const major = stdout?.match(/(\d+)\.\d+\.\d+\.\d+/)?.[1];
  if (error || !major) throw new Error(`no Chrome at ${chrome}, as CHROME says: ${error?.message ?? `it said ${JSON.stringify(stdout)}`}`);
  return { chrome, major };
}

/** The user agent of a reader's Chrome of that version, or of its first number, as Chrome itself says it, on a desktop
 * or a phone: `reader` says the desktop's, and a phone's page takes this as its override. */
export function readerAgent(version: string, phone = false): string {
  const major = version.split(".")[0];
  return phone
    ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`
    : `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** Starts Chrome: every process of it gone, and its profile, a directory of its own, removed, when it is closed. Where
 * the test dies first, by what it threw, process.exit or a signal, Playwright's handlers do the same; killed outright,
 * Chrome ends with the pipe it was driven over, and its profile is left in the temporary directory. */
export async function launch({ reader, args = [], ...options }: Options = {}): Promise<Browser> {
  const { chrome, major } = find();
  const machine = (process.env.CHROME_ARGS ?? "").split(" ").filter(Boolean);
  const started = await chromium.launch({
    ...options,
    executablePath: chrome,
    // Playwright turns the sandbox off unless told, and Chrome runs with it here.
    chromiumSandbox: true,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [...machine, ...(reader ? readerArgs(major) : []), ...args],
  });
  return reader ? asReader(started) : started;
}

function readerArgs(major: string): string[] {
  return [
    // Chrome over its DevTools port says navigator.webdriver true, and Emulation.setAutomationOverride does not clear
    // it (crux#85, blog#99): this does, and that sets it again, tab by tab, where a test wants automation.
    "--disable-blink-features=AutomationControlled",
    // Chrome headless says HeadlessChrome: crux's telemetry drops what such a browser sends (crux#23, crux#55).
    `--user-agent=${readerAgent(major)}`,
    // Where asReader reaches it, by the port it chooses.
    "--remote-debugging-port=0",
  ];
}

/** Which process Chrome is, leading a process group of its renderers and services, and its profile. */
export async function chromeProcess(browser: Browser): Promise<{ pid: number; profile: string }> {
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  await session.detach();
  const pid = processInfo.find((p) => p.type === "browser")!.id;
  // Chrome writes its own process title, its arguments one string with spaces between.
  const profile = readFileSync(`/proc/${pid}/cmdline`, "utf8").match(/--user-data-dir=(.+?)(?: --|\0|$)/)?.[1];
  if (!profile) throw new Error(`Chrome, process ${pid}, names no profile`);
  return { pid, profile };
}

/** The same Chrome over a second connection, whose first context holds no tab visible. Playwright keeps every page it
 * drives shown, by focus emulation (Emulation.setFocusEmulationEnabled), so that no page of chromium.launch's is ever
 * hidden, and another session's call cannot lift it: what a page sends as it is hidden, as crux's load does, is never
 * sent. `noDefaults` lifts it for the connection's first context alone, not for those of newContext. Closing it closes
 * the Chrome launch started, which keeps what to do where the test dies. */
async function asReader(started: Browser): Promise<Browser> {
  const { profile } = await chromeProcess(started);
  const active = join(profile, "DevToolsActivePort");
  for (let waited = 0; !existsSync(active); waited += 10) {
    if (waited === 10_000) throw new Error(`Chrome wrote no ${active} in 10 s`);
    await sleep(10);
  }
  const [port, path] = readFileSync(active, "utf8").split("\n");
  // A connection's own temporary directory, where none is given, goes only with a clean close: the profile goes always.
  const connection = { noDefaults: true, isLocal: true, artifactsDir: profile };
  const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${path}`, connection);
  browser.close = (options) => started.close(options);
  return browser;
}

/** Hides a page of a reader's Chrome, in `browser.contexts()[0]`, as a tab opened over it does, and gives that tab,
 * which the test closes, or leaves over it. A page of any other context, or of a Chrome not a reader's, stays shown, as
 * asReader says, and this fails, saying so. */
export async function hide(page: Page): Promise<Page> {
  const over = await page.context().newPage();
  await over.bringToFront();
  // Asked again and again, not by waitForFunction, which a page's policy refuses to run, and polls frames a hidden page
  // does not draw.
  for (let waited = 0; (await page.evaluate("document.visibilityState")) !== "hidden"; waited += 25) {
    if (waited === 5_000) throw new Error(`${page.url()} stayed shown: only a page of a reader's first context is hidden`);
    await sleep(25);
  }
  return over;
}
