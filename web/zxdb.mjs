// The ZXDB's own index (built by tools/zxdb-index.mjs from the ZXDB's dump, and put beside the server in the image):
// how its text is written (indexText, which the tool calls), and how an entry of it is read, as the tests of the tool's
// index read it (zxdb.test.mjs, zxdb-dump.spec.mjs). The server reads and searches it, and answers the page from it
// where ZXInfo cannot, in Rust (crates/app/src/zxdb.rs), in the API's shape, with `"answeredBy": "zxdb-index"` and the
// dump's `source`.

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

const head = (index) => `"answeredBy":"zxdb-index","source":${JSON.stringify(index.source)}`;
const text = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p)));

/** One entry, as the API's /games/<id> answers it, as JSON in UTF-8; null where the index has none. */
export function entry(index, id) {
  const key = index.byId.get(String(Number(id)).padStart(7, '0'));
  return key ? text(`{${head(index)},"_id":"${key.id}","found":true,"_source":`, key.json, '}') : null;
}
