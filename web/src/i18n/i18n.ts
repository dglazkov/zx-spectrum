// The page's words in the person's language: English, and Russian (ru.ts). What the page says is written in English
// where it is said, and that English is how its translation is found: t('Settings') is 'Настройки' in Russian. Words
// with blanks name them, t('{title} is in the deck.', { title }), and a translation fills the same blanks. The same
// English that means two things says which before a bar: 'Picture' the section, 'crop|Picture' the crop (in English,
// what is after the bar).
//
// The language changes while the page runs, with nothing reloaded: words put on the page as m() (a Msg) follow it by
// themselves (dom.ts's h() binds them), and what a panel works out afresh is worked out again (onLanguage). What is
// not the page's own (a game's title, a file's name, the manual from the archive, the Spectrum's keys) is a plain
// string, never translated, and marked translate="no" where it shows.
//
// Which language: the address's ?lang= (remembered, then taken out of the address), else the one chosen before (in
// Settings or the bar), else the browser's: the first of its languages that the page has, else English.

export type Lang = 'en' | 'ru';
export const LANGUAGES: readonly Lang[] = ['en', 'ru'];

/** Each language's name in itself, and its two letters as the bar shows them. */
export const NAMES: Readonly<Record<Lang, { name: string; short: string }>> = {
  en: { name: 'English', short: 'EN' },
  ru: { name: 'Русский', short: 'РУ' },
};

export type Params = Readonly<Record<string, string | number>>;
/** A translation: the words, with the English's blanks; or, where a number changes the words (Russian plurals), a function. */
export type Entry = string | ((params: Params) => string);

const catalogs: Record<Lang, Map<string, Entry>> = { en: new Map(), ru: new Map() };
let current: Lang = 'en';

/** Words the page says, in English, to be said in the language of the moment. */
export class Msg {
  constructor(
    readonly en: string,
    readonly params?: Params,
  ) {}

  toString(): string {
    return t(this.en, this.params);
  }
}

/** Words as the page holds them: a Msg is the page's own, translated; a string is said as it is. */
export type Words = string | Msg;

function fill(text: string, params: Params | undefined): string {
  return params ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all)) : text;
}

/** The English of a key: what is after its context's bar, if it has one. */
export function englishOf(key: string): string {
  return key.slice(key.indexOf('|') + 1);
}

/** The words in the language of the moment (English where there is no translation). */
export function t(key: string, params?: Params): string {
  const entry = current === 'en' ? undefined : catalogs[current].get(key);
  if (entry === undefined) return fill(englishOf(key), params);
  return typeof entry === 'function' ? entry(params ?? {}) : fill(entry, params);
}

/** Words to be put on the page, which follow the language. */
export function m(key: string, params?: Params): Msg {
  return new Msg(key, params);
}

/** Words said now: a Msg in the language of the moment, a string as it is. */
export function say(words: Words): string {
  return typeof words === 'string' ? words : words.toString();
}

/** A language's translations, added to what it has (each module of cards brings its own). */
export function addWords(lang: Lang, words: Readonly<Record<string, Entry>>): void {
  for (const [key, entry] of Object.entries(words)) catalogs[lang].set(key, entry);
}

/** Every translation a language has, by key: for the tests that hold the catalogue to the page. */
export function wordsOf(lang: Lang): ReadonlyMap<string, Entry> {
  return catalogs[lang];
}

/**
 * Russian's plurals: the form for one (1, 21, 31…), for a few (2–4, 22–24…), and for many (0, 5–20, 25…).
 * plural(3, ['блок', 'блока', 'блоков']) is 'блока'.
 */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const ten = Math.abs(n) % 10;
  const hundred = Math.abs(n) % 100;
  if (ten === 1 && hundred !== 11) return forms[0];
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return forms[1];
  return forms[2];
}

// --- The language of the moment ----------------------------------------------------------------------------------

interface Binding {
  readonly ref: WeakRef<Node>;
  readonly say: (node: Node) => void;
}

/** The page's nodes and attributes that say a Msg, each with how to say it again: kept only while the node is. */
const bound = new Set<Binding>();
const gone = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry<Binding>((b) => bound.delete(b)) : null;
const listeners = new Set<(lang: Lang) => void>();

function bind(node: Node, say: (node: Node) => void): void {
  const b: Binding = { ref: new WeakRef(node), say };
  bound.add(b);
  gone?.register(node, b);
}

export function language(): Lang {
  return current;
}

/** The language changed: every bound word said again, then each panel told, so that what it works out is worked out again. */
export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const b of bound) {
    const node = b.ref.deref();
    if (node) b.say(node);
    else bound.delete(b);
  }
  for (const listener of listeners) listener(lang);
}

/** Called whenever the language changes; returns what stops it. */
export function onLanguage(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A text node of the words, which follows the language when they are a Msg. */
export function textOf(words: Words): Text {
  const node = document.createTextNode(say(words));
  if (words instanceof Msg) bind(node, (n) => (n.textContent = words.toString()));
  return node;
}

/** An attribute of the words (a title, an aria-label, a placeholder), which follows the language when they are a Msg. */
export function setWords(el: Element, name: string, words: Words): void {
  el.setAttribute(name, say(words));
  if (words instanceof Msg) bind(el, (n) => (n as Element).setAttribute(name, words.toString()));
}

// --- Which language ---------------------------------------------------------------------------------------------

/** One of the page's languages, or null: 'ru', 'RU' and 'ru-RU' are Russian. */
export function langOf(tag: string | null | undefined): Lang | null {
  const primary = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (LANGUAGES as readonly string[]).includes(primary) ? (primary as Lang) : null;
}

export interface LanguageSources {
  /** The page's address's query (location.search). */
  readonly search: string;
  /** The language chosen before, as Settings keeps it ('' for none). */
  readonly chosen: string;
  /** The browser's languages, most wanted first (navigator.languages). */
  readonly browser: readonly string[];
}

/**
 * The language the page opens in, and whether it was asked for in the address (then it is remembered as chosen):
 * ?lang= first, then what was chosen before, then the first of the browser's languages the page has, then English.
 */
export function pickLanguage(from: LanguageSources): { lang: Lang; asked: boolean } {
  const asked = langOf(new URLSearchParams(from.search).get('lang'));
  if (asked) return { lang: asked, asked: true };
  const chosen = langOf(from.chosen);
  if (chosen) return { lang: chosen, asked: false };
  for (const tag of from.browser) {
    const lang = langOf(tag);
    if (lang) return { lang, asked: false };
  }
  return { lang: 'en', asked: false };
}
