// The stand-in product's pages (crux#118), on a port the server chooses: what `serve` starts in its suites. They are
// here for what a page does as it loads, each as one script.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

const PAGES = {
  "/throws": `<script>throw new Error("thrown in the page")</script>`,
  "/writes": `<script>console.error("written to the console")</script>`,
  "/warns": `<script>console.warn("a warning")</script>`,
  "/popup": `<a id=open href=/throws target=_blank>open</a>`,
  "/loading": `<img src=/never>`,
};

export async function serve() {
  const server = createServer((request, response) => {
    if (request.url === "/never") return;
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><title>stand-in</title><link rel=icon href=data:,>${PAGES[request.url] ?? "<p>a page"}`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

/** Holds this process for `ms`, as a stall does, with nothing waiting for a CPU. */
export async function stall(ms) {
  const held = spawn("sh", ["-c", `kill -STOP ${process.pid}; sleep ${ms / 1000}; kill -CONT ${process.pid}`], { stdio: "ignore" });
  await once(held, "exit");
}

/** A stall of `ms` that ends in this very moment: what wakes this process was written while it was held, so that its part
 * goes on as it wakes, beside what counts the stall. */
export async function stallEnding(ms) {
  const held = spawn("sh", ["-c", `kill -STOP ${process.pid}; sleep ${ms / 1000}; echo; kill -CONT ${process.pid}`], { stdio: ["ignore", "pipe", "ignore"] });
  await once(held.stdout, "data");
}
