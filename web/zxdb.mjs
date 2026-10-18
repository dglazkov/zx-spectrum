// The ZXDB's own index (built by tools/zxdb-index.mjs from the ZXDB's dump, and put beside the server in the image),
// answering as the ZXInfo API answers the page, for the paths the page asks (web/src/library/zxinfo.ts):
//
//   /search?query=…&size=…&offset=…&availability=Available   by title (and other titles) and publisher, the closest first
//   /games/<id>                                              one entry, by its ZXDB id
//
// The server answers from it where the API cannot (server.mjs): ZXInfo stays the first choice. Its answers carry
// `"answeredBy": "zxdb-index"` and the dump's `source`.

import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Lower case, no accents, words of letters and digits only: "Saboteur II: Avenging Angel" is "saboteur ii avenging angel". */
export function normalise(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The index's text (tools/zxdb-index.mjs writes it, gzipped): a line of JSON saying where it came from, then a line an
 * entry, its key and its answer apart by a tab: the key `[id, availability, releases with files, titles as words,
 * publisher as words]`, and the API's `_source` for it, kept as the UTF-8 it is and sent as it is. (Parsed into
 * objects, or held as a string, the index took 70 MB of the server's heap or more; as bytes, the bytes and the keys.)
 */
export function makeIndex(text) {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text);
  let at = bytes.indexOf(10);
  const { source = null } = JSON.parse(bytes.toString('utf8', 0, at));
  const byId = new Map();
  const keys = [];
  while (at >= 0 && at + 1 < bytes.length) {
    const start = at + 1;
    at = bytes.indexOf(10, start);
    const end = at < 0 ? bytes.length : at;
    if (end === start) continue;
    const tab = bytes.indexOf(9, start);
    const [id, availability, releases, titles, publisher] = JSON.parse(bytes.toString('utf8', start, tab));
    const key = { id, availability, releases, titles, words: [...new Set(titles.join(' ').split(' '))], publisher, json: bytes.subarray(tab + 1, end) };
    byId.set(id, key);
    keys.push(key);
  }
  return { source, byId, keys, size: keys.length };
}

/** An index's text, from its entries (each the API's `_source` with its `_id`, and `aliases`, the other titles). */
export function indexText({ source = null, entries }) {
  const lines = [JSON.stringify({ source, entries: entries.length })];
  for (const e of entries) {
    const { _id, aliases, ...answer } = e;
    const titles = [e.title, ...(aliases ?? [])].map(normalise).filter(Boolean);
    const releases = (e.releases ?? []).filter((r) => r.files?.length).length;
    const publisher = normalise(e.publishers?.[0]?.name).split(' ').filter(Boolean);
    lines.push(`${JSON.stringify([_id, e.availability, releases, titles.length ? titles : [''], publisher])}\t${JSON.stringify(answer)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Reads an index (.gz) from `path`, or null where there is none. */
export function readIndex(path) {
  if (!existsSync(path)) return null;
  return makeIndex(gunzipSync(readFileSync(path)));
}

const prefixOf = (words, w) => words.some((x) => x.startsWith(w));

/**
 * How close an entry is to the query's words, smaller the closer, or -1 for no match: its title the query (0), its
 * title beginning with it (1), every word the start of a word of a title (2), or of the publisher's name (3).
 */
function closeness(key, query, words) {
  if (key.titles.includes(query)) return 0;
  if (key.titles.some((t) => t.startsWith(query))) return 1;
  if (words.every((w) => prefixOf(key.words, w))) return 2;
  if (words.every((w) => prefixOf(key.words, w) || prefixOf(key.publisher, w))) return 3;
  return -1;
}

const head = (index) => `"answeredBy":"zxdb-index","source":${JSON.stringify(index.source)}`;
const text = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p)));

/** A search, as the API's /search answers it (hits.total.value, and hits.hits of {_id, _source}), as JSON in UTF-8. */
export function search(index, params) {
  const query = normalise(params.get('query'));
  const words = query.split(' ').filter(Boolean);
  const size = Math.min(Math.max(Number(params.get('size') ?? 25) || 0, 0), 100);
  const offset = Math.max(Number(params.get('offset') ?? 0) || 0, 0);
  const available = params.get('availability');
  const found = [];
  if (words.length) {
    for (const key of index.keys) {
      if (available && key.availability !== available) continue;
      const c = closeness(key, query, words);
      if (c >= 0) found.push({ c, key });
    }
  }
  // The closest first; then the one released most often (the game people knew, before a fan's remake), then the
  // shorter title (the game before its sequels and editions), then the older entry.
  found.sort((a, b) => a.c - b.c || b.key.releases - a.key.releases || a.key.titles[0].length - b.key.titles[0].length || (a.key.id < b.key.id ? -1 : 1));
  const hits = found.slice(offset, offset + size).flatMap(({ key }, i) => [`${i ? ',' : ''}{"_id":"${key.id}","_source":`, key.json, '}']);
  return text(`{${head(index)},"hits":{"total":{"value":${found.length},"relation":"eq"},"hits":[`, ...hits, ']}}');
}

/** One entry, as the API's /games/<id> answers it, as JSON in UTF-8; null where the index has none. */
export function entry(index, id) {
  const key = index.byId.get(String(Number(id)).padStart(7, '0'));
  return key ? text(`{${head(index)},"_id":"${key.id}","found":true,"_source":`, key.json, '}') : null;
}

/**
 * What the index answers for an API path (as the server passes it: "/search", "/games/0004293") and its query string:
 * {status, json}, or null for a path it does not answer (the API's /suggest) or where there is no index. The index is
 * read the first time it is asked for, from `path`.
 */
export function makeZxdb(path) {
  let index;
  const load = () => (index === undefined ? (index = typeof path === 'string' ? readIndex(path) : path) : index);
  return {
    answer(apiPath, rawQuery = '') {
      if (!load()) return null;
      if (apiPath === '/search') return { status: 200, json: search(index, new URLSearchParams(rawQuery)) };
      const game = /^\/games\/([0-9]{1,7})$/.exec(apiPath);
      if (game) {
        const e = entry(index, game[1]);
        return e ? { status: 200, json: e } : { status: 404, json: text(`{${head(index)},"found":false}`) };
      }
      return null;
    },
    /** Whether there is an index to answer from (reading it, the first time). */
    has: () => Boolean(load()),
  };
}
