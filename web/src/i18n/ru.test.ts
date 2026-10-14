// The Russian catalogue (ru.ts) held to the page's code: every phrase the code says through t() or m() (or the few
// helpers that hand theirs on) has its Russian, the catalogue has nothing the code no longer says, each translation
// fills the blanks its English has, and the names Settings lists from other modules (the crops, the colours, the fire
// keys) are there too. The play cards' Russian is held to them in library/card-words.test.ts.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FIRE_KEYS } from '../input/keymap';
import { PALETTES } from '../video/palette';
import { CROPS } from '../video/fit';
import { englishOf, language, setLanguage, t } from './i18n';
import { RU } from './ru';

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** The page's modules: its TypeScript but the tests, the play cards (their own test) and the catalogue. */
function modules(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'games' ? [] : modules(path);
    return /\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name) && !path.endsWith(join('i18n', 'ru.ts')) ? [path] : [];
  });
}

/** A quoted string's text, its escapes undone. */
const unquote = (s: string) => s.replace(/\\(.)/g, '$1');

/**
 * The phrases a module says, by where it says them: the first argument of t(), m() and translate() where it is a
 * quoted string, the sentence a phrase() is given, and both of a slotWords()'s. Comments are passed over (they show
 * how a call looks, not one the page makes).
 */
function phrasesOf(source: string): string[] {
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
  const quoted = String.raw`'((?:[^'\\]|\\.)*)'`;
  const found: string[] = [];
  for (const m of code.matchAll(new RegExp(String.raw`\b(?:t|m|translate)\(\s*${quoted}`, 'g'))) found.push(unquote(m[1]));
  for (const m of code.matchAll(new RegExp(String.raw`\bphrase\([^,]+,\s*${quoted}`, 'g'))) found.push(unquote(m[1]));
  for (const m of code.matchAll(new RegExp(String.raw`\bslotWords\(\s*\w+,\s*${quoted},\s*${quoted}\)`, 'g'))) found.push(unquote(m[1]), unquote(m[2]));
  return found;
}

const said = new Map<string, string>();
for (const path of modules()) for (const phrase of phrasesOf(readFileSync(path, 'utf8'))) if (!said.has(phrase)) said.set(phrase, relative(SRC, path));

/** The names Settings and the controls list from modules that say nothing themselves. */
const LISTED = [...Object.values(CROPS).map((c) => c.name), ...PALETTES.map((p) => p.name), ...FIRE_KEYS.map((k) => k.name)];
/** Of those, the ones that are a key's name as keyboards print it, the same in Russian. */
const AS_PRINTED = new Set(['Tab', 'Enter', 'Z', 'M']);

const CYRILLIC = /[А-Яа-яЁё]/;
const blanks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the Russian catalogue', () => {
  afterEach(() => setLanguage('en'));

  it('finds what the page says, in the places it says it', () => {
    // The scanner, held to known calls: if it reads nothing, every check below passes for nothing.
    expect(said.size).toBeGreaterThan(300);
    expect(said.get('Settings')).toBe('app.ts');
    expect(said.get('crop|Picture')).toBe(join('ui', 'settings.ts'));
    expect(said.has('Saved in the quick slot.') && said.has('Saved in slot {n}.')).toBe(true);
    expect(said.has('{how}, overnight, by a team of agents, and how we know it is faithful.')).toBe(true);
    expect(phrasesOf("// t('in a comment')\nconst a = t('said', { n }); m('also \\'quoted\\'');")).toEqual(['said', "also 'quoted'"]);
  });

  it('has the Russian of every phrase the page says', () => {
    const missing = [...said].filter(([key]) => RU[key] === undefined).map(([key, where]) => `${where}: ${key}`);
    expect(missing, `no Russian for:\n${missing.join('\n')}`).toEqual([]);
  });

  it('has the Russian of every name Settings lists from elsewhere', () => {
    const missing = LISTED.filter((name) => RU[name] === undefined && !AS_PRINTED.has(name));
    expect(missing).toEqual([]);
  });

  it('has nothing the page no longer says', () => {
    const listed = new Set(LISTED);
    expect(Object.keys(RU).filter((key) => !said.has(key) && !listed.has(key))).toEqual([]);
  });

  it('fills each phrase’s blanks, and is Russian', () => {
    setLanguage('ru');
    const wrong: string[] = [];
    for (const [key, entry] of Object.entries(RU)) {
      const english = englishOf(key);
      const wanted = blanks(english);
      if (typeof entry === 'string') {
        if (blanks(entry).join() !== wanted.join()) wrong.push(`${key}: its blanks are {${wanted.join('}, {')}}, the Russian’s {${blanks(entry).join('}, {')}}`);
      } else {
        // A function of the blanks: given each (a count as a number, which its plural needs), it says each, and leaves
        // none unfilled.
        const counts = new Set(['n', 'blocks', 'count']);
        const given = (name: string) => (counts.has(name) ? '3' : `«${name}»`);
        const out = t(key, Object.fromEntries([...wanted, 'count'].map((name) => [name, given(name)])));
        for (const name of wanted) if (!out.includes(given(name))) wrong.push(`${key}: leaves out {${name}}`);
        if (/\{\w+\}/.test(out)) wrong.push(`${key}: leaves a blank in “${out}”`);
      }
      const russian = t(key, Object.fromEntries(wanted.map((name) => [name, 1])));
      if (!CYRILLIC.test(russian) && !/^\{\w+\}$/.test(english)) wrong.push(`${key}: “${russian}” is not Russian`);
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('says Russian plurals as Russian counts them', () => {
    setLanguage('ru');
    expect(t('{n} steps', { n: 1 })).toBe('1 шаг');
    expect(t('{n} steps', { n: 3 })).toBe('3 шага');
    expect(t('{n} steps', { n: 11 })).toBe('11 шагов');
    expect(t('{n} steps', { n: 22 })).toBe('22 шага');
    expect(t('SAVE recorded {blocks} blocks, {bytes} bytes', { blocks: 5, bytes: '1,024' })).toBe('SAVE записал 5 блоков, байт: 1,024');
  });

  it('is said only in Russian: English is the English', () => {
    expect(language()).toBe('en');
    expect(t('Settings')).toBe('Settings');
    expect(t('crop|Picture')).toBe('Picture');
    setLanguage('ru');
    expect(t('Settings')).toBe('Настройки');
    expect(t('crop|Picture')).toBe('Кадр');
    expect(t('Picture')).toBe('Изображение');
  });
});
