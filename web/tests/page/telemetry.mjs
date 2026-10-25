// The page test's parts for what the page tells nerd (nerd guide telemetry): its events, counted and never of anyone,
// and nerd's feedback card, from F7 and from Settings, which keeps the keys typed into it from the machine. Run by
// page.mjs on page/harness.mjs; each part covers this file too, so that a change here runs only these.

import { parts, assert, clean, open, until, wait } from './harness.mjs';

const test = parts(import.meta.url);

/** The events the page sent so far, as `name kind` each. */
const events = (page) => page.nerd.filter((n) => n.path === '/nerd/event').map((n) => [n.body.name, n.body.kind].filter(Boolean).join(' '));

test('tells nerd what was played and how it went, and nothing of who or which: a game from a link, its slots, a rewind', ['web/src/telemetry.ts', 'web/src/state/saves.ts'], async () => {
  const page = await open({ query: '?game=4293', storage: { loading: 'accelerated' } });
  assert(await until(page, () => window.zx.emulator.peek(0x5800) === 0x4f && !window.zx.emulator.tape.state().playing, null, { step: 200, max: 20_000 }), 'the game did not load');
  await page.mouse.click(5, 300);
  await page.keyboard.press('F2');
  assert(await until(page, () => document.querySelectorAll('.slot.filled').length === 1, null, { step: 100, max: 5_000 }), 'the quick slot is not filled');
  await page.keyboard.press('F4');
  await wait(page, 1000);
  await page.evaluate(() => window.zx.app.goBack(0));
  await wait(page, 200);
  const said = events(page);
  const want = ['game.loaded link', 'slot.saved quick', 'slot.restored quick', 'rewind.used'];
  assert(JSON.stringify(said) === JSON.stringify(want), `the events: ${JSON.stringify(said)}`);
  // Each is the line nerd keeps and no more: no title, file or entry's number, the fetch's time a whole number.
  for (const { body } of page.nerd) {
    assert(Object.keys(body).every((k) => ['nerd', 'name', 'kind', 'n', 'ms'].includes(k)) && body.nerd === 'event', JSON.stringify(body));
    assert(!/saboteur|4293|\.tzx|\.tap|zip/i.test(JSON.stringify(body)), `an event names the game: ${JSON.stringify(body)}`);
  }
  const loaded = page.nerd[0].body;
  assert(Number.isInteger(loaded.ms) && loaded.ms >= 0, `game.loaded's ms: ${loaded.ms}`);
  // The feedback card hears them too, so that the last few go with what the person sends.
  await page.keyboard.press('F7');
  const listed = await page.evaluate(() => document.querySelector('#nerd-feedback')?.shadowRoot.querySelector('dl')?.textContent ?? '');
  assert(want.every((w) => listed.includes(w.split(' ')[0])), `the card's events: ${listed}`);
  clean(page);
  await page.context().close();
  return said.join(', ');
});

test('nerd’s feedback card: F7 and Settings open it, what is typed in it is not the machine’s, and it is sent as one line', ['web/src/telemetry.ts', 'web/src/ui/settings.ts', 'web/src/ui/help.ts', 'web/src/input/pc-keyboard.ts', 'crux/widget/', 'crates/app/'], async () => {
  const page = await open();
  await wait(page, 2000);
  const bottom = () => page.evaluate(() => window.zx.emulator.screenText().split('\n')[23]);
  const before = await bottom();
  // F7, the key the Spectrum has not got: the card, its words in focus.
  await page.mouse.click(5, 300);
  await page.keyboard.press('F7');
  assert(await page.evaluate(() => !!document.querySelector('#nerd-feedback')), 'F7 did not open the feedback card');
  // Typed into the card: its own, and none of it the machine's (a 48K at BASIC would print a keyword for each key).
  await page.keyboard.type('Saboteur loads');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await wait(page, 500);
  const typed = await page.evaluate(() => document.querySelector('#nerd-feedback').shadowRoot.querySelector('textarea').value);
  assert(typed === 'Saboteur loads', `the card's words: ${JSON.stringify(typed)}`);
  const after = await bottom();
  const touched = await page.evaluate(() => window.zx.app.touched);
  assert(after === before && !touched, `the machine took keys typed into the card: ${JSON.stringify(after)} (touched ${touched})`);
  // A click in its words keeps the focus there (the page lets go of a clicked control's focus, not a card's).
  await page.locator('#nerd-feedback textarea').click();
  await page.keyboard.type(' well');
  await page.keyboard.press('Control+Enter');
  assert(await until(page, () => document.querySelector('#nerd-feedback')?.shadowRoot.querySelector('.done') !== null, null, { step: 100, max: 5_000 }), 'the card did not say it was sent');
  const sent = page.nerd.filter((n) => n.path === '/nerd/feedback').map((n) => n.body);
  assert(sent.length === 1 && sent[0].words === 'Saboteur loads well' && sent[0].page === '/' && Array.isArray(sent[0].events) && Array.isArray(sent[0].errors), JSON.stringify(sent));
  await page.locator('#nerd-feedback .send').click();
  assert(await page.evaluate(() => !document.querySelector('#nerd-feedback')), 'the card stayed open after Close');
  // From Settings, which puts itself away for it; and the Keys sheet lists F7.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Send feedback' }).click();
  const fromSettings = await page.evaluate(() => ({ card: !!document.querySelector('#nerd-feedback'), settings: document.querySelector('dialog.settings').open }));
  assert(fromSettings.card && !fromSettings.settings, `from Settings: ${JSON.stringify(fromSettings)}`);
  await page.keyboard.press('Escape');
  const keys = await page.evaluate(() => document.querySelector('dialog.help').textContent);
  assert(keys.includes('F7') && keys.includes('Send feedback on the page'), 'the Keys sheet does not list F7');
  clean(page);
  await page.context().close();
  return `sent: ${JSON.stringify(sent[0].words)}`;
});
