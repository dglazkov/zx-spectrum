// How a load of the page went, as the browser measures it, sent once as the page is first hidden (crux#8, lifted
// from blog#31): load.ttfb, load.fcp, load.lcp and load.inp in ms, load.cls in thousandths, and load.ready, when the
// page was whole, from the navigation's start. They go together, as one list in one beacon to /nerd/event, which the
// part telemetry prints a line each: a browser torn down at once after hiding the page sends all of them or none,
// where one request each lost some (blog's on Oct 23). Each event's kind is VIEW.DEVICE: the view the page named,
// and phone where the main pointer is coarse, else desktop. Nothing else goes with it, nothing of the reader, and a
// number the browser never gave is not sent.
//
// A paint is a reader's wait only where the page was shown for it: fcp and lcp are not sent where the page was hidden
// or prerendering as it began, as one opened in a background tab is, as web-vitals drops them (crux#85: blog's loads
// in a background tab said an lcp of 4,118 s). Shown, it is sent as it is first hidden, its paints all before that.
//
// Nothing is sent where navigator.webdriver is true, as in a browser automation drives, a probe or a crawler, so
// that the lab's own Chrome is not counted as a reader (crux#86: blog's tests sent 481 post.phone loads on Oct 24).
//
// It reads PerformanceObserver alone, nothing from elsewhere. It is the same script on every page, with nothing of
// the page's in it, so that a policy allows it by its hash. A page rendered whole on the server has it inline,
// minified, with its view on the script itself (<script data-view="post">), and is whole once its HTML is parsed. A
// page whose views are built by script loads it as a file, early in its head, and calls nerdLoad.ready(view) once
// its first view is shown whole: ready is that frame. Later calls, as a switch of view, are not a load. Where the
// page is hidden before either, its view is none.
//
// nerd-load.js is this, built: `npx --yes esbuild@0.28.2 load.ts --minify --format=iife --target=es2020 --outfile=nerd-load.js`
// in this directory, which load.test.mts checks.

type Entry = PerformanceEntry & {
  responseStart?: number;
  interactionId?: number;
  value?: number;
  hadRecentInput?: boolean;
};

declare global {
  interface Window {
    nerdLoad: { ready(view: string): void };
  }
}

/** What the browser gave, by the event's name after "load.". */
const got: Record<string, number> = {};
/** The observers, each with what it gives its entries to, so that what each holds yet is taken as the page hides. */
const observers: [PerformanceObserver, (e: Entry) => void][] = [];
const now = () => performance.now();
// Named once, as the minifier keeps every "document" whole.
const doc = document;
/** Whether the page began unseen: hidden, or prerendering. */
const unseen = doc.visibilityState == "hidden" || (doc as { prerendering?: boolean }).prerendering;

/** Observes entries of a type, where the browser has them, each given to f; and says whether it does. */
function observe(type: string, f: (e: Entry) => void, more = {}): boolean {
  if (!(PerformanceObserver.supportedEntryTypes || []).includes(type)) return false;
  const o = new PerformanceObserver((list) => list.getEntries().forEach((e) => f(e)));
  o.observe({ type, buffered: true, ...more });
  observers.push([o, f]);
  return true;
}

observe("navigation", (e) => {
  if (e.responseStart! > 0) got.ttfb = e.responseStart!;
});
observe("paint", (e) => {
  if (e.name == "first-contentful-paint" && !unseen) got.fcp = e.startTime;
});
observe("largest-contentful-paint", (e) => {
  if (!unseen) got.lcp = e.startTime;
});
// The longest interaction: each of its events has its id, and the slowest is its duration.
const interaction = (e: Entry) => {
  if (e.interactionId) got.inp = Math.max(got.inp || 0, e.duration);
};
observe("event", interaction, { durationThreshold: 16 });
observe("first-input", interaction);
// An observer's entries come in a task after it observes, so that no shift is lost to the 0.
if (observe("layout-shift", (e) => { if (!e.hadRecentInput) got.cls += e.value!; })) got.cls = 0;

let view: string | undefined;
let sent = false;

/** The page built by script: ready is the frame its first view is shown in. */
function ready(name: string) {
  if (view !== undefined) return;
  view = name;
  requestAnimationFrame(() => {
    got.ready = now();
  });
}

const named = doc.currentScript?.dataset.view;
if (named) {
  const parsed = () => {
    view = named;
    got.ready = now();
  };
  if (doc.readyState == "loading") doc.addEventListener("DOMContentLoaded", parsed);
  else parsed();
}

doc.addEventListener("visibilitychange", () => {
  if (sent || navigator.webdriver || doc.visibilityState != "hidden") return;
  sent = true;
  for (const [o, f] of observers) o.takeRecords().forEach((e) => f(e));
  const kind = (view || "none") + "." + (matchMedia("(pointer:coarse)").matches ? "phone" : "desktop");
  const events = Object.keys(got).map((k) =>
    k == "cls" ? { name: "load.cls", kind, n: Math.round(got.cls * 1e3) } : { name: "load." + k, kind, ms: Math.round(got[k]) },
  );
  if (!events.length) return;
  const body = JSON.stringify(events);
  const to = "/nerd/event";
  if (!navigator.sendBeacon?.(to, body)) {
    fetch(to, { method: "POST", keepalive: true, body }).catch(() => {});
  }
});

window.nerdLoad = { ready };

export {};
