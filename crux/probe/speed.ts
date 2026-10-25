#!/usr/bin/env node
// A product's speed, as the person meets it: for each page it is given, the bytes on the wire, the
// requests a browser makes to read it, the server's time to answer, and what a phone fetches to show
// it whole. Lifted from blog's probe/speed.mjs (crux#5), and its weight from blog's probe/weigh.mjs
// (crux#22). Run it with --help.
//
// It is TypeScript a Node that strips types runs as it is (`node speed.ts`), and so only what can be
// erased: no enums, namespaces or parameter properties. Where Node was built without it, as Ubuntu's
// is, `npx --yes tsx@4.20.6 speed.ts` runs it the same.

import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `speed.ts [--url URL] [--page NAME=PATH]... [--pages FILE] [--baseline FILE] [--tries N]
         [--mark [PAGE:]NAME[=SELECTOR]]... [--ready SELECTOR] [--loads N]
         [--ideal NUMBER=VALUE]... [--main NUMBER] [--json] [--write-baseline]

Measures, against the product at --url (or $NERD_URL), for each page it is given:

  NAME_bytes     bytes on the wire for the page: its head and its body as sent, compressed as a
                 browser asks for it (br, gzip)
  NAME_requests  requests a browser makes to read it: the page and what it loads (stylesheets,
                 scripts, images, frames, fonts, icons)
  NAME_ms        the server's time to answer: from the request sent on a connection already open
                 to the first byte of the answer
  NAME_weight    bytes on the wire, headers with them, of every request a phone makes to show the
                 page whole, scrolled to its end: pictures as Chrome picks them from a srcset, lazy
                 ones as they come into view, and what its scripts fetch
  NAME_MARK_ms   for each --mark, the page's own moment after its load, from navigation: when
                 the page calls performance.mark(MARK), or, given a SELECTOR, when the page
                 first has an element it matches (--ready SELECTOR is --mark ready=SELECTOR)

The pages are each --page NAME=PATH, in the order given, or else those --pages FILE names, a JSON
object of NAME to PATH ({"home": "/", "post": "/a/long/post/"}): the product's own. The first
page's time is the main number. Each time is the median of --tries (15) answers after one to wake
the server; an answer slower than three times the median and 200 ms beyond it is noise (a server
starting after it sat idle, a stalled connection), counted and left out, as is an answer asked
again on a new connection after the first failed.

Each weight is measured once, after the times, in Chrome ($CHROME, or google-chrome), headless, a
profile of its own, as a phone (412 CSS pixels wide, 915 high, 2x, touch), its cache off, each page
a first visit, on connections of its own: the page loaded, its frames from then on running none of
its script (a page that draws every frame holds Chrome for seconds a frame), scrolled to its end a
screen at a time, and weighed once nothing has been fetched for two seconds. The headers whose value changes from one
answer to the next whatever the product sends, the time and Cloud Run's x-cloud-trace-context, are
counted as though each were sent with a value fixed for it; and each body over HTTP/2 as though it
came in frames of 16384 B, however many its front end split it into, and without the padding it
added. A third party's answer over HTTP/2 (another host's, as Google Fonts') is counted with its
headers as an encoder that indexes all it sends would code them, after those of its connection's
answers before it by URL, its times and age at values fixed for them too: whether its server sent
a header as a reference to the answer before, or whole, is its own. A weight's baseline keeps as
its worst the bytes weighed and a margin, the larger of 0.1% of them and 1 KB: a weight within it
is not worse than its baseline. A page's bytes keep one too, the larger of 0.1% of their worst and
64 B, as a page whose markup is the same compresses a few bytes apart from one build to the next
where the names of its hashed assets changed.

Each mark is timed after the times and before the weights, in Chrome as the weights are, but as a
desktop (1280 CSS pixels wide, 800 high), and as the page runs, its frames and all: each page that
has a mark loaded --loads (10) times, each a first visit, in a context of its own, until it has
each of its marks, a minute at the most. A mark is on every page, or on PAGE's alone; a load
slower than three times the median and 200 ms beyond it is noise, as the times' are. A mark's
ideal is a second, unless --ideal home_ready_ms=800 says another, as it may of any number; --main
names the main number, where the first page's time is not it.

--json prints what nerd reads (nerd guide intuition); --write-baseline writes it, with the address
and pages, to --baseline FILE (probe/speed.json), whose baselines each number is otherwise judged
against.`;

// One round trip of a new connection carries about 14 KB: a page that fits is read at once.
const IDEAL: Record<string, number> = { bytes: 14000, requests: 1, ms: 50, weight: 14000 };

/** A page to measure: its name, which starts each of its numbers' names, and its path. */
export interface Page {
  name: string;
  path: string;
}

/**
 * A moment of a page's own after its load: when it calls performance.mark(name), or, with a selector, when it
 * first has an element the selector matches. On every page, or on the page named alone.
 */
export interface Mark {
  name: string;
  page?: string;
  selector?: string;
}

/** Where times come from, in milliseconds: the process's own, or a test's. */
export interface Clock {
  now(): number;
}

export const realClock: Clock = { now: () => Number(process.hrtime.bigint()) / 1e6 };

/** One number as nerd reads it, with the worst of its tries, which a baseline keeps. */
export interface Measured {
  name: string;
  unit: string;
  value: number;
  spread: [number, number];
  better: 'lower' | 'higher';
  worst: number;
  noise: number;
  /** Its ideal, where it is not the one its kind has (a mark's, a second). */
  ideal?: number;
}

export interface Reported extends Omit<Measured, 'worst' | 'ideal'> {
  baseline: { value: number; worst: number };
  ideal: number;
}

export interface Report {
  main: string;
  numbers: Reported[];
}

export interface ProbeOptions {
  url: string;
  pages: Page[];
  tries?: number;
  clock?: Clock;
  /** How long one GET may take, in milliseconds, before it is given up. */
  deadline?: number;
  /** What weighs the pages, in their order: Chrome, as weigh() does, unless a test gives its own. */
  weigh?: (url: string, pages: Page[]) => Promise<Weighed[]>;
  /** The pages' own moments, timed after the times and before the weights. */
  marks?: Mark[];
  /** How many times each page that has a mark is loaded to time it. */
  loads?: number;
  /** What times the marks: Chrome, as timeMarks() does, unless a test gives its own. */
  time?: (url: string, pages: Page[], marks: Mark[]) => Promise<Record<string, number[]>[]>;
}

/** What a phone fetched to show a page whole: each request, and their bytes on the wire. */
export interface Weighed {
  bytes: number;
  fetched: { url: string; type: string; bytes: number; failed?: string }[];
}

export interface WeighOptions {
  /** Chrome's binary: $CHROME, or google-chrome. */
  chrome?: string;
  /** How long Chrome may take to start, and each page to be weighed, in milliseconds. */
  deadline?: number;
  /** How long nothing is fetched before the page is taken as whole, in milliseconds. */
  quiet?: number;
  /** More of Chrome's flags, as a test's own certificate wants. */
  flags?: string[];
}

