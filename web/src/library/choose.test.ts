import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import featured from './featured.json';
import { choose, machineFor, Unloadable } from './choose';
import { entryOf, searchQuery, type ZxHit } from './zxinfo';

// The ZXInfo API's own answers, recorded by tools/featured.mjs.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/zxinfo/${name}.json`, import.meta.url), 'utf8'));
const game = (id: string) => entryOf(fixture(`game-${id}`) as ZxHit);

describe('choosing the file to load', () => {
  it('takes the original release’s TZX of Saboteur, on a 48K', () => {
    const c = choose(game('0004293'));
    expect(c.file.path).toBe('/pub/sinclair/games/s/Saboteur.tzx.zip');
    expect(c.kind).toBe('tape');
    expect(c.model).toBe('48k');
  });

  it('takes the tape made for the 128K of a game for both, on a 128K', () => {
    const c = choose(game('0001196')); // Cybernoid: the original TZX, and Cybernoid128.tap and Cybernoid48.tap
    expect(c.model).toBe('128k');
    expect(c.file.path).toBe('/pub/sinclair/games/c/Cybernoid128.tap.zip');
  });

  it('takes a 128K game’s original TZX, on a 128K', () => {
    const c = choose(game('0002514')); // International Match Day
    expect(c.model).toBe('128k');
    expect(c.file.path).toBe('/pub/sinclair/games/i/InternationalMatchDay.tzx.zip');
  });

  it('takes a snapshot where there is no tape', () => {
    const c = choose(game('0032310')); // Bomb Jack +
    expect(c.kind).toBe('snapshot');
    expect(c.file.path).toMatch(/\.sna\.zip$/);
  });

  it('takes the game as sold, the plain file before a variant, and the later version', () => {
    const shelf = new Map((featured.entries as ZxHit[]).map((h) => [h._source.title, entryOf(h)]));
    const pick = (title: string) => choose(shelf.get(title)!).file.path.split('/').pop();
    expect(pick('Manic Miner')).toBe('ManicMiner.tzx.zip'); // not "(different)"
    expect(pick('Jet Set Willy')).toBe('JetSetWilly_2.tzx.zip'); // not the pre-production tape, nor the bugfix
    expect(pick('The Hobbit')).toBe('HobbitTheV1.2.tzx.zip'); // v1.2 over v1.0
    expect(pick('Treasure Island Dizzy')).toBe('Dizzy2-TreasureIslandDizzy.tzx.zip'); // not the bugfix
  });

  it('says why when there is only a disk', () => {
    expect(() => choose(game('0014957'))).toThrow(Unloadable);
    expect(() => choose(game('0014957'))).toThrow(/disk/);
  });

  it('loads nothing ZXDB does not list as Available', () => {
    const knightLore = game('0009366');
    expect(knightLore.availability).toBe('Distribution denied');
    expect(knightLore.releases.flat().length).toBeGreaterThan(0); // it has files, and they are not to be loaded
    expect(() => choose(knightLore)).toThrow(/distribution denied/);
  });

  it('knows the machines by ZXDB’s names for them', () => {
    expect(machineFor('ZX-Spectrum 48K')).toBe('48k');
    expect(machineFor('ZX-Spectrum 16K')).toBe('16k');
    expect(machineFor('ZX-Spectrum 16K/48K')).toBe('48k');
    expect(machineFor('ZX-Spectrum 48K/128K')).toBe('128k');
    expect(machineFor('ZX-Spectrum 128K')).toBe('128k');
    expect(machineFor('ZX-Spectrum 128 +2')).toBe('plus2');
    expect(machineFor('ZX-Spectrum 128 +2A/+3')).toBe('plus3');
    expect(machineFor('ZX-Spectrum 128 +3')).toBe('plus3');
    expect(machineFor('Pentagon 128')).toBe('pentagon');
    expect(machineFor('ZX-Spectrum Next')).toBeNull();
    expect(machineFor('ZX81 16K')).toBeNull();
    expect(machineFor('Timex TC2048')).toBeNull();
  });
});

describe('the featured shelf', () => {
  const shelf = (featured.entries as ZxHit[]).map(entryOf);
  it('starts with Saboteur', () => {
    expect(shelf[0].title).toBe('Saboteur!');
  });
  it('holds only what ZXDB lists as Available, each with a file to load', () => {
    for (const entry of shelf) {
      expect(entry.availability, entry.title).toBe('Available');
      expect(() => choose(entry), entry.title).not.toThrow();
    }
    expect(shelf.length).toBeGreaterThanOrEqual(20);
  });
});

describe('reading the API’s answers', () => {
  it('reads a search’s entries, with their pictures where they are', () => {
    const body = fixture('search-saboteur');
    const entries = (body.hits.hits as ZxHit[]).map(entryOf);
    expect(entries[0].title).toBe('Saboteur!');
    expect(entries[0].year).toBe(1985);
    expect(entries[0].publisher).toBe('Durell Software Ltd');
    expect(entries[0].screen).toMatch(/^https:\/\/(zxinfo\.dk\/media\/zxscreens|spectrumcomputing\.co\.uk\/pub)\//);
    expect(entries.every((e) => e.availability === 'Available')).toBe(true);
  });

  it('asks for software for the Spectrum family that is available', () => {
    const q = new URLSearchParams(searchQuery('jet set willy'));
    expect(q.get('query')).toBe('jet set willy');
    expect(q.get('contenttype')).toBe('SOFTWARE');
    expect(q.get('machinetype')).toBe('ZXSPECTRUM');
    expect(q.get('availability')).toBe('Available');
    expect(q.get('mode')).toBe('compact');
    expect(new URLSearchParams(searchQuery('x', { availableOnly: false })).has('availability')).toBe(false);
  });
});

describe('what the game’s panel shows of an entry', () => {
  it('finds Saboteur’s inlay (the original’s front, not a re-release’s), its instructions in English, and its controls', () => {
    const e = game('0004293');
    expect(e.inlay).toBe('/zxdb/sinclair/entries/0004293/Saboteur.jpg');
    expect(e.instructions).toBe('/pub/sinclair/games-info/s/Saboteur.txt');
    expect(e.controls).toEqual(['Cursor', 'Kempston Joystick', 'Redefineable keys']);
  });

  it('knows them for every game on the shelf, as recorded', () => {
    for (const hit of featured.entries as ZxHit[]) {
      const e = entryOf(hit);
      expect(e.inlay, e.title).toMatch(/\.(jpe?g|png|gif)$/i);
      expect(e.inlay, e.title).not.toMatch(/_Spanish/);
      if (e.instructions) expect(e.instructions, e.title).toMatch(/^\/pub\/sinclair\/games-info\/.+\.txt$/);
    }
  });

  it('says nothing of them where the record did not say (a fetch of the entry will)', () => {
    const e = entryOf({ _id: '0000001', _source: { title: 'X' } });
    expect(e.inlay).toBeUndefined();
    expect(e.instructions).toBeUndefined();
  });
});
