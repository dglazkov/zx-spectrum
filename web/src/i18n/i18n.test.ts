import { afterEach, describe, expect, it } from 'vitest';
import { addWords, langOf, language, m, onLanguage, pickLanguage, plural, say, setLanguage, t } from './i18n';

describe('which language the page opens in', () => {
  const pick = (search: string, chosen: string, browser: readonly string[]) => pickLanguage({ search, chosen, browser });

  it('is the one the address asks for, over any chosen before and the browser’s; and it is to be remembered', () => {
    expect(pick('?lang=ru', 'en', ['en-US'])).toEqual({ lang: 'ru', asked: true });
    expect(pick('?game=4293&lang=EN', 'ru', ['ru-RU'])).toEqual({ lang: 'en', asked: true });
    expect(pick('?lang=ru-RU', '', [])).toEqual({ lang: 'ru', asked: true });
  });

  it('is the one chosen before, over the browser’s', () => {
    expect(pick('', 'en', ['ru-RU', 'ru'])).toEqual({ lang: 'en', asked: false });
    expect(pick('', 'ru', ['en-GB'])).toEqual({ lang: 'ru', asked: false });
  });

  it('is the first of the browser’s languages that the page has', () => {
    expect(pick('', '', ['ru-RU', 'ru', 'en-US', 'en'])).toEqual({ lang: 'ru', asked: false });
    expect(pick('', '', ['de-DE', 'ru', 'en'])).toEqual({ lang: 'ru', asked: false });
    expect(pick('', '', ['en-US', 'ru-RU'])).toEqual({ lang: 'en', asked: false });
    expect(pick('', '', ['uk-UA', 'de'])).toEqual({ lang: 'en', asked: false });
  });

  it('is English when nothing says otherwise, and passes over what it does not have', () => {
    expect(pick('', '', [])).toEqual({ lang: 'en', asked: false });
    expect(pick('?lang=fr', 'de', ['fr-FR'])).toEqual({ lang: 'en', asked: false });
    expect(pick('?lang=', '', ['ru'])).toEqual({ lang: 'ru', asked: false });
  });

  it('reads a language tag by its first part, in any case', () => {
    expect(langOf('ru')).toBe('ru');
    expect(langOf('RU-ru')).toBe('ru');
    expect(langOf('en_GB')).toBe('en');
    expect(langOf('rus')).toBeNull();
    expect(langOf('')).toBeNull();
    expect(langOf(null)).toBeNull();
  });
});

describe('the words in a language', () => {
  afterEach(() => setLanguage('en'));
  addWords('ru', {
    'test|Hello': 'Привет',
    'test|{name} is here, {name}': '{name} здесь, {name}',
    'test|{n} apples': (p) => `${p.n} ${plural(Number(p.n), ['яблоко', 'яблока', 'яблок'])}`,
  });

  it('are the English in English, the context left out, the blanks filled', () => {
    expect(t('test|Hello')).toBe('Hello');
    expect(t('test|{name} is here, {name}', { name: 'Willy' })).toBe('Willy is here, Willy');
    expect(t('Not in any catalogue {x}', {})).toBe('Not in any catalogue {x}');
  });

  it('are the translation in the language that has one, with the same blanks filled; English where it has none', () => {
    setLanguage('ru');
    expect(t('test|Hello')).toBe('Привет');
    expect(t('test|{name} is here, {name}', { name: 'Вилли' })).toBe('Вилли здесь, Вилли');
    expect(t('test|{n} apples', { n: 2 })).toBe('2 яблока');
    expect(t('Not translated')).toBe('Not translated');
  });

  it('as a Msg, are said in the language of the moment, each time they are said', () => {
    const msg = m('test|Hello');
    expect(say(msg)).toBe('Hello');
    setLanguage('ru');
    expect(say(msg)).toBe('Привет');
    expect(`${msg}`).toBe('Привет');
    expect(say('a plain string')).toBe('a plain string');
  });

  it('tell whoever listens when the language changes, once a change, and not when it stays', () => {
    const heard: string[] = [];
    const stop = onLanguage((lang) => heard.push(lang));
    setLanguage('ru');
    setLanguage('ru');
    setLanguage('en');
    stop();
    setLanguage('ru');
    expect(heard).toEqual(['ru', 'en']);
    expect(language()).toBe('ru');
  });
});

describe('Russian plurals', () => {
  it('take the form for one, a few or many, as Russian counts', () => {
    const forms: [string, string, string] = ['шаг', 'шага', 'шагов'];
    const cases: [number, string][] = [
      [0, 'шагов'], [1, 'шаг'], [2, 'шага'], [4, 'шага'], [5, 'шагов'], [11, 'шагов'], [12, 'шагов'], [14, 'шагов'],
      [21, 'шаг'], [22, 'шага'], [25, 'шагов'], [101, 'шаг'], [111, 'шагов'], [112, 'шагов'], [122, 'шага'],
    ];
    for (const [n, form] of cases) expect(plural(n, forms), String(n)).toBe(form);
  });
});