export interface MarkOptions {
  /** Chrome's binary: $CHROME, or google-chrome. */
  chrome?: string;
  /** How many times each page is loaded. */
  loads?: number;
  /** How long Chrome may take to start, and each load to have its marks, in milliseconds. */
  deadline?: number;
  /** More of Chrome's flags. */
  flags?: string[];
  /** What each load's deadline is counted on, in milliseconds: the wall clock, unless a test gives its own. */
  clock?: () => number;
}

/** What a browser fetches to show the page, besides the page: each address once. */
export function subresources(html: string): string[] {
  const found = new Set<string>();
  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return m ? (m[2] ?? m[3] ?? m[4]) : null;
  };
  const add = (u: string | null) => {
    if (u && !u.startsWith('data:') && !u.startsWith('#')) found.add(u);
  };
  for (const tag of html.match(/<(img|script|iframe|source|video|audio|embed|link|input)\b[^>]*>/gi) ?? []) {
    const name = tag.slice(1).split(/[\s>]/)[0].toLowerCase();
    if (name === 'link') {
      const rel = (attr(tag, 'rel') || '').toLowerCase().split(/\s+/);
      const loads = ['stylesheet', 'icon', 'preload', 'modulepreload', 'manifest', 'apple-touch-icon'];
      if (rel.some((r) => loads.includes(r))) add(attr(tag, 'href'));
    } else if (name === 'input') {
      if ((attr(tag, 'type') || '').toLowerCase() === 'image') add(attr(tag, 'src'));
    } else {
      add(attr(tag, 'src'));
      if (name === 'video') add(attr(tag, 'poster'));
      const srcset = attr(tag, 'srcset');
      // A browser picks one candidate of a srcset.
      if (srcset && !attr(tag, 'src')) add(srcset.split(',')[0].trim().split(/\s+/)[0]);
    }
  }
  for (const style of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []) {
    for (const m of style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(m[1]);
    for (const m of style.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) add(m[1]);
  }
  // With no icon of its own, a browser asks for /favicon.ico.
  if (!/<link\b[^>]*rel\s*=\s*["']?[^"'>]*\bicon\b/i.test(html)) found.add('/favicon.ico');
  return [...found];
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The middle half of xs, from its low end to its high. */
export function quartiles(xs: number[]): [number, number] {
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  return [at(0.25), at(0.75)];
}

/** The times that are not noise: none slower than three times the median and 200 ms beyond it. */
export function withoutNoise(times: number[]): number[] {
  const mid = median(times);
  return times.filter((t) => !(t > 3 * mid && t > mid + 200));
}

const round = (x: number) => Math.round(x * 10) / 10;

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  ms: number;
  wire: number;
  retried: boolean;
}

/** GETs from one product, one connection at a time, kept open between them. */
class Fetcher {
  private lib: typeof http | typeof https;
  private agent: http.Agent;
  private url: string;
  private clock: Clock;
  private deadline: number;

  constructor(url: string, clock: Clock, deadline: number) {
    this.url = url;
    this.clock = clock;
    this.deadline = deadline;
    this.lib = new URL(url).protocol === 'https:' ? https : http;
    this.agent = new this.lib.Agent({ keepAlive: true, maxSockets: 1 });
  }

  /** One GET, its body as sent, with a deadline of its own. */
  private once(path: string): Promise<Omit<Answer, 'retried'>> {
    return new Promise((resolve, reject) => {
      const started = this.clock.now();
      const req = this.lib.request(new URL(path, this.url), {
        agent: this.agent,
        headers: { 'accept-encoding': 'br, gzip', 'user-agent': 'crux-speed-probe' },
      }, (res) => {
        const ms = this.clock.now() - started;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', (e) => { clearTimeout(timer); reject(e); });
        res.on('end', () => {
          clearTimeout(timer);
          const body = Buffer.concat(chunks);
          let head = `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}\r\n`;
          for (let i = 0; i < res.rawHeaders.length; i += 2) head += `${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}\r\n`;
          const wire = Buffer.byteLength(head + '\r\n') + body.length;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, ms, wire });
        });
      });
      const timer = setTimeout(() => req.destroy(new Error(`no answer to ${path} in ${this.deadline} ms`)), this.deadline);
      req.on('error', (e) => { clearTimeout(timer); reject(e); });
      req.end();
    });
  }

  /** One GET, asked once more on a new connection where the first fails: a dropped connection is the network's. */
  async get(path: string): Promise<Answer> {
    try {
      return { ...(await this.once(path)), retried: false };
    } catch (e) {
      this.agent.destroy();
      this.agent = new this.lib.Agent({ keepAlive: true, maxSockets: 1 });
      try {
        return { ...(await this.once(path)), retried: true };
      } catch (again) {
        throw new Error(`${path}: ${(e as Error).message}, then ${(again as Error).message}`);
      }
    }
  }

  close() {
    this.agent.destroy();
  }
}

function decode(r: Answer): string {
  const enc = r.headers['content-encoding'];
  if (enc === 'br') return zlib.brotliDecompressSync(r.body).toString('utf8');
  if (enc === 'gzip') return zlib.gunzipSync(r.body).toString('utf8');
  return r.body.toString('utf8');
}

async function measure(fetcher: Fetcher, page: Page, tries: number): Promise<Measured[]> {
  const first = await fetcher.get(page.path);
  if (first.status !== 200) throw new Error(`${page.path} answered ${first.status}`);
  const requests = 1 + subresources(decode(first)).length;
  const wires: number[] = [];
  const times: number[] = [];
  let retried = first.retried ? 1 : 0;
  for (let i = 0; i < tries; i++) {
    const r = await fetcher.get(page.path);
    if (r.status !== 200) throw new Error(`${page.path} answered ${r.status}`);
    if (r.retried) retried++;
    wires.push(r.wire);
    times.push(r.ms);
  }
  const kept = withoutNoise(times);
  const number = (key: string, unit: string, xs: number[], noise: number, worst = round(Math.max(...xs))): Measured => ({
    name: `${page.name}_${key}`, unit, value: round(median(xs)), spread: quartiles(xs).map(round) as [number, number],
    better: 'lower', worst, noise,
  });
  return [
    number('bytes', 'B', wires, 0, bytesWorst(Math.max(...wires))),
    number('requests', 'requests', [requests], 0),
    number('ms', 'ms', kept, times.length - kept.length + retried),
  ];
}

/**
 * Each page's numbers, measured against the product at url, the pages one after another; and then,
 * so that Chrome is not among what is timed, each page's weight.
 */
