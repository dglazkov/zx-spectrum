// The ZXDB's own index, for the server to answer from where the ZXInfo API cannot (crates/app/src/zxdb.rs): built from the
// ZXDB's MySQL dump (https://github.com/zxdb/ZXDB, ZXDB_mysql.sql.zip), the Spectrum's software alone, each entry in
// the shape of the API's compact `_source` as far as the page reads it (web/src/library/zxinfo.ts): its title (and
// other titles, for the search), year, machine, availability, genre, publisher, the files of each release, and its
// inlay, instructions and screens. Written gzipped, as zxdb.mjs writes it (indexText).
//
//   node tools/zxdb-index.mjs DUMP OUT [--source TEXT]
//       DUMP is ZXDB_mysql.sql.zip or ZXDB_mysql.sql; OUT the index (.gz); --source says where the dump came from
//   node tools/zxdb-index.mjs --fetch OUT
//       fetches the dump the Dockerfile pins (ZXDB_COMMIT, ZXDB_SHA256 below), checks it, and builds OUT from it
//
// Prints what it made as one line of JSON: entries, files, bytes, seconds.

import { createReadStream, openSync, readSync, closeSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createInflateRaw, gzipSync, constants } from 'node:zlib';
import { indexText } from '../zxdb.mjs';

/** The dump the image is built from: the ZXDB repository's commit, and the SHA-256 of its ZXDB_mysql.sql.zip. */
export const ZXDB_COMMIT = '0a634a1165bd3690ea24e3c6b67bbbbb1b1ebd09';
export const ZXDB_SHA256 = '6940a90091eb2f78700c4674a79c442bb480058cf09a757e85b860ff93068ee6';
export const ZXDB_DATE = '2026-10-03';
export const ZXDB_URL = `https://github.com/zxdb/ZXDB/raw/${ZXDB_COMMIT}/ZXDB_mysql.sql.zip`;

/** The tables read, and their columns kept. */
const TABLES = {
  entries: ['id', 'title', 'machinetype_id', 'genretype_id', 'availabletype_id'],
  aliases: ['entry_id', 'title'],
  releases: ['entry_id', 'release_seq', 'release_year'],
  contents: ['container_id', 'entry_id', 'is_original'],
  publishers: ['entry_id', 'release_seq', 'label_id', 'publisher_seq'],
  labels: ['id', 'name'],
  downloads: ['entry_id', 'release_seq', 'file_link', 'file_size', 'filetype_id', 'language_id', 'sourcetype_id', 'comments'],
  machinetypes: ['id', 'text'],
  genretypes: ['id', 'text'],
  availabletypes: ['id', 'text'],
  filetypes: ['id', 'text'],
  extensions: ['ext', 'text'],
  sourcetypes: ['id', 'text'],
  languages: ['id', 'text'],
};

/** The files of a release that are the program: tapes, snapshots, disks, cartridges (filetypes' ids). */
const PROGRAM_FILES = new Set([8, 10, 11, 17, 18, 21, 22]);
/** What else the page reads: the loading and running screens, the inlay's front, the instructions. */
const OTHER_FILES = new Set([1, 2, 5, 28]);

/**
 * One row of an INSERT's VALUES, as MySQL dumps it: `(1, 'it\'s', NULL, 2.5)`, with a trailing `,` or `;`. Strings
 * keep MySQL's backslash escapes undone; NULL is null; numbers are numbers.
 */
export function parseRow(line) {
  const out = [];
  let i = line.indexOf('(') + 1;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === ',') {
      i++;
      continue;
    }
    if (c === ')') break;
    if (c === "'") {
      let s = '';
      i++;
      for (;;) {
        const d = line[i];
        if (d === undefined) throw new Error(`a string not closed: ${line.slice(0, 80)}`);
        if (d === '\\') {
          const e = line[i + 1];
          s += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '0' ? '\0' : e === 'Z' ? '\x1a' : e;
          i += 2;
        } else if (d === "'") {
          if (line[i + 1] === "'") {
            s += "'";
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          s += d;
          i++;
        }
      }
      out.push(s);
      continue;
    }
    let j = i;
    while (j < n && line[j] !== ',' && line[j] !== ')') j++;
    const word = line.slice(i, j).trim();
    out.push(word === 'NULL' ? null : Number(word));
    i = j;
  }
  return out;
}

