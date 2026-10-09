// The featured shelf: loved games from the ZXDB, Saboteur first, each checked through the ZXInfo API to be listed as
// Available (an entry that is not is left off, and said). Writes src/library/featured.json, which the page shows
// without asking the API, and records the API's own answers for the unit tests in tests/fixtures/zxinfo/.
//
//   node tools/featured.mjs            check every entry and write both
//   node tools/featured.mjs --check    check only: exit 1 if one is no longer Available

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.zxinfo.dk/v3';
const AGENT = 'zx-spectrum-emulator (https://zx-spectrum.lab.glazkov.ai)';

/** ZXDB ids, in the shelf's order. */
const SHELF = [
  ['0004293', 'Saboteur!'],
  ['0004295', 'Saboteur II'],
  ['0003012', 'Manic Miner'],
  ['0002589', 'Jet Set Willy'],
  ['0002259', 'Head over Heels'],
  ['0001601', 'Elite'],
  ['0006604', 'The Lords of Midnight'],
  ['0004549', 'Skool Daze'],
  ['0003067', 'Match Day'],
  ['0001551', 'Dynamite Dan'],
  ['0004873', 'Starquake'],
  ['0001712', 'Fairlight'],
  ['0000472', 'Batty'],
  ['0000617', 'Bomb Jack'],
  ['0001686', 'Exolon'],
  ['0001196', 'Cybernoid'],
  ['0004135', 'Rick Dangerous'],
  ['0000438', 'Batman'],
  ['0004087', 'Target: Renegade'],
  ['0000722', 'Bubble Bobble'],
  ['0009333', 'Treasure Island Dizzy'],
  ['0006440', 'The Hobbit'],
  ['0001303', 'Deathchase'],
  ['0000210', 'Ant Attack'],
  ['0002351', 'Horace Goes Skiing'],
  ['0001217', "Daley Thompson's Decathlon"],
  ['0000255', 'Arkanoid'],
];

/** Recorded for the tests: the shelf's first, a 48K/128K game with a 128K tape, a 128K game, a snapshot only, a disk only, one whose distribution is denied. */
const FIXTURES = ['0004293', '0001196', '0002514', '0032310', '0014957', '0009366'];

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const check = process.argv.includes('--check');
const shelf = [];
let missing = 0;
for (const [id, name] of SHELF) {
  const hit = await get(`/games/${id}?mode=compact`);
  const s = hit._source;
  if (s.availability !== 'Available') {
    console.log(`left off: ${name} (${id}) is ${s.availability}`);
    missing++;
    continue;
  }
  shelf.push({
    _id: hit._id,
    _source: {
      title: s.title,
      originalYearOfRelease: s.originalYearOfRelease,
      machineType: s.machineType,
      availability: s.availability,
      genre: s.genre,
      publishers: (s.publishers ?? []).slice(0, 1).map((p) => ({ name: p.name })),
      screens: (s.screens ?? []).map((x) => ({ url: x.url, type: x.type })),
      releases: (s.releases ?? []).map((r) => ({ files: (r.files ?? []).map((f) => ({ path: f.path, size: f.size, type: f.type, format: f.format, origin: f.origin, comments: f.comments })) })),
      // For the game's panel: the cassette's inlay, its instructions as text, how it is played.
      controls: (s.controls ?? []).map((c) => ({ control: c.control })),
      additionalDownloads: (s.additionalDownloads ?? [])
        .filter((d) => d.type === 'Inlay - Front' || (d.type === 'Instructions' && /TXT/.test(d.format ?? '')))
        .map((d) => ({ path: d.path, type: d.type, format: d.format, language: d.language })),
    },
  });
  console.log(`ok: ${s.title} (${s.originalYearOfRelease}, ${s.machineType})`);
}
if (check) process.exit(missing ? 1 : 0);

writeFileSync(here('../src/library/featured.json'), `${JSON.stringify({ checked: new Date().toISOString().slice(0, 10), entries: shelf }, null, 1)}\n`);
mkdirSync(here('../tests/fixtures/zxinfo'), { recursive: true });
for (const id of FIXTURES) writeFileSync(here(`../tests/fixtures/zxinfo/game-${id}.json`), `${JSON.stringify(await get(`/games/${id}?mode=compact`), null, 1)}\n`);
const search = await get('/search?query=saboteur&mode=compact&size=6&offset=0&sort=rel_desc&contenttype=SOFTWARE&machinetype=ZXSPECTRUM&availability=Available');
writeFileSync(here('../tests/fixtures/zxinfo/search-saboteur.json'), `${JSON.stringify(search, null, 1)}\n`);
console.log(`${shelf.length} on the shelf; fixtures recorded`);
