// The ZXDB's own index built from the real dump: the one the image is built from (tools/zxdb-index.mjs pins it, and
// fixtures.txt names the same), from the fixture cache. It is the size it was, every shelf game in it is as ZXInfo
// listed it (src/library/featured.json, ZXInfo's own answers) and gives the page the same file to load, and searches
// find what ZXInfo found. Skipped where the dump cannot be had.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import featured from '../src/library/featured.json';
import { choose } from '../src/library/choose';
import { entryOf } from '../src/library/zxinfo';
import { buildFile, ZXDB_SHA256, ZXDB_URL } from '../tools/zxdb-index.mjs';
import { entry, readIndex, search } from '../zxdb.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const listed = readFileSync(join(root, 'fixtures.txt'), 'utf8').split('\n').find((l) => l.startsWith('zxdb-mysql.sql.zip '))?.split(' ');
let dump = null;
try {
  dump = execFileSync(join(root, 'scripts/fixture'), ['zxdb-mysql.sql.zip'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {}

it('is the dump the image is built from', () => {
  expect(listed?.[1]).toBe(ZXDB_SHA256);
  expect(listed?.[2]).toBe(ZXDB_URL);
});

describe.skipIf(!dump)('the index of the real dump', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zxdb-dump-'));
  let made;
  let index;
  beforeAll(async () => {
    made = await buildFile(dump, join(dir, 'index.txt.gz'), 'the fixture');
    index = readIndex(join(dir, 'index.txt.gz'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const get = (id) => JSON.parse(entry(index, id)?.toString() ?? 'null');
  const find = (q) => JSON.parse(search(index, new URLSearchParams(q)).toString());

  it('has the Spectrum’s software, small enough to ship: 36,539 entries in 2.4 MB at commit 0a634a1', () => {
    console.log(`  ${JSON.stringify(made)}`);
    expect(made.entries).toBe(36_539);
    expect(index.size).toBe(made.entries);
    expect(made.bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it('has every shelf game as ZXInfo listed it, and gives the page the same file to load', () => {
    for (const hit of featured.entries) {
      const ours = get(hit._id);
      expect(ours, hit._id).not.toBeNull();
      for (const k of ['title', 'originalYearOfRelease', 'machineType', 'availability']) expect(ours._source[k], `${hit._id} ${k}`).toEqual(hit._source[k]);
      const a = choose(entryOf(ours));
      const b = choose(entryOf(hit));
      expect([a.file.path, a.model], `${hit._id} ${hit._source.title}`).toEqual([b.file.path, b.model]);
    }
  });

  it('finds Saboteur first for “Saboteur”, and what ZXInfo found for it', () => {
    const r = find('query=Saboteur&size=24&availability=Available');
    expect(r.hits.hits[0]._id).toBe('0004293');
    const recorded = JSON.parse(readFileSync(new URL('./fixtures/zxinfo/search-saboteur.json', import.meta.url), 'utf8'));
    expect(new Set(r.hits.hits.map((h) => h._id))).toEqual(new Set(recorded.hits.hits.map((h) => h._id)));
  });
});
