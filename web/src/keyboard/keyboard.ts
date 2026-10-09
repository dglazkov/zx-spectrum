// The 48K's keyboard, drawn: the black case with "sinclair" pressed into its raised back and "ZX Spectrum" printed
// under it, the plate with its green and red legends, the forty grey-blue rubber keys with theirs, and the rainbow
// down the right-hand corner. Every key can be pressed by mouse or touch. CAPS SHIFT and SYMBOL SHIFT latch: tapped,
// they stay down until the next key has been pressed and let go, or until they are tapped again. Keys light when the
// machine has them down, however they got there.
//
// Everything is measured, in key pitches, from a photograph of a 48K from straight above (docs/web.md): the keys'
// faces and rows (GEOMETRY), where each legend sits and how big it is, the logotype's size, the stripe's slope and
// its bands' width. On a phone (under 760 px) it is drawn compact: keys as wide as the case allows and taller than
// they are wide, to press with a thumb, their main legends only. The keys a game uses can be marked (outlined), as
// the overlays some games came with marked them.

import { KEY } from '../emulator/keys';
import { capture, s } from '../ui/dom';
import { ARROWS, COLOUR_NAMES, GEOMETRY, LEGENDS, type KeyLegend } from './legends';

const P = 100; // a key pitch, in drawing units
/** The case is this wide: 0.42 of a pitch either side of the keys. */
export const WIDTH = 1128;
/** Key 1's left edge. */
const X0 = 42;

/** The colours the legends are printed in, as on the case: the colour names in their own colours, lightened to read on black. */
const INK = {
  white: '#f2f0ea',
  green: '#53cf3f',
  red: '#f0442f',
  names: ['#111', '#2f8fe8', '#ff5246', '#e052c8', '#53d33f', '#22b8e6', '#f8c53a', '#f2f0ea'],
};

/** The rainbow, the case's own red, yellow, green and cyan. */
export const STRIPE = ['#e3342b', '#f6c51e', '#4fb447', '#1d9fd8'];

/** How the keyboard is drawn: full, as the case is, or compact for a phone. */
export interface Look {
  readonly compact: boolean;
  readonly keyW: number;
  readonly keyH: number;
  readonly row: number;
  /** The raised back of the case, with the logos. */
  readonly header: number;
  /** The first row of keys. */
  readonly top: number;
  readonly height: number;
}

export function look(compact: boolean): Look {
  const keyW = (compact ? 0.88 : GEOMETRY.keyWidth) * P;
  const keyH = (compact ? 1.3 : GEOMETRY.keyHeight) * P;
  const row = compact ? keyH + 0.14 * P : GEOMETRY.rowPitch * P;
  // The back is 2.2 pitches deep on the case; here it keeps the logos at their size and less of the plain black.
  const header = compact ? 70 : 136;
  // The digits' row is 0.57 of a pitch into the plate, under the colours' names.
  const top = header + (compact ? 24 : 57);
  // Below the last row, 0.7 of a pitch of plate with its red legends.
  const height = top + 3 * row + keyH + (compact ? 30 : 72);
  return { compact, keyW, keyH, row, header, top, height };
}

interface Placed {
  legend: KeyLegend;
  x: number;
  y: number;
  w: number;
}

/** Where each key is, by the measured layout. */
export function layout(l: Look = look(false)): Placed[] {
  const out: Placed[] = [];
  const widen = l.keyW / P - GEOMETRY.keyWidth;
  LEGENDS.forEach((row, r) => {
    let x: number = GEOMETRY.rowStart[r];
    row.forEach((legend, i) => {
      if (r === 3 && i === 1) x = GEOMETRY.zStart;
      const wide = GEOMETRY.wideWidth[legend.key];
      const pitches = wide === undefined ? l.keyW / P : wide + widen;
      out.push({ legend, x: X0 + x * P, y: l.top + r * l.row, w: pitches * P });
      x += 1;
    });
  });
  return out;
}

function text(x: number, y: number, str: string, cls: string, anchor: 'start' | 'middle' | 'end' = 'start', fill?: string): SVGTextElement {
  return s('text', { x, y, class: cls, 'text-anchor': anchor, fill }, str);
}

