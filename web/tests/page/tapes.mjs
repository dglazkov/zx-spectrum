// The page test's parts for tapes loaded from a file and from the 128’s menu, a SAVE out of the deck, files refused,
// the stripes. Run by page.mjs on page/harness.mjs; each part covers this file too, so that a change here runs only
// these.

import { readFileSync } from 'node:fs';
import { parts, SHARP, assert, borderColours, clean, header, keyLog, open, openFile, pixel, playing, programTape, ready, screen, until, wait } from './harness.mjs';

const test = parts(import.meta.url);

test('a tape from a file loads: LOAD "" typed when the ROM is ready, stripes in the border, then its screen, flat out', ['web/src/ui/deck.ts', 'web/src/input/', 'web/src/clock/'], async () => {
  const page = await open({ storage: SHARP });
  await wait(page, 1000);
  await openFile(page, 'test.tap', programTape('PICTURE'));
  await wait(page, 100);
  const blocks = await page.locator('.block').count();
  assert(blocks === 4, `${blocks} blocks in the deck`);
  assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 250, max: 10_000 }), 'the tape did not start');
  const log = (await keyLog(page)).filter(([, d]) => d).map(([c]) => c);
  assert(log.join() === '33,36,25,36,25,30', `typed ${log}`);
  await wait(page, 3000);
  const colours = new Set(await borderColours(page));
  assert(colours.has('216,0,0') && colours.has('0,216,216'), `border colours in the pilot: ${[...colours].join(' ')}`);
  // The rest, flat out.
  await page.locator('.deck .seg', { hasText: 'Accelerated' }).click();
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  assert(await until(page, () => !window.zx.emulator.tape.state().playing, null, { step: 200, max: 15_000 }), 'the tape did not stop');
  const loadedIn = (await page.evaluate(() => window.zx.emulator.frameCount)) - f0;
  await wait(page, 200);
  const paper = await pixel(page, 49, 49);
  const ink = await pixel(page, 48, 49);
  assert(paper.join() === '0,0,255' && ink.join() === '255,255,255', `the loaded screen: ink ${ink}, paper ${paper}`);
  const speed = await page.evaluate(() => window.zx.app.scheduler.speed);
  assert(speed === 1, `back at ${speed} once the tape stopped`);
  clean(page);
  await page.context().close();
  return `border ${colours.size} colours; the rest in ${loadedIn} frames flat out; the screen ink ${ink} on ${paper}`;
});

test('a 128 loads a tape from its menu: ENTER on Tape Loader once the menu shows', ['web/src/input/typer.ts'], async () => {
  const page = await open({ storage: { ...SHARP, model: '128k', loading: 'accelerated' } });
  await wait(page, 500);
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  await openFile(page, 'test.tap', programTape('PICTURE'));
  assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 100, max: 10_000 }), 'the tape did not start');
  const enter = (await keyLog(page)).filter(([, d]) => d);
  assert(enter.length === 1 && enter[0][0] === 30, `typed ${JSON.stringify(enter)}`);
  const after = enter[0][2] - f0;
  // The menu shows about 61 frames after switching on: ENTER is pressed then, not after a fixed wait.
  assert(after > 55 && after < 100, `ENTER ${after} frames after switching on`);
  assert(await until(page, () => window.zx.emulator.peek(0x5800) === 0x4f && !window.zx.emulator.tape.state().playing, null, { step: 200, max: 15_000 }), 'the screen did not load');
  clean(page);
  await page.context().close();
  return `ENTER ${after} frames after switching on`;
});

test('a SAVE from BASIC comes out of the deck as a TAP to download', ['web/src/ui/deck.ts'], async () => {
  const page = await open();
  await wait(page, 2000);
  await page.mouse.click(5, 300);
  // 10 REM hi (E is REM in K mode), then SAVE "hi" (S is SAVE), as the ROM is typed.
  await page.keyboard.type('10ehi', { delay: 0 });
  await page.keyboard.press('Enter');
  await wait(page, 2000);
  await page.keyboard.type('s"hi"');
  await page.keyboard.press('Enter');
  await wait(page, 2000);
  assert((await screen(page)).includes('Start tape'), `SAVE did not ask for the tape: ${JSON.stringify((await screen(page)).split('\n').filter((l) => l.trim()))}`);
  await page.keyboard.press('Enter');
  assert(await until(page, () => /2 blocks/.test(document.querySelector('.deck-saved')?.textContent ?? ''), null, { step: 500, max: 20_000 }), `nothing recorded: ${JSON.stringify((await screen(page)).split('\n').filter((l) => l.trim()))} ${await page.evaluate(() => document.querySelector('.deck-saved').textContent + ' ' + window.zx.emulator.savedTap().length)}`);
  const download = page.waitForEvent('download');
  await page.locator('.deck-saved button').click();
  const file = await download;
  const tap = readFileSync(await file.path());
  // Named for what was SAVEd: its header's name.
  assert(file.suggestedFilename() === 'hi.tap' && tap[0] === 19 && tap[2] === 0 && tap.subarray(4, 6).toString() === 'hi', `${file.suggestedFilename()}: ${[...tap.subarray(0, 8)]}`);
  clean(page);
  await page.context().close();
  return `${file.suggestedFilename()}, ${tap.length} bytes`;
});

