// The server's pass-through: what it lets through and what it refuses, against an origin of the test's own; what it
// says when that goes wrong, and at which severity; and nerd's two paths, /nerd/event and /nerd/feedback.
import { createServer, get } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeLimiter, makeNerdTelemetry, makePassThrough, passTarget } from '../server.mjs';

describe('which paths are passed through', () => {
  it('passes the archive’s game files and the ZXDB’s own', () => {
    expect(passTarget('/archive/pub/sinclair/games/s/Saboteur.tzx.zip')?.url).toBe('https://spectrumcomputing.co.uk/pub/sinclair/games/s/Saboteur.tzx.zip');
    expect(passTarget('/archive/zxdb/sinclair/entries/0004293/Saboteur(Encore).tzx.zip')?.url).toBe('https://spectrumcomputing.co.uk/zxdb/sinclair/entries/0004293/Saboteur(Encore).tzx.zip');
    expect(passTarget('/archive/zxdb/sinclair/pokes/s/Saboteur!%20(1985).pok')?.url).toBe('https://spectrumcomputing.co.uk/zxdb/sinclair/pokes/s/Saboteur!%20(1985).pok');
  });

  it('passes the ZXInfo searches and entries the page asks for, with their queries', () => {
    expect(passTarget('/zxinfo/v3/search', 'query=saboteur&mode=compact')?.url).toBe('https://api.zxinfo.dk/v3/search?query=saboteur&mode=compact');
    expect(passTarget('/zxinfo/v3/games/0004293', 'mode=compact')?.url).toBe('https://api.zxinfo.dk/v3/games/0004293?mode=compact');
  });

  it('refuses anything else, however it is spelled', () => {
    for (const path of [
      '/archive/pub/other/file.zip',
      '/archive/pub/sinclair/',
      '/archive/pub/sinclair/../../etc/passwd',
      '/archive/pub/sinclair/%2e%2e/%2e%2e/etc/passwd',
      '/archive/pub/sinclair/games/./x.zip',
      '/archive/pub/sinclair/games//x.zip',
      '/archive/pub/sinclair/games/a%5cb.zip',
      '/archive/pub/sinclair/games/a%00b.zip',
      '/archive/pub/sinclair/games/%zz.zip',
      '/archive//evil.example/pub/sinclair/x',
      // The archive's books and magazines, and anything that is not a Spectrum file, text or a picture: not the page's.
      '/archive/pub/sinclair/books-pics/m/Manual.pdf',
      '/archive/pub/sinclair/magazines/Crash/Issue01.zip',
      '/archive/pub/sinclair/games/s/Saboteur.exe',
      '/archive/pub/sinclair/games/s/',
      '/zxinfo/v3/admin',
      '/zxinfo/v3/games/../search',
      '/zxinfo/v2/search',
    ]) {
      expect(passTarget(path), path).toBeNull();
    }
  });
});

