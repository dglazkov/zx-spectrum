// The page test's parts for the library: Saboteur searched and loaded, a game from a link, a game with no card. Run by
// page.mjs on page/harness.mjs; each part covers this file too, so that a change here runs only these.

import { readFileSync } from 'node:fs';
import { parts, SABOTEUR_ZIP, SHARP, Skip, assert, base, borderColours, clean, open, openFile, ready, screen, until, wait, zxinfo } from './harness.mjs';

const test = parts(import.meta.url);

test('Saboteur from the library: searched, fetched, loaded flat out to its £100 REWARD screen, with its inlay, manual and card; its Start button to play, and the controls over the screen', ['web/src/library/', 'web/src/ui/library.ts', 'web/src/ui/game.ts', 'web/src/ui/overlay.ts', 'web/src/ui/howto.ts', 'web/tests/fixtures/'], async () => {
  if (!SABOTEUR_ZIP) throw new Skip('no saboteur.tzx.zip in the fixture cache');
  const page = await open({ storage: { ...SHARP, loading: 'accelerated' }, realSaboteur: true });
  await wait(page, 500);
  await page.fill('.search', 'saboteur');
  await page.press('.search', 'Enter');
  await page.waitForFunction(() => document.querySelector('.library-status')?.textContent?.includes('found'));
  const fetched = page.waitForRequest((r) => r.url().endsWith('.zip'));
  await page.locator('.card', { hasText: 'Saboteur!' }).first().click();
  const request = await fetched;
  assert(request.url().endsWith('/archive/pub/sinclair/games/s/Saboteur.tzx.zip'), request.url());
  await page.waitForFunction(() => window.zx.emulator.tape.blocks().length > 8);
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  // The game's own loader's stripes in the border, black and red, while its 38,500 bytes come in (the tape's block 8,
  // after an archive info block and the loaders).
  assert(await until(page, () => window.zx.emulator.tape.state().block === 8, null, { step: 50, max: 10_000 }), 'the game block did not play');
  const stripes = await borderColours(page);
  assert(stripes.length === 2 && stripes.includes('0,0,0') && stripes.includes('216,0,0'), `the border while the game loads: ${stripes.join(' ')}`);
  const reached = await until(page, () => window.zx.emulator.screenText().includes('REWARD'), null, { step: 250, max: 20_000 });
  const after = await page.evaluate(() => ({ frames: window.zx.emulator.frameCount, text: window.zx.emulator.screenText().split('\n'), speed: window.zx.app.scheduler.speed, label: document.querySelector('.cs-title')?.textContent, inlay: document.querySelector('.deck')?.classList.contains('has-inlay'), keys: [...document.querySelectorAll('.controls-table td:last-child kbd')].map((t) => t.textContent), goal: document.querySelector('.game-goal')?.textContent ?? '', fallback: !document.querySelector('.game-fallback').hidden, model: window.zx.emulator.model, url: location.search }));
  assert(reached, `no REWARD screen: ${JSON.stringify(after.text.slice(0, 3))}`);
  const frames = after.frames - f0;
  // The tape plays 9,039 frames (180.5 s); the 48K boots, LOAD "" is typed, the game prints its screen.
  assert(frames < 9_400, `the REWARD screen ${frames} frames after the tape went in`);
  assert(after.text[0] === '          £100  REWARD          ' && after.text[23] === '   PRESS ANY KEY TO CONTINUE    ', JSON.stringify([after.text[0], after.text[23]]));
  assert(after.speed === 1, `the page at ${after.speed} once the tape stopped`);
  assert(after.label === 'Saboteur!' && after.model === '48k', `the cassette says ${after.label}, on a ${after.model}`);
  assert(after.inlay, 'no inlay on the cassette');
  assert(after.keys.includes('Space') && after.keys.includes('A') && after.keys.includes('N'), `keys on the card: ${after.keys}`);
  assert(/helicopter/.test(after.goal) && !after.fallback, `the card's goal: ${after.goal}; the fallback shown: ${after.fallback}`);
  assert(new URLSearchParams(after.url).get('game') === '4293', `the address: ${after.url}`);
  // The joystick is the card's choice to begin with, and no key is marked on the drawn keyboard for it; the game's own
  // keys are once Keys is chosen. Then the Start button takes it from the REWARD screen to the game by the keyboard,
  // the menu's keys pressed for the person (the card's route).
  const marks = () => page.evaluate(() => [...document.querySelectorAll('.kb-key.marked')].map((k) => k.dataset.key).sort().join(' '));
  const chosen = await page.evaluate(() => document.querySelector('.start-how .seg.on')?.textContent);
  const unmarked = await marks();
  assert(chosen === 'Joystick' && unmarked === '', `chosen at first: ${chosen}; keys marked: ${unmarked}`);
  const s0 = await page.evaluate(() => window.zx.emulator.frameCount);
  await page.locator('.start-how .seg', { hasText: 'Keys' }).click();
  const marked = await marks();
  assert(marked === 'A M N SPACE Z', `keys marked on the keyboard with Keys chosen: ${marked}`);
  // The way in is on the picture too while the REWARD screen waits: pressed, it starts the game as the panel's would.
  assert(await until(page, () => !document.querySelector('.start-prompt').hidden && document.querySelector('.panel.game').dataset.start === 'ready', null, { step: 100, max: 5_000 }), 'no start button on the picture at the REWARD screen');
  await page.locator('.start-prompt').click();
  assert(await until(page, () => document.querySelector('.panel.game').dataset.start === 'done', null, { step: 250, max: 120_000 }), `the game did not begin: ${await page.evaluate(() => document.querySelector('.panel.game').dataset.start)}`);
  const started = await page.evaluate(() => {
    const e = window.zx.emulator;
    const row = (r) => Array.from({ length: 32 }, (_, c) => e.peek(0x5800 + r * 32 + c));
    return { frames: e.frameCount, panel: row(18).every((a) => a === 2) && row(23).every((a) => a === 2) };
  });
  assert(started.panel, 'no game panel on the screen after the Start button');
  assert(await page.evaluate(() => document.querySelector('.start-prompt').hidden), 'the start button stayed on the picture once the game began');
  // Play has begun: the controls over the screen, as the keys chosen press them, for a few seconds of the game.
  const overlay = () =>
    page.evaluate(() => {
      const o = document.querySelector('.controls-overlay');
      return { shown: !o.hidden, mode: o.querySelector('.ov-mode')?.textContent, caps: [...o.querySelectorAll('.ov-row kbd')].map((k) => k.textContent), button: document.querySelector('.controls-button').getAttribute('aria-expanded') };
    });
  const first = await overlay();
  assert(first.shown && first.mode === 'Keys' && ['N', 'M', 'A', 'Z', 'Space'].every((k) => first.caps.includes(k)), `the controls when play began: ${JSON.stringify(first)}`);
  await wait(page, 9000);
  const gone = await overlay();
  assert(!gone.shown, 'the controls stayed over the screen past their few seconds');
  // F3 brings them back, as they are pressed now (the joystick chosen: the arrows and Left Alt); F3 again hides them.
  await page.locator('.start-how .seg', { hasText: 'Joystick' }).click();
  await page.mouse.click(5, 400);
  await page.keyboard.press('F3');
  const asked = await overlay();
  assert(asked.shown && asked.mode === 'Joystick' && asked.caps.includes('Left Alt') && asked.caps.includes('←') && asked.button === 'true', `F3: ${JSON.stringify(asked)}`);
  await wait(page, 9000);
  assert((await overlay()).shown, 'the controls asked for went by themselves');
  await page.keyboard.press('F3');
  assert(!(await overlay()).shown, 'F3 did not hide the controls');
  // The button on the set shows them; their × closes them, and that is remembered for the game.
  await page.locator('.controls-button').click();
  assert((await overlay()).shown, 'the button did not show the controls');
  await page.locator('.ov-close').click();
  const closed = await page.evaluate(() => ({ shown: !document.querySelector('.controls-overlay').hidden, kept: localStorage.getItem('zx-spectrum.controls-closed') }));
  assert(!closed.shown && JSON.parse(closed.kept ?? '[]').includes('zxdb:0004293'), `after the ×: ${JSON.stringify(closed)}`);
  // What nerd was told (web/src/telemetry.ts): a game found by searching, its play begun by the Start button, and, as
  // the page goes, how long it was played.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await wait(page, 100);
  const told = page.nerd.filter((n) => n.path === '/nerd/event').map((n) => n.body);
  const names = told.map((b) => [b.name, b.kind].filter(Boolean).join(' '));
  assert(JSON.stringify(names) === JSON.stringify(['game.loaded search', 'game.started button', 'game.played']), `the events: ${JSON.stringify(names)}`);
  assert(told[1].ms > 0 && told[2].ms >= 18_000, `game.started after ${told[1].ms} ms, played ${told[2].ms} ms`);
  clean(page);
  await page.context().close();
  return `REWARD ${frames} frames after the tape went in; keys ${after.keys.join(' ')}; the game ${started.frames - s0} frames after Start; the controls over it`;
});