export async function probe(options: ProbeOptions): Promise<Measured[]> {
  if (!options.pages.length) throw new Error('no pages to measure');
  const marks = options.marks ?? [];
  for (const m of marks) {
    if (m.page !== undefined && !options.pages.some((p) => p.name === m.page)) throw new Error(`--mark ${m.page}:${m.name}: there is no page ${m.page}`);
  }
  const fetcher = new Fetcher(options.url, options.clock ?? realClock, options.deadline ?? 10000);
  const measured: Measured[][] = [];
  try {
    for (const page of options.pages) measured.push(await measure(fetcher, page, options.tries ?? 15));
  } finally {
    fetcher.close();
  }
  const timed = marks.length
    ? await (options.time ?? ((url, pages, marks) => timeMarks(url, pages, marks, { loads: options.loads })))(options.url, options.pages, marks)
    : options.pages.map(() => ({}));
  const weighed = await (options.weigh ?? ((url, pages) => weigh(url, pages)))(options.url, options.pages);
  return options.pages.flatMap((page, i) => [...measured[i], {
    name: `${page.name}_weight`, unit: 'B', value: weighed[i].bytes, spread: [weighed[i].bytes, weighed[i].bytes] as [number, number],
    better: 'lower' as const, worst: weightWorst(weighed[i].bytes), noise: 0,
  }, ...marksOf(marks, page).map((m): Measured => {
    const times = timed[i][m.name];
    const kept = withoutNoise(times);
    return {
      name: `${page.name}_${m.name}_ms`, unit: 'ms', value: round(median(kept)), spread: quartiles(kept).map(round) as [number, number],
      better: 'lower', worst: round(Math.max(...kept)), noise: times.length - kept.length, ideal: 1000,
    };
  })]);
}

/**
 * The worst a weight of so many bytes keeps in its baseline: the bytes and a margin, the larger of 0.1% of them and
 * 1 KB, so that a few bytes more of a third party's answer, or of a frame's split, is not a regression (#56).
 */
export const weightWorst = (bytes: number) => Math.floor(bytes + Math.max(bytes / 1000, 1024));

/**
 * The worst a page's bytes keep in its baseline: the most of its answers and a margin, the larger of 0.1% of them and
 * 64 B, so that a page whose markup is the same is not a regression for the names of its hashed assets, which brotli
 * compresses a few bytes apart from one build to the next (#70).
 */
export const bytesWorst = (bytes: number) => Math.floor(bytes + Math.max(bytes / 1000, 64));

/** The marks a page has: those on every page, and its own. */
const marksOf = (marks: Mark[], page: Page) => marks.filter((m) => m.page === undefined || m.page === page.name);

/**
 * Each page's marks, timed in one Chrome, as a desktop, the page running as it does: each page that has a mark
 * loaded options.loads times, one after another, each a first visit in a context of its own, until it has every mark.
 * For each page, each of its marks' times from navigation, in milliseconds, a load each.
 */
export async function timeMarks(url: string, pages: Page[], marks: Mark[], options: MarkOptions = {}): Promise<Record<string, number[]>[]> {
  const loads = options.loads ?? 10;
  const deadline = options.deadline ?? 60000;
  const timed: Record<string, number[]>[] = pages.map((page) => Object.fromEntries(marksOf(marks, page).map((m) => [m.name, []])));
  if (!pages.some((page) => marksOf(marks, page).length)) return timed;
  const chrome = await Chrome.start(options.chrome ?? process.env.CHROME ?? 'google-chrome', deadline, options.flags ?? []);
  try {
    for (const [i, page] of pages.entries()) {
      const own = marksOf(marks, page);
      if (!own.length) continue;
      for (let n = 0; n < loads; n++) {
        const at = await timeOne(chrome, new URL(page.path, url).href, own, deadline, options.clock ?? Date.now);
        for (const m of own) timed[i][m.name].push(at[m.name]);
      }
    }
    return timed;
  } finally {
    await chrome.end();
  }
}

// Before the page's own script: each of its marks told to the probe as it is set, by a binding, which Chrome hears
// at once whatever the page's main thread does after, as a frame that holds it for seconds.
const MARKING = (named: string[], selected: [string, string][]) => `if (window === top) {
  const tell = window.__cruxMark;
  const want = new Set(${JSON.stringify(named)});
  const mark = performance.mark.bind(performance);
  performance.mark = (name, ...rest) => {
    const entry = mark(name, ...rest);
    if (want.delete(String(name))) tell(JSON.stringify([String(name), entry.startTime]));
    return entry;
  };
  for (const [name, selector] of ${JSON.stringify(selected)}) {
    const observer = new MutationObserver(() => look());
    const look = () => {
      try {
        if (!document.querySelector(selector)) return false;
      } catch (e) {
        tell(JSON.stringify([name, null, String(e)]));
        return true;
      }
      observer.disconnect();
      tell(JSON.stringify([name, performance.now()]));
      return true;
    };
    if (!look()) observer.observe(document, { childList: true, subtree: true, attributes: true });
  }
}`;

