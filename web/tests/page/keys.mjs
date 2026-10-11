// The page test's parts for the keys: the drawn keyboard, the PC’s, the arrows and the Kempston, and a card’s key map.
// Run by page.mjs on page/harness.mjs; each part covers this file too, so that a change here runs only these.

import { parts, assert, clean, keyLog, open, screen, until, wait } from './harness.mjs';

const test = parts(import.meta.url);

test('the keyboard is laid out as the case: no legend over another, each key’s on its face', ['web/src/keyboard/'], async () => {
  const page = await open();
  const r = await page.evaluate(() => {
    const box = (el) => {
      const b = el.getBBox();
      return { x: b.x, y: b.y, w: b.width, h: b.height, el };
    };
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // The letters' own height, roughly: the font's box less its ascent over the capitals and its descent.
    const ink = (b) => ({ ...b, y: b.y + b.h * 0.18, h: b.h * 0.64 });
    const plate = [...document.querySelectorAll('.zx-keyboard text.kb-plate')].map((el) => ink(box(el)));
    const clashes = [];
    for (let i = 0; i < plate.length; i++) for (let j = i + 1; j < plate.length; j++) if (overlap(plate[i], plate[j])) clashes.push(`${plate[i].el.textContent} × ${plate[j].el.textContent}`);
    // The legends on each key, inside its face (the font's box may stand 2 units over its top), and none over another.
    const off = [];
    for (const key of document.querySelectorAll('.zx-keyboard .kb-key')) {
      const face = box(key.querySelector('.kb-face'));
      const texts = [...key.querySelectorAll('.kb-legends text, .kb-legends .graphic')].map(box);
      for (const t of texts) if (t.x < face.x || t.x + t.w > face.x + face.w || t.y < face.y - 2.5 || t.y + t.h > face.y + face.h + 1) off.push(`${key.dataset.key}: ${t.el.textContent || 'graphic'}`);
      const inked = texts.map(ink);
      for (let i = 0; i < inked.length; i++) for (let j = i + 1; j < inked.length; j++) if (overlap(inked[i], inked[j])) off.push(`${key.dataset.key}: ${inked[i].el.textContent} × ${inked[j].el.textContent || 'graphic'}`);
    }
    return { plate: plate.length, clashes, off };
  });
  assert(r.plate === 76, `${r.plate} legends on the plate (26 letters × 2, 10 digits × 2 and 4 under the colours)`);
  assert(r.clashes.length === 0, `legends over one another: ${r.clashes.join(', ')}`);
  assert(r.off.length === 0, `legends off their keys or over one another: ${r.off.join(', ')}`);
  clean(page);
  await page.context().close();
  return `${r.plate} legends on the plate, none over another`;
});

test('a drawn key presses the key, lit while it is down; a shift latches', ['web/src/keyboard/', 'web/src/input/'], async () => {
  const page = await open();
  await wait(page, 2000);
  const key = page.locator('.kb-key[data-key="J"]');
  await key.scrollIntoViewIfNeeded();
  const box = await key.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await wait(page, 200);
  const lit = await key.evaluate((g) => g.classList.contains('lit'));
  await page.mouse.up();
  await wait(page, 200);
  const log = await keyLog(page);
  assert(lit, 'J is not lit while held');
  assert(log.some(([c, d]) => c === 33 && d) && log.some(([c, d]) => c === 33 && !d), `key log ${JSON.stringify(log)}`);
  // SYMBOL SHIFT, tapped, stays down for the next key.
  await page.locator('.kb-key[data-key="SYMBOL SHIFT"]').click();
  await wait(page, 100);
  const latched = await page.locator('.kb-key[data-key="SYMBOL SHIFT"]').evaluate((g) => g.classList.contains('latched'));
  await page.locator('.kb-key[data-key="P"]').click();
  await wait(page, 200);
  const after = await keyLog(page);
  const symDown = after.findIndex(([c, d]) => c === 36 && d);
  const pDown = after.findIndex(([c, d]) => c === 25 && d);
  assert(latched && symDown >= 0 && pDown > symDown, `latched ${latched}, SYMBOL SHIFT at ${symDown}, P at ${pDown}`);
  // The machine took them: LOAD (J in K mode), then a quote.
  const line = (await screen(page)).split('\n')[23];
  assert(line.startsWith('LOAD "'), `the bottom line reads ${JSON.stringify(line)}`);
  clean(page);
  await page.context().close();
});