test('with ZXInfo down (its nginx’s 502 for every path), Saboteur is found in the ZXDB’s own index and loads, and a link to a game not on the shelf (?game=2514) opens from it', ['crates/app/', 'web/app.mjs', 'web/zxdb.mjs', 'web/tools/zxdb-index.mjs', 'web/tests/fixtures/zxdb/', 'web/src/library/', 'web/src/ui/library.ts'], async () => {
  // The page's ZXDB requests go to the server, as they do when deployed; its ZXInfo is the harness's stand-in.
  const through = (page) => page.route('**/zxinfo/v3/**', (r) => r.continue());
  const asked = zxinfo.asked.length;
  const page = await open({ storage: { loading: 'accelerated' }, route: through });
  await wait(page, 500);
  const answers = [];
  page.on('response', (r) => r.url().includes('/zxinfo/v3/') && answers.push(`${r.status()} ${r.headers()['x-answered-by'] ?? 'zxinfo'}`));
  await page.fill('.search', 'Saboteur');
  await page.press('.search', 'Enter');
  await page.waitForFunction(() => /found|could not/.test(document.querySelector('.library-status')?.textContent ?? ''));
  const found = await page.evaluate(() => ({ status: document.querySelector('.library-status').textContent, cards: [...document.querySelectorAll('.library .card .card-title')].map((c) => c.textContent) }));
  assert(found.cards[0] === 'Saboteur!' && /^6 found/.test(found.status), `the search: ${JSON.stringify(found)}`);
  const fetched = page.waitForRequest((r) => r.url().endsWith('.zip'));
  await page.locator('.card', { hasText: 'Saboteur!' }).first().click();
  const request = await fetched;
  assert(request.url().endsWith('/archive/pub/sinclair/games/s/Saboteur.tzx.zip'), request.url());
  assert(await until(page, () => window.zx.emulator.tape.state().playing && document.querySelector('.cs-title')?.textContent === 'Saboteur!', null, { step: 200, max: 10_000 }), `Saboteur did not start: ${await page.evaluate(() => document.querySelector('.toasts')?.textContent)}`);
  assert(zxinfo.asked.length > asked, 'ZXInfo was not asked first');
  assert(answers.length && answers.every((a) => a === '200 zxdb-index'), `the server's answers: ${answers}`);
  clean(page);
  await page.context().close();
  const linked = await open({ query: '?game=2514', storage: { loading: 'accelerated' }, route: through });
  assert(await until(linked, () => window.zx.emulator.tape.state().loaded && document.querySelector('.cs-title')?.textContent === 'International Match Day', null, { step: 200, max: 10_000 }), `?game=2514 did not open: ${await linked.evaluate(() => JSON.stringify([document.querySelector('.cs-title')?.textContent, document.querySelector('.toasts')?.textContent]))}`);
  const model = await linked.evaluate(() => window.zx.emulator.model);
  assert(model === '128k', `International Match Day on a ${model}`);
  clean(linked);
  await linked.context().close();
  return `“Saboteur”: ${found.status.trim()}, ${found.cards.slice(0, 3).join(', ')}…; the server answered ${answers.length} from the index; ?game=2514 opened International Match Day on the 128K`;
});

