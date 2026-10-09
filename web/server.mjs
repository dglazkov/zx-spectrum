// The deployed server: hands out the built page (dist/), and passes two things through for it.
//
//   /archive/<path>    https://spectrumcomputing.co.uk/<path>, for the files the page uses only: Spectrum files,
//                      their manuals and their pictures, in the archive's directories of software (games, demos,
//                      utilities...) and the ZXDB's entries; not its books or magazines. The archive's files come
//                      without cross-origin headers, so the page cannot fetch them itself. Up to 16 MB, a minute for
//                      the whole of it; nothing is kept on disk.
//   /zxinfo/v3/<path>  https://api.zxinfo.dk/v3/<path>, for /search, /games/<id> and /suggest/<term> only: the API's
//                      answers carry Access-Control-Allow-Origin twice, which browsers refuse (docs/web.md), and it
//                      asks its clients to say who they are, which a browser cannot.
//
//   node server.mjs [dir]      PORT says which port (8080 if unset)
//
// The dev server (vite.config.ts) passes the same two through with the same code: `passThrough` below.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const AGENT = 'zx-spectrum (https://zx-spectrum.lab.glazkov.ai)';

/** What may be passed through, where to, and how much of it. */
export const ROUTES = [
  {
    prefix: '/archive',
    origin: 'https://spectrumcomputing.co.uk',
    hosts: ['spectrumcomputing.co.uk', 'www.spectrumcomputing.co.uk'],
    // The software's directories and the ZXDB's entries (and its pokes); Spectrum files, text and pictures.
    allow: /^\/(pub\/sinclair\/(games|games-info|games-inlays|games-maps|screens|demos|utils|tools|educational|compilations|slt)|zxdb\/sinclair\/(entries|pokes))\/[^?#]+\.(zip|tap|tzx|csw|pzx|z80|sna|szx|slt|scr|txt|pok|jpe?g|gif|png)$/i,
    maxBytes: 16 * 1024 * 1024,
    timeoutMs: 60_000,
    query: false,
    cache: 'public, max-age=86400',
  },
  {
    prefix: '/zxinfo/v3',
    origin: 'https://api.zxinfo.dk/v3',
    hosts: ['api.zxinfo.dk', 'internal.zxinfo.dk'],
    allow: /^\/(search|games\/[0-9]{1,7}|suggest\/[^/]{1,80})$/,
    maxBytes: 4 * 1024 * 1024,
    timeoutMs: 15_000,
    query: true,
    cache: 'public, max-age=600',
  },
];

/**
 * Where a request's path (as it came, percent-encoded) is passed through to, or null if it is not one to pass
 * through. A path with a '.' or '..' segment, a backslash or a control character is refused; each segment is
 * re-encoded, so that what reaches the archive is exactly the path that was checked.
 */
export function passTarget(rawPath, rawQuery = '', routes = ROUTES) {
  for (const route of routes) {
    if (!rawPath.startsWith(`${route.prefix}/`)) continue;
    let path;
    try {
      path = decodeURIComponent(rawPath.slice(route.prefix.length));
    } catch {
      return null;
    }
    if (/[\u0000-\u001f\u007f\\]/.test(path)) return null;
    const segments = path.split('/');
    if (segments.some((s, i) => (i > 0 && s === '') || s === '.' || s === '..')) return null;
    if (!route.allow.test(path)) return null;
    const url = `${route.origin}${segments.map(encodeURIComponent).join('/')}${route.query && rawQuery ? `?${rawQuery}` : ''}`;
    return { route, url };
  }
  return null;
}

/**
 * A handler that passes a request through if it is one to pass (see passTarget), answering it, and says whether it
 * was. Redirects are followed only to the route's own hosts, three at most; the body is streamed, and cut off past the
 * route's size. (Tests make one with routes to a server of their own.)
 */
export function makePassThrough(routes = ROUTES, limit = makeLimiter()) {
  return (req, res) => pass(req, res, routes, limit);
}

/** The pass-through, to the archive and the ZXInfo API. */
export const passThrough = makePassThrough();

/**
 * Requests passed through, a client at a time: so many a minute, as a token bucket refilled steadily. The page asks
 * for a few a game (its tape, its manual, its inlay, a search or two); a client asking for hundreds a minute is not
 * the page. The client is the first address of X-Forwarded-For (the platform's load balancer puts it there), or the
 * socket's.
 */
export function makeLimiter({ perMinute = 120, burst = 60, now = () => Date.now() } = {}) {
  const buckets = new Map();
  let swept = now();
  return (req) => {
    const t = now();
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || '?';
    const b = buckets.get(ip) ?? { tokens: burst, at: t };
    b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 60_000) * perMinute);
    b.at = t;
    buckets.set(ip, b);
    // Clients not heard from in ten minutes are forgotten.
    if (t - swept > 600_000) {
      swept = t;
      for (const [k, v] of buckets) if (t - v.at > 600_000) buckets.delete(k);
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

async function pass(req, res, routes, limit) {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  const target = passTarget(q < 0 ? raw : raw.slice(0, q), q < 0 ? '' : raw.slice(q + 1), routes);
  if (!target) {
    if (routes.some((r) => raw.startsWith(`${r.prefix.split('/').slice(0, 2).join('/')}/`))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not a path this server passes through\n');
      return true;
    }
    return false;
  }
  const { route } = target;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method not allowed\n');
    return true;
  }
  if (limit && !limit(req)) {
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' });
    res.end('Too many requests: try again in a little while\n');
    return true;
  }
  // The whole exchange, the body's streaming to the client included, within the route's time: a client that stops
  // reading is let go of then, and the archive's connection with it.
  const signal = AbortSignal.timeout(route.timeoutMs);
  try {
    let url = target.url;
    let upstream;
    for (let hops = 0; ; hops++) {
      upstream = await fetch(url, { method: req.method, redirect: 'manual', signal, headers: { 'User-Agent': AGENT, Accept: route.query ? 'application/json' : '*/*' } });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const next = upstream.headers.get('location');
      const to = next ? new URL(next, url) : null;
      if (!to || to.protocol !== new URL(route.origin).protocol || !route.hosts.includes(to.host) || hops >= 3) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('The archive redirected somewhere this server does not go\n');
        return true;
      }
      url = to.href;
    }
    // fetch hands over the body decoded, so a length the origin gave for a compressed body is not this body's: the
    // body then goes without one (chunked), checked against the cap as it streams.
    const encoded = !/^(identity)?$/i.test(upstream.headers.get('content-encoding') ?? '');
    const length = encoded ? 0 : Number(upstream.headers.get('content-length') ?? 0);
    if (length > route.maxBytes) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Too large to pass through\n');
      upstream.body?.cancel();
      return true;
    }
    const headers = {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': upstream.ok ? route.cache : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // What comes through is data for the page, never a page: an HTML answer (an error page) opened on this origin
      // runs nothing and reaches nothing.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // For this page's own use: another site's page may not take it.
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (length) headers['Content-Length'] = length;
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return true;
    }
    // Streamed, as the client takes it (back-pressure), cut off past the route's size; on the time running out, the
    // client going, or the cap, every part of it is torn down.
    let sent = 0;
    const cap = new Transform({
      transform(chunk, _encoding, done) {
        sent += chunk.length;
        done(sent > route.maxBytes ? new Error('too large to pass through') : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(upstream.body), cap, res, { signal });
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(e?.name === 'TimeoutError' || signal.aborted ? 504 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`The archive could not be reached: ${e?.message ?? e}\n`);
    } else res.destroy();
  }
  return true;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.rom': 'application/octet-stream',
};

/** The built page, read and compressed once, at start, and served from memory: no path from a URL reaches the disk. */
function readSite(root) {
  const files = new Map();
  const read = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        read(path, `${prefix}${name}/`);
        continue;
      }
      const body = readFileSync(path);
      const type = TYPES[extname(name)] ?? 'application/octet-stream';
      const entry = { body, type };
      if (body.length > 1024 && !/^(image\/png|font\/woff2)/.test(type)) {
        entry.br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
        entry.gzip = gzipSync(body, { level: 9 });
      }
      files.set(`${prefix}${name}`, entry);
    }
  };
  read(root, '/');
  if (!files.has('/index.html')) throw new Error(`no index.html in ${root}: build the page first (npm run build)`);
  return files;
}

