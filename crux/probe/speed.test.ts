// What the probe counts as a request, its median and its noise, and a run against a stand-in server
// whose answers are made here, on a clock of the test's own; and a page weighed in Chrome, as a phone,
// against the bytes its server wrote.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import http2 from 'node:http2';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { bytesWorst, framed, framesOf, headerBlock, idealsFrom, marksFrom, median, numberNames, pagesFrom, probe, quartiles, report, steadied, subresources, timeMarks, valueBytes, weigh, withoutNoise } from './speed.ts';
import type { Clock, Mark, Measured, Page } from './speed.ts';

const icon = '<link rel="icon" href="data:image/svg+xml,x">';

test('a page with its icon and style inside it needs nothing else', () => {
  assert.deepEqual(subresources(`<html><head>${icon}<style>body{color:red}</style></head><body><p>hi</p></body></html>`), []);
});

test('a page without an icon is asked for /favicon.ico', () => {
  assert.deepEqual(subresources('<p>hi</p>'), ['/favicon.ico']);
});

test('what a page loads is counted once each', () => {
  const html = `${icon}<link rel="stylesheet" href="/a.css"><link rel="alternate" href="/feed/">
    <script src="/a.js"></script><script>inline()</script><img src="/p.png"><img src='/p.png'><img src=/q.png alt=x>
    <img srcset="/r.png 1x, /r2.png 2x"><iframe src="/f"></iframe><video src="/v.mp4" poster="/v.jpg"></video>
    <style>@import "/b.css"; body{background:url('/bg.png')} i{background:url(data:image/png;base64,x)}</style>`;
  assert.deepEqual(subresources(html).sort(), ['/a.css', '/a.js', '/b.css', '/bg.png', '/f', '/p.png', '/q.png', '/r.png', '/v.jpg', '/v.mp4'].sort());
});

test('what a link loads is by its rel, and an input only as an image', () => {
  const html = `${icon}<link rel="preload" href="/font.woff2"><link rel="modulepreload" href="/m.js">
    <link rel="manifest" href="/app.webmanifest"><link rel="apple-touch-icon" href="/touch.png">
    <link rel="canonical" href="/here"><link rel="preconnect" href="https://cdn.example">
    <input type="image" src="/go.png"><input type="text" src="/not.png"><a href="/next">next</a><img src="#x">`;
  assert.deepEqual(subresources(html).sort(), ['/app.webmanifest', '/font.woff2', '/go.png', '/m.js', '/touch.png'].sort());
});

test('the median is the middle try, or the mean of the middle two', () => {
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([40, 10, 30, 20]), 25);
  assert.equal(median([7]), 7);
});

test('the spread is the middle half, from its low end to its high', () => {
  assert.deepEqual(quartiles([50, 10, 40, 20, 30]), [20, 40]);
  assert.deepEqual(quartiles([5]), [5, 5]);
});

test('noise is an answer slower than three times the median and 200 ms beyond it, and only that', () => {
  // The median is 50: 1000 is both, and noise; 240 is three times it but not 200 ms beyond.
  assert.deepEqual(withoutNoise([40, 50, 60, 240, 1000]), [40, 50, 60, 240]);
  // The median is 300: 600 is 200 ms beyond it but not three times it.
  assert.deepEqual(withoutNoise([290, 300, 310, 600]), [290, 300, 310, 600]);
  // Just past both, at a median of 100: 301 is noise, 300 is not.
  assert.deepEqual(withoutNoise([100, 100, 100, 300, 301]), [100, 100, 100, 300]);
});

/** A clock of the test's own, which only the stand-in server moves. */
function testClock(): Clock & { t: number } {
  return { t: 0, now() { return this.t; } };
}

interface Stand {
  url: string;
  asked: { path: string; encoding: string }[];
  close(): Promise<void>;
}

/**
 * A stand-in server: each answer is made by answer(path, n), its nth to that path, which says how
 * long the server takes (moving the test's clock), what it answers, or to drop the connection.
 */