test('the PC keyboard types BASIC: j is LOAD, a typed " is SYMBOL SHIFT and P, and the ROM shows LOAD ""', ['web/src/input/'], async () => {
  const page = await open();
  await wait(page, 2000);
  await page.mouse.click(5, 300); // the page, not a field
  await page.keyboard.press('j');
  await wait(page, 300);
  await page.keyboard.press('Shift+Quote');
  await wait(page, 300);
  await page.keyboard.press('Shift+Quote');
  await wait(page, 300);
  const log = await keyLog(page);
  const downs = log.filter(([, d]) => d).map(([c]) => c);
  assert(downs[0] === 33, `first key ${downs[0]}`);
  assert(downs.filter((c) => c === 36).length === 2 && downs.filter((c) => c === 25).length === 2, `downs ${downs}`);
  assert(!downs.includes(0), 'CAPS SHIFT went down for a quote');
  // Read from the screen's memory against the ROM's font, as the ROM drew it.
  const text = await page.evaluate(() => {
    const e = window.zx.emulator;
    let s = '';
    for (let col = 0; col < 7; col++) {
      const cell = 0x4000 | (2 << 11) | (7 << 5) | col;
      const bytes = Array.from({ length: 8 }, (_, i) => e.peek(cell + (i << 8)));
      for (let c = 32; c < 128; c++)
        if (bytes.every((b, i) => e.peek(0x3d00 + (c - 32) * 8 + i) === b)) {
          s += String.fromCharCode(c);
          break;
        }
    }
    return s;
  });
  assert(text === 'LOAD ""', `the bottom line reads ${JSON.stringify(text)}`);
  clean(page);
  await page.context().close();
  return text;
});

test('the page works from the keyboard, and a clicked button does not keep the keys', ['web/src/input/', 'web/src/ui/'], async () => {
  const page = await open();
  await wait(page, 1000);
  await page.mouse.click(5, 300);
  // From the machine, Shift+Tab is the way to the page's controls; there Tab moves on and Enter presses.
  await page.keyboard.press('Shift+Tab');
  const first = await page.evaluate(() => document.activeElement !== document.body);
  const toggle = page.locator('button[title="Show or hide the keyboard"]');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await wait(page, 100);
  const hidden = await page.evaluate(() => document.body.classList.contains('no-keyboard'));
  await page.keyboard.press('Tab');
  const moved = await page.evaluate(() => document.activeElement?.getAttribute('title') !== 'Show or hide the keyboard' && document.activeElement !== document.body);
  // Escape gives the keys back to the machine.
  await page.keyboard.press('Escape');
  const back = await page.evaluate(() => document.activeElement === document.body);
  // Clicked, the button lets go of the focus: Space after it is the machine's SPACE, not a second press.
  await toggle.click();
  await wait(page, 100);
  const shown = await page.evaluate(() => !document.body.classList.contains('no-keyboard') && document.activeElement === document.body);
  await page.keyboard.down('Space');
  await wait(page, 100);
  await page.keyboard.up('Space');
  await wait(page, 200);
  const still = await page.evaluate(() => !document.body.classList.contains('no-keyboard'));
  const space = (await keyLog(page)).some(([c, d]) => c === 35 && d);
  assert(first, 'Shift+Tab from the machine reached no control');
  assert(hidden && moved && back, `Enter on the focused toggle hid the keyboard: ${hidden}; Tab moved on: ${moved}; Escape back to the machine: ${back}`);
  assert(shown && still && space, `after a click: focus let go ${shown}, Space left the button alone ${still}, Space reached the machine ${space}`);
  clean(page);
  await page.context().close();
});

test('the arrows edit a BASIC line until a program loads, then are the joystick', ['web/src/input/'], async () => {
  const page = await open({ storage: { joystick: 'kempston', arrowsJoystick: true, mapping: 'auto' } });
  await wait(page, 1000);
  await page.mouse.click(5, 300);
  await page.keyboard.down('ArrowLeft');
  await wait(page, 200);
  const cursor = await page.evaluate(() => ({ bits: window.zx.emulator.joystickState.bits, down: window.zx.emulator.keyLog.filter((k) => k.down).map((k) => k.code) }));
  await page.keyboard.up('ArrowLeft');
  await wait(page, 200);
  await page.evaluate(() => (window.zx.app.programLoaded = true));
  await page.keyboard.down('ArrowLeft');
  await wait(page, 200);
  const joy = await page.evaluate(() => window.zx.emulator.joystickState.bits);
  // The Kempston port reads it: IN 31 has bit 1 (left) set while it is held.
  const port = await page.evaluate(() => {
    const e = window.zx.emulator;
    // IN A,(31) at 8000h: DB 1F, then HALT.
    [0xdb, 0x1f, 0x76].forEach((b, i) => e.poke(0x8000 + i, b));
    // Mid-frame, where no interrupt comes first.
    e.x.zx_set_tstate(e.h, 20_000);
    e.x.zx_set_register(e.h, 11, 0x8000);
    e.step();
    return e.registers().af >> 8;
  });
  await page.keyboard.up('ArrowLeft');
  // CAPS SHIFT (0) and 5 (19) at BASIC; the joystick's left (2) once a program is in.
  assert(cursor.bits === 0 && cursor.down.includes(0) && cursor.down.includes(19), `at BASIC: joystick ${cursor.bits}, keys down ${cursor.down}`);
  assert(joy === 2 && port === 2, `with a program loaded: joystick ${joy}, IN 31 reads ${port}`);
  clean(page);
  await page.context().close();
});

