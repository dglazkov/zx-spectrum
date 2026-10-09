// The tape deck: a cassette whose reels turn as the tape moves (the tape winding from one to the other, each turning
// as fast as the tape over its radius), a counter, the transport keys, the tape's blocks with the one under the head
// marked, and how tapes load.

import type { Tape, TapeBlock } from '../emulator/emulator';
import type { LoadingStyle } from '../state/settings';
import { segmented } from './controls';
import { h, s } from './dom';
import { icon } from './icons';

export interface Deck {
  readonly el: HTMLElement;
  /** On each display refresh: the reels, the counter, the block under the head. */
  update(): void;
  /** A tape went in, or came out: the list of blocks again, and its name for the label. */
  inserted(name: string | null): void;
  setLoading(style: LoadingStyle): void;
}

const HUB = 12;
const PACK_MAX = 36;
/** Drawing units of tape a second of tape plays (1⅞ inches a second, against the reels' size). */
const TAPE_SPEED = 66;

const LOADING_HINTS: Readonly<Record<LoadingStyle, string>> = {
  authentic: 'In real time, with the sound and the stripes, as it was.',
  accelerated: 'The real signal, played flat out: every loader works, in seconds.',
  instant: 'Standard blocks go straight in; anything else plays flat out.',
};

function kindIcon(b: TapeBlock): string {
  return { header: '▤', data: '▦', turbo: '▧', tone: '∿', pause: '·', stop: '■', group: '›', info: 'i' }[b.kind];
}