/** The rows of the tables in TABLES, from the dump's lines, each as an object of the columns kept. */
export async function readTables(lines) {
  const tables = Object.fromEntries(Object.keys(TABLES).map((t) => [t, []]));
  let table = null;
  let picks = null;
  for await (const line of lines) {
    if (table) {
      if (line.startsWith('\t(') || line.startsWith('(')) {
        const row = parseRow(line);
        const o = {};
        for (const [name, at] of picks) o[name] = row[at];
        tables[table].push(o);
        if (line.endsWith(';')) table = null;
        continue;
      }
      table = null;
    }
    const m = /^INSERT INTO `(\w+)` \(([^)]*)\) VALUES/.exec(line);
    if (m && TABLES[m[1]]) {
      table = m[1];
      const cols = m[2].split(',').map((c) => c.trim().replace(/`/g, ''));
      picks = TABLES[table].map((name) => {
        const at = cols.indexOf(name);
        if (at < 0) throw new Error(`the dump's ${table} has no column ${name}`);
        return [name, at];
      });
    }
  }
  for (const t of ['entries', 'downloads', 'machinetypes', 'filetypes']) if (!tables[t].length) throw new Error(`the dump has no rows of ${t}: not a ZXDB dump?`);
  return tables;
}

/** A program for the Spectrum family, as the page searches (contenttype SOFTWARE, machinetype ZXSPECTRUM). */
function isSpectrumSoftware(entry, machine, genre) {
  // ZXDB numbers hardware from 1000000 and books from 2000000.
  if (entry.id >= 1_000_000) return false;
  if (genre && /^(Book|Hardware)/.test(genre)) return false;
  return machine === null || /^ZX-Spectrum/.test(machine);
}

/** The index: its entries in the shape of the ZXInfo API's compact `_source`, with `_id` and the titles searched. */
export function buildIndex(tables, source = null) {
  const text = (name) => new Map(tables[name].map((r) => [r.id, r.text]));
  const machines = text('machinetypes');
  const genres = text('genretypes');
  const availability = text('availabletypes');
  const filetypes = text('filetypes');
  const sources = text('sourcetypes');
  const languages = text('languages');
  const labels = new Map(tables.labels.map((r) => [r.id, r.name]));
  // The longest extension that ends a file's name names its format: ".tzx.zip" before ".zip".
  const extensions = [...tables.extensions].sort((a, b) => b.ext.length - a.ext.length);
  const formatOf = (path) => extensions.find((e) => path.toLowerCase().endsWith(e.ext.toLowerCase()))?.text ?? null;

  const byEntry = (rows) => {
    const m = new Map();
    for (const r of rows) {
      let list = m.get(r.entry_id);
      if (!list) m.set(r.entry_id, (list = []));
      list.push(r);
    }
    return m;
  };
  const aliases = byEntry(tables.aliases);
  const releases = byEntry(tables.releases);
  const publishers = byEntry(tables.publishers);
  const downloads = byEntry(tables.downloads);
  // A program first sold on a compilation (Batty, on Hit Pak's Six Pak): the compilation's year is its own.
  const firstOn = new Map(tables.contents.filter((c) => c.is_original === 1 && c.entry_id !== null).map((c) => [c.entry_id, c.container_id]));
  const yearOf = (id) => releases.get(id)?.find((r) => r.release_seq === 0)?.release_year ?? null;

  const entries = [];
  let files = 0;
  for (const e of tables.entries) {
    const machine = machines.get(e.machinetype_id) ?? null;
    const genre = genres.get(e.genretype_id) ?? null;
    if (!isSpectrumSoftware(e, machine, genre)) continue;
    const rels = (releases.get(e.id) ?? []).sort((a, b) => a.release_seq - b.release_seq);
    const first = (publishers.get(e.id) ?? []).filter((p) => p.release_seq === 0).sort((a, b) => a.publisher_seq - b.publisher_seq)[0];
    const dls = (downloads.get(e.id) ?? []).filter((d) => d.file_link.startsWith('/'));
    const fileOf = (d) => ({
      path: d.file_link,
      size: d.file_size ?? null,
      type: filetypes.get(d.filetype_id) ?? '?',
      format: formatOf(d.file_link),
      origin: d.sourcetype_id ? (sources.get(d.sourcetype_id) ?? null) : null,
      comments: d.comments ?? null,
    });
    const seqs = [...new Set([0, ...rels.map((r) => r.release_seq)])].sort((a, b) => a - b);
    const releaseFiles = seqs.map((seq) => ({ files: dls.filter((d) => d.release_seq === seq && PROGRAM_FILES.has(d.filetype_id)).map(fileOf) }));
    // Releases with no files at the end say nothing the page reads.
    while (releaseFiles.length > 1 && !releaseFiles.at(-1).files.length) releaseFiles.pop();
    // The original release's first: its inlay before a re-release's.
    const others = dls.filter((d) => OTHER_FILES.has(d.filetype_id)).sort((a, b) => a.release_seq - b.release_seq);
    const screens = others.filter((d) => (d.filetype_id === 1 || d.filetype_id === 2) && /\.(png|gif|jpe?g)$/i.test(d.file_link)).map((d) => ({ url: d.file_link, type: filetypes.get(d.filetype_id) }));
    const additionalDownloads = others.map((d) => ({ path: d.file_link, type: filetypes.get(d.filetype_id), format: formatOf(d.file_link), language: d.language_id ? (languages.get(d.language_id) ?? null) : null }));
    const titles = [...new Set((aliases.get(e.id) ?? []).map((a) => a.title).filter((t) => t !== e.title))];
    files += releaseFiles.reduce((n, r) => n + r.files.length, 0);
    const s = {
      _id: String(e.id).padStart(7, '0'),
      title: e.title,
      originalYearOfRelease: yearOf(e.id) ?? (firstOn.has(e.id) ? yearOf(firstOn.get(e.id)) : null),
      machineType: machine,
      availability: availability.get(e.availabletype_id) ?? null,
      genre,
      publishers: first && labels.has(first.label_id) ? [{ name: labels.get(first.label_id) }] : [],
      releases: releaseFiles,
      screens,
      additionalDownloads,
    };
    if (titles.length) s.aliases = titles;
    entries.push(s);
  }
  entries.sort((a, b) => (a._id < b._id ? -1 : 1));
  return { index: { source, entries }, files };
}

