// The page test's parts for switching on, the picture, the sound, and a machine that stops or will not start. A change
// here runs only these.

import { group } from '../../../crux/chrome/harness.ts';
import { AMSTRAD, SHARP, assert, open, pixel, ready, screen, until, wait, waitReal } from '../harness.mjs';

const picture = group('picture', { covers: ['web/src/video', 'web/src/style.css', 'web/src/fonts'], why: 'what the page draws, in WebGL and on the 2D canvas' });
const sound = group('sound', { covers: ['web/src/audio', 'web/src/clock'], why: 'the page’s sound card, on its own clock' });
const test = group('machine', { covers: ['web/src/keyboard', 'web/src/ui/library.ts', 'web/src/library', 'web/public', 'crux/widget', 'web/src/input/typer.ts'], why: 'the real machine in the page, drawn in WebGL' });

test('becomes ready on the real machine, drawn in WebGL 2', async ({ page }) => {
  await open(page);
  const ready = await page.evaluate(() => ({ emulator: document.body.dataset.emulator, renderer: document.body.dataset.renderer, keys: document.querySelectorAll('.kb-key').length, cards: document.querySelectorAll('.card').length }));
  assert(ready.emulator === 'wasm' && ready.renderer === 'webgl2', JSON.stringify(ready));
  assert(ready.keys === 40, `${ready.keys} keys drawn`);
  assert(ready.cards >= 20, `${ready.cards} cards on the shelf`);
  await wait(page, 2000);
  return `${ready.keys} keys, ${ready.cards} games on the shelf`;
});

test('switches on to the ROM’s copyright: the white border, “© 1982 Sinclair Research Ltd” read from the frame and the canvas', async ({ page }) => {
  await open(page, { storage: SHARP });
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  await wait(page, 3000);
  const text = (await screen(page)).split('\n');
  assert(text[23].startsWith('© 1982 Sinclair Research Ltd'), `the bottom line reads ${JSON.stringify(text[23])}`);
  const border = await pixel(page, 4, 4);
  assert(border.join() === '216,216,216', `border ${border}`);
  // The © at the bottom left of the paper: some of its pixels are ink.
  const ink = await page.evaluate(() => {
    const p = window.zx.renderer.readPixels();
    const scale = p.width / 352;
    let dark = 0;
    for (let y = 232; y < 240; y++)
      for (let x = 48; x < 56; x++) {
        const i = (Math.floor((y + 0.5) * scale) * p.width + Math.floor((x + 0.5) * scale)) * 4;
        if (p.data[i] < 40) dark++;
      }
    return dark;
  });
  assert(ink > 8, `${ink} dark pixels in the © cell`);
  const frames = (await page.evaluate(() => window.zx.emulator.frameCount)) - f0;
  assert(Math.abs(frames - 150) <= 2, `${frames} frames in 3 s of the page's clock`);
  return `${frames} frames in 3 s, border ${border}`;
});

test('the stand-in still runs for tests of the page alone (?emulator=stub)', async ({ page }) => {
  await open(page, { query: '?emulator=stub' });
  await wait(page, 2000);
  const kind = await page.evaluate(() => document.body.dataset.emulator);
  const text = await screen(page);
  assert(kind === 'stub' && text.includes('Sinclair Research'), `${kind}: ${JSON.stringify(text.split('\n')[23])}`);
});

picture('draws the television without errors, and the 2D canvas where there is no WebGL', async ({ page, context }) => {
  await open(page, { storage: { display: 'tv', crop: 'tv' } });
  await wait(page, 2000);
  const centre = await page.evaluate(() => {
    const p = window.zx.renderer.readPixels();
    const i = (Math.floor(p.height / 2) * p.width + Math.floor(p.width / 2)) * 4;
    return [p.data[i], p.data[i + 1], p.data[i + 2]];
  });
  assert(centre[0] > 150, `the television's centre is ${centre}`);
  await page.close();
  const flat = await context.newPage();
  await open(flat, { query: '?renderer=2d', storage: SHARP });
  await wait(flat, 2000);
  const kind = await flat.evaluate(() => document.body.dataset.renderer);
  const border = await pixel(flat, 4, 4);
  assert(kind === 'canvas2d' && border.join() === '216,216,216', `${kind}: border ${border}`);
  return `television centre ${centre}, 2D border ${border}`;
});

