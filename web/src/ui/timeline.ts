// The rewind strip under the screen: the history kept, a sliver of colour for each moment (the picture's own colours,
// averaged), the newest at the right. Time runs on a scale that gives the last minute most of the strip and the
// minutes before it the rest (a moment eight seconds ago is a finger's width from the right, not a pixel), with ticks
// to read it by. Pressing on it, or dragging along it, shows the picture from that moment; letting go goes back to it.
// Arrow keys move along it (Shift: ten seconds at a time), Enter goes back, Escape leaves it.

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
  /** Shows a moment's picture in place of the machine's (null: the machine's again), and how long ago it was. */
  preview(moment: Moment | null, ago: string): void;
  goBack(index: number): void;
}

/** Seconds of the scale's knee: time under it is spread out, time over it pressed together. */
const KNEE = 20;
/** The strip spans at least this many seconds, so that it does not stretch the first moments across it. */
const MIN_SPAN = 60;

/**
 * Where on the strip a moment `seconds` ago sits, as a share of the strip's width from its right-hand end, with
 * `span` seconds across the whole strip: logarithmic, so that the newest seconds have the room.
 */
export function placeOf(seconds: number, span: number): number {
  const s = Math.max(MIN_SPAN, span);
  return Math.log1p(Math.max(0, seconds) / KNEE) / Math.log1p(s / KNEE);
}

/** And back: how many seconds ago the share `share` of the strip from its right is. */
export function secondsAt(share: number, span: number): number {
  const s = Math.max(MIN_SPAN, span);
  return KNEE * Math.expm1(Math.max(0, Math.min(1, share)) * Math.log1p(s / KNEE));
}

const tints = new WeakMap<Moment, { palette: Uint8Array; rgb: [number, number, number] }>();

/** A moment's colour on the strip: its picture's colours, averaged, in the palette of the day. */
function tint(m: Moment, palette: Uint8Array): [number, number, number] {
  const t = tints.get(m);
  if (t && t.palette === palette) return t.rgb;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  m.colours.forEach((count, c) => {
    r += palette[c * 3] * count;
    g += palette[c * 3 + 1] * count;
    b += palette[c * 3 + 2] * count;
    n += count;
  });
  const rgb: [number, number, number] = n ? [r / n, g / n, b / n] : [0, 0, 0];
  tints.set(m, { palette, rgb });
  return rgb;
}

/** "8 s", "1:05", "10:00". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How much is kept: "40 s kept", "3 min kept". */
function kept(seconds: number): string {
  return seconds < 60 ? `${Math.round(seconds)} s kept` : `${Math.floor(seconds / 60)} min kept`;
}

/** The ticks a strip of `span` seconds is read by. */
const TICKS = [10, 30, 60, 120, 300, 600];