/** An outlined arrow, as the case prints above 5 to 8, its left edge at x and its middle at y: long and low across, shorter and taller up and down. */
function arrow(x: number, y: number, dir: 'left' | 'down' | 'up' | 'right'): SVGPathElement {
  const across = dir === 'left' || dir === 'right';
  // Pointing right, from its left edge: a shaft and a head.
  const d = across ? 'M0 -2.3 H14 V-5 L22 0 L14 5 V2.3 H0 Z' : 'M-2.6 0 V7 H-6.5 L0 13 L6.5 7 H2.6 V0 Z';
  const transform = across
    ? dir === 'right'
      ? `translate(${x} ${y})`
      : `translate(${x + 22} ${y}) scale(-1 1)`
    : dir === 'down'
      ? `translate(${x + 7} ${y - 6.5})`
      : `translate(${x + 7} ${y + 6.5}) scale(1 -1)`;
  return s('path', { class: 'kb-plate kb-arrow', d, transform, fill: 'none', stroke: INK.white, 'stroke-width': 1.5, 'stroke-linejoin': 'miter' });
}

/** A block graphic (bits: 1 top right, 2 top left, 4 bottom right, 8 bottom left), printed as on the key: a white square, its inked quarters the key's own grey inside a white frame. */
function graphic(x: number, y: number, bits: number, size = 14): SVGGElement {
  const g = s('g', { class: 'graphic' });
  g.append(s('rect', { x, y, width: size, height: size, fill: INK.white }));
  const f = size * 0.13; // the frame
  const q = (size - 2 * f) / 2;
  const quarters: [number, number, number][] = [
    [1, 1, 0],
    [2, 0, 0],
    [4, 1, 1],
    [8, 0, 1],
  ];
  for (const [bit, cx, cy] of quarters) if (bits & bit) g.append(s('rect', { class: 'graphic-ink', x: x + f + cx * q, y: y + f + cy * q, width: q, height: q }));
  return g;
}

/**
 * The "sinclair" pressed into the case: Sinclair's logotype, wide letters of thick square bars, raised in the case's
 * own black and seen by their edges. `h` is the x-height; the letters are 1.6 of it wide, their bars 0.28 of it thick.
 * Its left edge is at x, the top of its x-height at y.
 */
function sinclair(x: number, y: number, h: number): SVGGElement {
  const t = h * 0.28; // a bar
  const w = h * 1.6; // a wide letter
  const gap = h * 0.22;
  const up = h * 0.37; // the i's dots and the l rise this far over the x-height
  const mid = (h - t) / 2;
  const R = (rx: number, ry: number, rw: number, rh: number) => `M${rx} ${ry}h${rw}v${rh}h${-rw}Z`;
  const letters: [string, number][] = [
    [R(0, 0, w * 1.08, t) + R(0, 0, t, mid + t) + R(0, mid, w * 1.08, t) + R(w * 1.08 - t, mid, t, h - mid) + R(0, h - t, w * 1.08, t), w * 1.08], // s
    [R(0, -up, t, t * 0.9) + R(0, 0, t, h), t], // i
    [R(0, 0, w, t) + R(0, 0, t, h) + R(w - t, 0, t, h), w], // n
    [R(0, 0, w, t) + R(0, 0, t, h) + R(0, h - t, w, t), w], // c
    [R(0, -up, t, h + up), t], // l
    [R(0, 0, w, t) + R(w - t, 0, t, h) + R(0, mid, w, t) + R(0, mid, t, h - mid) + R(0, h - t, w, t), w], // a
    [R(0, -up, t, t * 0.9) + R(0, 0, t, h), t], // i
    [R(0, 0, t, h) + R(0, 0, w, t), w], // r
  ];
  const g = s('g', { class: 'sinclair', transform: `translate(${x} ${y})` });
  let cx = 0;
  for (const [d, width] of letters) {
    g.append(s('path', { d, transform: `translate(${cx.toFixed(2)} 0)` }));
    cx += width + gap;
  }
  return g;
}