async function stand(answer: (path: string, n: number) => { ms?: number; status?: number; html?: string; drop?: boolean; hang?: boolean }): Promise<Stand> {
  const asked: Stand['asked'] = [];
  const counts = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const n = counts.get(path) ?? 0;
    counts.set(path, n + 1);
    const encoding = String(req.headers['accept-encoding'] ?? '');
    asked.push({ path, encoding });
    const a = answer(path, n);
    if (a.hang) return;
    if (a.drop) return req.socket.destroy();
    if (a.ms !== undefined) clock.t += a.ms;
    const html = Buffer.from(a.html ?? '');
    const br = encoding.split(/,\s*/).includes('br');
    const body = br ? zlib.brotliCompressSync(html) : zlib.gzipSync(html);
    res.writeHead(a.status ?? 200, { 'content-type': 'text/html', 'content-encoding': br ? 'br' : 'gzip', 'content-length': body.length });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    asked,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

let clock = testClock();
// Where Chrome is not the point: each page weighs a thousand times its place in the list, and one more.
const weighed: Page[][] = [];
const scales = async (_url: string, pages: Page[]) => {
  weighed.push(pages);
  return pages.map((_p, i) => ({ bytes: 1000 * (i + 1) + 1, fetched: [] }));
};
const byName = (numbers: Measured[]) => Object.fromEntries(numbers.map((n) => [n.name, n]));
// A page that compresses well, its stylesheet and script loaded, its icon inline.
const page = `<!doctype html>${icon}<link rel="stylesheet" href="/s.css"><script src="/a.js"></script>${'<p>words words words</p>'.repeat(2000)}`;

test('each page is measured: its bytes as a browser asks for them, its requests, and its time without the wake or the noise', async () => {
  clock = testClock();
  // To each page: a slow wake, then five tries; of those to /, the last is noise.
  const homeMs = [5000, 10, 20, 30, 40, 1000];
  const postMs = [900, 70, 50, 60, 80, 90];
  const s = await stand((path, n) => (path === '/' ? { ms: homeMs[n], html: page } : { ms: postMs[n], html: '<p>a post</p>' }));
  try {
    const pages = [{ name: 'home', path: '/' }, { name: 'post', path: '/post' }];
    weighed.length = 0;
    const n = byName(await probe({ url: s.url, pages, tries: 5, clock, weigh: scales }));
    assert.deepEqual(Object.keys(n), ['home_bytes', 'home_requests', 'home_ms', 'home_weight', 'post_bytes', 'post_requests', 'post_ms', 'post_weight']);

    // Each page's weight is its own, weighed once, all the pages together after their times.
    assert.deepEqual(weighed, [pages]);
    assert.deepEqual({ ...n.home_weight }, { name: 'home_weight', unit: 'B', value: 1001, spread: [1001, 1001], better: 'lower', worst: 2025, noise: 0 });
    assert.equal(n.post_weight.value, 2001);

    // The wake is left out, and so is the noise, counted.
    assert.deepEqual({ ...n.home_ms }, { name: 'home_ms', unit: 'ms', value: 25, spread: [20, 30], better: 'lower', worst: 40, noise: 1 });
    assert.deepEqual([n.post_ms.value, n.post_ms.spread, n.post_ms.worst, n.post_ms.noise], [70, [60, 80], 90, 0]);
    // Each page is asked once to wake the server, and then once a try; nothing else is asked for.
    assert.deepEqual(s.asked.map((a) => a.path), [...Array(6).fill('/'), ...Array(6).fill('/post')]);

    assert.equal(n.home_requests.value, 3);
    assert.equal(n.post_requests.value, 2);

    // Asked for br and gzip, it is sent brotli: what is counted is the compressed body and its head.
    assert.ok(s.asked.every((a) => a.encoding === 'br, gzip'));
    const body = zlib.brotliCompressSync(Buffer.from(page)).length;
    assert.ok(n.home_bytes.value > body && n.home_bytes.value < body + 400, `${n.home_bytes.value} is not ${body} and a head`);
    assert.deepEqual(n.home_bytes.spread, [n.home_bytes.value, n.home_bytes.value]);
  } finally {
    await s.close();
  }
});

test('a connection dropped is asked again on a new one, and counted as noise, the wake\'s too', async () => {
  for (const dropped of [0, 2]) {
    clock = testClock();
    const s = await stand((_path, n) => (n === dropped ? { drop: true } : { ms: 10, html: '<p>hi</p>' }));
    try {
      const n = byName(await probe({ url: s.url, pages: [{ name: 'home', path: '/' }], tries: 3, clock, weigh: scales }));
      assert.equal(n.home_ms.noise, 1, `dropped at ${dropped}`);
      assert.equal(n.home_ms.value, 10);
    } finally {
      await s.close();
    }
  }
});

test('a page that does not answer 200, to wake it or on any try, fails the run, and so does one dropped twice', async () => {
  for (const at of [0, 2]) {
    clock = testClock();
    const missing = await stand((_path, n) => (n === at ? { status: 404, html: 'gone' } : { html: '<p>hi</p>' }));
    try {
      await assert.rejects(probe({ url: missing.url, pages: [{ name: 'home', path: '/' }], tries: 3, clock, weigh: scales }), /\/ answered 404/);
    } finally {
      await missing.close();
    }
  }
  const dropped = await stand(() => ({ drop: true }));
  try {
    await assert.rejects(probe({ url: dropped.url, pages: [{ name: 'home', path: '/' }], tries: 2, clock, weigh: scales }), /^Error: \/: .*, then /);
  } finally {
    await dropped.close();
  }
});

test('a server that never answers is given up at the deadline, each try on its own', async () => {
  clock = testClock();
  const s = await stand(() => ({ hang: true }));
  try {
    await assert.rejects(probe({ url: s.url, pages: [{ name: 'home', path: '/' }], tries: 2, clock, deadline: 50, weigh: scales }),
      /no answer to \/ in 50 ms, then no answer to \/ in 50 ms/);
    assert.equal(s.asked.length, 2);
  } finally {
    await s.close();
  }
});

test('a weight is judged with a margin: within its baseline up to 0.1% or 1 KB more, whichever is larger, and worse a byte past it', async () => {
  const s = await stand(() => ({ html: '<p>a page</p>' }));
  try {
    const weighs = (bytes: number) => probe({ url: s.url, pages: [{ name: 'home', path: '/' }], tries: 1, clock: testClock(), weigh: async () => [{ bytes, fetched: [] }] });
    // As nerd judges it: a weight is worse where it is more than its baseline's worst.
    const worse = async (file: string, bytes: number) => {
      const n = report(await weighs(bytes), file, false).numbers.find((n) => n.name === 'home_weight')!;
      return n.value > n.baseline.worst;
    };
    // A small page, where 1 KB is the larger (0.1% of 20,001 B is 20 B); and a large one, where 0.1% is (5,000 B).
    for (const [w, margin] of [[20001, 1024], [5000000, 5000]]) {
      const file = JSON.stringify(report(await weighs(w), null, true));
      assert.equal(await worse(file, w), false);
      assert.equal(await worse(file, w + margin), false, `${w} B and ${margin} B more`);
      assert.equal(await worse(file, w + margin + 1), true, `${w} B and ${margin + 1} B more`);
    }
  } finally {
    await s.close();
  }
});

test('a page\'s bytes are judged with a margin: the same markup with new hashed names is not worse, and more of it is', async () => {
  // A page as a bundler writes it, its script and stylesheet named by their hashes, the rest of it the same each build:
  // the hashes drawn from a seed, so each run is the same builds.
  let seed = 70;
  const char = () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[((seed = (seed * 1103515245 + 12345) % 2 ** 31) >>> 16) % 64];
  const hash = () => Array.from({ length: 8 }, char).join('');
  const markup = (more = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">${icon}
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Dawn</title>
    <script type="module" crossorigin src="/assets/index-${hash()}.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-${hash()}.css"></head>
    <body><main id="app"><h1>Dawn</h1><p>A day as it begins, kept for you.</p>${more}</main></body></html>`;
  let html = markup();
  const s = await stand(() => ({ html }));
  try {
    const bytes = async (file: string | null, write: boolean) =>
      report(await probe({ url: s.url, pages: [{ name: 'home', path: '/' }], tries: 1, clock: testClock(), weigh: scales }), file, write)
        .numbers.find((n) => n.name === 'home_bytes')!;
    const file = JSON.stringify({ numbers: [await bytes(null, true)] });
    const baseline = (await bytes(file, false)).baseline;
    assert.equal(baseline.worst, baseline.value + 64);
    // As nerd judges it: worse where it is more than its baseline's worst. Builds whose names alone changed are not,
    // though some compress past the build the baseline was written from.
    const builds: number[] = [];
    for (let i = 0; i < 40; i++) {
      html = markup();
      const n = await bytes(file, false);
      assert.ok(n.value <= n.baseline.worst, `${n.value} B, a baseline of ${n.baseline.value} B`);
      builds.push(n.value);
    }
    assert.ok(builds.some((b) => b > baseline.value), `every build compressed to ${baseline.value} B or less: ${builds}`);
    // A page with more to it, words that compress no smaller, is worse.
    html = markup(`<p>${hash()}${hash()}${hash()}${hash()}${hash()}${hash()}${hash()}${hash()}${hash()}${hash()}</p>`);
    const more = await bytes(file, false);
    assert.ok(more.value > more.baseline.worst, `${more.value} B, a baseline of ${more.baseline.worst} B at worst`);
  } finally {
    await s.close();
  }
  // The margin is 64 B, or 0.1% of the bytes where that is larger.
  assert.equal(bytesWorst(1573), 1637);
  assert.equal(bytesWorst(64000), 64064);
  assert.equal(bytesWorst(200000), 200200);
});

const measured: Measured[] = [
  { name: 'home_bytes', unit: 'B', value: 4978, spread: [4978, 4978], better: 'lower', worst: 4978, noise: 0 },
  { name: 'home_ms', unit: 'ms', value: 89.4, spread: [88.4, 92.2], better: 'lower', worst: 94, noise: 2 },
  { name: 'post_ms', unit: 'ms', value: 91.6, spread: [90.8, 93.1], better: 'lower', worst: 95.6, noise: 0 },
];

test('what nerd reads: each number with the baseline its file keeps, its ideal, and the first page\'s time as main', () => {
  const file = JSON.stringify({ url: 'x', numbers: [{ name: 'home_ms', baseline: { value: 80, worst: 85 } }] });
  const out = report(measured, file, false);
  assert.equal(out.main, 'home_ms');
  assert.deepEqual(out.numbers[1], {
    name: 'home_ms', unit: 'ms', value: 89.4, spread: [88.4, 92.2], better: 'lower', noise: 2,
    baseline: { value: 80, worst: 85 }, ideal: 50,
  });
  // A number the file has no baseline for takes this run's, as does every number where it is written again.
  assert.deepEqual(out.numbers[0].baseline, { value: 4978, worst: 4978 });
  assert.equal(out.numbers[0].ideal, 14000);
  assert.ok(out.numbers.every((n) => !('worst' in n)));
  assert.deepEqual(report(measured, file, true).numbers[1].baseline, { value: 89.4, worst: 94 });
  assert.deepEqual(report(measured, null, false).numbers[2].baseline, { value: 91.6, worst: 95.6 });
});

test('the pages are the flags\', in their order, or else the file\'s', () => {
  const read = (f: string) => {
    assert.equal(f, 'pages.json');
    return '{"home": "/", "post": "/2008/01/31/gears-asp-net-tutorial/"}';
  };
  assert.deepEqual(pagesFrom(['--page', 'b=/b', '--json', '--page', 'a=/a?x=1', '--pages', 'pages.json'], read),
    [{ name: 'b', path: '/b' }, { name: 'a', path: '/a?x=1' }]);
  assert.deepEqual(pagesFrom(['--pages', 'pages.json'], read),
    [{ name: 'home', path: '/' }, { name: 'post', path: '/2008/01/31/gears-asp-net-tutorial/' }]);
  assert.throws(() => pagesFrom([], read), /no pages/);
  assert.throws(() => pagesFrom(['--page', '/a'], read), /NAME=PATH/);
  assert.throws(() => pagesFrom(['--page', 'a='], read), /NAME=PATH/);
  assert.throws(() => pagesFrom(['--pages', 'p.json'], () => '["/"]'), /not an object/);
  assert.throws(() => pagesFrom(['--pages', 'p.json'], () => '{}'), /names no pages/);
});

/** The probe run as a product's [[intuition]] runs it, from dir, as this test was run. */
function cli(dir: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const speed = fileURLToPath(new URL('./speed.ts', import.meta.url));
  return new Promise((resolve) => {
    execFile(process.execPath, [...process.execArgv, speed, ...args], { cwd: dir, env: { ...process.env, NERD_URL: '', ...env } },
      (e, stdout, stderr) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout, stderr }));
  });
}

test('--json prints what nerd reads, and --write-baseline writes the baseline it is judged against after, making its directory', async () => {
  const s = await stand(() => ({ html: page }));
  const dir = mkdtempSync(join(tmpdir(), 'crux-probe-'));
  try {
    // A new product has no probe/ directory: the baseline is written all the same.
    writeFileSync(join(dir, 'pages.json'), '{"home": "/", "post": "/post"}');
    const wrote = await cli(dir, ['--pages', 'pages.json', '--tries', '3', '--json', '--write-baseline'], { NERD_URL: s.url });
    assert.equal(wrote.code, 0, wrote.stderr);
    const out = JSON.parse(wrote.stdout);
    assert.equal(out.main, 'home_ms');
    // Weighed in Chrome, as the command always is.
    assert.deepEqual(out.numbers.map((n: { name: string }) => n.name),
      ['home_bytes', 'home_requests', 'home_ms', 'home_weight', 'post_bytes', 'post_requests', 'post_ms', 'post_weight']);
    const weight = out.numbers.find((n: { name: string }) => n.name === 'home_weight');
    assert.ok(weight.value > zlib.brotliCompressSync(Buffer.from(page)).length, `home_weight is ${weight.value}`);
    assert.equal(weight.ideal, 14000);
    for (const n of out.numbers) assert.deepEqual(Object.keys(n).sort(), ['baseline', 'better', 'ideal', 'name', 'noise', 'spread', 'unit', 'value']);

    // The baseline keeps the address and the pages, and what was printed; nerd reads its numbers' baselines.
    const file = JSON.parse(readFileSync(join(dir, 'probe/speed.json'), 'utf8'));
    assert.equal(file.url, s.url);
    assert.deepEqual(file.pages, { home: '/', post: '/post' });
    assert.ok(!Number.isNaN(Date.parse(file.measured)));
    assert.deepEqual(file.numbers, out.numbers);
    assert.match(wrote.stderr, /wrote probe\/speed\.json/);

    // Run again, it is judged against the file's baselines, not its own numbers.
    file.numbers[2].baseline = { value: 1, worst: 2 };
    writeFileSync(join(dir, 'probe/speed.json'), JSON.stringify(file));
    const judged = await cli(dir, ['--url', s.url + '/', '--page', 'home=/', '--tries', '2', '--json']);
    assert.equal(judged.code, 0, judged.stderr);
    assert.deepEqual(JSON.parse(judged.stdout).numbers[2].baseline, { value: 1, worst: 2 });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'probe/speed.json'), 'utf8')), file);

    // With no address, nothing is measured, and it fails, saying why.
    const none = await cli(dir, ['--pages', 'pages.json', '--json']);
    assert.equal(none.code, 1);
    assert.equal(none.stdout, '');
    assert.match(none.stderr, /no address: give --url URL, or NERD_URL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await s.close();
  }
});

/**
 * A page as a phone reads it, its server counting the bytes it writes for each answer, headers with them: a
 * picture of a srcset, for 1x and 2x; one far down, loaded lazily as it comes into view; one hidden, which a
 * lazy picture never is loaded as; and one its script fetches a second and a half after the far one has come,
 * within the two seconds the weighing waits for. The pictures are noise, as large as the test says.
 */
/** A PNG of noise, which compresses to nothing less: about bytes long, a picture Chrome reads whole. */
function png(bytes: number): Buffer {
  const width = Math.ceil(bytes / 4);
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(1, 4);
  head.set([8, 6, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + 4 * width);
  for (let i = 1; i < row.length; i++) row[i] = (i * 2654435761) >>> 13 & 255;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head),
    chunk('IDAT', zlib.deflateSync(row, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

async function phonePage(): Promise<{ url: string; wrote: Map<string, number>; close(): Promise<void> }> {
  const sizes: Record<string, number> = { '/near-1x.png': 3000, '/near-2x.png': 11000, '/far.png': 50000, '/hidden.png': 90000, '/late.png': 7000, '/redirected.png': 5000 };
  const html = `<!doctype html><meta name="viewport" content="width=device-width">${icon}
    <img srcset="/near-1x.png 1x, /near-2x.png 2x" width="300" height="200">
    <div style="height: 12000px"></div>
    <img src="/hidden.png" loading="lazy" width="300" height="200" style="display: none">
    <img src="/far.png" loading="lazy" width="300" height="200" onload="later()" onerror="later()">
    <script>
      function later() { setTimeout(() => { const i = new Image(); i.src = '/late.png'; document.body.append(i); }, 1500); }
    </script>
    <img src="/moved.png" width="10" height="10">`;
  const wrote = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const before = req.socket.bytesWritten;
    res.on('finish', () => wrote.set(path, (wrote.get(path) ?? 0) + req.socket.bytesWritten - before));
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    } else if (path === '/moved.png') {
      res.writeHead(301, { location: '/redirected.png', 'content-length': 0 });
      res.end();
    } else if (sizes[path]) {
      const body = png(sizes[path]);
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length });
      res.end(body);
    } else {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<p>not here</p>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    wrote,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

test('a page\'s weight is every byte a phone fetched to show it whole, scrolled to its end, and no other', async () => {
  const s = await phonePage();
  try {
    const [w] = await weigh(s.url, [{ name: 'home', path: '/' }]);
    // What Chrome fetched, as the server saw it: the 2x of the srcset, the lazy picture far down and what came after
    // it, the redirect and where it led; and neither the 1x nor the hidden picture.
    assert.deepEqual([...s.wrote.keys()].sort(), ['/', '/far.png', '/late.png', '/moved.png', '/near-2x.png', '/redirected.png']);
    assert.deepEqual(w.fetched.map((f) => new URL(f.url).pathname).sort(), [...s.wrote.keys()].sort());
    // Each request's bytes are what the server wrote for it, its head with its body.
    for (const f of w.fetched) assert.equal(f.bytes, s.wrote.get(new URL(f.url).pathname), f.url);
    assert.equal(w.bytes, [...s.wrote.values()].reduce((a, b) => a + b, 0));
  } finally {
    await s.close();
  }
});

test('a page that starts a Worker is weighed with the worker\'s script and what the worker fetched, each once', async () => {
  // Chrome tells of a worker's script on the page's session as it is asked for, and of its end, and of all the worker
  // fetches, on the worker's own: a weighing that heard only the page's waited for the script to the deadline (crux#39).
  const files: Record<string, [string, string]> = {
    '/': ['text/html', `<!doctype html>${icon}<script>new Worker('/worker.js')</script>`],
    '/worker.js': ['text/javascript', `fetch('/more.txt').then((r) => r.text()).then((t) => postMessage(t))`],
    '/more.txt': ['text/plain', 'x'.repeat(5000)],
  };
  const wrote = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const before = req.socket.bytesWritten;
    res.on('finish', () => wrote.set(path, (wrote.get(path) ?? 0) + req.socket.bytesWritten - before));
    const [type, body] = files[path] ?? ['text/plain', 'not here'];
    res.writeHead(files[path] ? 200 : 404, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const weighed = await weigh(`http://127.0.0.1:${port}`, [{ name: 'home', path: '/' }], { quiet: 300, deadline: 20000 })
      .catch((e: Error) => e);
    assert.ok(!(weighed instanceof Error), `the page was not weighed: ${weighed instanceof Error ? weighed.message : ''}`);
    const [w] = weighed;
    assert.deepEqual([...wrote.keys()].sort(), ['/', '/more.txt', '/worker.js']);
    assert.deepEqual(w.fetched.map((f) => new URL(f.url).pathname).sort(), ['/', '/more.txt', '/worker.js']);
    for (const f of w.fetched) assert.equal(f.bytes, wrote.get(new URL(f.url).pathname), f.url);
    assert.equal(w.bytes, [...wrote.values()].reduce((a, b) => a + b, 0));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a page that draws every frame is weighed though each frame holds its main thread longer than Chrome is waited for', async () => {
  // As reynolds-number's WebGL simulation, in Chrome's software GL, holds its main thread for seconds a frame: every
  // Runtime.evaluate waited behind a frame, and gave up at 30000 ms (crux#40). Here a frame after the load spins for a
  // minute, and one before it for 50 ms; the picture far down is lazy, and fetched only as it is scrolled to.
  const files: Record<string, [string, string | Buffer]> = {
    '/': ['text/html', `<!doctype html><meta name="viewport" content="width=device-width">${icon}
      <div style="height: 3000px"></div><img src="/far.png" loading="lazy" width="300" height="200">
      <script>
        function frame() {
          const t = performance.now();
          while (performance.now() - t < (document.readyState === 'complete' ? 60000 : 50));
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      </script>`],
    '/far.png': ['image/png', png(20000)],
  };
  const wrote = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const before = req.socket.bytesWritten;
    res.on('finish', () => wrote.set(path, (wrote.get(path) ?? 0) + req.socket.bytesWritten - before));
    const [type, body] = files[path] ?? ['text/plain', 'not here'];
    res.writeHead(files[path] ? 200 : 404, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    // Past the 30000 ms a command is waited for, so that a weighing that waits on a frame fails at its evaluate.
    const weighed = await weigh(`http://127.0.0.1:${port}`, [{ name: 'home', path: '/' }], { quiet: 300, deadline: 45000 })
      .catch((e: Error) => e);
    assert.ok(!(weighed instanceof Error), `the page was not weighed: ${weighed instanceof Error ? weighed.message : ''}`);
    const [w] = weighed;
    assert.deepEqual([...wrote.keys()].sort(), ['/', '/far.png']);
    assert.deepEqual(w.fetched.map((f) => new URL(f.url).pathname).sort(), ['/', '/far.png']);
    for (const f of w.fetched) assert.equal(f.bytes, wrote.get(new URL(f.url).pathname), f.url);
    assert.equal(w.bytes, [...wrote.values()].reduce((a, b) => a + b, 0));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('each page is weighed as a first visit, on connections of its own: none the page before opened carries over', async () => {
  // A connection kept from the page before is where HTTP/2 sends a page's headers as references to its table, and so
  // where its weight hangs on what came before it (crux#26). Here, over HTTP/1.1, whatever socket serves a page's
  // requests is one no other page's were served on.
  const sockets = new Map<string, Set<object>>();
  const server = http.createServer((req, res) => {
    const page = new URL(req.url ?? '/', 'http://x').searchParams.get('page') ?? req.headers.referer?.match(/page=(\w+)/)?.[1] ?? '?';
    if (!sockets.has(page)) sockets.set(page, new Set());
    sockets.get(page)!.add(req.socket);
    res.writeHead(200, { 'content-type': 'text/html', 'keep-alive': 'timeout=60' });
    res.end(`<!doctype html>${icon}<img src="/a.png?page=${page}" width="10" height="10">`);
  });
  server.keepAliveTimeout = 60000;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const pages = ['one', 'two', 'six'].map((name) => ({ name, path: `/?page=${name}` }));
    const weighed = await weigh(`http://127.0.0.1:${port}`, pages, { quiet: 300 });
    assert.equal(weighed.length, 3);
    assert.deepEqual([...sockets.keys()].sort(), ['one', 'six', 'two']);
    for (const [page, mine] of sockets) {
      for (const [other, theirs] of sockets) {
        if (other !== page) for (const socket of mine) assert.ok(!theirs.has(socket), `${page} was served on a connection ${other} opened`);
      }
    }
    // Each page, the same but for its name, weighs the same whatever was weighed before it.
    assert.equal(new Set(weighed.map((w) => w.bytes)).size, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a header\'s value is counted as it goes on the wire: as it is over HTTP/1, coded over HTTP/2 and HTTP/3', () => {
  // RFC 7541's own examples (C.4.1, C.6.1): each a byte of length and then its Huffman code.
  assert.equal(valueBytes('www.example.com', 'h2'), 1 + 12);
  assert.equal(valueBytes('Mon, 21 Oct 2013 20:13:21 GMT', 'h2'), 1 + 22);
  assert.equal(valueBytes('https://www.example.com', 'h3'), 1 + 17);
  assert.equal(valueBytes('private', 'h2'), 1 + 5);
  // What the code would make longer is sent as it is, and a length of 127 or more takes a second byte.
  assert.equal(valueBytes('\x01\x01', 'h2'), 1 + 2);
  assert.equal(valueBytes('w'.repeat(126), 'h2'), 1 + 111);
  assert.equal(valueBytes('w'.repeat(200), 'h2'), 2 + 175);
  assert.equal(valueBytes('w'.repeat(500), 'h2'), 3 + 438);
  assert.equal(valueBytes('Mon, 21 Oct 2013 20:13:21 GMT', 'http/1.1'), 29);
});

test('an answer is counted as though its time and its trace were sent as the same values, and nothing else is', () => {
  const trace = (v: string) => ({ 'x-cloud-trace-context': v, 'content-type': 'text/html' });
  const short = '105445aa7843bc8bf206b12000100000/1;o=1';
  const long = '105445aa7843bc8bf206b12000100000/18446744073709551615';
  // Over HTTP/2, these code to lengths of their own: what is steadied is a difference that is there.
  assert.notEqual(valueBytes(short, 'h2'), valueBytes(long, 'h2'));
  assert.notEqual(valueBytes('Sat, 24 Oct 2026 19:41:05 GMT', 'h2'), valueBytes('Sun, 04 Jan 2026 23:59:59 GMT', 'h2'));
  for (const protocol of ['h2', 'h3', 'http/1.1']) {
    // Each trace, however long, comes to the same once steadied.
    assert.equal(valueBytes(short, protocol) + steadied(trace(short), protocol), valueBytes(long, protocol) + steadied(trace(long), protocol), protocol);
    const date = (d: string) => valueBytes(d, protocol) + steadied({ Date: d }, protocol);
    assert.equal(date('Sat, 24 Oct 2026 19:41:05 GMT'), date('Sun, 04 Jan 2026 23:59:59 GMT'), protocol);
  }
  assert.equal(steadied({ 'content-type': 'text/html', server: 'Google Frontend', 'content-length': '12345' }, 'h2'), 0);
  assert.equal(steadied({}, 'h2'), 0);
});

test('a third party\'s headers over HTTP/2 are counted as an encoder that indexes all it sends codes them, its times and its age at values fixed for them', () => {
  const sent = new Set<string>();
  const css = (date: string, age: string) => ({ 'content-type': 'text/css; charset=utf-8', date, expires: date, 'last-modified': date, age, 'x-xss-protection': '0' });
  const first = headerBlock(200, css('Sun, 25 Oct 2026 04:23:20 GMT', '5'), sent);
  // Its frame's header, its status, and each header whole: a name the static table has as an index, and one it has not whole.
  const fixed = 'Thu, 01 Jan 1970 00:00:00 GMT';
  assert.equal(first, 9 + 1 + (1 + valueBytes('text/css; charset=utf-8', 'h2')) + 3 * (1 + valueBytes(fixed, 'h2')) + (1 + valueBytes('0', 'h2'))
    + (1 + valueBytes('x-xss-protection', 'h2') + valueBytes('0', 'h2')));
  // The same headers again on the connection, whatever their times and age, are an index each; what changed is sent
  // whole, its name an index of what was sent before.
  assert.equal(headerBlock(200, css('Mon, 26 Oct 2026 14:00:01 GMT', '123456'), sent), 9 + 1 + 6);
  assert.equal(headerBlock(200, { ...css(fixed, '0'), 'x-xss-protection': '1' }, sent), 9 + 1 + 5 + 1 + valueBytes('1', 'h2'));
  // On a connection of its own, it is the first again; a status the static table does not have is sent whole.
  assert.equal(headerBlock(200, css('Tue, 03 Nov 2026 01:02:03 GMT', '77'), new Set()), first);
  assert.equal(headerBlock(302, {}, new Set()), 9 + 1 + valueBytes('302', 'h2'));
});

test('a body over HTTP/2 is counted as though it came in frames of 16384 B, and only there, and only when its frames are known', () => {
  // blog's image.738.webp on Cloud Run, Oct 24: 119 B of headers, 23706 B of body, in 7 frames one visit and 6 the next.
  const seven = [4000, 4000, 4000, 4000, 4000, 3706, 0];
  const six = [6000, 6000, 6000, 5706, 0, 0];
  assert.equal(framed(119 + 23706 + 7 * 9, seven, 'h2'), 119 + 23706 + 2 * 9);
  assert.equal(framed(119 + 23706 + 6 * 9, six, 'h2'), 119 + 23706 + 2 * 9);
  // A frame holds 16384 B at most: one more takes another frame, and no body takes none.
  assert.equal(framed(100 + 16384 + 9 * 3, [8000, 8384, 0], 'h2'), 100 + 16384 + 9);
  assert.equal(framed(100 + 16385 + 9 * 3, [8000, 8385, 0], 'h2'), 100 + 16385 + 18);
  assert.equal(framed(100 + 9, [0], 'h2'), 100);
  assert.equal(framed(100, [], 'h2'), 100);
  // Whatever Chrome said its headers came to, as it may have had a frame of the body or more with them (crux#47): only
  // its total and the frames are counted.
  assert.equal(framed(119 + 23706 + 7 * 9, seven.slice(0, 6).concat([0]), 'h2'), framed(119 + 23706 + 6 * 9, six, 'h2'));
  // Over HTTP/1 and HTTP/3, with no frames known, or with more frames than Chrome counted (an answer cut off), it is as counted.
  for (const [frames, protocol] of [[seven, 'http/1.1'], [seven, 'h3'], [undefined, 'h2'], [[30000, 0], 'h2']] as const) {
    assert.equal(framed(119 + 23706 + 7 * 9, frames as number[] | undefined, protocol), 119 + 23706 + 7 * 9, `${frames} ${protocol}`);
  }
});

test('each stream\'s frames are found in Chrome\'s net log by its socket, its authority and its path, each time it was asked, with how many Chrome had when it told of its answer', () => {
  let ts = 0;
  const event = (name: string, session: string, params: object, ph = 'n') => ({ name, cat: 'netlog', ph, id2: { local: session }, ts: ++ts, args: { params } });
  // A request, by its own source: its URL, when it began to tell of its answer, and the stream it then read from.
  const request = (source: string, url: string) => event('REQUEST_ALIVE', source, { url }, 'b');
  const told = (source: string) => event('URL_REQUEST_DELEGATE_RESPONSE_STARTED', source, {}, 'b');
  const read = (source: string, stream: number) => event('HTTP2_STREAM_UPDATE_RECV_WINDOW', source, { stream_id: stream, delta: -1 });
  const started = (session: string, socket: number) => event('HTTP2_SESSION_INITIALIZED', session, { protocol: 'h2', source_dependency: { id: socket, type: 10 } });
  const asked = (session: string, stream: number, authority: string, path: string) =>
    event('HTTP2_SESSION_SEND_HEADERS', session, { stream_id: stream, headers: [':method: GET', `:authority: ${authority}`, ':scheme: https', `:path: ${path}`] });
  const data = (session: string, stream: number, size: number) => event('HTTP2_SESSION_RECV_DATA', session, { stream_id: stream, size, fin: size === 0 });
  const win = (session: string, delta: number) => event('HTTP2_SESSION_UPDATE_RECV_WINDOW', session, { delta });
  const events = [
    // A session of Chrome's own, before the page, whose id is used again once it is gone.
    started('0x37', 232), asked('0x37', 1, 'accounts.google.com', '/ListAccounts'), data('0x37', 1, 0),
    started('0x37', 384), asked('0x37', 1, 'a.run.app', '/?home'), data('0x37', 1, 1809), data('0x37', 1, 1356),
    asked('0x37', 3, 'a.run.app', '/a.png'), asked('0x37', 5, 'cdn.example', '/a.png'),
    data('0x37', 3, 5017), data('0x37', 5, 4013), data('0x37', 1, 0), data('0x37', 3, 0), data('0x37', 5, 0),
    // The same picture asked again on the connection, and on another.
    asked('0x37', 7, 'a.run.app', '/a.png'), data('0x37', 7, 5017), data('0x37', 7, 0),
    started('0x40', 433), asked('0x40', 1, 'a.run.app', '/a.png'), data('0x40', 1, 16384), data('0x40', 1, 1),
    // Of a session whose start the trace did not have: nobody's.
    asked('0x99', 1, 'a.run.app', '/?home'), data('0x99', 1, 10),
    // A worker's script, told of once two of its frames were there, as Chrome tells of one late; and the picture
    // after it, told of at once, by a request whose source's id is the worker's again, once it is gone.
    request('0x85', 'https://a.run.app/w.js'), asked('0x40', 3, 'a.run.app', '/w.js'),
    data('0x40', 3, 894), data('0x40', 3, 766), told('0x85'), read('0x85', 3), data('0x40', 3, 1153), data('0x40', 3, 0),
    request('0x85', 'https://a.run.app/b.png?x=1'), asked('0x40', 5, 'a.run.app', '/b.png?x=1'),
    told('0x85'), data('0x40', 5, 2000), read('0x85', 5), data('0x40', 5, 0),
    // A stylesheet padded as Google pads its frames (crux#52): of each frame, its padding's length's byte and its
    // padding taken from the window and given back at once, its data taken until it is read; and one not padded,
    // whose data was read at once, after it.
    started('0x41', 458), asked('0x41', 1, 'fonts.googleapis.com', '/css2?family=x'),
    data('0x41', 1, 742), win('0x41', -1), win('0x41', 1), win('0x41', -492), win('0x41', -249), win('0x41', 249),
    data('0x41', 1, 245), win('0x41', -1), win('0x41', 1), win('0x41', -10), win('0x41', -234), win('0x41', 234),
    data('0x41', 1, 0), win('0x41', 10), win('0x41', 492),
    asked('0x41', 3, 'fonts.googleapis.com', '/css2?family=y'), data('0x41', 3, 300), win('0x41', -300), win('0x41', 300), data('0x41', 3, 0),
  ];
  // As Chrome's threads hand them in, not in order.
  const streams = framesOf([...events].reverse());
  const none = (frames: number[]) => ({ frames, told: 0 });
  assert.deepEqual(Object.fromEntries(streams), {
    '232 accounts.google.com/ListAccounts': [none([0])],
    '384 a.run.app/?home': [none([1809, 1356, 0])],
    '384 a.run.app/a.png': [none([5017, 0]), none([5017, 0])],
    '384 cdn.example/a.png': [none([4013, 0])],
    '433 a.run.app/a.png': [none([16384, 1])],
    '433 a.run.app/w.js': [{ frames: [894, 766, 1153, 0], told: 2 }],
    '433 a.run.app/b.png?x=1': [none([2000, 0])],
    '458 fonts.googleapis.com/css2?family=x': [none([492, 10, 0])],
    '458 fonts.googleapis.com/css2?family=y': [none([300, 0])],
  });
});

/**
 * A stand-in for Cloud Run's front end, over HTTP/2 as Chrome reads it, with a certificate made for the test: each
 * answer has an x-cloud-trace-context of its own, of a length of its own, now and then with ';o=1' after it, and a
 * date that changes from one answer to the next, as Google's front end sends them; and each body is sent in frames
 * of lengths of its own, as many as the answer's number says, as Cloud Run's front end split blog's pictures into 5
 * to 13 frames from one visit to the next (crux#29). The page, compressed as it is sent, says no content-length. With
 * early, each answer says Clear-Site-Data, which Chrome's network service asks its browser of before it tells of the
 * answer, so that the first frames of the body are there by then, and counted with the headers it tells of (crux#47):
 * as a busy machine had it now and then.
 */
async function frontEnd(early = false): Promise<{ url: string; answers: string[]; dates: string[]; worker: number; close(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'crux-front-'));
  await new Promise<void>((resolve, reject) => execFile('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'],
  (e) => (e ? reject(e) : resolve())));
  const key = readFileSync(join(dir, 'key.pem'));
  const cert = readFileSync(join(dir, 'cert.pem'));
  rmSync(dir, { recursive: true, force: true });
  const answers: string[] = [];
  const dates: string[] = [];
  let n = 0;
  let second = 0;
  // Larger than a frame, so that it takes two however it is framed.
  const picture = png(20000);
  // Words that brotli cannot make much smaller, so that the page too is long enough to split.
  const words = Array.from({ length: 1500 }, (_, i) => ((i * 2654435761) >>> 7).toString(36)).join(' ');
  const page = zlib.brotliCompressSync(`<!doctype html>${icon}<p>the same page</p><img src="/a.png" width="10" height="10"><link rel="stylesheet" href="/a.css"><p>${words}</p><script>new Worker('/w.js', { type: 'module' })</script>`);
  // A dedicated worker's script, as Dawn's home page starts one, compressed as the page is: Chrome tells of its answer
  // on the worker's session with no connection, so that its frames are known by what it asked for alone (crux#51).
  const worker = zlib.brotliCompressSync(`postMessage(${JSON.stringify(words)});\n// ${words}`);
  /** body, in 2 + n % 5 frames, each sent once the one before has gone, so that none is joined to the next. */
  const inFrames = async (res: http2.Http2ServerResponse, body: Buffer, n: number) => {
    const count = 2 + (n % 5);
    for (let i = 0, at = 0; i < count; i++) {
      const end = i === count - 1 ? body.length : at + Math.floor(body.length / (count + i % 2));
      await new Promise<void>((resolve) => res.write(body.subarray(at, end), () => setTimeout(resolve, 5)));
      at = end;
    }
    res.end();
  };
  const server = http2.createSecureServer({ key, cert }, (req, res) => {
    const path = req.url ?? '/';
    n++;
    // A span id of 1 to 20 digits, its digits of codes 5 and 6 bits long, and ';o=1' on every third answer.
    const span = String(10 ** (n % 20)).replace(/0/g, () => String((n * 7) % 10)).slice(0, 1 + (n * 3) % 20);
    const trace = `${(n * 2654435761).toString(16).padStart(32, '7')}/${span}${n % 3 ? '' : ';o=1'}`;
    answers.push(trace);
    // Each a time of its own, so that none is sent as a reference to one sent before, a second after the one before
    // and coded a byte longer or shorter than it, by turns.
    let date = '';
    do date = new Date(Date.UTC(2026, 9, 24) + 1000 * ++second).toUTCString();
    while (dates.length && (valueBytes(date, 'h2') === valueBytes(dates.at(-1)!, 'h2')));
    dates.push(date);
    const head = { 'x-cloud-trace-context': trace, date, server: 'Google Frontend', ...(early ? { 'clear-site-data': '"cache"' } : {}) };
    // The picture one Chrome reads whole, as Cloud Run's are: one it cannot read, as 2000 spaces, Chrome counts
    // its body alone of, over HTTP/2 (crux#28). The stylesheet is the same bytes, so that only its type tells them apart.
    if (path.startsWith('/a.png') || path.startsWith('/a.css')) {
      res.writeHead(200, { ...head, 'content-type': path.startsWith('/a.png') ? 'image/png' : 'text/css', 'content-length': String(picture.length) });
      void inFrames(res, picture, n);
    } else if (path === '/w.js') {
      res.writeHead(200, { ...head, 'content-type': 'text/javascript', 'content-encoding': 'br' });
      void inFrames(res, worker, n);
    } else if (path.startsWith('/?')) {
      res.writeHead(200, { ...head, 'content-type': 'text/html', 'content-encoding': 'br' });
      void inFrames(res, page, n);
    } else {
      res.writeHead(404, head);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}`,
    answers,
    dates,
    worker: worker.length,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('a page weighs the same from one visit to the next over HTTP/2, though its front end\'s trace and time change their length, and its frames their number, and Chrome tells of its headers late', async () => {
  for (const early of [false, true]) await visits(early);
});

async function visits(early: boolean) {
  const s = await frontEnd(early);
  try {
    // The same page, a name of the same length each time, so that only the trace and the time tell its answers apart.
    // The first warms Chrome: its first handshake can be slow enough that Chrome opens a second connection beside it,
    // whose own first frames it counts to whatever it asks there (30 B, now and then), which is no header's.
    const pages = ['wrm', 'one', 'two', 'six', 'ten'].map((name) => ({ name, path: `/?${name}` }));
    const weighed = (await weigh(s.url, pages, { quiet: 300, flags: ['--ignore-certificate-errors'] })).slice(1);
    // Four answers a visit, the page, its picture, its stylesheet and its worker's script, each of a trace of its own,
    // of lengths that are not all the same.
    assert.equal(s.answers.length, 20);
    assert.ok(new Set(s.answers.map((a) => valueBytes(a, 'h2'))).size > 3, s.answers.join(' '));
    assert.equal(new Set(s.dates.map((d) => valueBytes(d, 'h2'))).size, 2, s.dates.join(', '));
    assert.ok(weighed.every((w) => w.fetched.length === 4 && w.fetched.every((f) => f.bytes > 0)));
    // The worker's script with its body, which Chrome counts its head alone of (crux#39).
    for (const w of weighed) assert.ok(w.fetched.find((f) => f.url.endsWith('/w.js'))!.bytes > s.worker, `early: ${early}`);
    assert.deepEqual(weighed.map((w) => w.bytes), weighed.map(() => weighed[0].bytes), `early: ${early}: ${weighed.map((w) => w.fetched.map((f) => f.bytes).join('+')).join(', ')}`);
    // The picture is weighed as the stylesheet is, its headers and its frames with its body (crux#28): they differ by
    // their types alone.
    const kind = (w: (typeof weighed)[number], type: string) => w.fetched.find((f) => f.type === type)!.bytes;
    for (const w of weighed) assert.equal(kind(w, 'Image') - kind(w, 'Stylesheet'), valueBytes('image/png', 'h2') - valueBytes('text/css', 'h2'), `early: ${early}`);
  } finally {
    await s.close();
  }
}

/**
 * A third party's answers, over HTTP/2, as Google Fonts sends its stylesheets (crux#52): each frame of a body padded,
 * as Google's are, and each body in frames of a number of its own; and the times of the visit's two answers, its date,
 * its expires and its last-modified, the same second on one visit, so that the second answer sends them as references
 * to the first's, and seconds of their own on the next, so that it sends them whole, and its age of a length of its own.
 */
async function thirdParty(): Promise<{ url: string; asked: string[]; close(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'crux-third-'));
  await new Promise<void>((resolve, reject) => execFile('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'],
  (e) => (e ? reject(e) : resolve())));
  const key = readFileSync(join(dir, 'key.pem'));
  const cert = readFileSync(join(dir, 'cert.pem'));
  rmSync(dir, { recursive: true, force: true });
  const asked: string[] = [];
  const css = zlib.gzipSync(Array.from({ length: 400 }, (_, i) => `.c${((i * 2654435761) >>> 9).toString(36)}{color:#${(i * 77777).toString(16).slice(-6).padStart(6, '0')}}`).join('\n'));
  let n = 0;
  let second = 0;
  const server = http2.createSecureServer({ key, cert, paddingStrategy: http2.constants.PADDING_STRATEGY_MAX }, (req, res) => {
    const path = req.url ?? '/';
    asked.push(path);
    n++;
    // Each visit asks for two: the second of an even visit has the first's second, and every other a second of its own.
    if (n % 4 !== 2) second += 3601 + (n % 7) * 86400 * 11;
    const at = (d: number) => new Date(Date.UTC(2026, 9, 24) + 1000 * (second + d)).toUTCString();
    res.writeHead(200, {
      'content-type': 'text/css; charset=utf-8', 'content-encoding': 'gzip', 'access-control-allow-origin': '*',
      'cache-control': 'private, max-age=86400, stale-while-revalidate=604800', 'x-content-type-options': 'nosniff',
      date: at(0), expires: at(86400), 'last-modified': at(0), age: String(7 ** (n % 9)), server: 'ESF',
    });
    void (async () => {
      const count = 1 + (n % 4);
      for (let i = 0, from = 0; i < count; i++) {
        const end = i === count - 1 ? css.length : from + Math.floor(css.length / count);
        await new Promise<void>((resolve) => res.write(css.subarray(from, end), () => setTimeout(resolve, 5)));
        from = end;
      }
      res.end();
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `https://127.0.0.1:${port}`, asked, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test('a page weighs the same from one visit to the next though a third party pads its frames, splits its bodies its own way, and sends its times whole or as references', async () => {
  const fonts = await thirdParty();
  const page = `<!doctype html>${icon}<link rel="stylesheet" href="${fonts.url}/a.css"><link rel="stylesheet" href="${fonts.url}/b.css"><p>the same page</p>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(page) });
    res.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const pages = ['wrm', 'one', 'two', 'six', 'ten'].map((name) => ({ name, path: `/?${name}` }));
    const weighed = (await weigh(`http://127.0.0.1:${port}`, pages, { quiet: 300, flags: ['--ignore-certificate-errors'] })).slice(1);
    assert.equal(fonts.asked.length, 10);
    assert.ok(weighed.every((w) => w.fetched.length === 3 && w.fetched.every((f) => f.bytes > 0)));
    assert.deepEqual(weighed.map((w) => w.bytes), weighed.map(() => weighed[0].bytes), weighed.map((w) => w.fetched.map((f) => f.bytes).join('+')).join(', '));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fonts.close();
  }
});

test('a page not 200 to Chrome fails its weighing, and so does a Chrome that is not there', async () => {
  const s = await phonePage();
  try {
    await assert.rejects(weigh(s.url, [{ name: 'gone', path: '/gone' }]), /\/gone answered 404 to Chrome/);
    await assert.rejects(weigh(s.url, [{ name: 'home', path: '/' }], { chrome: '/no/such/chrome' }), /Chrome \(\/no\/such\/chrome\) could not start/);
  } finally {
    await s.close();
  }
});

test('a page that never answers is given up at the deadline, and Chrome with it', async () => {
  const server = http.createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await assert.rejects(weigh(`http://127.0.0.1:${port}`, [{ name: 'home', path: '/' }], { deadline: 3000 }),
      /weighing \/ took longer than 3000 ms/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// A page's own marks (crux#43): a stand-in for Chrome where Chrome is not the point, which gives each mark of each
// page the times the test says, a load each.
test('each mark is a number of its page\'s, after its weight: the median of its loads, their spread, and the noise left out', async () => {
  clock = testClock();
  const s = await stand(() => ({ ms: 10, html: '<p>hi</p>' }));
  try {
    const pages = [{ name: 'home', path: '/' }, { name: 'post', path: '/post' }];
    const marks: Mark[] = [{ name: 'ready', selector: 'body[data-ready]' }, { name: 'instruments', page: 'home' }];
    const timedWith: [Page[], Mark[]][] = [];
    const time = async (_url: string, pages: Page[], marks: Mark[]) => {
      timedWith.push([pages, marks]);
      return [{ ready: [1700, 1600, 1800, 9000, 1650], instruments: [1500, 1400, 1550, 1450, 1500] }, { ready: [300, 310, 320] }];
    };
    const n = byName(await probe({ url: s.url, pages, tries: 2, clock, weigh: scales, marks, time }));
    assert.deepEqual(Object.keys(n), ['home_bytes', 'home_requests', 'home_ms', 'home_weight', 'home_ready_ms', 'home_instruments_ms',
      'post_bytes', 'post_requests', 'post_ms', 'post_weight', 'post_ready_ms']);
    assert.deepEqual(n.home_ready_ms, { name: 'home_ready_ms', unit: 'ms', value: 1675, spread: [1650, 1700], better: 'lower', worst: 1800, noise: 1, ideal: 1000 });
    assert.deepEqual([n.home_instruments_ms.value, n.home_instruments_ms.spread, n.home_instruments_ms.noise], [1500, [1450, 1500], 0]);
    assert.deepEqual([n.post_ready_ms.value, n.post_ready_ms.worst], [310, 320]);
    // Timed once, all the pages together, given every mark.
    assert.deepEqual(timedWith, [[pages, marks]]);
    // With no marks, nothing is timed, and the numbers are as they were.
    const none = byName(await probe({ url: s.url, pages, tries: 2, clock, weigh: scales, time: () => assert.fail('timed') }));
    assert.deepEqual(Object.keys(none), numberNames(pages, []));
    assert.deepEqual(Object.keys(n), numberNames(pages, marks));
    // A mark on a page there is not fails before anything is asked.
    s.asked.length = 0;
    await assert.rejects(probe({ url: s.url, pages, clock, weigh: scales, time, marks: [{ name: 'x', page: 'about' }] }), /there is no page about/);
    assert.equal(s.asked.length, 0);
  } finally {
    await s.close();
  }
});

test('a mark\'s ideal is a second, and any number\'s is what the product says, as main is', () => {
  const marked: Measured[] = [...measured, { name: 'home_ready_ms', unit: 'ms', value: 1700, spread: [1650, 1750], better: 'lower', worst: 1800, noise: 0, ideal: 1000 }];
  const out = report(marked, null, false);
  assert.equal(out.main, 'home_ms');
  assert.deepEqual(out.numbers[3], { name: 'home_ready_ms', unit: 'ms', value: 1700, spread: [1650, 1750], better: 'lower', noise: 0, baseline: { value: 1700, worst: 1800 }, ideal: 1000 });
  const judged = report(marked, null, false, { ideals: { home_ready_ms: 800, home_ms: 40 }, main: 'home_ready_ms' });
  assert.equal(judged.main, 'home_ready_ms');
  assert.deepEqual(judged.numbers.map((n) => n.ideal), [14000, 40, 50, 800]);
});

test('the marks are the flags\', on every page or on one, a performance.mark or a selector', () => {
  assert.deepEqual(marksFrom(['--mark', 'instruments', '--json', '--mark', 'home:shown=main > canvas:not(.x)', '--ready', 'body[data-ready]']), [
    { name: 'instruments' },
    { name: 'shown', page: 'home', selector: 'main > canvas:not(.x)' },
    { name: 'ready', selector: 'body[data-ready]' },
  ]);
  assert.deepEqual(marksFrom(['--page', 'home=/']), []);
  assert.deepEqual(marksFrom(['--mark', 'home:a', '--mark', 'post:a']), [{ name: 'a', page: 'home' }, { name: 'a', page: 'post' }]);
  assert.throws(() => marksFrom(['--mark', 'a b']), /\[PAGE:\]NAME\[=SELECTOR\]/);
  assert.throws(() => marksFrom(['--mark']), /\[PAGE:\]NAME\[=SELECTOR\]/);
  assert.throws(() => marksFrom(['--ready']), /--ready wants a SELECTOR/);
  assert.throws(() => marksFrom(['--mark', 'ready', '--ready', 'body']), /ready is given twice/);
  assert.throws(() => marksFrom(['--mark', 'home:a', '--mark', 'a']), /a is given twice/);
  assert.deepEqual(idealsFrom(['--ideal', 'home_ready_ms=800', '--ideal', 'home_ms=40.5']), { home_ready_ms: 800, home_ms: 40.5 });
  assert.throws(() => idealsFrom(['--ideal', 'home_ms']), /NUMBER=VALUE/);
});

/**
 * A page that does its work in the browser after its load, as Dawn loads its instruments: its script fetches /slow,
 * which its server answers after the test's delay, marks `instruments` once it has it, and sets body[data-ready] a
 * frame after; and from then on each frame holds its main thread for a minute, as a page that draws every frame may.
 */
async function workingPage(delay: number): Promise<{ url: string; asked: string[]; close(): Promise<void> }> {
  const asked: string[] = [];
  const html = `<!doctype html>${icon}<body><script>
    addEventListener('load', async () => {
      await (await fetch('/slow')).text();
      performance.mark('instruments');
      requestAnimationFrame(() => {
        document.body.dataset.ready = 'yes';
        const spin = () => { const t = performance.now(); while (performance.now() - t < 60000); requestAnimationFrame(spin); };
        requestAnimationFrame(spin);
      });
    });
  </script></body>`;
  const server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    asked.push(path);
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    };
    if (path === '/' || path === '/again') send(200, 'text/html', html);
    else if (path === '/slow') setTimeout(() => send(200, 'text/plain', 'instruments'), delay);
    // It asks for /thrown, and only then, its main thread held a second, throws.
    else if (path === '/bad') send(200, 'text/html', `<!doctype html>${icon}<script>fetch('/thrown'); const t = performance.now(); while (performance.now() - t < 1000); throw new Error('no instruments')</script>`);
    else if (path === '/thrown') send(200, 'text/plain', 'heard');
    else send(404, 'text/plain', 'not here');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    asked,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('a page\'s marks are timed in Chrome from navigation, a first visit each load, though its frames after hold its main thread', async () => {
  const s = await workingPage(300);
  try {
    const pages = [{ name: 'home', path: '/' }, { name: 'plain', path: '/nothing' }, { name: 'again', path: '/again' }];
    const marks: Mark[] = [{ name: 'instruments' }, { name: 'ready', selector: 'body[data-ready]' }];
    const timed = await timeMarks(s.url, pages, marks.map((m) => ({ ...m, page: 'home' })).concat([{ name: 'ready', page: 'again', selector: 'body[data-ready]' }]), { loads: 3, deadline: 20000 });
    assert.equal(timed.length, 3);
    assert.deepEqual(timed[1], {});
    for (const [i, own] of [[0, ['instruments', 'ready']], [2, ['ready']]] as const) {
      assert.deepEqual(Object.keys(timed[i]), own);
      for (const t of Object.values(timed[i])) assert.equal(t.length, 3);
    }
    for (let n = 0; n < 3; n++) {
      // No sooner than the server's answer to what the page waits for, and not long after: Chrome running here.
      const { instruments, ready } = { instruments: timed[0].instruments[n], ready: timed[0].ready[n] };
      assert.ok(instruments >= 300 && instruments < 5000, `instruments at ${instruments}`);
      assert.ok(ready >= instruments, `ready at ${ready}, before instruments at ${instruments}`);
      assert.ok(timed[2].ready[n] >= 300, `again ready at ${timed[2].ready[n]}`);
    }
    // Each load asked for the page and what it fetched, nothing kept from the load before; a page with no marks never loaded.
    assert.equal(s.asked.filter((p) => p === '/').length, 3);
    assert.equal(s.asked.filter((p) => p === '/slow').length, 6);
    assert.ok(!s.asked.includes('/nothing'));
  } finally {
    await s.close();
  }
});

test('a page that never sets its mark is given up at the deadline, saying what it threw; and one not 200, and a selector that is not one, fail', async () => {
  const s = await workingPage(0);
  try {
    // The deadline is the probe's clock's, and the test's runs out once the page has asked for /thrown: a busy machine
    // slows the page, and not the deadline with it (crux#50). The page throws only after, so what it threw is heard
    // only as the probe asks the page for what it did before it gives up.
    let read = 0;
    const clock = () => s.asked.includes('/thrown') ? (read++, 20001) : 0;
    await assert.rejects(timeMarks(s.url, [{ name: 'bad', path: '/bad' }], [{ name: 'instruments' }], { loads: 1, deadline: 20000, clock }),
      /\/bad had no instruments in 20000 ms \(the page threw: Error: no instruments\)/);
    assert.ok(read > 0, 'the deadline was not counted on the clock given');
    await assert.rejects(timeMarks(s.url, [{ name: 'gone', path: '/gone' }], [{ name: 'ready', selector: 'body' }], { loads: 1, deadline: 20000 }),
      /\/gone answered 404 to Chrome/);
    await assert.rejects(timeMarks(s.url, [{ name: 'home', path: '/' }], [{ name: 'ready', selector: 'body[' }], { loads: 1, deadline: 20000 }),
      /the selector of ready: SyntaxError/);
  } finally {
    await s.close();
  }
});

test('--mark, --ideal and --main as a product\'s intuition gives them: its marks among what nerd reads, judged as it says', async () => {
  const s = await workingPage(100);
  const dir = mkdtempSync(join(tmpdir(), 'crux-probe-'));
  try {
    const args = ['--url', s.url, '--page', 'home=/', '--tries', '2', '--loads', '2', '--mark', 'instruments', '--ready', 'body[data-ready]',
      '--ideal', 'home_ready_ms=800', '--main', 'home_ready_ms', '--json'];
    const run = await cli(dir, args);
    assert.equal(run.code, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.main, 'home_ready_ms');
    assert.deepEqual(out.numbers.map((n: { name: string }) => n.name), ['home_bytes', 'home_requests', 'home_ms', 'home_weight', 'home_instruments_ms', 'home_ready_ms']);
    const [instruments, ready] = out.numbers.slice(4);
    assert.deepEqual([instruments.ideal, ready.ideal, ready.unit], [1000, 800, 'ms']);
    assert.ok(instruments.value >= 100 && ready.value >= instruments.value, `instruments ${instruments.value}, ready ${ready.value}`);
    for (const n of out.numbers) assert.deepEqual(Object.keys(n).sort(), ['baseline', 'better', 'ideal', 'name', 'noise', 'spread', 'unit', 'value']);

    // A number there is not, to judge or as main, fails before anything is measured.
    s.asked.length = 0;
    const wrong = await cli(dir, ['--url', s.url, '--page', 'home=/', '--main', 'home_ready_ms', '--json']);
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /there is no number home_ready_ms: there are home_bytes, home_requests, home_ms, home_weight/);
    assert.deepEqual(s.asked, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await s.close();
  }
});
