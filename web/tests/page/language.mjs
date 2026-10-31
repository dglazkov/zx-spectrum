// The page test's parts for its language (src/i18n/, docs/russian.md): Russian asked for in the address, or the
// browser's; nothing of the page's own left in English on the Russian page (nor in Russian on the English one); the
// language changed at once from the bar's menu and from Settings, with nothing reloaded and the game left as it was;
// the choice remembered over the browser's; and a phone in Russian. A change here runs only
// these.

import { group } from '../../../crux/chrome/harness.ts';
import { PHONE, assert, open, until, wait } from '../harness.mjs';

const test = group('language', { covers: ['web/src/i18n', 'web/src/library/games', 'web/src/ui', 'web/src/state/settings.ts', 'web/src/fonts/golos-text-cyrillic.woff2'], why: 'what the page shows, in the language it chose' });

/**
 * What the page says in the other language than it speaks: in Russian, each run of three English words or more (the
 * Spectrum's own capitals, as PRESS ANY KEY, are not one; a name in «quotes», a game's or a file's, is a name); in
 * English, any Cyrillic. Every text and every title,
 * aria-label and placeholder is read, shown or not (a panel shut now opens later), but what is marked translate="no":
 * the page's words alone, not a game's title, the manual or the Spectrum's keys.
 */
const otherLanguage = (page) =>
  page.evaluate(() => {
    const ru = document.documentElement.lang === 'ru';
    const pattern = ru ? /\b[A-Za-z][a-z’']+(?:[\s,]+[A-Za-z][a-z’']+){2,}/ : /[А-Яа-яЁё]/;
    const foreign = { test: (text) => pattern.test(ru ? text.replace(/«[^»]*»/g, '') : text) };
    const found = [];
    const mine = (el) => !el.closest('[translate="no"], script, style');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      if (n.parentElement && mine(n.parentElement) && foreign.test(text)) found.push(text.slice(0, 120));
    }
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
      if (!mine(el)) continue;
      for (const name of ['title', 'aria-label', 'placeholder']) {
        const v = el.getAttribute(name);
        if (v && foreign.test(v)) found.push(`${name}: ${v.slice(0, 120)}`);
      }
    }
    return found;
  });

/** What the page shows where a person looks first: the bar, the game's panel, the controls over the screen, Settings. */
const said = (page) =>
  page.evaluate(() => ({
    lang: document.documentElement.lang,
    badge: document.querySelector('.lang-button .lang-badge')?.textContent,
    open: document.querySelector('.tools .btn-label')?.textContent,
    goal: document.querySelector('.game-goal h4')?.textContent,
    blurb: document.querySelector('.game-blurb')?.textContent ?? '',
    overlay: document.querySelector('.controls-overlay .ov-how')?.textContent ?? '',
    settings: document.querySelector('dialog.settings h2')?.textContent,
    search: location.search,
    chosen: JSON.parse(localStorage.getItem('zx-spectrum.settings') ?? '{}').language ?? '',
  }));

/** Saboteur from a link, its panel up and its controls shown over the screen (F3), with Settings open: everything says something. */
async function everythingShowing(page) {
  assert(await until(page, () => !document.querySelector('.panel.game').hidden && document.querySelector('.game-blurb').textContent.length > 0), 'the game’s panel never showed');
  await page.keyboard.press('F3');
  await wait(page, 200);
  await page.click('.tools button:has(.icon-settings)');
  await wait(page, 200);
}

test('in Russian from the address: nothing of the page’s own left in English, the address tidied, the choice kept across a reload', { context: { locale: 'en-US' } }, async ({ page }) => {
  await open(page, { query: '?lang=ru&game=4293' });
  await everythingShowing(page);
  const now = await said(page);
  assert(now.lang === 'ru' && now.badge === 'РУ' && now.open === 'Открыть' && now.goal === 'Ваша цель' && now.settings === 'Настройки', `the page says ${JSON.stringify(now)}`);
  assert(/[А-Яа-я]/.test(now.blurb) && /[А-Яа-я]/.test(now.overlay), `the card and the controls: “${now.blurb.slice(0, 60)}”, “${now.overlay}”`);
  assert(!/lang=/.test(now.search) && /game=4293/.test(now.search) && now.chosen === 'ru', `the address ${now.search}, remembered ${now.chosen}`);
  const english = await otherLanguage(page);
  assert(english.length === 0, `English on the Russian page: ${english.slice(0, 5).join(' | ')}${english.length > 5 ? ` and ${english.length - 5} more` : ''}`);
  // Russian's letters drawn in Golos Text, which the page brings (Archivo has none).
  const golos = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Golos Text' && f.status === 'loaded');
  });
  assert(golos, 'Golos Text was not loaded for the Russian page');
  // Remembered: a reload (the address no longer asks) is Russian still, though the browser's language is English.
  await page.reload();
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  const again = await said(page);
  assert(again.lang === 'ru' && again.badge === 'РУ' && again.open === 'Открыть', `after a reload the page says ${JSON.stringify(again)}`);
  return `${now.goal}; ${now.open}; ${now.overlay.slice(0, 40)}…`;
});