export function createTimeline(hooks: TimelineHooks): Timeline {
  const canvas = h('canvas', { class: 'timeline-strip', height: 28, 'aria-hidden': 'true' });
  const marker = h('div', { class: 'timeline-marker', hidden: true });
  const ticks = h('div', { class: 'timeline-ticks', 'aria-hidden': 'true' });
  const readout = h('span', { class: 'timeline-readout' }, '');
  const track = h('div', { class: 'timeline-track', role: 'slider', tabindex: 0, 'aria-label': 'Go back in time', 'aria-valuemin': 0, 'aria-valuemax': 0, 'aria-valuenow': 0 }, canvas, marker);
  const el = h('div', { class: 'timeline empty' }, h('span', { class: 'timeline-label' }, icon('history'), h('span', {}, 'Rewind')), h('div', { class: 'timeline-body' }, track, ticks), readout);

  /** What the strip shows: its newest moment and how many, its width, and when it was drawn (it is drawn at most four times a second, as moments come thick and fast flat out). */
  let drawn = '';
  let drawnWidth = 0;
  let drawnAt = -Infinity;
  let drawnSpan = 0;
  let choosing = -1;

  const secondsAgo = (m: Moment) => Math.max(0, (hooks.now() - m.frame) / hooks.frameRate());
  const span = () => {
    const first = hooks.moments()[0];
    return first ? secondsAgo(first) : 0;
  };
  const ago = (m: Moment) => {
    const s = secondsAgo(m);
    return s < 1 ? 'now' : `${clock(s)} ago`;
  };

  const drawTicks = (seconds: number) => {
    const shown = TICKS.filter((t) => t <= Math.max(MIN_SPAN, seconds) * 1.001);
    ticks.replaceChildren(
      h('span', { class: 'tick now', style: 'right: 0' }, 'now'),
      ...shown.map((t) => h('span', { class: 'tick', style: `right: ${(placeOf(t, seconds) * 100).toFixed(2)}%` }, t < 60 ? `${t} s` : `${t / 60} min`)),
    );
  };

  const draw = () => {
    const moments = hooks.moments();
    const width = Math.round(track.clientWidth * devicePixelRatio);
    const shows = `${moments.length}:${moments.at(-1)?.frame ?? -1}`;
    if (width === drawnWidth && (shows === drawn || performance.now() - drawnAt < 250)) return;
    drawn = shows;
    drawnWidth = width;
    drawnAt = performance.now();
    canvas.width = Math.max(1, width);
    canvas.height = Math.round(28 * devicePixelRatio);
    const ctx = canvas.getContext('2d');
    el.classList.toggle('empty', moments.length === 0);
    track.setAttribute('aria-valuemax', String(Math.max(0, moments.length - 1)));
    if (choosing < 0) track.setAttribute('aria-valuenow', String(Math.max(0, moments.length - 1)));
    const seconds = span();
    if (Math.abs(seconds - drawnSpan) > 1 || !ticks.childElementCount) {
      drawnSpan = seconds;
      drawTicks(seconds);
    }
    if (choosing < 0) readout.textContent = moments.length ? kept(seconds) : 'Fills as it plays';
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const palette = hooks.palette();
    const W = canvas.width;
    // Each moment from where it was kept to where the next one was (the newest to now).
    let right = W;
    for (let i = moments.length - 1; i >= 0; i--) {
      const m = moments[i];
      const x = W - placeOf(secondsAgo(m), seconds) * W;
      const [r, g, b] = tint(m, palette);
      ctx.fillStyle = `rgb(${r | 0} ${g | 0} ${b | 0})`;
      const w = Math.max(1, right - x);
      ctx.fillRect(Math.floor(x), 0, Math.ceil(w) - (w > 4 ? 1 : 0), canvas.height);
      right = x;
    }
  };

  /** The moment nearest the strip's point at `clientX`. */
  const indexAt = (clientX: number) => {
    const moments = hooks.moments();
    const rect = track.getBoundingClientRect();
    const target = secondsAt((rect.right - clientX) / Math.max(1, rect.width), span());
    let best = moments.length - 1;
    let gap = Infinity;
    moments.forEach((m, i) => {
      const d = Math.abs(secondsAgo(m) - target);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    return Math.max(0, best);
  };

  const choose = (i: number) => {
    const moments = hooks.moments();
    const m = moments[i];
    if (!m) return;
    choosing = i;
    const said = ago(m);
    hooks.preview(m, said);
    const rect = track.getBoundingClientRect();
    marker.hidden = false;
    marker.style.right = `${placeOf(secondsAgo(m), span()) * rect.width}px`;
    readout.textContent = said;
    track.setAttribute('aria-valuenow', String(i));
    track.setAttribute('aria-valuetext', said);
    el.classList.add('choosing');
  };
  const finish = (commit: boolean) => {
    if (choosing < 0) return;
    const i = choosing;
    choosing = -1;
    marker.hidden = true;
    el.classList.remove('choosing');
    hooks.preview(null, '');
    if (commit) hooks.goBack(i);
    drawn = '';
    drawnAt = -Infinity;
    draw();
  };

  track.addEventListener('pointerdown', (e) => {
    if (!hooks.moments().length) return;
    e.preventDefault();
    capture(track, e.pointerId);
    choose(indexAt(e.clientX));
    const move = (ev: PointerEvent) => choose(indexAt(ev.clientX));
    const end = (commit: boolean) => () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', cancel);
      finish(commit);
    };
    const up = end(true);
    const cancel = end(false);
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', cancel);
  });
  track.addEventListener('keydown', (e) => {
    const n = hooks.moments().length;
    if (!n) return;
    const at = choosing < 0 ? n - 1 : choosing;
    // A step is a moment (half a second while playing); with Shift, ten seconds' worth.
    const moments = hooks.moments();
    const tenBack = () => {
      const target = secondsAgo(moments[at]) + 10;
      let i = at;
      while (i > 0 && secondsAgo(moments[i]) < target) i--;
      return i;
    };
    const tenOn = () => {
      const target = secondsAgo(moments[at]) - 10;
      let i = at;
      while (i < n - 1 && secondsAgo(moments[i]) > target) i++;
      return i;
    };
    if (e.key === 'ArrowLeft') choose(e.shiftKey ? tenBack() : Math.max(0, at - 1));
    else if (e.key === 'ArrowRight') choose(e.shiftKey ? tenOn() : Math.min(n - 1, at + 1));
    else if (e.key === 'Home') choose(0);
    else if (e.key === 'End') choose(n - 1);
    else if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  track.addEventListener('blur', () => finish(false));

  return { el, update: draw };
}