/** One load of the page at href, in a context of its own, until it has each of its marks: when each came, from navigation. */
async function timeOne(chrome: Chrome, href: string, marks: Mark[], deadline: number, clock: () => number): Promise<Record<string, number>> {
  const started = clock();
  const { browserContextId } = await chrome.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method: string, params = {}) => chrome.send(method, params, sessionId);
  const at: Record<string, number> = {};
  const thrown: string[] = [];
  let failed = '';
  const listen = (m: any) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params;
    if (m.method === 'Runtime.bindingCalled' && p.name === '__cruxMark') {
      const [name, ms, error] = JSON.parse(p.payload);
      if (error) failed ||= `${href}: the selector of ${name}: ${error}`;
      else if (!(name in at)) at[name] = ms;
    } else if (m.method === 'Network.responseReceived' && p.type === 'Document' && p.frameId === targetId && p.response.status !== 200) {
      failed ||= `${href} answered ${p.response.status} to Chrome`;
    } else if (m.method === 'Runtime.exceptionThrown') {
      thrown.push(p.exceptionDetails.exception?.description?.split('\n')[0] ?? p.exceptionDetails.text);
    }
  };
  chrome.listeners.add(listen);
  try {
    await s('Network.enable');
    await s('Network.setCacheDisabled', { cacheDisabled: true });
    await s('Runtime.enable');
    await s('Runtime.addBinding', { name: '__cruxMark' });
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await s('Page.addScriptToEvaluateOnNewDocument', {
      source: MARKING(marks.filter((m) => m.selector === undefined).map((m) => m.name), marks.filter((m) => m.selector !== undefined).map((m) => [m.name, m.selector!])),
    });
    const nav = await s('Page.navigate', { url: href });
    if (nav.errorText) throw new Error(`${href}: ${nav.errorText}`);
    while (!marks.every((m) => m.name in at)) {
      if (failed) throw new Error(failed);
      if (clock() - started > deadline) {
        await settle(s, clock);
        const missing = marks.filter((m) => !(m.name in at)).map((m) => m.name).join(', ');
        throw new Error(`${href} had no ${missing} in ${deadline} ms${thrown.length ? ` (the page threw: ${thrown.join('; ')})` : ''}`);
      }
      await pause(10);
    }
    return at;
  } finally {
    chrome.listeners.delete(listen);
    await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
    await chrome.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

/**
 * A round trip to the page, which Chrome answers after every event the page sent before it, so that what it threw by
 * then has been heard; a page whose main thread is held is given SETTLE ms more on the clock, and no more.
 */
async function settle(s: (method: string, params?: object) => Promise<any>, clock: () => number) {
  let answered = false;
  s('Runtime.evaluate', { expression: '0' }).catch(() => {}).finally(() => { answered = true; });
  const until = clock() + SETTLE;
  while (!answered && clock() < until) await pause(10);
}

const SETTLE = 1000;

/** Each page of the product at url weighed in one Chrome, as a phone, one after another, each in a context of its own. */
export async function weigh(url: string, pages: Page[], options: WeighOptions = {}): Promise<Weighed[]> {
  // None of Chrome's own fetches beside the page's, as its updates of what it has: its net log, traced for each page,
  // took seconds to end with them in it (crux#47).
  const quiet = ['--disable-background-networking', '--disable-component-update'];
  const chrome = await Chrome.start(options.chrome ?? process.env.CHROME ?? 'google-chrome', options.deadline ?? 60000, [...quiet, ...options.flags ?? []]);
  try {
    const weighed: Weighed[] = [];
    for (const page of pages) {
      const deadline = options.deadline ?? 120000;
      // A page given up stops its own waiting too.
      const stop = { now: false };
      weighed.push(await chrome.within(deadline, `weighing ${page.path} took longer than ${deadline} ms`,
        weighOne(chrome, new URL(page.path, url).href, options.quiet ?? 2000, stop)).finally(() => { stop.now = true; }));
    }
    return weighed;
  } finally {
    await chrome.end();
  }
}

// The headers whose value changes from one answer to the next whatever the product sends: Cloud Run's front end
// gives each answer a trace of its own, a random id that codes to a length of its own and now and then has ';o=1'
// after it, and every server the time (crux#27). Each is counted as though it were sent as this, so that a page
// weighs the same from one run to the next where nothing of it changed.
export const FIXED: Record<string, string> = {
  'x-cloud-trace-context': '00000000000000000000000000000000/0000000000000000000;o=1',
  date: 'Thu, 01 Jan 1970 00:00:00 GMT',
};

// A third party's times too, and how old its cache's copy is (crux#52): Google Fonts' answers each give the time, when
// it expires and when it was last changed, and its stylesheets have them all the same second as a page's two answers
// come or not, which sends them as references to the first's or whole; its fonts say their age, of a length of its own.
export const OTHERS: Record<string, string> = {
  ...FIXED,
  expires: FIXED.date,
  'last-modified': FIXED.date,
  age: '0',
};

// The names HPACK's static table has (RFC 7541, Appendix A), which an encoder sends as an index of a byte.
const NAMED = new Set(['accept-charset', 'accept-encoding', 'accept-language', 'accept-ranges', 'accept', 'access-control-allow-origin',
  'age', 'allow', 'authorization', 'cache-control', 'content-disposition', 'content-encoding', 'content-language', 'content-length',
  'content-location', 'content-range', 'content-type', 'cookie', 'date', 'etag', 'expect', 'expires', 'from', 'host', 'if-match',
  'if-modified-since', 'if-none-match', 'if-range', 'if-unmodified-since', 'last-modified', 'link', 'location', 'max-forwards',
  'proxy-authenticate', 'proxy-authorization', 'range', 'referer', 'refresh', 'retry-after', 'server', 'set-cookie',
  'strict-transport-security', 'transfer-encoding', 'user-agent', 'vary', 'via', 'www-authenticate']);

/**
 * An answer's HEADERS frame over HTTP/2, in bytes, as an encoder that indexes all it sends would code it, sent after
 * what it sent before on the connection (sent, which it adds to): its frame's own header; its status, an index of a
 * byte where HPACK's static table has it; and each header, OTHERS' value for those it has, as an index of a byte where
 * it sent the same before, and otherwise its value whole after its name, as an index where the static table or what it
 * sent before has it. A third party's answers are counted so (crux#52): whether its encoder sent a header as a
 * reference to the one before, or whole, is its own, and Chrome counts what it sent.
 */
export function headerBlock(status: number, headers: Record<string, string>, sent: Set<string>): number {
  let bytes = FRAME_HEAD + ([200, 204, 206, 304, 400, 404, 500].includes(status) ? 1 : 1 + valueBytes(String(status), 'h2'));
  for (const [header, values] of Object.entries(headers ?? {})) {
    const name = header.toLowerCase();
    for (const one of String(values).split('\n')) {
      const value = OTHERS[name] ?? one;
      if (sent.has(`${name}: ${value}`)) bytes += 1;
      else bytes += 1 + (NAMED.has(name) || sent.has(name) ? 0 : valueBytes(name, 'h2')) + valueBytes(value, 'h2');
      sent.add(name).add(`${name}: ${value}`);
    }
  }
  return bytes;
}

// Each byte's length, in bits, in the Huffman code HTTP/2 and HTTP/3 send headers in (RFC 7541, Appendix B).
const HUFFMAN = [
  13, 23, 28, 28, 28, 28, 28, 28, 28, 24, 30, 28, 28, 30, 28, 28, 28, 28, 28, 28, 28, 28, 30, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  6, 10, 10, 12, 13, 6, 8, 11, 10, 10, 8, 11, 8, 6, 6, 6, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 7, 8, 15, 6, 12, 10,
  13, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 7, 8, 13, 19, 13, 14, 6,
  15, 5, 6, 5, 6, 5, 6, 6, 6, 5, 7, 7, 6, 6, 6, 5, 6, 7, 6, 5, 5, 6, 7, 7, 7, 7, 7, 15, 11, 14, 13, 28,
  20, 22, 20, 20, 22, 22, 22, 23, 22, 23, 23, 23, 23, 23, 24, 23, 24, 24, 22, 23, 24, 23, 23, 23, 23, 21, 22, 23, 22, 23, 23, 24,
  22, 21, 20, 22, 22, 23, 23, 21, 23, 22, 22, 24, 21, 22, 23, 23, 21, 21, 22, 21, 23, 22, 23, 23, 20, 22, 22, 22, 23, 22, 22, 23,
  26, 26, 20, 19, 22, 23, 22, 25, 26, 26, 26, 27, 27, 26, 24, 25, 19, 21, 26, 27, 27, 26, 27, 24, 21, 21, 26, 26, 28, 27, 27, 27,
  20, 24, 20, 21, 22, 21, 21, 23, 22, 22, 25, 25, 24, 24, 26, 23, 26, 27, 26, 26, 27, 27, 27, 27, 27, 28, 27, 27, 27, 27, 27, 26,
];

/** Whether a protocol sends its headers coded, as HTTP/2's HPACK and HTTP/3's QPACK do, rather than as text. */
const codesHeaders = (protocol: string) => /^(h2|h3|spdy|quic)/i.test(protocol);

/**
 * A header's value as it goes on the wire, in bytes: as it is, over HTTP/1, and over HTTP/2 and HTTP/3 a string
 * literal, its length first and then the shorter of its Huffman code and itself, as encoders send it.
 */
export function valueBytes(value: string, protocol: string): number {
  const raw = Buffer.from(value, 'latin1');
  if (!codesHeaders(protocol)) return raw.length;
  const coded = Math.min(raw.length, Math.ceil(raw.reduce((bits, b) => bits + HUFFMAN[b], 0) / 8));
  // The length in an integer of a 7-bit prefix (RFC 7541, 5.1): one byte below 127, and one more for each 7 bits after.
  let length = 1;
  if (coded >= 127) for (let rest = coded - 127, more = true; more; rest >>= 7) { length++; more = rest >= 128; }
  return length + coded;
}

/**
 * What one answer's bytes are to be told apart by, so that it weighs as though each of FIXED's headers it has were
 * sent as FIXED's. A header the encoder sent as a reference to its table, as it may send the time it sent before, is
 * off by no more than the two values' lengths differ, a byte or so; one sent as a literal is counted exactly.
 */
export function steadied(headers: Record<string, string>, protocol: string): number {
  let by = 0;
  for (const [name, value] of Object.entries(headers ?? {})) {
    const fixed = FIXED[name.toLowerCase()];
    if (fixed === undefined) continue;
    for (const one of String(value).split('\n')) by += valueBytes(fixed, protocol) - valueBytes(one, protocol);
  }
  return by;
}

// The largest DATA frame HTTP/2 lets a server send before the browser says it takes more, which Chrome never does
// (RFC 9113, 6.5.2), and each frame's own header (4.1).
export const FRAME = 16384;
export const FRAME_HEAD = 9;

/**
 * An answer's bytes, as Chrome counted them (total), but over HTTP/2 with its body counted as though it came in
 * frames of FRAME, as few as hold it, where frames are the lengths of the DATA frames Chrome had of it. Cloud Run's
 * front end splits the same body into frames of lengths of its own from one answer to the next, 9 B a frame, and
 * Chrome counts each (crux#29). They are taken from the total, not added to its headers: what Chrome says its
 * headers came to is what it had of the answer when it told of them, a frame of the body or more with them where
 * its network service read on before it told (crux#47). Where the frames are not known, or are more than Chrome
 * counted, it is as counted.
 */
export function framed(total: number, frames: number[] | undefined, protocol: string): number {
  if (!/^h2$/i.test(protocol) || frames === undefined) return total;
  const body = frames.reduce((a, b) => a + b, 0);
  if (total < body + FRAME_HEAD * frames.length) return total;
  return total - FRAME_HEAD * frames.length + FRAME_HEAD * Math.ceil(body / FRAME);
}

/** An HTTP/2 stream's DATA frames, their lengths, and how many of them Chrome had when it told of its answer. */
export type Stream = { frames: number[]; told: number };

/**
 * The DATA frames of each HTTP/2 stream in Chrome's net log, as a trace of its category netlog gives its events: the
 * lengths of each, by the socket its session is on (a response's connectionId) and the authority and path it asked
 * for, a list for each time they were asked for there, in the order they were. A session's id is used again once it
 * is gone: its socket is the one it was given last; and so is a request's, its URL the one it was given last.
 *
 * Each frame's length is its data's, without the padding a server may add to it, as Google's front end does to each of
 * its stylesheets' frames, a length of its own each time, which Chrome counts none of (crux#52): Chrome tells of a padded
 * frame's padding, its length's byte first, as it takes it from the session's window and gives it back at once.
 *
 * With them, how many Chrome had when it told of the answer: those it had before its request began to tell of it
 * (URL_REQUEST_DELEGATE_RESPONSE_STARTED), which it counted with the answer's headers. A request is told from the
 * stream it was answered on by its URL and the stream's id, which it logs as it reads its body (crux#51). Where its
 * request is not found, none.
 */
export function framesOf(events: any[]): Map<string, Stream[]> {
  const sockets = new Map<string, number>();
  // Of each stream: its frames, when each came, its URL and id, and when it was asked for.
  type Asked = { frames: number[]; at: number[]; id: string; sent: number };
  const streams = new Map<string, Asked>();
  const asked = new Map<string, Asked[]>();
  // Of each request: its URL and when it began to tell of its answer; and when the request of each URL and stream id did.
  const requests = new Map<string, { url: string; told?: number }>();
  const told = new Map<string, number[]>();
  // Of each session, the frame it had last, and what it took from its window and gave back since.
  const last = new Map<string, { s: Asked; i: number; window: number[] }>();
  const unpad = ({ s, i, window }: { s: Asked; i: number; window: number[] }) => {
    if (window[0] !== -1 || window[1] !== 1) return;
    for (let j = 0; j + 1 < window.length; j++) if (window[j] < 0 && window[j + 1] === -window[j]) s.frames[i] += window[j++];
  };
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    const session = e.id2?.local ?? e.id;
    const p = e.args?.params ?? {};
    if (e.name === 'REQUEST_ALIVE' && e.ph === 'b' && p.url) {
      const url = URL.parse(p.url);
      if (url) requests.set(session, { url: `${url.host}${url.pathname}${url.search}` });
    } else if (e.name === 'URL_REQUEST_DELEGATE_RESPONSE_STARTED' && e.ph === 'b' && requests.has(session)) {
      requests.get(session)!.told = e.ts;
    } else if (e.name === 'HTTP2_STREAM_UPDATE_RECV_WINDOW' && requests.get(session)?.told !== undefined) {
      const r = requests.get(session)!;
      const key = `${r.url} ${p.stream_id}`;
      told.set(key, [...(told.get(key) ?? []), r.told!]);
      r.told = undefined;
    }
    if (e.name === 'HTTP2_SESSION_INITIALIZED') sockets.set(session, p.source_dependency?.id);
    if (!sockets.has(session)) continue;
    if (e.name === 'HTTP2_SESSION_UPDATE_RECV_WINDOW') {
      last.get(session)?.window.push(p.delta);
      continue;
    }
    if (last.has(session) && e.name.startsWith('HTTP2_SESSION')) {
      unpad(last.get(session)!);
      last.delete(session);
    }
    const stream = `${sockets.get(session)} ${p.stream_id}`;
    if (e.name === 'HTTP2_SESSION_SEND_HEADERS') {
      const pseudo = (name: string) => (p.headers ?? []).find((h: string) => h.startsWith(`:${name}: `))?.slice(name.length + 3) ?? '';
      const at = `${pseudo('authority')}${pseudo('path')}`;
      const s: Asked = { frames: [], at: [], id: `${at} ${p.stream_id}`, sent: e.ts };
      streams.set(stream, s);
      const key = `${sockets.get(session)} ${at}`;
      asked.set(key, [...(asked.get(key) ?? []), s]);
    } else if (e.name === 'HTTP2_SESSION_RECV_DATA' && streams.has(stream)) {
      const s = streams.get(stream)!;
      s.frames.push(p.size);
      s.at.push(e.ts);
      last.set(session, { s, i: s.frames.length - 1, window: [] });
    }
  }
  for (const frame of last.values()) unpad(frame);
  // Each stream's request is the first of its URL and stream id to tell of an answer after the stream was asked.
  return new Map([...asked].map(([key, list]) => [key, list.map(({ frames, at, id, sent }) => {
    const times = told.get(id) ?? [];
    const i = times.findIndex((t) => t > sent);
    const when = i < 0 ? -Infinity : times.splice(i, 1)[0];
    return { frames, told: at.filter((t) => t < when).length };
  })]));
}

