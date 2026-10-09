// The deployed server: hands out the built page (dist/), and passes two things through for it.
//
//   /archive/<path>    https://spectrumcomputing.co.uk/<path>, for paths under /pub/sinclair/ and /zxdb/sinclair/
//                      only: the archive's files come without cross-origin headers, so the page cannot fetch them
//                      itself. Up to 16 MB, 20 s; nothing is kept on disk.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const AGENT = 'zx-spectrum (https://zx-spectrum.lab.glazkov.ai; dimitri@glazkov.com)';

/** What may be passed through, where to, and how much of it. */
export const ROUTES = [
  {
    prefix: '/archive',
    origin: 'https://spectrumcomputing.co.uk',
    hosts: ['spectrumcomputing.co.uk', 'www.spectrumcomputing.co.uk'],
    allow: /^\/(pub|zxdb)\/sinclair\/[^?#]+$/,
    maxBytes: 16 * 1024 * 1024,
    timeoutMs: 20_000,
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
export function makePassThrough(routes = ROUTES) {
  return (req, res) => pass(req, res, routes);
}

/** The pass-through, to the archive and the ZXInfo API. */
export const passThrough = makePassThrough();

async function pass(req, res, routes) {
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
    };
    if (length) headers['Content-Length'] = length;
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return true;
    }
    let sent = 0;
    for await (const chunk of upstream.body) {
      sent += chunk.length;
      if (sent > route.maxBytes) {
        res.destroy();
        return true;
      }
      // Wait for the client to take it, or to go (a closed socket never drains, and the upstream would be held).
      if (!res.write(chunk)) await new Promise((resolve) => (res.once('drain', resolve), res.once('close', resolve)));
      if (res.destroyed) {
        await upstream.body.cancel().catch(() => {});
        return true;
      }
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(e?.name === 'TimeoutError' ? 504 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
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