/** "ZX Spectrum" as the 48K has it printed: upright, light, the Z and X spaced apart. */
function wordmark(x: number, y: number, size: number): SVGTextElement {
  const t = s('text', { x, y, class: 'kb-logo', 'font-size': size });
  t.append(s('tspan', { 'letter-spacing': size * 0.1 }, 'ZX'), ' Spectrum');
  return t;
}

/** The slashed zero the case prints on the 0 key: a 0 with a stroke through it, as the ROM's own font has. */
function slashedZero(x: number, y: number, size: number): SVGGElement {
  const w = size * 0.52;
  const h = size * 0.685;
  return s('g', { class: 'kb-main-group' }, text(x, y, '0', 'kb-main'), s('path', { class: 'kb-slash', d: `M${x + w * 0.2} ${y - h * 0.18} L${x + w * 0.82} ${y - h * 0.82}`, 'stroke-width': size * 0.08 }));
}

export interface KeyboardView {
  readonly el: SVGSVGElement;
  /** Shows whether the machine has key `code` down. */
  light(code: number, down: boolean): void;
  /** Outlines the keys a game uses (none: an empty list). */
  mark(codes: readonly number[]): void;
}

/**
 * The keyboard. `press(code, down)` is called as the person presses and lets go of drawn keys; a latched shift is
 * held across the next key.
 */
