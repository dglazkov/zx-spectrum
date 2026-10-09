// The rewind strip under the screen: a band of the last minute or two, a sliver of colour for each moment kept (the
// picture's own colours, averaged), the newest at the right. Pressing on it, or dragging along it, shows the picture
// from that moment; letting go goes back to it. Arrow keys move along it, Enter goes back, Escape leaves it.

import type { Moment } from '../state/rewind';
import { capture, h } from './dom';
import { icon } from './icons';

export interface Timeline {
  readonly el: HTMLElement;
  /** On each display refresh: draws the strip again if moments were added. */
  update(): void;
}

export interface TimelineHooks {
  moments(): readonly Moment[];
  /** Frames a second, to say how long ago a moment was. */
  frameRate(): number;
  /** Where the machine is now in its history (frames). */
  now(): number;
  /** The palette, 16 × RGB. */
  palette(): Uint8Array;
  /** Shows a moment's picture in place of the machine's (null: the machine's again). */
  preview(moment: Moment | null): void;
  goBack(index: number): void;
}

const tints = new WeakMap<Moment, [number, number, number]>();

function tint(m: Moment, palette: Uint8Array): [number, number, number] {
  let t = tints.get(m);
  if (t) return t;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < m.picture.length; i += 97) {
    const c = (m.picture[i] & 15) * 3;
    r += palette[c];
    g += palette[c + 1];
    b += palette[c + 2];
    n++;
  }
  t = [r / n, g / n, b / n];
  tints.set(m, t);
  return t;
}

export function createTimeline(hooks: TimelineHooks): Timeline {
  const canvas = h('canvas', { class: 'timeline-strip', height: 28, 'aria-hidden': 'true' });
  const marker = h('div', { class: 'timeline-marker', hidden: true });
  const readout = h('span', { class: 'timeline-readout' }, '');
  const track = h('div', { class: 'timeline-track', role: 'slider', tabindex: 0, 'aria-label': 'Go back in time', 'aria-valuemin': 0, 'aria-valuemax': 0, 'aria-valuenow': 0 }, canvas, marker);
  const el = h('div', { class: 'timeline' }, h('span', { class: 'timeline-label' }, icon('history'), h('span', {}, 'Rewind')), track, readout);

  let drawn = -1;
  let drawnWidth = 0;
  let choosing = -1;

  const ago = (m: Moment) => {
    const s = Math.max(0, (hooks.now() - m.frame) / hooks.frameRate());
    return s < 1 ? 'now' : s < 60 ? `${Math.round(s)} s ago` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s ago`;
  };

  const draw = () => {
    const moments = hooks.moments();
    const width = Math.round(track.clientWidth * devicePixelRatio);
    if (moments.length === drawn && width === drawnWidth) return;
    drawn = moments.length;
    drawnWidth = width;
    canvas.width = Math.max(1, width);
    canvas.height = Math.round(28 * devicePixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const keep = 120;
    const slot = canvas.width / keep;
    const palette = hooks.palette();
    moments.forEach((m, i) => {
      const [r, g, b] = tint(m, palette);
      const x = canvas.width - (moments.length - i) * slot;
      ctx.fillStyle = `rgb(${r | 0} ${g | 0} ${b | 0})`;
      ctx.fillRect(Math.round(x), 0, Math.ceil(slot) - (slot > 3 ? 1 : 0), canvas.height);
    });
    track.setAttribute('aria-valuemax', String(Math.max(0, moments.length - 1)));
    track.setAttribute('aria-valuenow', String(Math.max(0, moments.length - 1)));
    el.classList.toggle('empty', moments.length === 0);
    if (choosing < 0) readout.textContent = moments.length ? `${Math.round((moments.length * 50) / hooks.frameRate())} s kept` : '';
  };

  const indexAt = (clientX: number) => {
    const moments = hooks.moments();
    const rect = track.getBoundingClientRect();
    const slot = rect.width / 120;
    const fromRight = Math.floor((rect.right - clientX) / slot);
    return Math.max(0, Math.min(moments.length - 1, moments.length - 1 - fromRight));
  };

  const choose = (i: number) => {
    const moments = hooks.moments();
    const m = moments[i];
    if (!m) return;
    choosing = i;
    hooks.preview(m);
    const rect = track.getBoundingClientRect();
    const slot = rect.width / 120;
    marker.hidden = false;
    marker.style.right = `${(moments.length - 1 - i) * slot}px`;
    marker.style.width = `${Math.max(2, slot)}px`;
    readout.textContent = ago(m);
    track.setAttribute('aria-valuenow', String(i));
    track.setAttribute('aria-valuetext', ago(m));
    el.classList.add('choosing');
  };
  const finish = (commit: boolean) => {
    if (choosing < 0) return;
    const i = choosing;
    choosing = -1;
    marker.hidden = true;
    el.classList.remove('choosing');
    hooks.preview(null);
    if (commit) hooks.goBack(i);
    drawn = -1;
    draw();
  };

  track.addEventListener('pointerdown', (e) => {
    if (!hooks.moments().length) return;
    e.preventDefault();
    capture(track, e.pointerId);
    choose(indexAt(e.clientX));
    const move = (ev: PointerEvent) => choose(indexAt(ev.clientX));
    const up = () => {
      track.removeEventListener('pointermove', move);
      finish(true);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up, { once: true });
    track.addEventListener('pointercancel', () => finish(false), { once: true });
  });
  track.addEventListener('keydown', (e) => {
    const n = hooks.moments().length;
    if (!n) return;
    const at = choosing < 0 ? n - 1 : choosing;
    if (e.key === 'ArrowLeft') choose(Math.max(0, at - 1));
    else if (e.key === 'ArrowRight') choose(Math.min(n - 1, at + 1));
    else if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  track.addEventListener('blur', () => finish(false));

  return { el, update: draw };
}