test('a link to a game loads it straight away (?game=4293), and the share button gives that link', ['web/src/ui/game.ts', 'web/src/library/'], async () => {
  const page = await open({ query: '?game=4293', storage: { loading: 'accelerated' } });
  assert(await until(page, () => window.zx.emulator.tape.state().loaded && document.querySelector('.cs-title')?.textContent === 'Saboteur!', null, { step: 200, max: 10_000 }), `Saboteur did not go into the deck: ${await page.evaluate(() => JSON.stringify([window.zx.emulator.tape.state(), document.querySelector('.cs-title')?.textContent, document.querySelector('.toasts')?.textContent, location.href]))}; ${page.problems}; archive ${page.archive}`);
  assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 200, max: 10_000 }), 'the tape did not start');
  assert(page.archive.some((p) => p.endsWith('/Saboteur.tzx.zip')) && page.archive.some((p) => p.endsWith('/Saboteur.txt')), `fetched ${page.archive.join(', ')}`);
  const panel = await page.evaluate(() => ({ title: document.querySelector('.game-title')?.textContent, start: document.querySelector('.game-start')?.textContent ?? '', shown: !document.querySelector('.panel.game').hidden }));
  assert(panel.shown && panel.title === 'Saboteur!' && panel.start.includes('REWARD'), JSON.stringify(panel));
  await page.locator('.game button', { hasText: 'Share' }).click();
  await wait(page, 100);
  const shared = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return document.querySelector('.toasts')?.textContent ?? '';
    }
  });
  assert(shared.includes(`${new URL(base).host}/?game=4293`), `shared ${shared}`);
  // A snapshot saved of the game, opened again, is the game again: its panel, not a file's.
  await page.getByRole('button', { name: 'Snapshot' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Save as .szx' }).click();
  const file = await download;
  const bytes = readFileSync(await file.path());
  await page.evaluate(() => window.zx.app.reset());
  await openFile(page, file.suggestedFilename(), bytes);
  assert(await until(page, () => document.querySelector('.game-title')?.textContent === 'Saboteur!' && window.zx.app.game?.entry?.id === '0004293', null, { step: 100, max: 5_000 }), `the snapshot opened as ${await page.evaluate(() => document.querySelector('.game-title')?.textContent)}`);
  clean(page);
  await page.context().close();
  return `${shared}; ${file.suggestedFilename()} opened as Saboteur!`;
});