picture('the television keeps BRIGHT brighter than normal: no colour clips at the beam', async ({ page }) => {
  // The paper's top half white, its bottom half BRIGHT white (216 and 255 in the palette, 18% apart). A television
  // that lifts its beam's peak past full white shows them alike, and half the palette with them.
  await open(page, { storage: { display: 'tv', crop: 'full', palette: 'ula' } });
  await wait(page, 2500);
  await page.evaluate(() => {
    const e = window.zx.emulator;
    for (let a = 0x4000; a < 0x5800; a++) e.poke(a, 0);
    for (let a = 0x5800; a < 0x5b00; a++) e.poke(a, a < 0x5980 ? 0x38 : 0x78);
  });
  await wait(page, 200);
  const [normal, bright] = await page.evaluate(() => {
    const p = window.zx.renderer.readPixels();
    const band = (y0, y1) => {
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(y0 * p.height); y < y1 * p.height; y++)
        for (let x = Math.floor(0.35 * p.width); x < 0.65 * p.width; x++) {
          const i = (y * p.width + x) * 4;
          sum += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
          n++;
        }
      return sum / n;
    };
    // Frame rows 48–144 are the white half, 144–240 the bright half: well inside each.
    return [band(70 / 296, 125 / 296), band(165 / 296, 220 / 296)];
  });
  assert(bright / normal > 1.08, `normal white ${normal.toFixed(1)}, bright white ${bright.toFixed(1)}: ${((bright / normal - 1) * 100).toFixed(1)}% apart`);
  return `normal ${normal.toFixed(0)}, bright ${bright.toFixed(0)} (${((bright / normal - 1) * 100).toFixed(0)}% apart)`;
});

picture('switching on warms the tube up (a fade where motion is reduced), and the footer says Amstrad’s words', async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => {
    window.warmed = 0;
    new MutationObserver(() => window.zx.renderer.canvas.classList.contains('warming') && window.warmed++).observe(window.zx.renderer.canvas, { attributes: true, attributeFilter: ['class'] });
  });
  await page.locator('button[title="Switch it off and on again"]').click();
  const anim = await page.evaluate(() => ({ warmed: window.warmed, name: getComputedStyle(window.zx.renderer.canvas).animationName }));
  const foot = await page.evaluate(() => document.querySelector('.foot')?.textContent ?? '');
  await page.close();
  const still = await context.newPage();
  await still.emulateMedia({ reducedMotion: 'reduce' });
  await open(still);
  await still.locator('button[title="Switch it off and on again"]').click();
  const reduced = await still.evaluate(() => getComputedStyle(window.zx.renderer.canvas).animationName);
  assert(anim.warmed >= 1 && anim.name === 'warm-up', JSON.stringify(anim));
  assert(reduced === 'warm-fade', `with reduced motion: ${reduced}`);
  assert(foot.includes(AMSTRAD), `the footer: ${foot}`);
  assert(/Spectrum Computing/.test(foot) && /ZXDB/.test(foot), 'the archive is not credited');
  return `${anim.name}; ${reduced}`;
});

sound('sounds once clicked: the worklet plays the frames', async ({ page }) => {
  await open(page, { clock: false });
  const before = await page.evaluate(() => !!window.zx.app.sound);
  await page.locator('.veil').click();
  await waitReal(page, () => window.zx.app.sound?.running && document.body.classList.contains('sound-on'), null, 10_000, 'sound card running');
  const frames0 = await page.evaluate(() => window.zx.emulator.frameCount);
  // Condition, not time: the sound card's clock runs frames until there have been 50 more.
  await waitReal(page, (f) => window.zx.emulator.frameCount > f + 50, frames0, 15_000, '50 frames on the sound card’s clock');
  const led = await page.evaluate(() => window.zx.app.scheduler.audioLed && window.zx.emulator.audio().length > 1500);
  assert(!before && led, `sound before the click: ${before}; frames led by the sound card, with their sound: ${led}`);
});

