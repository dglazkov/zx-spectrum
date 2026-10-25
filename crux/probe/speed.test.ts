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
import { framed, median, pagesFrom, probe, quartiles, report, steadied, subresources, valueBytes, weigh, withoutNoise } from './speed.ts';
import type { Clock, Measured, Page } from './speed.ts';

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
    assert.deepEqual({ ...n.home_weight }, { name: 'home_weight', unit: 'B', value: 1001, spread: [1001, 1001], better: 'lower', worst: 1001, noise: 0 });
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

test('a body over HTTP/2 is counted as though it came in frames of 16384 B, and only there, and only when its length is known', () => {
  // blog's image.738.webp on Cloud Run, Oct 24: 119 B of headers, 23706 B of body, in 7 frames one visit and 6 the next.
  assert.equal(framed(119 + 23706 + 7 * 9, 119, 23706, 'h2'), 119 + 23706 + 2 * 9);
  assert.equal(framed(119 + 23706 + 6 * 9, 119, 23706, 'h2'), 119 + 23706 + 2 * 9);
  // A frame holds 16384 B at most: one more takes another frame, and no body takes none.
  assert.equal(framed(100 + 16384 + 9 * 3, 100, 16384, 'h2'), 100 + 16384 + 9);
  assert.equal(framed(100 + 16385 + 9 * 3, 100, 16385, 'h2'), 100 + 16385 + 18);
  assert.equal(framed(100 + 9, 100, 0, 'h2'), 100);
  // Over HTTP/1 and HTTP/3, with no length, or with a length longer than what came (an answer cut off), it is as counted.
  for (const [body, protocol] of [[23706, 'http/1.1'], [23706, 'h3'], [undefined, 'h2'], [30000, 'h2']] as const) {
    assert.equal(framed(119 + 23706 + 7 * 9, 119, body, protocol), 119 + 23706 + 7 * 9, `${body} ${protocol}`);
  }
});

/**
 * A stand-in for Cloud Run's front end, over HTTP/2 as Chrome reads it, with a certificate made for the test: each
 * answer has an x-cloud-trace-context of its own, of a length of its own, now and then with ';o=1' after it, and a
 * date that changes from one answer to the next, as Google's front end sends them; and each body is sent in frames
 * of lengths of its own, as many as the answer's number says, as Cloud Run's front end split blog's pictures into 5
 * to 13 frames from one visit to the next (crux#29). The page, compressed as it is sent, says no content-length.
 */
async function frontEnd(): Promise<{ url: string; answers: string[]; dates: string[]; close(): Promise<void> }> {
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
  const page = zlib.brotliCompressSync(`<!doctype html>${icon}<p>the same page</p><img src="/a.png" width="10" height="10"><link rel="stylesheet" href="/a.css"><p>${words}</p>`);
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
    const head = { 'x-cloud-trace-context': trace, date, server: 'Google Frontend' };
    // The picture one Chrome reads whole, as Cloud Run's are: one it cannot read, as 2000 spaces, Chrome counts
    // its body alone of, over HTTP/2 (crux#28). The stylesheet is the same bytes, so that only its type tells them apart.
    if (path.startsWith('/a.png') || path.startsWith('/a.css')) {
      res.writeHead(200, { ...head, 'content-type': path.startsWith('/a.png') ? 'image/png' : 'text/css', 'content-length': String(picture.length) });
      void inFrames(res, picture, n);
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('a page weighs the same from one visit to the next over HTTP/2, though its front end\'s trace and time change their length, and its frames their number', async () => {
  const s = await frontEnd();
  try {
    // The same page, a name of the same length each time, so that only the trace and the time tell its answers apart.
    // The first warms Chrome: its first handshake can be slow enough that Chrome opens a second connection beside it,
    // whose own first frames it counts to whatever it asks there (30 B, now and then), which is no header's.
    const pages = ['wrm', 'one', 'two', 'six', 'ten'].map((name) => ({ name, path: `/?${name}` }));
    const weighed = (await weigh(s.url, pages, { quiet: 300, flags: ['--ignore-certificate-errors'] })).slice(1);
    // Three answers a visit, the page, its picture and its stylesheet, each of a trace of its own, of lengths that are
    // not all the same.
    assert.equal(s.answers.length, 15);
    assert.ok(new Set(s.answers.map((a) => valueBytes(a, 'h2'))).size > 3, s.answers.join(' '));
    assert.equal(new Set(s.dates.map((d) => valueBytes(d, 'h2'))).size, 2, s.dates.join(', '));
    assert.ok(weighed.every((w) => w.fetched.length === 3 && w.fetched.every((f) => f.bytes > 0)));
    assert.deepEqual(weighed.map((w) => w.bytes), weighed.map(() => weighed[0].bytes), weighed.map((w) => w.fetched.map((f) => f.bytes).join('+')).join(', '));
    // The picture is weighed as the stylesheet is, its headers and its frames with its body (crux#28): they differ by
    // their types alone.
    const kind = (w: (typeof weighed)[number], type: string) => w.fetched.find((f) => f.type === type)!.bytes;
    for (const w of weighed) assert.equal(kind(w, 'Image') - kind(w, 'Stylesheet'), valueBytes('image/png', 'h2') - valueBytes('text/css', 'h2'));
  } finally {
    await s.close();
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