/** The lines of the dump: of the .sql, or of the one .sql in a .zip (stored or deflated), streamed. */
export function dumpLines(path) {
  let stream;
  if (/\.zip$/i.test(path)) {
    // The local header of the first entry: its method, its size, and where its data begins.
    const fd = openSync(path, 'r');
    const head = Buffer.alloc(30);
    readSync(fd, head, 0, 30, 0);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`${path} is not a zip`);
    const method = head.readUInt16LE(8);
    const nameLength = head.readUInt16LE(26);
    const extraLength = head.readUInt16LE(28);
    closeSync(fd);
    const start = 30 + nameLength + extraLength;
    stream = createReadStream(path, { start });
    if (method === 8) stream = stream.pipe(createInflateRaw());
    else if (method !== 0) throw new Error(`${path}: compression method ${method}, not one read here`);
  } else stream = createReadStream(path);
  return createInterface({ input: stream, crlfDelay: Infinity });
}

/** Builds the index from the dump at `dump` and writes it, gzipped, to `out`. */
export async function buildFile(dump, out, source = null) {
  const t0 = performance.now();
  const { index, files } = buildIndex(await readTables(dumpLines(dump)), source);
  const body = gzipSync(indexText(index), { level: constants.Z_BEST_COMPRESSION });
  writeFileSync(out, body);
  return { entries: index.entries.length, files, bytes: body.length, seconds: Number(((performance.now() - t0) / 1000).toFixed(1)) };
}

async function fetchPinned(to) {
  const res = await fetch(ZXDB_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${ZXDB_URL}: ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(body).digest('hex');
  if (sha !== ZXDB_SHA256) throw new Error(`${ZXDB_URL}: SHA-256 ${sha}, not ${ZXDB_SHA256}`);
  writeFileSync(to, body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--fetch' && args[1]) {
      const dir = mkdtempSync(join(tmpdir(), 'zxdb-'));
      try {
        const dump = join(dir, 'ZXDB_mysql.sql.zip');
        await fetchPinned(dump);
        console.log(JSON.stringify(await buildFile(dump, args[1], `ZXDB ${ZXDB_COMMIT.slice(0, 7)}, ${ZXDB_DATE}`)));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } else if (args.length >= 2 && !args[0].startsWith('-')) {
      const at = args.indexOf('--source');
      const source = at > 0 ? args[at + 1] : `ZXDB dump ${statSync(args[0]).mtime.toISOString().slice(0, 10)}`;
      console.log(JSON.stringify(await buildFile(args[0], args[1], source)));
    } else {
      console.error('usage: node tools/zxdb-index.mjs DUMP OUT [--source TEXT] | --fetch OUT');
      process.exit(2);
    }
  } catch (e) {
    console.error(`zxdb-index: ${e.message}`);
    process.exit(1);
  }
}