sound('follows the sound card when it stops and starts again: the display’s clock meanwhile, nothing stale queued', async ({ page }) => {
  await open(page, { clock: false });
  await page.locator('.veil').click();
  await waitReal(page, () => window.zx.app.sound?.running && window.zx.app.scheduler.audioLed, null, 10_000, 'sound card running');
  // The system takes the sound card away (a call, another app): frames go on by the display, silently, and the
  // page asks for sound again on the next gesture.
  await page.evaluate(() => window.zx.app.sound.context.suspend());
  await waitReal(page, () => !window.zx.app.scheduler.audioLed && !document.querySelector('.veil').hidden, null, 10_000, 'move to the display’s clock');
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  await waitReal(page, (f) => window.zx.emulator.frameCount > f + 10, f0, 15_000, '10 frames on the display’s clock');
  await page.locator('.veil').click();
  await waitReal(page, () => window.zx.app.sound.running && window.zx.app.scheduler.audioLed && document.querySelector('.veil').hidden, null, 10_000, 'return to the sound card’s clock');
  // Started afresh: what is queued is what the scheduler has just sent, not what piled up meanwhile.
  const queued = await page.evaluate(() => window.zx.app.scheduler.queued(performance.now()) / window.zx.app.scheduler.samplesPerFrame());
  assert(queued < 8, `${queued.toFixed(1)} frames queued after the sound card came back`);
  return `${queued.toFixed(1)} frames queued on its return`;
});

test('a frame that throws stops the machine and says so; started again, it goes back to the last moment, in a new module', { reports: [/machine stopped/i] }, async ({ page }) => {
  await open(page, { storage: SHARP });
  await wait(page, 3000);
  // The module traps once, in a frame (as it would out of memory): every call into it is refused from then on.
  await page.evaluate(() => {
    const e = window.zx.emulator;
    const x = e.x;
    // The module's exports are frozen: a copy of them, its frame call trapping.
    e.x = {
      ...x,
      zx_run_frame: () => {
        throw new WebAssembly.RuntimeError('unreachable');
      },
    };
  });
  await wait(page, 500);
  const stopped = await page.evaluate(() => ({ broken: window.zx.app.broken, card: !document.querySelector('.screen-card.stopped').hidden, dead: window.zx.emulator.stopped, frames: window.zx.emulator.frameCount }));
  await wait(page, 1000);
  const still = await page.evaluate(() => window.zx.emulator.frameCount);
  assert(stopped.broken && stopped.card && stopped.dead && still === stopped.frames, `after the trap: ${JSON.stringify(stopped)}, frames ${still}`);
  await page.locator('.screen-card.stopped button').click();
  assert(await until(page, () => !window.zx.app.broken && document.querySelector('.screen-card.stopped').hidden, null, { step: 100, max: 5_000 }), 'it did not start again');
  const f0 = await page.evaluate(() => window.zx.emulator.frameCount);
  await wait(page, 1000);
  const after = await page.evaluate(() => ({ frames: window.zx.emulator.frameCount, bottom: window.zx.emulator.screenText().split('\n')[23], alive: !window.zx.emulator.stopped }));
  assert(after.alive && after.frames - f0 >= 45 && after.bottom.includes('Sinclair Research'), JSON.stringify(after));
  return `${after.frames - f0} frames in the second after it started again`;
});

test('when the machine will not start, the page says so with a way to try again, and runs no stand-in', { reports: [/ERR_FAILED/, /Failed to fetch/] }, async ({ page }) => {
  await page.route(/\/zx\.wasm$/, (r) => r.abort('failed'));
  await open(page, { ready: false });
  await page.waitForSelector('body[data-failed]', { state: 'attached' });
  const said = await page.evaluate(() => ({ text: document.querySelector('.fatal')?.textContent ?? '', button: !!document.querySelector('.fatal button'), emulator: document.body.dataset.emulator ?? null }));
  assert(/would not start/.test(said.text) && said.button && said.emulator === null, JSON.stringify(said));
});