test('a tape playing leaves the page where it is: the deck’s list follows the head, the window does not', ['web/src/ui/deck.ts'], async () => {
  // On a phone the deck is under the keyboard: the screen is what is watched while the tape loads.
  const page = await open({ phone: true });
  await wait(page, 1000);
  await openFile(page, 'test.tap', programTape('PICTURE'));
  await page.evaluate(() => window.scrollTo(0, 0));
  assert(await until(page, () => window.zx.emulator.tape.state().block >= 1, null, { step: 500, max: 20_000 }), 'the tape did not reach its second block');
  const y = await page.evaluate(() => window.scrollY);
  assert(y === 0, `the window scrolled to ${y} as the tape went on`);
  clean(page);
  await page.context().close();
});

test('a file the machine cannot load changes nothing: a tape with nothing to play, a file too large', ['web/src/ui/deck.ts'], async () => {
  const page = await open();
  await wait(page, 2000);
  await page.mouse.click(5, 300);
  await page.keyboard.press('j');
  await wait(page, 500);
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  // A TZX whose one block is cut short: nothing on it plays.
  await openFile(page, 'broken.tzx', Buffer.from('ZXTape!\x1a\x01\x14\x10\x00\x00\xff\xff', 'latin1'));
  await wait(page, 300);
  await openFile(page, 'huge.tap', Buffer.alloc(17 * 1024 * 1024));
  await wait(page, 300);
  const after = await page.evaluate(() => ({ bottom: window.zx.emulator.screenText().split('\n')[23], loaded: window.zx.emulator.tape.state().loaded, empty: document.querySelector('.deck').classList.contains('empty'), toasts: [...document.querySelectorAll('.toast-error .toast-text')].map((t) => t.textContent), frames: window.zx.emulator.frameCount }));
  assert(after.bottom.startsWith('LOAD') && !after.loaded && after.empty, `after the files: ${JSON.stringify(after)}`);
  assert(after.toasts.length === 2 && /nothing on it|no block that plays/.test(after.toasts[0]) && /larger than any Spectrum file/.test(after.toasts[1]), JSON.stringify(after.toasts));
  clean(page);
  await page.context().close();
});

test('a loader’s stripes drawn calmly when asked: the border one colour while the tape plays; F8 reads the screen; F1 the keys', ['web/src/ui/settings.ts', 'web/src/ui/help.ts'], async () => {
  const page = await open({ storage: { ...SHARP, calmStripes: 'on' } });
  await wait(page, 2000);
  await page.mouse.click(5, 300);
  await page.keyboard.press('F8');
  const read = await page.evaluate(() => document.querySelector('[aria-live].visually-hidden:not(.osd *)')?.textContent ?? '');
  await page.keyboard.press('F1');
  const help = await page.evaluate(() => document.querySelector('dialog.help')?.open && document.querySelector('dialog.help').textContent.includes('Shift+Tab'));
  await page.keyboard.press('Escape');
  await openFile(page, 'test.tap', programTape('PICTURE'));
  assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 250, max: 10_000 }), 'the tape did not start');
  await wait(page, 2000);
  const calm = new Set(await borderColours(page));
  // The machine's own border has the stripes: only the picture is calmed.
  const machine = await page.evaluate(() => {
    const f = window.zx.emulator.frame();
    return new Set(Array.from({ length: 296 }, (_, y) => f[y * 352 + 2])).size;
  });
  assert(read.includes('Sinclair Research'), `the screen read: ${read}`);
  assert(help, 'F1 did not show the keys');
  assert(calm.size === 1 && machine > 1, `the border shown in ${calm.size} colours, the machine's in ${machine}`);
  clean(page);
  await page.context().close();
  return `${calm.size} colour shown of the border's ${machine}`;
});