function duration(seconds: number): string {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

export function createDeck(tape: () => Tape, onLoading: (style: LoadingStyle) => void, loading: LoadingStyle): Deck {
  // The cassette.
  const svg = s('svg', { class: 'cassette', viewBox: '0 0 300 190', role: 'img', 'aria-label': 'The cassette' });
  svg.append(
    s('defs', {}, s('linearGradient', { id: 'cs-body', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#2c2b31' }), s('stop', { offset: 1, 'stop-color': '#18171b' }))),
    s('rect', { x: 2, y: 2, width: 296, height: 186, rx: 12, fill: 'url(#cs-body)', stroke: '#3b3a41', 'stroke-width': 1.5 }),
    s('rect', { x: 18, y: 14, width: 264, height: 112, rx: 6, fill: '#ece3cf' }),
  );
  ['#e3342b', '#f6c51e', '#4fb447', '#1d9fd8'].forEach((c, i) => svg.append(s('rect', { x: 18, y: 96 + i * 7, width: 264, height: 7, fill: c, opacity: 0.92 })));
  const label = s('text', { x: 30, y: 36, class: 'cs-title' }, 'No tape');
  const side = s('text', { x: 270, y: 36, class: 'cs-side', 'text-anchor': 'end' }, 'A');
  svg.append(label, side);
  svg.append(s('rect', { x: 66, y: 48, width: 168, height: 44, rx: 22, fill: '#121115', stroke: '#2a292e', 'stroke-width': 1.5 }));
  const tapeLine = s('path', { class: 'cs-tape', d: '' });
  const packL = s('circle', { cx: 100, cy: 70, r: PACK_MAX, class: 'cs-pack' });
  const packR = s('circle', { cx: 200, cy: 70, r: HUB, class: 'cs-pack' });
  const reels = s('g', { 'clip-path': 'url(#cs-window)' });
  svg.append(s('clipPath', { id: 'cs-window' }, s('rect', { x: 67, y: 49, width: 166, height: 42, rx: 21 })));
  reels.append(packL, packR, tapeLine);
  svg.append(reels);
  const hub = (cx: number) => {
    const g = s('g', { class: 'cs-hub', transform: `translate(${cx} 70)` });
    g.append(s('circle', { r: HUB - 1, fill: '#f4f1ea' }), s('circle', { r: 6, fill: '#121115' }));
    for (let i = 0; i < 6; i++) g.append(s('rect', { x: -1.6, y: -9.5, width: 3.2, height: 4, fill: '#121115', transform: `rotate(${i * 60})` }));
    svg.append(g);
    return g;
  };
  const hubL = hub(100);
  const hubR = hub(200);
  svg.append(
    s('path', { d: 'M60 188 L74 150 H226 L240 188', fill: '#141317', stroke: '#3b3a41', 'stroke-width': 1.5 }),
    ...[95, 205].map((cx) => s('circle', { cx, cy: 170, r: 5, fill: '#08080a' })),
    ...[
      [14, 14],
      [286, 14],
      [14, 176],
      [286, 176],
    ].map(([cx, cy]) => s('circle', { cx, cy, r: 3.2, fill: '#0c0c0e', stroke: '#45444b' })),
  );

  // The counter and the keys.
  const counter = h('div', { class: 'counter', 'aria-label': 'Tape counter' }, ...[0, 1, 2].map(() => h('span', { class: 'digit' }, '0')));
  const key = (name: string, title: string, act: () => void) => {
    const b = h('button', { type: 'button', class: `deck-key deck-${name}`, title, 'aria-label': title }, icon(name));
    b.addEventListener('click', act);
    return b;
  };
  const playKey = key('play', 'Play', () => tape().play());
  const keys = h(
    'div',
    { class: 'deck-keys' },
    key('rewind', 'Rewind', () => tape().rewind()),
    playKey,
    key('stop', 'Stop', () => tape().stop()),
    key('eject', 'Eject', () => {
      tape().eject();
      deck.inserted(null);
    }),
  );

  const list = h('ol', { class: 'blocks', 'aria-label': 'The blocks on the tape' });
  const empty = h('p', { class: 'deck-empty' }, 'No tape in the deck. Choose a game from the library, or drop a TAP or TZX file anywhere on the page.');
  const styles = segmented<LoadingStyle>(
    'How tapes load',
    [
      { value: 'authentic', label: 'Authentic' },
      { value: 'accelerated', label: 'Accelerated' },
      { value: 'instant', label: 'Instant' },
    ],
    loading,
    (v) => {
      hint.textContent = LOADING_HINTS[v];
      onLoading(v);
    },
    'deck-styles',
  );
  const hint = h('p', { class: 'deck-hint' }, LOADING_HINTS[loading]);

  const el = h(
    'section',
    { class: 'panel deck', 'aria-label': 'Tape deck' },
    h('header', { class: 'panel-head' }, h('h2', {}, 'Tape'), counter),
    h('div', { class: 'cassette-wrap' }, svg),
    keys,
    styles.el,
    hint,
    empty,
    list,
  );

  let rows: HTMLLIElement[] = [];
  let lastBlock = -1;
  let angleL = 0;
  let angleR = 0;
  let lastPosition = 0;

  const deck: Deck = {
    el,
    inserted(name) {
      const blocks = tape().blocks();
      list.replaceChildren();
      rows = blocks.map((b, i) => {
        const li = h('li', { class: `block block-${b.kind}`, title: 'Wind the tape to here' }, h('span', { class: 'block-kind', 'aria-hidden': 'true' }, kindIcon(b)), h('span', { class: 'block-label' }, b.label), h('span', { class: 'block-time' }, duration(b.seconds)), h('span', { class: 'block-progress' }));
        li.addEventListener('click', () => tape().seek(i));
        list.append(li);
        return li;
      });
      empty.hidden = blocks.length > 0;
      label.textContent = name ? name.replace(/\.(zip|tzx|tap)$/gi, '').slice(0, 30) : 'No tape';
      lastBlock = -1;
      deck.update();
    },
    setLoading(style) {
      styles.set(style);
      hint.textContent = LOADING_HINTS[style];
    },
    update() {
      const st = tape().state();
      el.classList.toggle('playing', st.playing);
      playKey.classList.toggle('down', st.playing);
      // The reels: the tape winds from left to right; each turns at the tape's speed over its radius.
      const frac = st.length ? Math.min(1, st.position / st.length) : 0;
      const area = PACK_MAX * PACK_MAX - HUB * HUB;
      const rl = st.loaded ? Math.sqrt(HUB * HUB + (1 - frac) * area) : HUB;
      const rr = st.loaded ? Math.sqrt(HUB * HUB + frac * area) : HUB;
      const moved = (st.position - lastPosition) * TAPE_SPEED;
      lastPosition = st.position;
      if (Math.abs(moved) < 4000) {
        angleL += (moved / rl) * (180 / Math.PI);
        angleR += (moved / rr) * (180 / Math.PI);
      }
      packL.setAttribute('r', rl.toFixed(2));
      packR.setAttribute('r', rr.toFixed(2));
      hubL.setAttribute('transform', `translate(100 70) rotate(${angleL % 360})`);
      hubR.setAttribute('transform', `translate(200 70) rotate(${angleR % 360})`);
      tapeLine.setAttribute('d', st.loaded ? `M${100 - rl} 92 L${100 - rl} 70 M${200 + rr} 70 L${200 + rr} 92` : '');
      const count = String(Math.floor(st.position) % 1000).padStart(3, '0');
      counter.querySelectorAll('.digit').forEach((d, i) => {
        if (d.textContent !== count[i]) d.textContent = count[i];
      });
      // The block under the head, and how far through it.
      if (st.block !== lastBlock) {
        rows[lastBlock]?.classList.remove('current');
        rows[st.block]?.classList.add('current');
        // The list follows the head, and only the list: scrollIntoView would move the page to the deck too, away from
        // the screen being watched (on a phone the deck is below the keyboard).
        const now = rows[st.block];
        if (now && list.clientHeight) {
          const lr = list.getBoundingClientRect();
          const rr = now.getBoundingClientRect();
          if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top;
          else if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom;
        }
        lastBlock = st.block;
      }
      const row = rows[st.block];
      if (row) {
        const blocks = tape().blocks();
        const start = blocks.slice(0, st.block).reduce((t, b) => t + b.seconds, 0);
        const len = blocks[st.block]?.seconds ?? 0;
        const through = len ? Math.max(0, Math.min(1, (st.position - start) / len)) : 0;
        row.style.setProperty('--through', through.toFixed(3));
      }
    },
  };
  return deck;
}
