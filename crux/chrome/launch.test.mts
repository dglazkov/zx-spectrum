// launch, against the real Chrome: what it runs and what it reads from the environment; a reader's Chrome and
// automation's, as a page and a server see them; and what is left of Chrome once it is closed or its test has died.
//
// npm ci && CHROME=... npx --yes tsx@4.20.6 --test launch.test.mts    (as `nerd test chrome` runs it, CHROME its own)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { chromeProcess, hide, launch, type Options, readerAgent } from "./launch.ts";

/** Runs `f` with these in the environment, as `nerd test` would give them. */
async function withEnv<T>(env: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const set = (e: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(e)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  };
  set(env);
  try {
    return await f();
  } finally {
    set(was);
  }
}

/** A Chrome for this test, closed at its end, whatever became of it: one closed already is closed to no effect. */
async function chrome(t: TestContext, options?: Options) {
  const browser = await launch(options);
  t.after(() => browser.close());
  return browser;
}

/** The processes of Chrome's group, or with its profile in their arguments, that have not ended. */
function left({ pid, profile }: { pid: number; profile: string }): string[] {
  const found: string[] = [];
  for (const p of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      // After the process's name, in brackets, which may hold spaces: its state, parent and group.
      const [state, , group] = readFileSync(`/proc/${p}/stat`, "utf8").split(") ").pop()!.split(" ");
      const line = readFileSync(`/proc/${p}/cmdline`, "utf8");
      if (state !== "Z" && (Number(group) === pid || line.includes(profile))) found.push(`${p}: ${line.slice(0, 100)}`);
    } catch {
      // It ended as it was read.
    }
  }
  return found;
}

/** Waits for what `f` gives to be empty or false, and gives it: what is left is the kernel's to take, in its time. */
async function gone<T>(f: () => T): Promise<T> {
  for (let i = 0; i < 2000; i++) {
    const was = f();
    if (Array.isArray(was) ? !was.length : !was) return was;
    await sleep(10);
  }
  return f();
}

// A page as a reader reaches one, on loopback, which a browser counts as secure and so tells its client hints.
let asked: IncomingHttpHeaders | undefined;
const server = createServer((request, response) => {
  if (request.url === "/") asked = request.headers;
  // As strict as a product's pages are, which refuses what a test might run in the page by a string.
  if (request.url === "/strict") response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("Content-Type", "text/html");
  response.end("<p>a page");
});
let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(() => server.close());

test("a Chrome that is not there fails, saying so", async () => {
  await withEnv({ CHROME: "/nowhere/chrome" }, () =>
    assert.rejects(launch(), (e: Error) => /no Chrome at \/nowhere\/chrome/.test(e.message) && !/playwright install/.test(e.message)),
  );
  await withEnv({ CHROME: undefined }, () => assert.rejects(launch(), /CHROME is not set/));
  // Something there that is not a Chrome.
  await withEnv({ CHROME: "/bin/true" }, () => assert.rejects(launch(), /no Chrome at \/bin\/true/));
});

test("CHROME_ARGS and the test's own flags reach Chrome, and its sandbox stays on", async (t) => {
  await withEnv({ CHROME_ARGS: "--user-agent=from-chrome-args  --crux-from-machine" }, async () => {
    for (const reader of [false, true]) {
      const browser = await chrome(t, { reader, args: ["--crux-from-test"] });
      const { pid } = await chromeProcess(browser);
      const line = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      assert.match(line, /--crux-from-machine/);
      assert.match(line, /--crux-from-test/);
      assert.doesNotMatch(line, /--no-sandbox/);
      if (!reader) {
        const page = await (await browser.newContext()).newPage();
        assert.equal(await page.evaluate("navigator.userAgent"), "from-chrome-args");
      }
    }
  });
});

test("Chrome as automation leaves it says so", async (t) => {
  const browser = await chrome(t);
  const page = await (await browser.newContext()).newPage();
  await page.goto(base);
  assert.equal(await page.evaluate("navigator.webdriver"), true);
  assert.match(await page.evaluate<string>("navigator.userAgent"), /HeadlessChrome/);
  assert.match(asked!["user-agent"]!, /HeadlessChrome/);
});