test('opens in the browser’s language, changes at once from the menu and from Settings, and keeps a choice over the browser’s', { context: { locale: 'ru-RU' } }, async ({ page }) => {
  await open(page, { query: '?game=4293' });
  await everythingShowing(page);
  const first = await said(page);
  assert(first.lang === 'ru' && first.goal === 'Ваша цель' && first.chosen === '', `a Russian browser's page says ${JSON.stringify(first)}`);
  // Changed from the bar: the menu, then English; nothing reloaded, the game where it was.
  await page.evaluate(() => (window.stayed = true));
  const frame = await page.evaluate(() => window.zx.emulator.frameCount);
  await page.click('.tools .lang-button');
  const menu = await page.evaluate(() => [...document.querySelectorAll('.lang-menu [data-lang]')].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}`));
  assert(menu.join() === 'ENEnglish:false,РУРусский:true', `the menu shows ${menu}`);
  await page.click('.lang-menu [data-lang="en"]');
  const english = await said(page);
  const kept = await page.evaluate(() => ({ stayed: window.stayed === true, frame: window.zx.emulator.frameCount, title: document.querySelector('.game-title').textContent }));
  assert(kept.stayed && kept.frame >= frame && kept.title === 'Saboteur!', `after the change ${JSON.stringify(kept)}`);
  assert(english.lang === 'en' && english.badge === 'EN' && english.open === 'Open' && english.goal === 'Your goal' && english.settings === 'Settings' && english.chosen === 'en', `in English the page says ${JSON.stringify(english)}`);
  assert(/^You are a ninja/.test(english.blurb) && /arrow keys/.test(english.overlay), `the card and the controls in English: “${english.blurb.slice(0, 40)}”, “${english.overlay}”`);
  const russian = await otherLanguage(page);
  assert(russian.length === 0, `Russian left on the English page: ${russian.slice(0, 5).join(' | ')}`);
  // And back, from Settings' own choice.
  await page.click('dialog.settings .language-choice [data-value="ru"]');
  const back = await said(page);
  assert(back.lang === 'ru' && back.badge === 'РУ' && back.settings === 'Настройки' && /[А-Яа-я]/.test(back.blurb) && back.chosen === 'ru', `back in Russian the page says ${JSON.stringify(back)}`);
  const left = await otherLanguage(page);
  assert(left.length === 0, `English left after changing back: ${left.slice(0, 5).join(' | ')}`);
  // English chosen, in a Russian browser: a reload keeps the choice.
  await page.click('dialog.settings .language-choice [data-value="en"]');
  await page.reload();
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  const chosen = await said(page);
  assert(chosen.lang === 'en' && chosen.open === 'Open', `after a reload, English chosen in a Russian browser, the page says ${JSON.stringify(chosen)}`);
  return `ru → en → ru → en, kept over the browser’s ru-RU`;
});

test('a browser in another language opens it in English', { context: { locale: 'de-DE' } }, async ({ page }) => {
  await open(page);
  const now = await said(page);
  assert(now.lang === 'en' && now.open === 'Open' && now.badge === 'EN', `a German browser's page says ${JSON.stringify(now)}`);
  return 'de-DE: English';
});

test('a phone in Russian: no sideways scroll, the language in Settings', { context: PHONE }, async ({ page }) => {
  await open(page, { query: '?lang=ru&game=4293' });
  await until(page, () => !document.querySelector('.panel.game').hidden);
  await wait(page, 500);
  const fit = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth,
    choose: document.querySelector('.choose-game')?.textContent,
    fire: document.querySelector('.pad-fire')?.textContent,
    bar: getComputedStyle(document.querySelector('.lang-button')).display,
  }));
  assert(fit.scroll <= fit.width, `page ${fit.scroll} px wide in a ${fit.width} px window, in Russian`);
  assert(fit.choose === 'Выбрать игру' && fit.fire === 'ОГОНЬ', `the phone says “${fit.choose}”, “${fit.fire}”`);
  assert(fit.bar === 'none', `the bar's language button on a phone: ${fit.bar}`);
  await page.click('.tools button:has(.icon-settings)');
  await wait(page, 200);
  const choice = await page.evaluate(() => [...document.querySelectorAll('dialog.settings .language-choice [data-value]')].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}`));
  assert(choice.join() === 'English:false,Русский:true', `Settings' language on a phone: ${choice}`);
  return `${fit.scroll} px in ${fit.width} px`;
});
