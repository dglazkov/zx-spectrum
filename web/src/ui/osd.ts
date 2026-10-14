// Messages on the screen itself, in the Spectrum's own font (the 48K ROM's, at 3D00h), as a video recorder put its
// words over the picture: "PAUSED" while the machine waits, and while a moment is chosen on the rewind strip, how long
// ago it was and PREVIEW, over a picture drained a little of its colour. Only these: the page's own controls keep
// their own type. In Russian (ПАУЗА, ПРОСМОТР) the ROM's Latin letters stand in for the Cyrillic ones they look like, as
// the Soviet clones' fonts had it, and the two it has nothing like, П and У, are drawn here in its manner.

import romUrl from '../../../roms/48.rom?url';
import { t } from '../i18n/i18n';
import { h } from './dom';

/** The ROM's character set: 96 characters from the space, 8 bytes each. */
let font: Promise<Uint8Array | null> | null = null;

function loadFont(): Promise<Uint8Array | null> {
  font ??= fetch(romUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => new Uint8Array(b).slice(0x3d00, 0x4000))
    .catch(() => null);
  return font;
}

/** Two arrowheads pointing back, as a recorder's rewind showed it: 8 × 8, as the ROM's characters are. */
const REWIND = [0x00, 0x11, 0x33, 0x77, 0x77, 0x33, 0x11, 0x00];

/** Cyrillic letters the ROM has nothing like, drawn as its capitals are (a column and a row of space on the left and above). */
const DRAWN: Readonly<Record<string, readonly number[]>> = {
  П: [0x00, 0x7e, 0x42, 0x42, 0x42, 0x42, 0x42, 0x00],
  У: [0x00, 0x42, 0x42, 0x42, 0x3e, 0x02, 0x3c, 0x00],
};

/** Cyrillic letters that are the ROM's Latin ones to look at. */
const LOOKALIKE: Readonly<Record<string, string>> = { А: 'A', В: 'B', Е: 'E', З: '3', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x' };

/** A character's 8 × 8 picture: the ROM's, a lookalike's, or one drawn here; null for one the ROM cannot show. */
export function glyphOf(rom: Uint8Array, ch: string): ArrayLike<number> | null {
  if (ch === '◀') return REWIND;
  if (DRAWN[ch]) return DRAWN[ch];
  const code = (LOOKALIKE[ch] ?? ch).charCodeAt(0) - 32;
  return code >= 0 && code < 96 ? rom.subarray(code * 8, code * 8 + 8) : null;
}

export interface Osd {
  readonly el: HTMLElement;
  /** What the screen says now: nothing, the machine paused, or a moment being previewed (`ago`: "1:05 ago", said; `seconds` ago). */
  show(what: { kind: 'none' } | { kind: 'paused' } | { kind: 'preview'; ago: string; seconds: number }): void;
}

export function createOsd(): Osd {
  const canvas = h('canvas', { class: 'osd-text', 'aria-hidden': 'true' });
  const live = h('span', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const el = h('div', { class: 'osd', hidden: true }, canvas, live);
  let shown = '';

  /** Text in the ROM's font onto the canvas, at `x` characters, in `colour`, with a dark edge to read on any picture. */
  const write = (ctx: CanvasRenderingContext2D, rom: Uint8Array, text: string, col: number, colour: string, scale: number) => {
    const glyph = (bytes: ArrayLike<number>, cx: number, fill: string, dx = 0, dy = 0) => {
      ctx.fillStyle = fill;
      for (let row = 0; row < 8; row++)
        for (let bit = 0; bit < 8; bit++) if (bytes[row] & (0x80 >> bit)) ctx.fillRect((cx * 8 + bit + 1) * scale + dx, (row + 1) * scale + dy, scale, scale);
    };
    [...text].forEach((ch, i) => {
      const bytes = glyphOf(rom, ch);
      if (!bytes) return;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) glyph(bytes, col + i, 'rgb(0 0 0 / 0.75)', dx * Math.max(1, scale / 2), dy * Math.max(1, scale / 2));
      glyph(bytes, col + i, colour);
    });
  };

  return {
    el,
    show(what) {
      const key = what.kind === 'preview' ? `preview:${what.ago}:${Math.round(what.seconds)}` : `${what.kind}:${t('PAUSED')}`;
      if (key === shown) return;
      shown = key;
      el.hidden = what.kind === 'none';
      el.dataset.kind = what.kind;
      document.body.classList.toggle('previewing', what.kind === 'preview');
      live.textContent = what.kind === 'paused' ? t('Paused') : what.kind === 'preview' ? t('Rewind preview, {ago}', { ago: what.ago }) : '';
      if (what.kind === 'none') return;
      void loadFont().then((rom) => {
        if (shown !== key || !rom) return;
        // 32 characters across, as the Spectrum's line: at 2 device pixels a Spectrum pixel and more on a big screen.
        const scale = 3;
        canvas.width = (32 * 8 + 2) * scale;
        canvas.height = 10 * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (what.kind === 'paused') {
          const paused = t('PAUSED');
          write(ctx, rom, paused, Math.floor((32 - paused.length) / 2), '#ffffff', scale);
        } else {
          const s = Math.round(what.seconds);
          const ago = what.seconds < 1 ? '' : s < 60 ? `-${s}${t('osd|s')}` : `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          const preview = t('PREVIEW');
          write(ctx, rom, `◀ ${ago}`, 1, '#ffffff', scale);
          write(ctx, rom, preview, 31 - preview.length, '#ffd800', scale);
        }
      });
    },
  };
}
