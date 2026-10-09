// Messages on the screen itself, in the Spectrum's own font (the 48K ROM's, at 3D00h), as a video recorder put its
// words over the picture: "PAUSED" while the machine waits, and while a moment is chosen on the rewind strip, how long
// ago it was and PREVIEW, over a picture drained a little of its colour. Only these: the page's own controls keep
// their own type.

import romUrl from '../../../roms/48.rom?url';
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

export interface Osd {
  readonly el: HTMLElement;
  /** What the screen says now: nothing, the machine paused, or a moment being previewed (`ago`: "1:05 ago"). */
  show(what: { kind: 'none' } | { kind: 'paused' } | { kind: 'preview'; ago: string }): void;
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
      const code = ch === '◀' ? -1 : ch.charCodeAt(0) - 32;
      const bytes = code === -1 ? REWIND : rom.subarray(code * 8, code * 8 + 8);
      if (code < -1 || code >= 96) return;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) glyph(bytes, col + i, 'rgb(0 0 0 / 0.75)', dx * Math.max(1, scale / 2), dy * Math.max(1, scale / 2));
      glyph(bytes, col + i, colour);
    });
  };

  return {
    el,
    show(what) {
      const key = what.kind === 'preview' ? `preview:${what.ago}` : what.kind;
      if (key === shown) return;
      shown = key;
      el.hidden = what.kind === 'none';
      el.dataset.kind = what.kind;
      document.body.classList.toggle('previewing', what.kind === 'preview');
      live.textContent = what.kind === 'paused' ? 'Paused' : what.kind === 'preview' ? `Rewind preview, ${what.ago}` : '';
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
        if (what.kind === 'paused') write(ctx, rom, 'PAUSED', 13, '#ffffff', scale);
        else {
          const ago = what.ago === 'now' ? '' : `-${what.ago.replace(/ ago$/, '').replace(/ s$/, 's')}`;
          write(ctx, rom, `◀ ${ago}`, 1, '#ffffff', scale);
          write(ctx, rom, 'PREVIEW', 24, '#ffd800', scale);
        }
      });
    },
  };
}