export function createKeyboard(press: (code: number, down: boolean) => void): KeyboardView {
  const svg = s('svg', { class: 'zx-keyboard', role: 'group', 'aria-label': 'The ZX Spectrum keyboard' });
  const keys = new Map<number, SVGGElement>();
  const latched = new Set<number>();
  const lit = new Set<number>();
  const held = new Set<number>(); // pressed by the pointer
  let marked = new Set<number>();

  const draw = (l: Look) => {
    // A key held across a redraw would never hear its pointer lift: let it go first.
    for (const code of [...held]) up(code);
    svg.replaceChildren();
    keys.clear();
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${l.height}`);
    svg.classList.toggle('compact', l.compact);
    const defs = s('defs');
    defs.append(
      s('linearGradient', { id: 'kb-case', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#1a191c' }), s('stop', { offset: 0.3, 'stop-color': '#121114' }), s('stop', { offset: 1, 'stop-color': '#0b0a0c' })),
      s('linearGradient', { id: 'kb-key', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#62808a' }), s('stop', { offset: 0.45, 'stop-color': '#527079' }), s('stop', { offset: 1, 'stop-color': '#445e66' })),
      s('linearGradient', { id: 'kb-key-lit', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#94c4d2' }), s('stop', { offset: 1, 'stop-color': '#5d95a6' })),
      s('linearGradient', { id: 'kb-ridge', x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#29282c' }), s('stop', { offset: 0.5, 'stop-color': '#212023' }), s('stop', { offset: 1, 'stop-color': '#1a191c' })),
      s('clipPath', { id: 'kb-clip' }, s('rect', { x: 0, y: 0, width: WIDTH, height: l.height, rx: 22 })),
    );
    svg.append(defs);

    // The case: the raised back with the logos, the plate in front, the rainbow down its corner.
    const body = s('g', { 'clip-path': 'url(#kb-clip)' });
    body.append(s('rect', { x: 0, y: 0, width: WIDTH, height: l.height, rx: 22, fill: 'url(#kb-case)' }));
    body.append(s('rect', { x: 0, y: 0, width: WIDTH, height: l.header, fill: 'url(#kb-ridge)' }));
    body.append(s('rect', { x: 0, y: l.header - 2, width: WIDTH, height: 3, fill: '#040404', opacity: 0.85 }));
    body.append(s('rect', { x: 0, y: l.header + 1, width: WIDTH, height: 1.2, fill: '#3b3a40', opacity: 0.6 }));
    if (l.compact) {
      body.append(sinclair(X0 - 2, 14, 22));
      body.append(wordmark(X0 - 2, 58, 15));
    } else {
      // The logotype 4.2 pitches long and 0.4 of one high, a quarter of a pitch under the case's back edge; the
      // wordmark 1.6 pitches long under it, both from key 1's left edge.
      body.append(sinclair(X0 - 2, 24, 40));
      body.append(wordmark(X0 - 2, 101, 24.5));
    }
    // Four bands, each 0.145 of a pitch across, falling 22° from the upright: the red's edge leaves the case's right
    // side 0.42 of a pitch below the top of the digits, and the bands run down under ENTER and SPACE to the front.
    const slope = 0.398;
    const band = 14.5;
    const y0 = l.top + 0.415 * l.row;
    const ya = y0 - 60;
    const yb = l.height + 10;
    const stripe = s('g', { class: 'kb-stripe' });
    STRIPE.forEach((c, i) => {
      const xa = WIDTH + i * band + slope * (y0 - ya);
      const xb = WIDTH + i * band - slope * (yb - y0);
      stripe.append(s('path', { d: `M${xa} ${ya} H${xa + band} L${xb + band} ${yb} H${xb} Z`, fill: c }));
    });
    body.append(stripe);
    svg.append(body);

    for (const { legend: k, x, y, w } of layout(l)) {
      const code = KEY[k.key];
      const right = x + w;
      const { keyH } = l;
      // What is printed on the plate around the key, each from 0.08 of a pitch in from the key's left edge.
      if (!l.compact) {
        if (k.colour !== undefined || k.capsShifted) {
          if (k.colour !== undefined) {
            const name = COLOUR_NAMES[k.colour];
            if (k.colour === 0) {
              svg.append(s('rect', { class: 'kb-plate', x: x + 5, y: y - 37, width: 54, height: 16, rx: 1, fill: INK.white }));
              svg.append(text(x + 32, y - 24.5, name, 'kb-plate', 'middle', '#111'));
            } else svg.append(text(x + 7, y - 24, name, 'kb-plate', 'start', INK.names[k.colour]));
          }
          const fn = k.capsShifted ?? '';
          if (ARROWS[fn]) svg.append(arrow(x + 8, y - 12.5, ARROWS[fn]));
          else svg.append(text(x + 7, y - 8, fn, 'kb-plate', 'start', INK.white));
        } else if (k.extended) {
          svg.append(text(x + 8, y - 8, k.extended, 'kb-plate', 'start', INK.green));
        }
        if (k.extendedShifted) svg.append(text(x + 9, y + keyH + 13, k.extendedShifted, 'kb-plate', 'start', INK.red));
      }

      // The key.
      const g = s('g', { class: 'kb-key', 'data-code': code, 'data-key': k.key, role: 'button', 'aria-label': k.key, tabindex: -1 });
      g.append(s('rect', { class: 'kb-shadow', x: x + 0.5, y: y + 3.5, width: w - 1, height: keyH, rx: 6 }));
      g.append(s('rect', { class: 'kb-face', x, y, width: w, height: keyH, rx: 6 }));
      g.append(s('rect', { class: 'kb-shine', x: x + 4, y: y + 1.2, width: w - 8, height: 2.6, rx: 1.3 }));
      const legends = s('g', { class: 'kb-legends' });
      const cx = x + w / 2;
      if (l.compact) {
        const mid = y + keyH / 2;
        if (k.key === 'CAPS SHIFT' || k.key === 'SYMBOL SHIFT') {
          const red = k.key === 'SYMBOL SHIFT' ? ' kb-red' : '';
          legends.append(text(cx, mid - 4, k.key.split(' ')[0], `kb-name${red}`, 'middle'), text(cx, mid + 20, 'SHIFT', `kb-name${red}`, 'middle'));
        } else if (k.key === 'ENTER' || k.key === 'SPACE') legends.append(text(cx, mid + 8, k.key, 'kb-name', 'middle'));
        else if (k.key === '0') legends.append(slashedZero(cx - 12, mid + 14, 38));
        else legends.append(text(cx, mid + 14, k.main, 'kb-main', 'middle'));
      } else if (k.key === 'CAPS SHIFT') {
        legends.append(text(cx, y + 22, 'CAPS', 'kb-name', 'middle'), text(cx, y + 41, 'SHIFT', 'kb-name', 'middle'));
      } else if (k.key === 'SYMBOL SHIFT') {
        legends.append(text(cx, y + 22, 'SYMBOL', 'kb-name kb-small kb-red', 'middle'), text(cx, y + 40, 'SHIFT', 'kb-name kb-small kb-red', 'middle'));
      } else if (k.key === 'ENTER') {
        legends.append(text(cx, y + 31, 'ENTER', 'kb-name kb-small', 'middle'));
      } else if (k.key === 'SPACE') {
        legends.append(text(cx, y + 19, 'BREAK', 'kb-fine kb-white', 'middle'), text(cx, y + 43, 'SPACE', 'kb-name kb-big', 'middle'));
      } else if (/^[0-9]$/.test(k.key)) {
        // The digit at the left, the block graphic top right, the symbol under it; 0 is slashed, its _ a long bar.
        if (k.key === '0') legends.append(slashedZero(x + 9, y + 34, 29));
        else legends.append(text(x + 9, y + 34, k.main, 'kb-main'));
        if (k.graphic !== undefined) legends.append(graphic(x + 41, y + 6, k.graphic));
        if (k.symbol === '_') legends.append(s('rect', { class: 'kb-sym', x: x + 33, y: y + 38.5, width: 27, height: 2.2 }));
        else if (k.symbol) legends.append(text(x + 48, y + 40, k.symbol, 'kb-sym', 'middle'));
      } else {
        // The letter top left, its symbol top right in red, its keyword bottom right.
        legends.append(text(x + 6, y + 25, k.main, 'kb-main'));
        // A word (STOP, THEN, AND...) is printed smaller and narrower than a sign, clear of the letter.
        if (k.symbol) legends.append(text(right - 11, y + 22, k.symbol, /^[A-Z]{2,}$/.test(k.symbol) ? 'kb-sym kb-sym-word' : 'kb-sym', 'end'));
        if (k.keyword) legends.append(text(right - 11, y + 43, k.keyword, 'kb-fine kb-white', 'end'));
      }
      g.append(legends);
      svg.append(g);
      keys.set(code, g);
    }
    keys.forEach((g, code) => {
      g.classList.toggle('lit', lit.has(code));
      g.classList.toggle('latched', latched.has(code));
      g.classList.toggle('marked', marked.has(code));
    });
  };

  const isShift = (code: number) => code === KEY['CAPS SHIFT'] || code === KEY['SYMBOL SHIFT'];
  const showLatched = () => keys.forEach((g, code) => g.classList.toggle('latched', latched.has(code)));

  const down = (code: number) => {
    if (isShift(code)) {
      if (latched.has(code)) {
        latched.delete(code);
        press(code, false);
      } else {
        latched.add(code);
        press(code, true);
      }
      showLatched();
      return;
    }
    held.add(code);
    press(code, true);
  };
  const up = (code: number) => {
    if (!held.delete(code)) return;
    press(code, false);
    // A latched shift lasts one key.
    for (const shift of latched) press(shift, false);
    latched.clear();
    showLatched();
  };

  // Compact on a phone, and drawn again when the window crosses that width.
  const narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
  draw(look(!!narrow?.matches));
  narrow?.addEventListener('change', () => draw(look(narrow.matches)));

  svg.addEventListener('pointerdown', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.kb-key');
    if (!g) return;
    e.preventDefault();
    const code = Number(g.dataset.code);
    capture(g, e.pointerId);
    down(code);
    const end = () => {
      g.removeEventListener('pointerup', end);
      g.removeEventListener('pointercancel', end);
      up(code);
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  });
  // No menus or selection from a long press on a key.
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    el: svg,
    light(code, on) {
      if (on) lit.add(code);
      else lit.delete(code);
      keys.get(code)?.classList.toggle('lit', on);
    },
    mark(codes) {
      marked = new Set(codes);
      keys.forEach((g, code) => g.classList.toggle('marked', marked.has(code)));
    },
  };
}
