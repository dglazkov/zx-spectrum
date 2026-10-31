// The page test's parts for a phone, upright and sideways. A change here runs only these.

import { group } from '../../../crux/chrome/harness.ts';
import { PHONE, assert, open, screen, wait } from '../harness.mjs';

const test = group('phone', { covers: ['web/src/ui/touch.ts', 'web/src/input/gamepad.ts'], why: 'how the page fits a phone, and takes touches' });

test('fits a phone: no sideways scroll, a touch pad that is the joystick', { context: PHONE }, async ({ page }) => {
  await open(page, { query: '?game=4293' });
  await wait(page, 1000);
  const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, pad: getComputedStyle(document.querySelector('.touchpad')).display }));
  assert(fit.scroll <= fit.width, `page ${fit.scroll} px wide in a ${fit.width} px window (with a game's panel)`);
  assert(fit.pad === 'flex', `touch pad display ${fit.pad}`);
  const fire = page.locator('.pad-fire');
  await fire.scrollIntoViewIfNeeded();
  const box = await fire.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  // A tap is a press and a release; hold it instead, through the pointer events a touch makes.
  await fire.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  await wait(page, 100);
  const bits = await page.evaluate(() => window.zx.emulator.joystickState.bits);
  await fire.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  assert(bits === 16, `joystick bits ${bits} with fire held`);
  return `${fit.scroll} px in ${fit.width} px`;
});

test('a phone held sideways is a console: the screen the height of the display, the pad and fire beside it', { context: { ...PHONE, viewport: { width: 844, height: 390 } } }, async ({ page }) => {
  await open(page, { storage: { display: 'tv', crop: 'tv' } });
  await wait(page, 1000);
  const r = await page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const screen = box('.tv-frame');
    const pad = box('.pad');
    const fire = box('.pad-fire');
    return { scroll: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight, screen: [screen.left, screen.right, screen.bottom], pad: [pad.left, pad.right], fire: [fire.left, fire.right] };
  });
  assert(r.scroll <= r.width, `page ${r.scroll} px wide in ${r.width}`);
  assert(r.pad[1] <= r.screen[0] && r.fire[0] >= r.screen[1], `pad ${r.pad}, screen ${r.screen}, fire ${r.fire}`);
  assert(r.screen[2] <= r.height + 1 && r.screen[1] - r.screen[0] > 380, `the screen: ${r.screen} in a window ${r.height} high`);
  return `screen ${Math.round(r.screen[1] - r.screen[0])} px wide, pad and fire beside it`;
});