test('a game with no card (found by searching) shows what is known: ZXDB’s controls, the manual’s keys, the honest line; F3 puts them over the screen', ['web/src/ui/game.ts', 'web/src/ui/overlay.ts', 'web/src/ui/howto.ts', 'web/src/library/'], async () => {
  // International Match Day: on no shelf, so with no card; its manual (the test's) has a table of keys.
  const page = await open({ query: '?game=2514', storage: { loading: 'accelerated' } });
  assert(await until(page, () => document.querySelector('.game-title')?.textContent === 'International Match Day' && document.querySelector('.game-fallback .keys-table'), null, { step: 200, max: 10_000 }), `no panel for the game: ${await page.evaluate(() => document.querySelector('.panel.game')?.textContent?.slice(0, 200))}`);
  const panel = await page.evaluate(() => ({
    start: !document.querySelector('.game-start').hidden,
    card: !document.querySelector('.game-howto').hidden,
    said: document.querySelector('.fallback-said').textContent,
    honest: document.querySelector('.fallback-honest').textContent,
    keys: [...document.querySelectorAll('.game-fallback .keys-table th')].map((t) => t.textContent),
    model: window.zx.emulator.model,
  }));
  assert(!panel.start && !panel.card, `a card's parts shown for a game with none: ${JSON.stringify(panel)}`);
  assert(panel.said === 'The ZXDB says it takes a cursor joystick (5, 6, 7, 8 and 0), a Sinclair joystick or a Kempston joystick.', panel.said);
  assert(panel.honest.startsWith('Most games of the time take a Kempston joystick from their menu: choose it there, then play with the arrow keys and Left Alt.'), panel.honest);
  assert(panel.keys.join(' ') === 'Q A O P SPACE' && panel.model === '128k', `the manual's keys ${panel.keys}, on a ${panel.model}`);
  await page.mouse.click(5, 400);
  await page.keyboard.press('F3');
  const over = await page.evaluate(() => {
    const o = document.querySelector('.controls-overlay');
    return { shown: !o.hidden, mode: o.querySelector('.ov-mode').textContent, caps: [...o.querySelectorAll('.ov-row kbd')].map((k) => k.textContent), note: o.querySelector('.ov-note').textContent };
  });
  assert(over.shown && over.mode === 'Controls' && over.caps.join(' ') === 'Q A O P SPACE' && /Kempston joystick from their menu/.test(over.note), JSON.stringify(over));
  // Its keys outlined on the drawn keyboard, from the manual.
  const marked = await page.evaluate(() => [...document.querySelectorAll('.kb-key.marked')].map((k) => k.dataset.key).sort().join(' '));
  assert(marked === 'A O P Q SPACE', `keys marked: ${marked}`);
  clean(page);
  await page.context().close();
  return panel.said;
});
