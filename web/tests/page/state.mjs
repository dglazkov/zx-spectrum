// The page test's parts for keeping the machine: save slots, snapshots, rewind, a breakpoint, the settings. Run by
// page.mjs on page/harness.mjs; each part covers this file too, so that a change here runs only these.

import { readFileSync } from 'node:fs';
import { parts, assert, clean, open, pause, ready, screen, until, wait } from './harness.mjs';

const test = parts(import.meta.url);

test('save slots: F2 keeps the machine, F4 puts it back, after a reload too, with the game’s tape in the deck', ['web/src/state/saves.ts', 'web/src/ui/game.ts'], async () => {
  const page = await open({ query: '?game=4293', storage: { loading: 'accelerated' } });
  assert(await until(page, () => window.zx.emulator.peek(0x5800) === 0x4f && !window.zx.emulator.tape.state().playing, null, { step: 200, max: 20_000 }), 'the game did not load');
  await page.evaluate(() => window.zx.emulator.poke(0x8000, 0x5a));
  await page.mouse.click(5, 300);
  await page.keyboard.press('F2');
  assert(await until(page, () => document.querySelectorAll('.slot.filled').length === 1, null, { step: 100, max: 5_000 }), 'the quick slot is not filled');
  await page.evaluate(() => window.zx.emulator.poke(0x8000, 0));
  await page.keyboard.press('F4');
  assert(await until(page, () => window.zx.emulator.peek(0x8000) === 0x5a, null, { step: 100, max: 5_000 }), 'F4 did not put it back');
  // Another visit: the link loads the game afresh; F4 brings back the moment, the tape where it was.
  await page.reload();
  await ready(page);
  assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 200, max: 10_000 }), 'the game did not load again');
  await page.mouse.click(5, 300);
  await page.keyboard.press('F4');
  assert(await until(page, () => window.zx.emulator.peek(0x8000) === 0x5a, null, { step: 100, max: 5_000 }), 'the slot did not come back after a reload');
  const after = await page.evaluate(() => ({ slots: document.querySelectorAll('.slot.filled').length, tape: window.zx.emulator.tape.state() }));
  assert(after.slots === 1 && after.tape.loaded && after.tape.position > 30, JSON.stringify(after));
  clean(page);
  await page.context().close();
  return `tape at ${after.tape.position.toFixed(1)} s`;
});

test('saves a snapshot, and loads one dropped on the page', [], async () => {
  const page = await open();
  await wait(page, 2000);
  await page.evaluate(() => window.zx.emulator.poke(0x8000, 0x5a));
  const files = [];
  for (const format of ['z80', 'szx', 'sna']) {
    await page.getByRole('button', { name: 'Snapshot' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: `Save as .${format}` }).click();
    const file = await download;
    files.push({ name: file.suggestedFilename(), bytes: readFileSync(await file.path()) });
  }
  assert(files.every((f, i) => f.name.endsWith(['.z80', '.szx', '.sna'][i]) && f.bytes.length > 300), files.map((f) => `${f.name} ${f.bytes.length}`).join(', '));
  for (const f of files) {
    await page.evaluate(() => window.zx.emulator.poke(0x8000, 0));
    await page.evaluate(
      ([b64, name]) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name));
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }));
      },
      [f.bytes.toString('base64'), f.name],
    );
    await page.waitForFunction(() => window.zx.emulator.peek(0x8000) === 0x5a);
  }
  await wait(page, 500);
  const text = (await screen(page)).split('\n')[23];
  assert(text.includes('Sinclair Research'), `after the snapshots: ${JSON.stringify(text)}`);
  clean(page);
  await page.context().close();
  return files.map((f) => `${f.name} ${f.bytes.length} bytes`).join(', ');
});

