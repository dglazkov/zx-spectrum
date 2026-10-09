// The library: the ZXDB searched through ZXInfo, and a shelf of loved games to start from, each a card with its
// loading screen. Choosing one hands it to the page, which fetches the file and loads it.

import featured from '../library/featured.json';
import { choose, Unloadable } from '../library/choose';
import { entryOf, search, type ZxEntry, type ZxHit } from '../library/zxinfo';
import { h } from './dom';
import { icon } from './icons';

export interface Library {
  readonly el: HTMLElement;
  /** Shows a card as loading (0–1), done (null), or failed (a message). */
  progress(id: string, value: number | null | string): void;
}

const SHELF: readonly ZxEntry[] = (featured.entries as ZxHit[]).map(entryOf);

const machineShort = (m: string | null) => (m ?? '').replace(/^ZX-Spectrum\s*/, '').replace('128 ', '');

export function createLibrary(onPick: (entry: ZxEntry) => void): Library {
  const cards = new Map<string, HTMLElement>();

  const card = (entry: ZxEntry): HTMLElement => {
    let why: string | null = null;
    try {
      choose(entry);
    } catch (e) {
      if (e instanceof Unloadable) why = e.message;
      else throw e;
    }
    const picture = entry.screen
      ? h('img', { src: entry.screen, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: (e: Event) => (e.target as HTMLElement).replaceWith(placeholder(entry)) })
      : placeholder(entry);
    const el = h(
      'button',
      { type: 'button', class: `card${why ? ' card-off' : ''}`, 'data-id': entry.id, title: why ?? `Load ${entry.title}` },
      h('div', { class: 'card-picture' }, picture, h('div', { class: 'card-load' }, icon('play'), h('span', {}, why ? 'Not here' : 'Load')), h('div', { class: 'card-bar' })),
      h('div', { class: 'card-text' }, h('div', { class: 'card-title' }, entry.title), h('div', { class: 'card-meta' }, [entry.year, entry.publisher].filter(Boolean).join(' · ') || ' ')),
      entry.machine ? h('span', { class: 'card-machine' }, machineShort(entry.machine)) : null,
    );
    el.addEventListener('click', () => {
      if (!why) onPick(entry);
    });
    cards.set(entry.id, el);
    return el;
  };

  const grid = h('div', { class: 'cards' });
  const heading = h('h3', { class: 'library-heading' }, 'From the shelf');
  const status = h('p', { class: 'library-status', role: 'status' });
  const more = h('button', { type: 'button', class: 'btn more', hidden: true }, 'More');
  const input = h('input', { type: 'search', class: 'search', placeholder: 'Search the ZXDB: Saboteur, Ultimate, 1985…', 'aria-label': 'Search the ZXDB', enterkeyhint: 'search', spellcheck: 'false', autocomplete: 'off' });
  const form = h('form', { class: 'search-form', role: 'search' }, icon('search'), input);

  let query = '';
  let offset = 0;
  let controller: AbortController | null = null;

  const showShelf = () => {
    heading.textContent = 'From the shelf';
    status.textContent = '';
    grid.replaceChildren(...SHELF.map(card));
    more.hidden = true;
  };

  const run = async (text: string, append: boolean) => {
    controller?.abort();
    controller = new AbortController();
    if (!append) {
      offset = 0;
      heading.textContent = `“${text}”`;
      status.textContent = 'Searching…';
      grid.classList.add('waiting');
    }
    try {
      const result = await search(text, { offset, size: 24, signal: controller.signal });
      if (!append) grid.replaceChildren();
      grid.append(...result.entries.map(card));
      offset += result.entries.length;
      status.textContent = result.total ? `${result.total.toLocaleString()} found` : 'Nothing found. ZXDB knows games by their titles, their authors and their publishers.';
      more.hidden = offset >= result.total;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      status.textContent = `The ZXDB could not be reached: ${(e as Error).message}.`;
    } finally {
      grid.classList.remove('waiting');
    }
  };

  let timer = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    query = input.value.trim();
    if (!query) {
      controller?.abort();
      showShelf();
      return;
    }
    timer = window.setTimeout(() => run(query, false), 350);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    query = input.value.trim();
    if (query) run(query, false);
    else showShelf();
  });
  more.addEventListener('click', () => run(query, true));

  const el = h(
    'section',
    { class: 'panel library', 'aria-label': 'Library' },
    h('header', { class: 'panel-head' }, h('h2', {}, 'Library'), h('a', { class: 'panel-note', href: 'https://zxinfo.dk', target: '_blank', rel: 'noopener' }, 'ZXDB · ZXInfo')),
    form,
    heading,
    status,
    grid,
    more,
  );
  showShelf();

  return {
    el,
    progress(id, value) {
      const c = cards.get(id);
      if (!c) return;
      c.classList.toggle('loading', typeof value === 'number');
      c.classList.toggle('failed', typeof value === 'string');
      if (typeof value === 'number') c.style.setProperty('--progress', value.toFixed(3));
      if (typeof value === 'string') c.title = value;
    },
  };
}

/** A card's picture when the archive has none: the title on a Spectrum-ish ground. */
function placeholder(entry: ZxEntry): HTMLElement {
  const hue = [...entry.title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 7;
  return h('div', { class: `card-placeholder p${hue + 1}` }, h('span', {}, entry.title));
}