test('a card’s key map: for a game with no joystick, the arrows and the fire key press its keys, and let them go', ['web/src/input/', 'web/src/ui/touch.ts'], async () => {
  const page = await open({ storage: { joystick: 'kempston', arrowsJoystick: true, mapping: 'auto' } });
  await wait(page, 1000);
  // As a card's key map would put them (Manic Miner's, say): left on O, fire on SPACE.
  await page.evaluate(() => {
    const app = window.zx.app;
    app.programLoaded = true;
    app.padKeys.set({ LEFT: 'O', FIRE: 'SPACE' }, window.zx.emulator.frameCount);
  });
  await page.mouse.click(5, 300);
  const at = () => page.evaluate(() => ({ bits: window.zx.emulator.joystickState.bits, down: window.zx.emulator.keyLog.filter((k) => k.down).map((k) => k.code), up: window.zx.emulator.keyLog.filter((k) => !k.down).map((k) => k.code) }));
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('AltLeft');
  await wait(page, 200);
  const held = await at();
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('AltLeft');
  await wait(page, 200);
  const after = await at();
  // O is key 26 (half-row DFFE, bit 1), SPACE 35; the joystick itself left at rest.
  assert(held.bits === 0 && held.down.includes(26) && held.down.includes(35), `held: ${JSON.stringify(held)}`);
  assert(after.up.includes(26) && after.up.includes(35) && !(await page.evaluate(() => window.zx.app.feeder.isDown(26) || window.zx.app.feeder.isDown(35))), `let go: ${JSON.stringify(after)}`);
  // No key map: the arrows are the joystick again.
  await page.evaluate(() => window.zx.app.padKeys.set(null, window.zx.emulator.frameCount));
  await page.keyboard.down('ArrowLeft');
  await wait(page, 200);
  const joystick = await page.evaluate(() => window.zx.emulator.joystickState.bits);
  await page.keyboard.up('ArrowLeft');
  assert(joystick === 2, `without a key map, left is joystick bit ${joystick}`);
  clean(page);
  await page.context().close();
});

test('the Kempston stays plugged in: IN 31 reads nothing pressed after the power button, a game’s tape and going back', ['web/src/input/'], async () => {
  const page = await open({ query: '?game=4293', storage: { joystick: 'kempston', loading: 'accelerated' } });
  // IN A,(31) at 8000h mid-frame, as a game reads the joystick: 0 with nothing pressed; a port with no interface floats (FF).
  const in31 = () =>
    page.evaluate(() => {
      const e = window.zx.emulator;
      const keep = [0, 1, 2].map((i) => e.peek(0x8000 + i));
      [0xdb, 0x1f, 0x76].forEach((b, i) => e.poke(0x8000 + i, b));
      const pc = e.registers().pc;
      e.x.zx_set_tstate(e.h, 20_000);
      e.x.zx_set_register(e.h, 11, 0x8000);
      e.step();
      const a = e.registers().af >> 8;
      e.x.zx_set_register(e.h, 11, pc);
      keep.forEach((b, i) => e.poke(0x8000 + i, b));
      return a;
    });
  assert(await until(page, () => window.zx.emulator.tape.state().playing, null, { step: 100, max: 10_000 }), 'the tape did not start');
  await wait(page, 200);
  const loading = await in31();
  await page.locator('button[title="Switch it off and on again"]').click();
  await wait(page, 200);
  const afterPower = await in31();
  await page.evaluate(() => window.zx.app.goBack(0));
  await wait(page, 200);
  const afterRewind = await in31();
  assert(loading === 0 && afterPower === 0 && afterRewind === 0, `IN 31: loading ${loading}, after the power button ${afterPower}, after going back ${afterRewind}`);
  clean(page);
  await page.context().close();
});

test('typing <> as two characters gives the Spectrum’s own <>: a line of BASIC with it is taken', ['web/src/input/'], async () => {
  const page = await open();
  await wait(page, 2000);
  await page.mouse.click(5, 300);
  // 10 IF 1<>2 THEN PRINT 1: IF is U in K mode, THEN SYMBOL SHIFT and G (Alt+G), PRINT is P in K mode again.
  for (const ch of '10u') {
    await page.keyboard.type(ch);
    await wait(page, 200);
  }
  for (const ch of '1<>2') {
    await page.keyboard.type(ch);
    await wait(page, 200);
  }
  await page.keyboard.press('Alt+g');
  await wait(page, 300);
  await page.keyboard.type('p1');
  await wait(page, 300);
  await page.keyboard.press('Enter');
  await wait(page, 1000);
  const top = (await screen(page)).split('\n')[0];
  // As the ROM lists it: the line number, the current line's >, and <> one token (typed as < and >, it would be refused).
  assert(/^ *10.IF 1<>2 THEN PRINT 1 *$/.test(top), `the listing reads ${JSON.stringify(top)}`);
  clean(page);
  await page.context().close();
  return top.trim();
});