test("a reader's Chrome is not automation and not headless, in every context", async (t) => {
  const browser = await chrome(t, { reader: true });
  for (const context of [browser.contexts()[0], await browser.newContext()]) {
    const page = await context.newPage();
    await page.goto(base);
    assert.equal(await page.evaluate("navigator.webdriver"), false);
    const said = [
      await page.evaluate<string>("navigator.userAgent"),
      await page.evaluate<string>("JSON.stringify(navigator.userAgentData.brands)"),
      asked!["user-agent"]!,
      String(asked!["sec-ch-ua"]),
    ];
    assert.match(said[0], /Chrome\/\d+\.0\.0\.0/);
    assert.match(said[3], /Google Chrome/);
    for (const s of said) assert.doesNotMatch(s, /headless/i);
  }
  assert.match(readerAgent(browser.version()), new RegExp(`Chrome/${browser.version().split(".")[0]}\\.0\\.0\\.0 `));
  assert.match(readerAgent(browser.version(), true), /Android.*Chrome\/\d+\.0\.0\.0 Mobile/);
});

test("a reader's tab is hidden as a reader's is, and sends what it sends then", async (t) => {
  const browser = await chrome(t, { reader: true });
  const page = await browser.contexts()[0].newPage();
  await page.goto(base);
  await page.evaluate(`document.addEventListener("visibilitychange", () => navigator.sendBeacon("/hidden", document.visibilityState))`);
  const sent = page.waitForRequest("**/hidden");
  const over = await hide(page);
  assert.equal((await sent).postData(), "hidden");
  await over.close();
  await page.bringToFront();
  assert.equal(await page.evaluate("document.visibilityState"), "visible");
});

test("a page that cannot be hidden fails, saying so, whatever its policy", async (t) => {
  const browser = await chrome(t, { reader: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}strict`);
  await assert.rejects(hide(page), /strict stayed shown/);
});

test("closed, nothing of Chrome is left, its profile with it", async (t) => {
  for (const reader of [false, true]) {
    const browser = await chrome(t, { reader });
    const running = await chromeProcess(browser);
    await (await (await browser.newContext()).newPage()).goto(base);
    assert.ok(existsSync(running.profile), running.profile);
    assert.notEqual(left(running).length, 0);
    await browser.close();
    assert.deepEqual(await gone(() => left(running)), []);
    assert.equal(await gone(() => existsSync(running.profile)), false);
  }
});

// Under node's test runner, a child's test would report to it, not print.
const { NODE_TEST_CONTEXT: _, ...env } = process.env;
const dies = join(import.meta.dirname, "dies.mts");

/** A test of its own that opens Chrome, in a temporary directory of its own, and dies by `how`: what it threw, or
 * `signal`, sent once Chrome is open. Every process of Chrome is gone; and it gives what asks what is left of the rest. */
async function death(t: TestContext, as: string, how: string, signal?: NodeJS.Signals) {
  // In /tmp, not under the temporary directory nerd gives a test: Chrome's socket under it would be too long for a path.
  const tmp = mkdtempSync("/tmp/crux-chrome-dies-");
  const child = spawn(process.execPath, [...process.execArgv, dies, as, how], {
    env: { ...env, TMPDIR: tmp },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGKILL");
    rmSync(tmp, { recursive: true, force: true });
  });
  const ended = new Promise((resolve) => child.on("exit", resolve));
  const running = await new Promise<{ pid: number; profile: string }>((resolve, reject) => {
    let out = "", err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("\n")) resolve(JSON.parse(out));
    });
    child.on("close", (code) => reject(new Error(`the test ended, ${code}, with Chrome never open: ${err}`)));
  });
  if (signal) child.kill(signal);
  await ended;
  assert.deepEqual(await gone(() => left(running)), []);
  // But for what tsx compiled, and the scratch of Chrome's own processes, which a process killed cannot clear.
  return () => gone(() => readdirSync(tmp).filter((name) => !/^(tsx-|com\.google\.Chrome\.)/.test(name)));
}

for (const as of ["automation", "reader"]) {
  test(`a test that throws leaves nothing of Chrome, ${as}'s`, async (t) => {
    assert.deepEqual(await (await death(t, as, "throw"))(), []);
  });

  test(`a test stopped leaves nothing of Chrome, ${as}'s`, async (t) => {
    assert.deepEqual(await (await death(t, as, "wait", "SIGTERM"))(), []);
  });

  test(`a test killed leaves no process of Chrome, ${as}'s`, async (t) => {
    await death(t, as, "wait", "SIGKILL");
  });
}
