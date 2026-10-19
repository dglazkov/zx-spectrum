// The ZXDB's own index (tools/zxdb-index.mjs, zxdb.mjs) and the server answering from it where ZXInfo cannot: the
// dump's rows read as MySQL writes them; the index built from a real excerpt of the dump (tests/fixtures/zxdb/), its
// entries giving the page the same file to load as ZXInfo's own answers for them (tests/fixtures/zxinfo/); its search;
// and the pass-through falling back to it on a 502 shaped like ZXInfo's nginx page, on no answer, and on no origin,
// for a while, and back to ZXInfo once it answers.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { choose, kindOf } from '../src/library/choose';
import { entryOf } from '../src/library/zxinfo';
import { makePassThrough } from '../server.mjs';
import { buildIndex, dumpLines, parseRow, readTables } from '../tools/zxdb-index.mjs';
import { entry as entryText, indexText, makeIndex, makeZxdb, normalise, search as searchText } from '../zxdb.mjs';

const EXCERPT = fileURLToPath(new URL('./fixtures/zxdb/excerpt.sql', import.meta.url));
const recording = (name) => JSON.parse(readFileSync(new URL(`./fixtures/zxinfo/${name}.json`, import.meta.url), 'utf8'));
/** api.zxinfo.dk's answer to every path on Oct 18 2026, as its nginx gave it (#5, #6). */
const NGINX_502 = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';

let index;
beforeAll(async () => {
  index = makeIndex(indexText(buildIndex(await readTables(dumpLines(EXCERPT)), 'the excerpt').index));
});
/** The index's answers, as the page reads them. */
const entry = (index, id) => JSON.parse(entryText(index, id)?.toString() ?? 'null');
const search = (index, params) => JSON.parse(searchText(index, params).toString());

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

describe('searching the index', () => {
  const ids = (q) => search(index, new URLSearchParams(q)).hits.hits.map((h) => h._id);
  it('finds Saboteur first for “Saboteur”, as ZXInfo does, then its sequels', () => {
    const r = search(index, new URLSearchParams({ query: 'Saboteur', size: '24', availability: 'Available' }));
    expect(r.answeredBy).toBe('zxdb-index');
    expect(r.hits.hits[0]._id).toBe('0004293');
    expect(r.hits.hits[0]._source.title).toBe('Saboteur!');
    expect(r.hits.total.value).toBe(recording('search-saboteur').hits.total.value);
    expect(new Set(ids('query=Saboteur&availability=Available'))).toEqual(new Set(recording('search-saboteur').hits.hits.map((h) => h._id)));
  });

  it('matches however the title is written: case, accents, punctuation, the start of a word, another title', () => {
    expect(ids('query=SABOTÉUR')[0]).toBe('0004293');
    expect(ids('query=sabot').slice(0, 2).sort()).toEqual(['0004293', '0004295']);
    expect(ids('query=saboteur%202')).toContain('0004295');
    expect(ids('query=avenging%20angel')).toEqual(['0004295']);
    expect(ids('query=jet-set')).toContain('0002589');
    expect(normalise('Saboteur II: Avenging Angel')).toBe('saboteur ii avenging angel');
  });

  it('finds by publisher too, after titles', () => {
    expect(ids('query=durell')).toContain('0004293');
  });

  it('keeps to what is Available where asked, and counts the rest where not', () => {
    expect(ids('query=chuckie%20egg&availability=Available')).toEqual([]);
    expect(ids('query=chuckie%20egg')).toEqual(['0000958']);
  });

  it('pages by size and offset, and finds nothing for nothing', () => {
    const all = ids('query=saboteur&size=24');
    expect(ids('query=saboteur&size=2&offset=1')).toEqual(all.slice(1, 3));
    expect(search(index, new URLSearchParams('query=saboteur&size=0')).hits).toEqual({ total: { value: all.length, relation: 'eq' }, hits: [] });
    expect(ids('query=%20%21')).toEqual([]);
  });
});