export function startServer(root, port) {
  const files = readSite(root);
  const server = createServer(async (req, res) => {
    if (await passThrough(req, res)) return;
    const headers = { 'X-Content-Type-Options': 'nosniff' };
    const reply = (status, text) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : text);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, 'Method not allowed\n');
    let path;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return reply(400, 'Bad request\n');
    }
    const file = files.get(path.endsWith('/') ? `${path}index.html` : path);
    if (!file) return reply(404, 'Not found\n');
    // Built files carry a hash of their content in their name and never change; the rest are checked every time.
    headers['Cache-Control'] = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : path.startsWith('/fonts/') ? 'public, max-age=604800' : 'no-cache';
    headers['Content-Type'] = file.type;
    let body = file.body;
    if (file.br) {
      headers.Vary = 'Accept-Encoding';
      const accepts = String(req.headers['accept-encoding'] ?? '');
      if (/\bbr\b/.test(accepts)) {
        body = file.br;
        headers['Content-Encoding'] = 'br';
      } else if (/\bgzip\b/.test(accepts)) {
        body = file.gzip;
        headers['Content-Encoding'] = 'gzip';
      }
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  server.listen(port, () => {
    let bytes = 0;
    for (const f of files.values()) bytes += f.body.length;
    console.log(`ZX Spectrum: ${files.size} files (${(bytes / 1024).toFixed(0)} KB) from ${root} on port ${server.address().port}`);
  });
  // The platform stops the container with SIGTERM: finish what is in flight, then go.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    });
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer(process.argv[2] ?? fileURLToPath(new URL('./dist', import.meta.url)), Number(process.env.PORT) || 8080);
}