test('rewinds: a moment every half second, its picture shown while choosing, and the machine put back to it', ['web/src/state/rewind.ts', 'web/src/ui/timeline.ts'], async () => {
  const page = await open();
  await wait(page, 4000);
  const before = await page.evaluate(() => ({ moments: window.zx.app.rewind.length, history: window.zx.app.history, first: Array.from(window.zx.app.rewind.list()[0].colours).reduce((a, b) => a + b, 0) }));
  assert(before.moments >= 7, `${before.moments} moments after 4 s`);
  // The first moment's colours were read before the module's memory grew (making the moments' reader grows it).
  assert(before.first > 1000, `the first moment's colours count ${before.first} pixels`);
  // Something to go back from: LOAD typed on the bottom line.
  await page.mouse.click(5, 300);
  await page.keyboard.press('j');
  await wait(page, 2000);
  assert((await screen(page)).split('\n')[23].startsWith('LOAD'), 'LOAD was not typed');
  await page.focus('.timeline-track');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  const chosen = await page.evaluate(() => {
    const app = window.zx.app;
    const list = app.rewind.list();
    const m = list[list.length - 7];
    const picture = window.zx.emulator.statePicture(m.state);
    // What is on the screen now is the moment's picture, not the machine's.
    const p = window.zx.renderer.readPixels();
    return { previewing: !!app.preview, frame: m.frame, picture: picture && Array.from(picture.subarray(23 * 8 * 352 + 48 * 352 + 48, 23 * 8 * 352 + 48 * 352 + 100)), drawn: p.width > 0 };
  });
  const osd = await page.evaluate(() => ({ kind: document.querySelector('.osd')?.dataset.kind, hidden: document.querySelector('.osd')?.hidden, drained: document.body.classList.contains('previewing') }));
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => ({ history: window.zx.app.history, bottom: window.zx.emulator.screenText().split('\n')[23], frame: Array.from(window.zx.emulator.frame().subarray(23 * 8 * 352 + 48 * 352 + 48, 23 * 8 * 352 + 48 * 352 + 100)) }));
  assert(chosen.previewing, 'no moment shown while choosing');
  assert(osd.kind === 'preview' && !osd.hidden && osd.drained, `the screen while previewing: ${JSON.stringify(osd)}`);
  assert(after.history === chosen.frame && after.history < before.history + 100, `history ${before.history} → ${after.history}`);
  assert(!after.bottom.startsWith('LOAD'), `after going back the bottom line reads ${JSON.stringify(after.bottom)}`);
  assert(JSON.stringify(after.frame) === JSON.stringify(chosen.picture), 'the picture after going back is not the moment’s');
  clean(page);
  await page.context().close();
  return `back to frame ${after.history}`;
});

test('a breakpoint stops the machine, and the inspector shows where, disassembled', ['web/src/ui/inspector.ts'], async () => {
  const page = await open();
  await wait(page, 2000);
  await page.locator('button[title="Settings"]').click();
  await page.fill('.inspector input[aria-label="Breakpoint address, in hex"]', '0038');
  await page.locator('.inspector button', { hasText: 'Break at' }).click();
  await page.keyboard.press('Escape');
  await wait(page, 200);
  const stopped = await page.evaluate(() => ({ pc: window.zx.emulator.registers().pc, at: window.zx.emulator.breakpoint, speed: window.zx.app.scheduler.speed, open: document.querySelector('dialog.settings').open, code: document.querySelector('.dump.code')?.textContent ?? '' }));
  assert(stopped.pc === 0x38 && stopped.at === 0x38 && stopped.speed === 'pause', JSON.stringify(stopped));
  assert(stopped.open && /▶ 0038 +F5 +PUSH AF/.test(stopped.code), stopped.code.split('\n')[0]);
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  await page.locator('.inspector .bp').click();
  await page.locator('.inspector button', { hasText: 'Run' }).click();
  await page.keyboard.press('Escape');
  await wait(page, 1000);
  const ran = (await page.evaluate(() => window.zx.emulator.frameCount)) - f0;
  assert(ran >= 45, `${ran} frames after Run`);
  clean(page);
  await page.context().close();
  return stopped.code.split('\n')[0].trim();
});

test('the keyboard button is lit while the keyboard shows, puts it away and brings it back, and is remembered', ['web/src/keyboard/keyboard.ts'], async () => {
  const page = await open();
  const state = () =>
    page.evaluate(() => ({
      pressed: document.querySelector('.tools button:has(.icon-keyboard)').getAttribute('aria-pressed'),
      lit: getComputedStyle(document.querySelector('.tools button:has(.icon-keyboard)')).color,
      shown: getComputedStyle(document.querySelector('.keyboard-wrap')).display !== 'none',
    }));
  const on = await state();
  assert(on.pressed === 'true' && on.shown, `at first: ${JSON.stringify(on)}`);
  await page.click('.tools button:has(.icon-keyboard)');
  const off = await state();
  assert(off.pressed === 'false' && !off.shown && off.lit !== on.lit, `put away: ${JSON.stringify(off)}, lit ${on.lit} before`);
  await page.reload();
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  const remembered = await state();
  assert(remembered.pressed === 'false' && !remembered.shown, `after a reload: ${JSON.stringify(remembered)}`);
  await page.click('.tools button:has(.icon-keyboard)');
  const back = await state();
  assert(back.pressed === 'true' && back.shown && back.lit === on.lit, `brought back: ${JSON.stringify(back)}`);
  clean(page);
  await page.context().close();
  return `lit ${on.lit}, put away ${off.lit}`;
});

test('remembers its settings across a reload', ['web/src/state/settings.ts', 'web/src/ui/settings.ts'], async () => {
  const page = await open();
  await page.locator('.display .seg', { hasText: 'Sharp' }).click();
  await page.reload();
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  const display = await page.evaluate(() => document.body.dataset.display);
  assert(display === 'sharp', `display ${display} after a reload`);
  clean(page);
  await page.context().close();
});