describe('the server, with ZXInfo down', () => {
  let origin;
  let mode = 'down';
  let asked = 0;
  let front;
  let base;
  let dead;
  let clock = 0;
  let said;
  beforeAll(async () => {
    origin = createServer((req, res) => {
      asked++;
      if (mode === 'down') return res.writeHead(502, { Server: 'nginx', 'Content-Type': 'text/html' }).end(NGINX_502);
      if (mode === 'hang') return;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ hits: { total: { value: 1 }, hits: [{ _id: '0000001', _source: { title: 'From ZXInfo' } }] } }));
    });
    await new Promise((r) => origin.listen(0, '127.0.0.1', r));
    const host = `127.0.0.1:${origin.address().port}`;
    const closed = createServer();
    await new Promise((r) => closed.listen(0, '127.0.0.1', r));
    dead = `127.0.0.1:${closed.address().port}`;
    await new Promise((r) => closed.close(r));
    const route = (prefix, at) => ({ prefix, origin: `http://${at}/v3`, hosts: [at], allow: /^\/(search|games\/[0-9]{1,7}|suggest\/[^/]{1,80})$/, maxBytes: 1 << 20, timeoutMs: 10_000, query: true, cache: 'no-store', fallback: makeZxdb(index), fallbackMs: 300, fallbackFor: 60_000 });
    const pass = makePassThrough([route('/zxinfo/v3', host), route('/dead/v3', dead)], null, () => clock);
    front = createServer(async (req, res) => {
      if (!(await pass(req, res))) res.writeHead(418).end();
    });
    await new Promise((r) => front.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${front.address().port}`;
  });
  afterAll(() => {
    origin.closeAllConnections();
    origin.close();
    front.close();
  });
  const listen = () => {
    said = { errors: [], warnings: [] };
    vi.spyOn(console, 'error').mockImplementation((e) => said.errors.push(e.message));
    vi.spyOn(console, 'log').mockImplementation((l) => said.warnings.push(JSON.parse(l).message));
  };
  afterEach(() => vi.restoreAllMocks());
  const searchFor = (prefix = '/zxinfo/v3') => fetch(`${base}${prefix}/search?query=Saboteur&mode=compact&size=24&offset=0&sort=rel_desc&contenttype=SOFTWARE&machinetype=ZXSPECTRUM&availability=Available`);

  it('answers a search from the index where ZXInfo answers 502, and says so once, as a warning: the visitor is answered', async () => {
    listen();
    clock = 0;
    mode = 'down';
    asked = 0;
    const res = await searchFor();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-answered-by')).toBe('zxdb-index');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.hits.hits[0]._source.title).toBe('Saboteur!');
    expect(asked).toBe(1);
    expect(said.errors).toEqual([]);
    expect(said.warnings).toEqual([expect.stringMatching(/^\/zxinfo\/v3: 127\.0\.0\.1:\d+ answered 502; answered from the ZXDB index for 60 s$/)]);
  });

  it('then answers from the index for a minute without asking ZXInfo, an entry by its id among it; then asks again', async () => {
    listen();
    clock = 1_000;
    mode = 'up';
    asked = 0;
    const game = await fetch(`${base}/zxinfo/v3/games/0002514?mode=compact`);
    expect(game.headers.get('x-answered-by')).toBe('zxdb-index');
    expect((await game.json())._source.title).toBe('International Match Day');
    expect((await fetch(`${base}/zxinfo/v3/games/0999999?mode=compact`)).status).toBe(404);
    expect(asked).toBe(0);
    expect(said.errors).toEqual([]);
    clock = 61_001;
    const res = await searchFor();
    expect(res.headers.get('x-answered-by')).toBeNull();
    expect((await res.json()).hits.hits[0]._source.title).toBe('From ZXInfo');
    expect(asked).toBe(1);
  });

  it('answers from the index where ZXInfo gives no answer in time', async () => {
    listen();
    clock = 200_000;
    mode = 'hang';
    const res = await searchFor();
    expect(res.headers.get('x-answered-by')).toBe('zxdb-index');
    expect((await res.json()).hits.hits[0]._id).toBe('0004293');
    expect(said.warnings).toEqual([expect.stringMatching(/gave no answer in 300 ms; answered from the ZXDB index/)]);
    mode = 'up';
  });

  it('answers from the index where ZXInfo cannot be reached at all', async () => {
    listen();
    clock = 400_000;
    const res = await searchFor('/dead/v3');
    expect(res.headers.get('x-answered-by')).toBe('zxdb-index');
    expect((await res.json()).hits.hits[0]._id).toBe('0004293');
    expect(said.errors).toEqual([]);
    expect(said.warnings).toEqual([expect.stringMatching(/could not be reached .*; answered from the ZXDB index/)]);
  });

  it('says ZXInfo is down where the index has no answer for the path: the server’s error, once, with its stack', async () => {
    listen();
    clock = 600_000;
    mode = 'down';
    const res = await fetch(`${base}/zxinfo/v3/suggest/sabot`);
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/answered 502/);
    expect(said.errors).toEqual([expect.stringMatching(/^\/zxinfo\/v3: 127\.0\.0\.1:\d+ answered 502$/)]);
    expect(said.warnings).toEqual([]);
    mode = 'up';
  });
});
