// The ZXDB's own index (tools/zxdb-index.mjs, zxdb.mjs): the dump's rows read as MySQL writes them; the index built
// from a real excerpt of the dump (tests/fixtures/zxdb/), its entries giving the page the same file to load as ZXInfo's
// own answers for them (tests/fixtures/zxinfo/); and the server's copy of that index (crates/app/tests/zxdb-index.txt),
// which its tests search and fall back to, the one the tool builds. The search and the server answering from the index
// with ZXInfo down are the server's tests now (crates/app/tests/zxdb.rs and pass.rs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { choose, kindOf } from '../src/library/choose';
import { entryOf } from '../src/library/zxinfo';
import { buildIndex, dumpLines, parseRow, readTables } from '../tools/zxdb-index.mjs';
import { entry as entryText, indexText, makeIndex } from '../zxdb.mjs';

const EXCERPT = fileURLToPath(new URL('./fixtures/zxdb/excerpt.sql', import.meta.url));
const recording = (name) => JSON.parse(readFileSync(new URL(`./fixtures/zxinfo/${name}.json`, import.meta.url), 'utf8'));
const SERVERS = fileURLToPath(new URL('../../crates/app/tests/zxdb-index.txt', import.meta.url));

let text;
let index;
beforeAll(async () => {
  text = indexText(buildIndex(await readTables(dumpLines(EXCERPT)), 'the excerpt').index);
  index = makeIndex(text);
});
/** The index's answers, as the page reads them. */
const entry = (index, id) => JSON.parse(entryText(index, id)?.toString() ?? 'null');

describe('the dump’s rows', () => {
  it('reads strings with MySQL’s escapes, NULL and numbers', () => {
    expect(parseRow(`\t(1, 'it\\'s', NULL, -2.5, 'a, (b)', 'back\\\\slash', 'two\\nlines', ''),`)).toEqual([1, "it's", null, -2.5, 'a, (b)', 'back\\slash', 'two\nlines', '']);
    expect(parseRow(`\t(7, 'Raül Torralba', 'end');`)).toEqual([7, 'Raül Torralba', 'end']);
  });

  it('refuses what is not a ZXDB dump', async () => {
    await expect(readTables(['-- nothing here'])).rejects.toThrow(/not a ZXDB dump/);
  });
});

describe('the index built from the dump', () => {
  it('has the Spectrum’s software only: no hardware, no books', () => {
    expect(index.size).toBe(13);
    expect(entry(index, '1000011')).toBeNull();
    expect(entry(index, '2000000')).toBeNull();
  });

  it('has Saboteur as ZXInfo has it: its title, year, machine, publisher, availability and genre', () => {
    const ours = entry(index, '4293')._source;
    const theirs = recording('game-0004293')._source;
    for (const k of ['title', 'originalYearOfRelease', 'machineType', 'availability', 'genre']) expect(ours[k], k).toEqual(theirs[k]);
    expect(ours.publishers[0].name).toBe(theirs.publishers[0].name);
  });

  it('gives the page the same file to load, on the same machine, as ZXInfo’s own answers do', () => {
    for (const id of ['0004293', '0001196', '0002514', '0032310']) {
      const ours = choose(entryOf(entry(index, id)));
      const theirs = choose(entryOf(recording(`game-${id}`)));
      expect([ours.file.path, ours.kind, ours.model], id).toEqual([theirs.file.path, theirs.kind, theirs.model]);
    }
    // And refuses what it refuses: a game on disk only, and one its rights holder keeps back.
    for (const id of ['0014957', '0009366']) {
      let ours, theirs;
      try {
        choose(entryOf(entry(index, id)));
      } catch (e) {
        ours = e.message;
      }
      try {
        choose(entryOf(recording(`game-${id}`)));
      } catch (e) {
        theirs = e.message;
      }
      expect(ours, id).toBeTruthy();
      expect(ours, id).toBe(theirs);
    }
  });

  it('lists each release’s tapes and snapshots as ZXInfo does: release by release, with their type, format and origin', () => {
    const files = (e) => {
      const releases = e.releases.map((r) => r.filter((f) => kindOf(f)).map((f) => [f.path, f.type, f.format, f.origin ?? null].join(' · ')).sort());
      while (releases.length && !releases.at(-1).length) releases.pop();
      return releases;
    };
    for (const id of ['0004293', '0001196', '0002514', '0032310', '0014957']) {
      const theirs = files(entryOf(recording(`game-${id}`)));
      expect(files(entryOf(entry(index, id))), id).toEqual(theirs);
      if (id === '0004293') expect(theirs.flat().length).toBeGreaterThan(5);
    }
  });

  it('has the inlay and the manual the page shows: the original’s, in English', () => {
    const e = entryOf(entry(index, '4293'));
    expect(e.instructions).toBe('/pub/sinclair/games-info/s/Saboteur.txt');
    expect(e.inlay).toBe(entryOf(recording('game-0004293')).inlay);
  });
});

describe('the server’s copy of it', () => {
  it('is the index the tool builds from the excerpt, as it is now', () => {
    expect(readFileSync(SERVERS, 'utf8'), 'crates/app/tests/zxdb-index.txt is stale: write indexText of the excerpt to it again').toBe(text);
  });
});