/** A body's length, as its content-length says it, where it says one. */
function bodyLength(headers: Record<string, string> | undefined): number | undefined {
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() === 'content-length' && /^\d+$/.test(String(value).trim())) return Number(String(value).trim());
  }
  return undefined;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Once the page has loaded, its frames run none of its script (crux#40). A page that draws every frame, as a WebGL
// simulation in Chrome's software GL, holds its main thread for seconds a frame, and every Runtime.evaluate waits
// behind one: so did a command to freeze it. Chrome still lays out and paints a frame, so a lazy picture scrolled to
// is fetched, and timers and what the page's script fetches run as they would.
const STILL = `{
  const frame = requestAnimationFrame.bind(window);
  let loaded = false;
  addEventListener('load', () => { loaded = true; }, { once: true });
  window.requestAnimationFrame = (callback) => frame((t) => { if (!loaded) callback(t); });
}`;

async function weighOne(chrome: Chrome, href: string, quiet: number, stop: { now: boolean }): Promise<Weighed> {
  const wait = async () => {
    if (stop.now) throw new Error(`${href} was given up`);
    await pause(100);
  };
  // A browser context of its own, as a reader's first visit: no connection the page before opened, nor its HTTP/2
  // header table, carries over, so that its headers are weighed whole whatever was weighed before it (crux#26).
  const { browserContextId } = await chrome.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (method: string, params = {}) => chrome.send(method, params, sessionId);
  // Of each request: what steadies its headers (by), and over HTTP/2, what frames its body (head, body, protocol,
  // and the connection whose frames in Chrome's net log are its); and whether Chrome told of its end on a session
  // other than the one that asked for it (apart).
  type Request = Weighed['fetched'][number] & { done: boolean; by: number; head: number; body?: number; protocol: string; connection?: string; asked?: string; apart?: boolean; status?: number; headers?: Record<string, string> };
  const requests = new Map<string, Request>();
  // A redirect's answer is given the same id as where it leads: its bytes are kept here as it is followed.
  const redirected: Weighed['fetched'] = [];
  let last = Date.now();
  let loaded = false;
  let status = 0;
  // The page's session and each a worker or a frame of another process has (crux#39): Chrome tells of a worker's
  // script on the page's session as it is asked for but of its end on the worker's, and of all the worker fetches there.
  const sessions = new Set([sessionId]);
  const attach = async (session: string) => {
    const t = (method: string, params = {}) => chrome.send(method, params, session);
    await t('Network.enable');
    await t('Network.setCacheDisabled', { cacheDisabled: true });
    await t('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  };
  // Chrome's net log of the visit, as a trace: the one place Chrome tells of each HTTP/2 frame it had (crux#47).
  const traced: any[] = [];
  let complete: (p: { dataLossOccurred?: boolean }) => void = () => {};
  const completed = new Promise<{ dataLossOccurred?: boolean }>((resolve) => { complete = resolve; });
  let tracing = false;
  const listen = (m: any) => {
    // The trace is the browser's, on no session.
    if (m.method === 'Tracing.dataCollected') traced.push(...m.params.value);
    else if (m.method === 'Tracing.tracingComplete') complete(m.params);
    if (!sessions.has(m.sessionId)) return;
    const p = m.params;
    if (m.method === 'Target.attachedToTarget') {
      // Held before it runs, so that none of what it fetches is asked for before it is heard; and let go however that went.
      sessions.add(p.sessionId);
      attach(p.sessionId).catch(() => {}).finally(() => chrome.send('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {}));
    } else if (m.method === 'Network.requestWillBeSent') {
      const before = requests.get(p.requestId);
      if (before && p.redirectResponse) {
        const r = p.redirectResponse;
        redirected.push({ url: before.url, type: before.type, bytes: (r.encodedDataLength ?? 0) + steadied(r.headers, r.protocol ?? '') });
      }
      requests.set(p.requestId, { url: p.request.url, type: p.type ?? 'Other', bytes: 0, done: false, by: 0, head: 0, protocol: '', asked: m.sessionId });
      last = Date.now();
    } else if (m.method === 'Network.responseReceived') {
      if (p.type === 'Document' && p.frameId === targetId) status = p.response.status;
      // A picture is steadied as any answer is: Chrome counts its headers and its frames, over HTTP/2 too (crux#28).
      const r = requests.get(p.requestId);
      if (r) {
        r.by = steadied(p.response.headers, p.response.protocol ?? '');
        r.head = p.response.encodedDataLength ?? 0;
        r.protocol = p.response.protocol ?? '';
        // An answer from the network: one from a service worker or a cache came on no stream of the page's.
        if (!p.response.fromServiceWorker && !p.response.fromDiskCache && !p.response.fromPrefetchCache) r.connection = String(p.response.connectionId);
        r.body = bodyLength(p.response.headers);
        r.status = p.response.status;
        r.headers = p.response.headers;
      }
    } else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
      const r = requests.get(p.requestId);
      if (r) {
        r.done = true;
        if (m.method === 'Network.loadingFinished') {
          r.bytes = p.encodedDataLength ?? 0;
          r.apart = m.sessionId !== r.asked;
        }
        else r.failed = p.errorText;
      }
      last = Date.now();
    } else if (m.method === 'Page.loadEventFired') loaded = true;
  };
  chrome.listeners.add(listen);
  try {
    await chrome.send('Tracing.start', { traceConfig: { includedCategories: ['netlog'], excludedCategories: ['*'] }, transferMode: 'ReportEvents' });
    tracing = true;
    await attach(sessionId);
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await s('Page.addScriptToEvaluateOnNewDocument', { source: STILL });
    const nav = await s('Page.navigate', { url: href });
    if (nav.errorText) throw new Error(`${href}: ${nav.errorText}`);
    while (!loaded) await wait();
    if (status !== 200) throw new Error(`${href} answered ${status} to Chrome`);
    // A screen at a time, as a reader scrolls, until the end no longer moves.
    for (let i = 0; i < 400; i++) {
      const { result } = await s('Runtime.evaluate', {
        expression: 'window.scrollBy(0, innerHeight * 0.8), innerHeight + scrollY >= document.documentElement.scrollHeight - 1',
        returnByValue: true,
      });
      await wait();
      if (result.value) break;
    }
    const pending = () => [...requests.values()].some((r) => !r.done);
    while (Date.now() - last < quiet || pending()) await wait();
    tracing = false;
    await chrome.send('Tracing.end');
    if ((await completed).dataLossOccurred) throw new Error(`Chrome's net log of ${href} lost some of its events`);
    // Each request's stream, by its connection and what it asked for. A dedicated worker's script Chrome tells of on
    // the worker's session with no connection (0), and its stream is the first not yet taken of any connection's that
    // asked for it (crux#51): taken after those whose connection is known, so as to take none of theirs. Where none is
    // found, its bytes are as Chrome counted them, so that the page is weighed all the same.
    const streams = framesOf(traced);
    const streamOf = new Map<Request, Stream | undefined>();
    const h2 = [...requests.values()].filter((r) => r.protocol === 'h2' && r.connection !== undefined && !r.failed);
    for (const r of [...h2.filter((r) => r.connection !== '0'), ...h2.filter((r) => r.connection === '0')]) {
      const url = new URL(r.url);
      const at = ` ${url.host}${url.pathname}${url.search}`;
      const key = r.connection !== '0' ? `${r.connection}${at}` : [...streams.keys()].find((k) => k.endsWith(at) && streams.get(k)!.length > 0);
      streamOf.set(r, key === undefined ? undefined : streams.get(key)?.shift());
    }
    // A dedicated worker's script Chrome counts as its head alone, where it tells of its end on the worker's session
    // (apart): its head, and the frames of its stream Chrome had not yet had when it told of its answer, which it
    // counted with its head (crux#51), or as long as its headers say, where its stream is not known. Only there: an
    // answer whose head Chrome counted its whole body with, as it may (crux#47), is as long as Chrome counted it.
    const whole = (r: Request, stream?: Stream) => {
      if (!r.apart || r.head <= 0 || r.bytes > r.head) return r.bytes;
      if (stream === undefined) return r.body === undefined ? r.bytes : r.head + r.body;
      const rest = stream.frames.slice(stream.told);
      return r.head + rest.reduce((a, b) => a + b, 0) + FRAME_HEAD * rest.length;
    };
    // A third party's answer over HTTP/2, whose stream is known, is its header block as headerBlock counts it, after
    // those before it on its connection in the order of their URLs, and its body's data in frames of FRAME (crux#52).
    const own = new URL(href).host;
    const sent = new Map<string, Set<string>>();
    const others = new Map<Request, number>();
    for (const r of [...streamOf.keys()].filter((r) => new URL(r.url).host !== own).sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))) {
      const stream = streamOf.get(r);
      if (stream === undefined || stream.frames.length === 0) continue;
      if (!sent.has(r.connection!)) sent.set(r.connection!, new Set());
      const data = stream.frames.reduce((a, b) => a + b, 0);
      others.set(r, headerBlock(r.status ?? 0, r.headers ?? {}, sent.get(r.connection!)!) + data + FRAME_HEAD * Math.ceil(data / FRAME));
    }
    const fetched = [...redirected, ...[...requests.values()].map((request) => {
      const { done, by, head, body, protocol, connection, asked, apart, status, headers, ...r } = request;
      if (r.failed) return r;
      if (others.has(request)) return { ...r, bytes: others.get(request)! };
      const stream = streamOf.get(request);
      return { ...r, bytes: framed(whole(request, stream), stream?.frames, protocol) + by };
    })];
    return { bytes: fetched.reduce((a, r) => a + r.bytes, 0), fetched };
  } finally {
    // Ended whole, so that the next page's trace can begin.
    if (tracing) await chrome.send('Tracing.end').then(() => chrome.within(10000, 'Chrome\'s trace did not end', completed)).catch(() => {});
    chrome.listeners.delete(listen);
    await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
    await chrome.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

/** Chrome, headless, with a profile of its own, spoken to over its DevTools socket. */
class Chrome {
  listeners = new Set<(m: any) => void>();
  private process: ChildProcess;
  private dir: string;
  private socket: WebSocket | undefined;
  private ended: Promise<unknown>;
  private failed: Promise<never>;
  private next = 0;
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();

  private constructor(binary: string, flags: string[]) {
    this.dir = mkdtempSync(join(tmpdir(), 'crux-weigh-'));
    // A process group of its own, its renderers and services in it, so that end() kills them all.
    this.process = spawn(binary, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${this.dir}`,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu', ...flags, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    let err = '';
    this.process.stderr!.on('data', (d) => { err += d; });
    this.ended = new Promise((resolve) => {
      this.process.on('exit', resolve);
      this.process.on('error', resolve);
    });
    this.failed = new Promise<never>((_, reject) => {
      this.process.on('error', (e) => reject(new Error(`Chrome (${binary}) could not start: ${e.message}`)));
      this.process.on('exit', (code) => reject(new Error(`Chrome ended, ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`)));
    });
    this.failed.catch(() => {});
  }

  static async start(binary: string, deadline: number, flags: string[]): Promise<Chrome> {
    const chrome = new Chrome(binary, flags);
    try {
      const ws = await chrome.within(deadline, `Chrome did not start in ${deadline} ms`, new Promise<string>((resolve) => {
        let err = '';
        chrome.process.stderr!.on('data', (d) => {
          err += d;
          const m = err.match(/DevTools listening on (ws:\S+)/);
          if (m) resolve(m[1]);
        });
      }));
      const socket = new WebSocket(ws);
      await chrome.within(deadline, 'Chrome\'s DevTools socket did not open', new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error('Chrome\'s DevTools socket would not open'));
      }));
      socket.onmessage = ({ data }) => {
        const m = JSON.parse(String(data));
        if (m.id !== undefined) {
          const w = chrome.waiting.get(m.id)!;
          chrome.waiting.delete(m.id);
          if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`));
          else w.resolve(m.result);
        } else for (const l of chrome.listeners) l(m);
      };
      chrome.socket = socket;
      return chrome;
    } catch (e) {
      await chrome.end();
      throw e;
    }
  }

  send(method: string, params = {}, sessionId?: string): Promise<any> {
    const id = ++this.next;
    this.socket!.send(JSON.stringify({ id, method, params, sessionId }));
    return this.within(30000, `${method} had no answer in 30000 ms`,
      new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject, method })));
  }

  /** What `work` comes to, unless the deadline passes or Chrome ends first. */
  within<T>(ms: number, why: string, work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(why)), ms); });
    return Promise.race([work, late, this.failed]).finally(() => clearTimeout(timer));
  }

  /** Kills every process of Chrome's group, and removes its profile once the last is gone. */
  async end() {
    this.socket?.close();
    try { process.kill(-this.process.pid!, 'SIGKILL'); } catch {}
    await this.ended;
    for (let i = 0; this.process.pid && i < 1000; i++) {
      try { process.kill(-this.process.pid, 0); } catch { break; }
      await pause(10);
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** What the product says of its numbers: the ideal of any of them, and which is main. */
export interface Judged {
  ideals?: Record<string, number>;
  main?: string;
}

/**
 * What nerd reads: each number with its baseline, the one the baseline file keeps for it (a JSON
 * report of its own), or, where there is none or it is written again, this run's.
 */
export function report(numbers: Measured[], baselineFile: string | null, write: boolean, judged: Judged = {}): Report {
  const kept: Record<string, { value: number; worst: number }> = {};
  if (baselineFile && !write) {
    for (const n of JSON.parse(baselineFile).numbers ?? []) kept[n.name] = n.baseline;
  }
  return {
    main: judged.main ?? numbers.find((n) => n.name.endsWith('_ms'))?.name ?? numbers[0].name,
    numbers: numbers.map(({ worst, ideal, ...n }) => ({
      ...n,
      baseline: kept[n.name] ?? { value: n.value, worst },
      ideal: judged.ideals?.[n.name] ?? ideal ?? IDEAL[n.name.slice(n.name.lastIndexOf('_') + 1)],
    })),
  };
}

/** The names of the numbers probe() measures, in its order, which --ideal and --main may name and no others. */
export function numberNames(pages: Page[], marks: Mark[]): string[] {
  return pages.flatMap((p) => [...['bytes', 'requests', 'ms', 'weight'].map((k) => `${p.name}_${k}`), ...marksOf(marks, p).map((m) => `${p.name}_${m.name}_ms`)]);
}

/** The marks from each --mark [PAGE:]NAME[=SELECTOR], and --ready SELECTOR, in their order. */
export function marksFrom(args: string[]): Mark[] {
  const marks: Mark[] = [];
  for (let i = 0; i < args.length; i++) {
    const given = args[i + 1] ?? '';
    if (args[i] === '--ready') {
      if (!given) throw new Error('--ready wants a SELECTOR');
      marks.push({ name: 'ready', selector: given });
    } else if (args[i] === '--mark') {
      const m = given.match(/^(?:([^:=]+):)?([A-Za-z0-9_-]+)(?:=(.+))?$/);
      if (!m) throw new Error(`--mark wants [PAGE:]NAME[=SELECTOR], NAME of letters, digits, _ and -, not "${given}"`);
      marks.push({ name: m[2], ...(m[1] !== undefined && { page: m[1] }), ...(m[3] !== undefined && { selector: m[3] }) });
    } else continue;
    const last = marks[marks.length - 1];
    if (marks.some((m) => m !== last && m.name === last.name && (m.page === undefined || last.page === undefined || m.page === last.page))) {
      throw new Error(`the mark ${last.name} is given twice for a page`);
    }
  }
  return marks;
}

/** Each --ideal NUMBER=VALUE. */
export function idealsFrom(args: string[]): Record<string, number> {
  const ideals: Record<string, number> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--ideal') continue;
    const m = (args[i + 1] ?? '').match(/^([^=]+)=(\d+(?:\.\d+)?)$/);
    if (!m) throw new Error(`--ideal wants NUMBER=VALUE, not "${args[i + 1] ?? ''}"`);
    ideals[m[1]] = Number(m[2]);
  }
  return ideals;
}

/** The pages from --page NAME=PATH, in their order, or else from the JSON object --pages names. */
export function pagesFrom(args: string[], read: (file: string) => string): Page[] {
  const pages: Page[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--page') continue;
    const given = args[i + 1] ?? '';
    const at = given.indexOf('=');
    if (at < 1 || at === given.length - 1) throw new Error(`--page wants NAME=PATH, not "${given}"`);
    pages.push({ name: given.slice(0, at), path: given.slice(at + 1) });
  }
  if (pages.length) return pages;
  const file = valueOf(args, '--pages');
  if (!file) throw new Error('no pages: give --page NAME=PATH or --pages FILE');
  const named = JSON.parse(read(file));
  if (!named || typeof named !== 'object' || Array.isArray(named)) throw new Error(`${file} is not an object of NAME to PATH`);
  for (const [name, path] of Object.entries(named)) {
    if (typeof path !== 'string') throw new Error(`${file}: ${name} is not a path`);
    pages.push({ name, path });
  }
  if (!pages.length) throw new Error(`${file} names no pages`);
  return pages;
}

function valueOf(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  const url = (valueOf(args, '--url') || process.env.NERD_URL || '').replace(/\/$/, '');
  if (!url) throw new Error('no address: give --url URL, or NERD_URL');
  const pages = pagesFrom(args, (file) => readFileSync(file, 'utf8'));
  const tries = Number(valueOf(args, '--tries') ?? '15');
  if (!Number.isInteger(tries) || tries < 1) throw new Error(`--tries wants a whole number above 0`);
  const marks = marksFrom(args);
  const loads = Number(valueOf(args, '--loads') ?? '10');
  if (!Number.isInteger(loads) || loads < 1) throw new Error(`--loads wants a whole number above 0`);
  const judged = { ideals: idealsFrom(args), main: valueOf(args, '--main') };
  const names = numberNames(pages, marks);
  for (const name of [...Object.keys(judged.ideals), ...(judged.main ? [judged.main] : [])]) {
    if (!names.includes(name)) throw new Error(`there is no number ${name}: there are ${names.join(', ')}`);
  }
  const baselinePath = valueOf(args, '--baseline') ?? 'probe/speed.json';
  const write = args.includes('--write-baseline');

  const numbers = await probe({ url, pages, tries, marks, loads });
  let baselineFile: string | null = null;
  try {
    baselineFile = readFileSync(baselinePath, 'utf8');
  } catch {}
  const out = report(numbers, baselineFile, write, judged);

  if (write) {
    const pagesKept = Object.fromEntries(pages.map((p) => [p.name, p.path]));
    // A new product has no probe/ yet: this is what makes it.
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify({ url, pages: pagesKept, measured: new Date().toISOString(), ...out }, null, 1) + '\n');
    console.error(`wrote ${baselinePath}`);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(out));
  } else {
    for (const n of out.numbers) {
      console.log(`${n.name.padEnd(20)} ${String(n.value).padStart(8)} ${n.unit.padEnd(9)} spread ${n.spread.join('–')}  baseline ${n.baseline.value} (worst ${n.baseline.worst})  ideal ${n.ideal}${n.noise ? `  noise ${n.noise}` : ''}`);
    }
  }
}

const run = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (run) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`speed: ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