describe('passing through', () => {
  let origin;
  let front;
  let base;
  const big = Buffer.alloc(5000, 7);
  beforeAll(async () => {
    origin = createServer((req, res) => {
      if (req.url === '/pub/sinclair/ok.tap') return res.end('TAPE');
      if (req.url === '/pub/sinclair/big.tap') return res.end(big);
      if (req.url === '/pub/sinclair/missing.tap') return res.writeHead(404).end('no');
      if (req.url === '/pub/sinclair/moved.tap') return res.writeHead(301, { Location: '/pub/sinclair/ok.tap' }).end();
      if (req.url === '/pub/sinclair/away.tap') return res.writeHead(302, { Location: 'https://evil.example/x' }).end();
      // An origin that compresses (as nginx may for whatever it is set to): its Content-Length is of the compressed body.
      if (req.url === '/pub/sinclair/gzipped.json') {
        const body = gzipSync(Buffer.from(JSON.stringify({ hits: Array.from({ length: 100 }, (_, i) => ({ id: i, title: "Saboteur" })) })));
        return res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length }).end(body);
      }
      if (req.url === '/pub/sinclair/error.html') return res.writeHead(404, { 'Content-Type': 'text/html' }).end('<script>alert(1)</script>');
      // Far more than a socket holds, for a client that stops reading.
      if (req.url === '/pub/sinclair/huge.tap') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        const chunk = Buffer.alloc(64 * 1024, 1);
        const more = () => {
          while (!res.destroyed && res.write(chunk));
          if (!res.destroyed) res.once('drain', more);
        };
        res.on('close', () => (origin.huge = 'closed'));
        return more();
      }
      if (req.url === '/pub/sinclair/chunked.tap') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.write(big.subarray(0, 2500));
        return res.end(big.subarray(2500));
      }
      res.writeHead(500).end();
    });
    await new Promise((r) => origin.listen(0, '127.0.0.1', r));
    const host = `127.0.0.1:${origin.address().port}`;
    const pass = makePassThrough([
      { prefix: '/archive', origin: `http://${host}`, hosts: [host], allow: /^\/pub\/sinclair\/(?!huge)[^?#]+$/, maxBytes: 4000, timeoutMs: 5000, query: false, cache: 'public, max-age=60' },
      // A route of its own for the stalled client: a large cap, and a short time for the whole exchange.
      { prefix: '/slow', origin: `http://${host}`, hosts: [host], allow: /^\/pub\/sinclair\/huge\.tap$/, maxBytes: 1 << 30, timeoutMs: 300, query: false, cache: 'no-store' },
    ]);
    front = createServer(async (req, res) => {
      if (!(await pass(req, res))) res.writeHead(418).end();
    });
    await new Promise((r) => front.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${front.address().port}`;
  });
  afterAll(() => {
    origin.close();
    front.close();
  });

  it('hands the file over as it is, with a cache header', async () => {
    const res = await fetch(`${base}/archive/pub/sinclair/ok.tap`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('TAPE');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('follows a redirect on the same host, and no other', async () => {
    expect(await (await fetch(`${base}/archive/pub/sinclair/moved.tap`)).text()).toBe('TAPE');
    expect((await fetch(`${base}/archive/pub/sinclair/away.tap`)).status).toBe(502);
  });

  it('passes on a missing file as missing', async () => {
    expect((await fetch(`${base}/archive/pub/sinclair/missing.tap`)).status).toBe(404);
  });

  it('refuses a file over its size, whether it says so or not', async () => {
    expect((await fetch(`${base}/archive/pub/sinclair/big.tap`)).status).toBe(502);
    const chunked = await fetch(`${base}/archive/pub/sinclair/chunked.tap`).then((r) => r.arrayBuffer()).catch((e) => e);
    expect(chunked instanceof Error || chunked.byteLength < big.length).toBe(true);
  });

  it('hands over a body the origin compressed whole, with no length that is not its own', async () => {
    const res = await fetch(`${base}/archive/pub/sinclair/gzipped.json`);
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).hits).toHaveLength(100);
  });

  it('lets nothing it passes through run as the page: no script, no frame, no sniffing', async () => {
    const res = await fetch(`${base}/archive/pub/sinclair/error.html`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('lets go of a client that stops reading once the time is up, the archive’s connection with it, leaving no listener behind', async () => {
    const warnings = [];
    const warn = (w) => warnings.push(w.name);
    process.on('warning', warn);
    // Read the first bytes, then read no more: the server's writes back up, and it must not wait for ever. Its time up,
    // it tears the exchange down, the archive's connection with it (which the origin sees close).
    let client;
    await new Promise((resolve) => {
      client = get(`${base}/slow/pub/sinclair/huge.tap`, (res) => {
        res.once('data', () => {
          res.pause();
          resolve();
        });
      });
      client.on('error', () => {});
    });
    for (let i = 0; i < 250 && origin.huge !== 'closed'; i++) await new Promise((r) => setTimeout(r, 20));
    client.destroy();
    process.off('warning', warn);
    expect(origin.huge).toBe('closed');
    expect(warnings).not.toContain('MaxListenersExceededWarning');
  });

  it('marks what it passes through as the page’s own: no other site may take it', async () => {
    expect((await fetch(`${base}/archive/pub/sinclair/ok.tap`)).headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });

  it('refuses a path it does not pass, and leaves other paths to the page', async () => {
    expect((await fetch(`${base}/archive/pub/other/x`)).status).toBe(403);
    expect((await fetch(`${base}/index.html`)).status).toBe(418);
  });
});

describe('what goes wrong in passing through, said once at its severity', () => {
  let origin;
  let front;
  let base;
  let said;
  beforeAll(async () => {
    origin = createServer((req, res) => {
      if (req.url === '/pub/sinclair/away.tap') return res.writeHead(302, { Location: 'https://evil.example/x' }).end();
      if (req.url === '/pub/sinclair/big.tap') return res.writeHead(200, { 'Content-Length': 5000 }).end(Buffer.alloc(5000));
      res.writeHead(404).end();
    });
    await new Promise((r) => origin.listen(0, '127.0.0.1', r));
    const host = `127.0.0.1:${origin.address().port}`;
    // A port nothing listens on: an origin that cannot be reached.
    const closed = createServer();
    await new Promise((r) => closed.listen(0, '127.0.0.1', r));
    const dead = `127.0.0.1:${closed.address().port}`;
    await new Promise((r) => closed.close(r));
    const pass = makePassThrough(
      [
        { prefix: '/archive', origin: `http://${host}`, hosts: [host], allow: /^\/pub\/sinclair\/[^?#]+$/, maxBytes: 4000, timeoutMs: 5000, query: false, cache: 'no-store' },
        { prefix: '/dead', origin: `http://${dead}`, hosts: [dead], allow: /^\/pub\/sinclair\/[^?#]+$/, maxBytes: 4000, timeoutMs: 5000, query: false, cache: 'no-store' },
      ],
      null,
    );
    front = createServer(async (req, res) => {
      if (!(await pass(req, res))) res.writeHead(418).end();
    });
    await new Promise((r) => front.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${front.address().port}`;
  });
  afterAll(() => {
    origin.close();
    front.close();
  });
  const listen = () => {
    said = { errors: [], lines: [] };
    vi.spyOn(console, 'error').mockImplementation((...a) => said.errors.push(a));
    vi.spyOn(console, 'log').mockImplementation((l) => said.lines.push(JSON.parse(l)));
  };
  afterEach(() => vi.restoreAllMocks());

  it('an origin that cannot be reached is the server’s error: once, with its stack', async () => {
    listen();
    expect((await fetch(`${base}/dead/pub/sinclair/x.tap`)).status).toBe(502);
    expect(said.errors).toHaveLength(1);
    expect(said.errors[0][0]).toBeInstanceOf(Error);
    expect(said.errors[0][0].stack).toMatch(/\n\s+at /);
    expect(said.lines).toEqual([]);
  });

  it('a redirect elsewhere and a file too large are the archive’s, not the server’s: a warning each, no error', async () => {
    listen();
    expect((await fetch(`${base}/archive/pub/sinclair/away.tap`)).status).toBe(502);
    expect((await fetch(`${base}/archive/pub/sinclair/big.tap`)).status).toBe(502);
    expect(said.errors).toEqual([]);
    expect(said.lines.map((l) => l.severity)).toEqual(['WARNING', 'WARNING']);
  });

  it('a missing file is said by its status alone', async () => {
    listen();
    expect((await fetch(`${base}/archive/pub/sinclair/missing.tap`)).status).toBe(404);
    expect(said.errors).toEqual([]);
    expect(said.lines).toEqual([]);
  });
});

describe('nerd’s paths', () => {
  let front;
  let base;
  let printed;
  let allowed;
  beforeAll(async () => {
    const nerd = makeNerdTelemetry({ print: (line) => printed.push(line), limit: () => allowed });
    front = createServer(async (req, res) => {
      if (!(await nerd(req, res))) res.writeHead(418).end();
    });
    await new Promise((r) => front.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${front.address().port}`;
  });
  afterAll(() => front.close());
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const reset = () => {
    printed = [];
    allowed = true;
  };

  it('prints an event as one line of its own fields, and nothing else of the body', async () => {
    reset();
    const res = await post('/nerd/event', { nerd: 'event', name: 'game.loaded', kind: 'shelf', ms: 830, severity: 'ERROR', title: 'Saboteur', message: 'x' });
    expect(res.status).toBe(204);
    expect(printed).toEqual(['{"nerd":"event","name":"game.loaded","kind":"shelf","ms":830}']);
  });

  it('prints feedback as one line of its own fields: the words, the page, the events and the errors', async () => {
    reset();
    const body = { words: 'The tape loads too slowly.', page: '/', events: ['game.loaded', 'game.started'], errors: ['TypeError: x'], severity: 'ERROR', nerd: 'event', httpRequest: {} };
    expect((await post('/nerd/feedback', body)).status).toBe(204);
    expect(JSON.parse(printed[0])).toEqual({ nerd: 'feedback', words: 'The tape loads too slowly.', page: '/', events: ['game.loaded', 'game.started'], errors: ['TypeError: x'] });
    expect(printed).toHaveLength(1);
  });

  it('refuses what is not a POST of a JSON object up to 64 KB, or past the client’s share, and prints nothing for it', async () => {
    reset();
    expect((await fetch(`${base}/nerd/event`)).status).toBe(405);
    expect((await post('/nerd/event', 'not json')).status).toBe(400);
    expect((await post('/nerd/event', '[1,2]')).status).toBe(400);
    expect((await post('/nerd/event', 'null')).status).toBe(400);
    const large = await post('/nerd/feedback', { words: 'a'.repeat(70 * 1024) }).catch((e) => e);
    expect(large instanceof Error || large.status === 413).toBe(true);
    allowed = false;
    expect((await post('/nerd/event', { name: 'game.loaded' })).status).toBe(429);
    expect(printed).toEqual([]);
  });

  it('leaves every other path to the page, its spellings with them', async () => {
    reset();
    for (const path of ['/nerd', '/nerd/', '/nerd/events', '/nerd/event/x', '/NERD/event', '/x/nerd/event']) expect((await post(path, { name: 'x' })).status, path).toBe(418);
    expect((await post('/nerd/event?x=1', { name: 'game.loaded' })).status).toBe(204);
  });
});

describe('a client asking too often', () => {
  it('is refused past its burst, and let back in as the minute goes on', () => {
    let t = 0;
    const allow = makeLimiter({ perMinute: 60, burst: 10, now: () => t });
    const req = (ip) => ({ headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` }, socket: { remoteAddress: '10.0.0.1' } });
    const granted = Array.from({ length: 15 }, () => allow(req('1.2.3.4'))).filter(Boolean).length;
    expect(granted).toBe(10);
    // Another client is its own.
    expect(allow(req('5.6.7.8'))).toBe(true);
    // A second later, one more; five seconds later, five.
    t += 1000;
    expect(allow(req('1.2.3.4'))).toBe(true);
    expect(allow(req('1.2.3.4'))).toBe(false);
    t += 5000;
    expect(Array.from({ length: 8 }, () => allow(req('1.2.3.4'))).filter(Boolean).length).toBe(5);
  });
});
