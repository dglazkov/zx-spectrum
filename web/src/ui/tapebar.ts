// The tape, where the eye is: while a tape plays, a slim bar under the screen says what is loading, which part of
// how many, and how long is left, on a bar split into the tape's parts; and offers to load the rest fast, for this
// tape only, without losing the picture (the stripes and the loading screen still come in, flat out). The deck in the
// side column has the rest (and on a phone it is screens away).

import type { Tape, TapeBlock } from '../emulator/emulator';
import { blockLabel } from './deck';
import { m, onLanguage, t } from '../i18n/i18n';
import { h, s } from './dom';
import { icon } from './icons';

export interface TapeBar {
  readonly el: HTMLElement;
  /** Whether it is showing (the page makes room for it under the screen). */
  readonly shown: boolean;
  /** On each refresh: shown while the tape plays (or the machine is about to play it), and where it is. */
  update(o: { title: string; loading: boolean; fast: boolean; style: 'authentic' | 'accelerated' | 'instant' }): void;
}

/** "2:21", "45 s". */
function left(seconds: number): string {
  const s0 = Math.max(0, Math.round(seconds));
  return s0 < 60 ? t('{n} s', { n: s0 }) : `${Math.floor(s0 / 60)}:${String(s0 % 60).padStart(2, '0')}`;
}

/** What a block is, said plainly for the bar. */
function partName(b: TapeBlock | undefined): string {
  if (!b) return '';
  if (b.kind === 'header') {
    const header = /^(Program|Bytes|Number array|Character array): ?(.*)$/i.exec(b.label);
    if (!header) return b.label;
    const name = header[2].trim();
    switch (header[1].toLowerCase()) {
      case 'program':
        return t('program {name}', { name }).trim();
      case 'bytes':
        return t('bytes {name}', { name }).trim();
      case 'number array':
        return t('number array {name}', { name }).trim();
      default:
        return t('character array {name}', { name }).trim();
    }
  }
  if (/\b6912\b/.test(b.label) || b.bytes === 6912 || b.bytes === 6914) return t('the loading screen');
  if (b.kind === 'data') return t('{n} bytes', { n: (b.bytes ?? 0).toLocaleString() });
  if (b.kind === 'turbo') return t('the game, by its own loader');
  if (b.kind === 'tone') return t('a tone');
  return blockLabel(b.label);
}

export function createTapeBar(tape: () => Tape, onFast: () => void): TapeBar {
  const reels = s('svg', { class: 'tb-reels', viewBox: '0 0 40 24', 'aria-hidden': 'true' });
  reels.append(
    s('rect', { x: 1, y: 3, width: 38, height: 18, rx: 4, class: 'tb-shell' }),
    ...[12, 28].map((cx) => s('g', { class: 'tb-reel', style: `transform-origin: ${cx}px 12px` }, s('circle', { cx, cy: 12, r: 5.2 }), s('path', { d: `M${cx} 7.6v2.4M${cx} 14v2.4M${cx - 4.4} 12h2.4M${cx + 2} 12h2.4` }))),
  );
  const title = h('strong', { class: 'tb-title', translate: 'no' });
  const part = h('span', { class: 'tb-part' });
  const status = h('span', { class: 'tb-status' });
  const bar = h('div', { class: 'tb-bar', role: 'progressbar', 'aria-label': m('How much of the tape has played'), 'aria-valuemin': 0, 'aria-valuemax': 100 });
  const fast = h('button', { type: 'button', class: 'btn btn-primary tb-fast', title: m('Load the rest of this tape flat out: its stripes and its screen still come in') }, icon('forward'), h('span', { class: 'btn-label' }, m('Load it fast')));
  fast.addEventListener('click', onFast);
  const el = h('div', { class: 'tapebar', hidden: true, 'aria-label': m('The tape loading') }, reels, h('div', { class: 'tb-text' }, h('div', { class: 'tb-line' }, title, part), status, bar), fast);

  let blocksOf: readonly TapeBlock[] = [];
  let segments: HTMLElement[] = [];
  let starts: number[] = [];
  /** How far through each part the bar shows it (only the parts that change are touched). */
  let shownThrough: string[] = [];
  /** The parts that play, counted up to each block. */
  let playingUpTo: number[] = [];
  /** What it was last told, to say again at once in another language (not a frame later). */
  let last: Parameters<TapeBar['update']>[0] | null = null;

  const bar_: TapeBar = {
    el,
    get shown() {
      return !el.hidden;
    },
    update(o) {
      last = o;
      const st = tape().state();
      const show = st.loaded && (st.playing || o.loading) && st.length > 0;
      el.hidden = !show;
      if (!show) return;
      const blocks = tape().blocks();
      if (blocks !== blocksOf) {
        blocksOf = blocks;
        // The parts that play, each as wide as it lasts, and where each starts (a prefix sum, once).
        starts = [];
        let t = 0;
        for (const b of blocks) {
          starts.push(t);
          t += b.seconds;
        }
        const total = Math.max(1e-9, t);
        segments = blocks.map((b) => h('span', { class: 'tb-seg', style: `flex-grow: ${(b.seconds / total).toFixed(5)}` }, h('span', { class: 'tb-fill' })));
        bar.replaceChildren(...segments);
        shownThrough = blocks.map(() => '');
        let n = 0;
        playingUpTo = blocks.map((b) => (n += b.seconds > 0 ? 1 : 0));
      }
      el.classList.toggle('playing', st.playing);
      el.classList.toggle('fast', o.fast);
      const parts = playingUpTo.at(-1) ?? 0;
      const index = playingUpTo[Math.min(st.block, blocks.length - 1)] ?? parts;
      const text = (el: HTMLElement, words: string) => {
        if (el.textContent !== words) el.textContent = words;
      };
      text(title, o.title);
      text(part, partName(blocks[st.block]) ? ` · ${partName(blocks[st.block])}` : '');
      const said = { part: Math.max(1, Math.min(index, parts)), parts, left: left(st.length - st.position) };
      text(status, o.fast ? t('Part {part} of {parts} · {left} left, loading fast', said) : t('Part {part} of {parts} · {left} left', said));
      segments.forEach((seg, i) => {
        const len = blocks[i]?.seconds ?? 0;
        const through = (len ? Math.max(0, Math.min(1, (st.position - starts[i]) / len)) : st.position >= starts[i] ? 1 : 0).toFixed(3);
        if (shownThrough[i] !== through) {
          shownThrough[i] = through;
          seg.style.setProperty('--through', through);
        }
      });
      bar.setAttribute('aria-valuenow', String(Math.round((100 * st.position) / Math.max(1e-9, st.length))));
      fast.hidden = o.fast || o.style !== 'authentic';
    },
  };
  onLanguage(() => last && bar_.update(last));
  return bar_;
}
