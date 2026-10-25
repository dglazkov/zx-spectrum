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
         [--json] [--write-baseline]

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
came in frames of 16384 B, however many its front end split it into.

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
}

export interface Reported extends Omit<Measured, 'worst'> {
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
  const number = (key: string, unit: string, xs: number[], noise: number): Measured => ({
    name: `${page.name}_${key}`, unit, value: round(median(xs)), spread: quartiles(xs).map(round) as [number, number],
    better: 'lower', worst: round(Math.max(...xs)), noise,
  });
  return [
    number('bytes', 'B', wires, 0),
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
  const fetcher = new Fetcher(options.url, options.clock ?? realClock, options.deadline ?? 10000);
  const measured: Measured[][] = [];
  try {
    for (const page of options.pages) measured.push(await measure(fetcher, page, options.tries ?? 15));
  } finally {
    fetcher.close();
  }
  const weighed = await (options.weigh ?? ((url, pages) => weigh(url, pages)))(options.url, options.pages);
  return options.pages.flatMap((page, i) => [...measured[i], {
    name: `${page.name}_weight`, unit: 'B', value: weighed[i].bytes, spread: [weighed[i].bytes, weighed[i].bytes] as [number, number],
    better: 'lower' as const, worst: weighed[i].bytes, noise: 0,
  }]);
}

/** Each page of the product at url weighed in one Chrome, as a phone, one after another, each in a context of its own. */
export async function weigh(url: string, pages: Page[], options: WeighOptions = {}): Promise<Weighed[]> {
  const chrome = await Chrome.start(options.chrome ?? process.env.CHROME ?? 'google-chrome', options.deadline ?? 60000, options.flags ?? []);
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
 * An answer's bytes, as Chrome counted them (total, of which head its headers), but over HTTP/2 with its body of
 * body bytes counted as though it came in frames of FRAME, as few as hold it. Cloud Run's front end splits the same
 * body into frames of lengths of its own from one answer to the next, 9 B a frame, and Chrome counts each (crux#29).
 * Where the body's length is not known, or is more than Chrome had of frames (an answer cut off), it is as counted.
 */
export function framed(total: number, head: number, body: number | undefined, protocol: string): number {
  if (!/^h2$/i.test(protocol) || body === undefined || !Number.isInteger(body) || body < 0 || total - head < body) return total;
  return head + body + FRAME_HEAD * Math.ceil(body / FRAME);
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
  // Of each request: what steadies its headers (by), and over HTTP/2, what frames its body (head, body, protocol).
  const requests = new Map<string, Weighed['fetched'][number] & { done: boolean; by: number; head: number; body?: number; protocol: string }>();
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
  const listen = (m: any) => {
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
      requests.set(p.requestId, { url: p.request.url, type: p.type ?? 'Other', bytes: 0, done: false, by: 0, head: 0, protocol: '' });
      last = Date.now();
    } else if (m.method === 'Network.responseReceived') {
      if (p.type === 'Document' && p.frameId === targetId) status = p.response.status;
      // A picture is steadied as any answer is: Chrome counts its headers and its frames, over HTTP/2 too (crux#28).
      const r = requests.get(p.requestId);
      if (r) {
        r.by = steadied(p.response.headers, p.response.protocol ?? '');
        r.head = p.response.encodedDataLength ?? 0;
        r.protocol = p.response.protocol ?? '';
        r.body = bodyLength(p.response.headers);
      }
    } else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
      const r = requests.get(p.requestId);
      if (r) {
        r.done = true;
        if (m.method === 'Network.loadingFinished') r.bytes = p.encodedDataLength ?? 0;
        else r.failed = p.errorText;
      }
      last = Date.now();
    } else if (m.method === 'Page.loadEventFired') loaded = true;
  };
  chrome.listeners.add(listen);
  try {
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
    // A body whose length its headers do not say, as one compressed as it is sent, is as long as the page's Resource
    // Timing says, where it says one length for the address.
    if ([...requests.values()].some((r) => r.body === undefined && r.protocol === 'h2')) {
      const { result } = await s('Runtime.evaluate', {
        expression: 'JSON.stringify(performance.getEntries().filter((e) => "encodedBodySize" in e).map((e) => [e.name, e.encodedBodySize]))',
        returnByValue: true,
      });
      const sizes = new Map<string, Set<number>>();
      for (const [name, size] of JSON.parse(result.value ?? '[]') as [string, number][]) {
        if (!sizes.has(name)) sizes.set(name, new Set());
        sizes.get(name)!.add(size);
      }
      for (const r of requests.values()) {
        const known = sizes.get(r.url);
        // A size of 0 is what Resource Timing says of another origin's answer that does not let it say more.
        if (r.body === undefined && known?.size === 1 && !known.has(0)) r.body = [...known][0];
      }
    }
    // A dedicated worker's script Chrome counts as its head alone, where it tells of its end on the worker's session:
    // its body is as long as its headers say, where they say.
    const whole = (bytes: number, head: number, body?: number) => body !== undefined && head > 0 && bytes <= head ? head + body : bytes;
    const fetched = [...redirected, ...[...requests.values()].map(({ done, by, head, body, protocol, ...r }) =>
      ({ ...r, bytes: r.failed ? r.bytes : framed(whole(r.bytes, head, body), head, body, protocol) + by }))];
    return { bytes: fetched.reduce((a, r) => a + r.bytes, 0), fetched };
  } finally {
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

/**
 * What nerd reads: each number with its baseline, the one the baseline file keeps for it (a JSON
 * report of its own), or, where there is none or it is written again, this run's.
 */
export function report(numbers: Measured[], baselineFile: string | null, write: boolean): Report {
  const kept: Record<string, { value: number; worst: number }> = {};
  if (baselineFile && !write) {
    for (const n of JSON.parse(baselineFile).numbers ?? []) kept[n.name] = n.baseline;
  }
  return {
    main: numbers.find((n) => n.name.endsWith('_ms'))?.name ?? numbers[0].name,
    numbers: numbers.map(({ worst, ...n }) => ({
      ...n,
      baseline: kept[n.name] ?? { value: n.value, worst },
      ideal: IDEAL[n.name.slice(n.name.lastIndexOf('_') + 1)],
    })),
  };
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
  const baselinePath = valueOf(args, '--baseline') ?? 'probe/speed.json';
  const write = args.includes('--write-baseline');

  const numbers = await probe({ url, pages, tries });
  let baselineFile: string | null = null;
  try {
    baselineFile = readFileSync(baselinePath, 'utf8');
  } catch {}
  const out = report(numbers, baselineFile, write);

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
      console.log(`${n.name.padEnd(14)} ${String(n.value).padStart(8)} ${n.unit.padEnd(9)} spread ${n.spread.join('–')}  baseline ${n.baseline.value} (worst ${n.baseline.worst})  ideal ${n.ideal}${n.noise ? `  noise ${n.noise}` : ''}`);
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
