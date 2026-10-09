// The game in the machine: its cassette's inlay and what ZXDB says of it, a link to share that loads it straight
// away, how to start it (the steps with their keys as keycaps, and, where the page knows the way, a button that takes
// it from its first screen to playing), its keys as the manual sets them out, save slots of its own, and the whole
// manual to read, set as a booklet.

import type { Manual } from '../library/manual';
import type { StartChoice, StartRoute } from '../library/start';
import type { Slot } from '../state/saves';
import { SLOTS, THUMB_HEIGHT, THUMB_WIDTH } from '../state/saves';
import { FRAME_HEIGHT, FRAME_WIDTH } from '../emulator/emulator';
import { segmented } from './controls';
import { h } from './dom';
import { icon } from './icons';

export interface GameInfo {
  /** The saves' key: `zxdb:<id>`, `file:<name>`, ... */
  readonly key: string;
  readonly title: string;
  /** "1985 · Durell Software Ltd · 48K" */
  readonly meta: string;
  /** The inlay's picture, as an address to show. */
  readonly inlay: string | null;
  /** The address that loads it straight away (a ZXDB entry's), to share. */
  readonly share: string | null;
  /** How to start it, where the page knows (library/start.ts). */
  readonly route: StartRoute | null;
  /** ZXDB's controls: "Kempston Joystick", ... */
  readonly controls: readonly string[];
  /** Whether it has a manual to fetch. */
  readonly hasManual: boolean;
  /** The joystick is the likelier way to play here (a touch screen: the pad is the joystick). */
  readonly joystickFirst: boolean;
}

/** Where starting the game stands: its first screen not there yet, there, asked for and waiting for it, being driven, begun, or not managed. */
export type StartState = 'waiting' | 'ready' | 'armed' | 'driving' | 'done' | 'gave up';

export interface GamePanel {
  readonly el: HTMLElement;
  show(game: GameInfo | null): void;
  /** The manual: coming, here, or not to be had (a message). */
  manual(manual: 'loading' | Manual | string): void;
  /** The game's save slots (null: empty), and the palette to draw their pictures in. */
  slots(slots: readonly (Slot | null)[], palette: Uint8Array): void;
  /** Where starting the game stands, for its button. */
  startState(state: StartState): void;
}

export interface GameHooks {
  save(slot: number): void;
  load(slot: number): void;
  share(): void;
  /** Drive the game from its first screen to playing, as chosen. */
  start(choice: StartChoice): void;
}

const SLOT_NAMES = ['Quick', 'Slot 1', 'Slot 2', 'Slot 3'];

/** A slot's picture: the paper and a little border, small, through the palette (a whole frame from an older page, sampled). */
function thumbnail(picture: Uint8Array, palette: Uint8Array): HTMLCanvasElement {
  const w = THUMB_WIDTH;
  const hgt = THUMB_HEIGHT;
  const canvas = h('canvas', { width: w, height: hgt, class: 'slot-picture', 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, hgt);
  const whole = picture.length === FRAME_WIDTH * FRAME_HEIGHT;
  for (let y = 0; y < hgt; y++)
    for (let x = 0; x < w; x++) {
      const index = whole ? picture[Math.min(FRAME_HEIGHT - 1, 32 + y * 3 + 1) * FRAME_WIDTH + Math.min(FRAME_WIDTH - 1, 32 + x * 3 + 1)] : picture[y * w + x];
      const c = (index & 15) * 3;
      const i = (y * w + x) * 4;
      img.data[i] = palette[c];
      img.data[i + 1] = palette[c + 1];
      img.data[i + 2] = palette[c + 2];
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function when(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

/** A key as a keycap: 'any' reads "any key". */
function keycap(name: string): HTMLElement {
  return h('kbd', { class: `keycap${name.length > 2 ? ' wide' : ''}` }, name === 'any' ? 'any key' : name);
}

/** Text with each named key in it (as the route's steps name them) set as a keycap. */
function withKeycaps(text: string, keys: readonly string[]): (Node | string)[] {
  const out: (Node | string)[] = [];
  const names = keys.filter((k) => k !== 'any');
  const pattern = names.length ? new RegExp(`(?<![A-Za-z0-9])(${names.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9])`, 'g') : null;
  let last = 0;
  if (pattern)
    for (const m of text.matchAll(pattern)) {
      out.push(text.slice(last, m.index));
      out.push(keycap(m[0]));
      last = (m.index ?? 0) + m[0].length;
    }
  out.push(text.slice(last));
  if (keys.includes('any')) out.push(' ', keycap('any'));
  return out;
}

/**
 * A table of keys as the manual lays it out, a line a row: a row too long for the panel wraps under its last column
 * (a hanging indent), not back at the margin, where it would read as a row of its own. Tabs are expanded first, so
 * that the columns are counted as they are seen.
 */
function bookletTable(lines: readonly string[]): HTMLElement {
  const rows = lines.map((raw) => {
    let line = '';
    for (const c of raw) line += c === '\t' ? ' '.repeat(8 - (line.length % 8)) : c;
    const last = [...line.matchAll(/\s{2,}(?=\S)/g)].pop();
    const at = last ? (last.index ?? 0) + last[0].length : 0;
    // A last column far to the right would leave the wrapped text a sliver: hang it under the second instead.
    const second = line.search(/\s{2,}\S/);
    const hang = at <= 26 ? at : second >= 0 ? line.slice(second).search(/\S/) + second : 0;
    return h('span', { class: 'booklet-row', style: `--hang: ${Math.min(hang, 26)}ch` }, line);
  });
  return h('pre', { class: 'booklet-table' }, ...rows);
}

/** The manual set as a booklet: its headings (lines in capitals, or underlined) as headings, its paragraphs as paragraphs, tables of keys kept as they are laid out. */
export function booklet(text: string): HTMLElement[] {
  const lines = text.split('\n');
  const out: HTMLElement[] = [];
  let para: string[] = [];
  let pre: string[] = [];
  const flush = () => {
    if (para.length) out.push(h('p', {}, para.join(' ').replace(/\s+/g, ' ').trim()));
    if (pre.length) out.push(bookletTable(pre));
    para = [];
    pre = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const next = lines[i + 1] ?? '';
    if (!t) {
      flush();
      continue;
    }
    if (/^[-=_*]{3,}$/.test(t)) continue;
    const underlined = /^\s*[-=_]{3,}\s*$/.test(next) && t.length <= 60;
    const capitals = t.length <= 48 && /^[A-Z0-9 &'’/:(),.!-]+$/.test(t) && /[A-Z]{3}/.test(t);
    if (underlined || capitals) {
      flush();
      out.push(h('h5', {}, t.replace(/\b([A-Z])([A-Z']+)\b/g, (_, a: string, b: string) => a + b.toLowerCase())));
      continue;
    }
    // A line set out in columns (keys and what they do) keeps its layout.
    if (/\S\s{3,}\S/.test(line) || /\.{3,}/.test(line)) {
      if (para.length) {
        out.push(h('p', {}, para.join(' ').replace(/\s+/g, ' ').trim()));
        para = [];
      }
      pre.push(line.replace(/\s+$/, ''));
      continue;
    }
    if (pre.length) {
      out.push(bookletTable(pre));
      pre = [];
    }
    para.push(t);
  }
  flush();
  return out;
}

export function createGamePanel(hooks: GameHooks): GamePanel {
  const inlay = h('img', { class: 'game-inlay', alt: '', decoding: 'async', hidden: true });
  inlay.addEventListener('error', () => (inlay.hidden = true));
  const title = h('h3', { class: 'game-title' });
  const meta = h('p', { class: 'game-meta' });
  const controls = h('p', { class: 'game-controls' });
  const share = h('button', { type: 'button', class: 'btn', title: 'A link that loads this game straight away' }, icon('share'), h('span', { class: 'btn-label' }, 'Share'));
  share.addEventListener('click', () => hooks.share());

  // Starting it.
  const steps = h('ol', { class: 'start-steps' });
  let skill = 1;
  const skillSelect = h('select', { class: 'select skill', 'aria-label': 'Skill level' });
  skillSelect.addEventListener('change', () => (skill = Number(skillSelect.value)));
  let joystick = false;
  const how = segmented<'keys' | 'joystick'>(
    'Play with',
    [
      { value: 'keys', label: 'Keys', title: 'The game’s own keys' },
      { value: 'joystick', label: 'Joystick', title: 'The arrow keys and Left Alt, a gamepad, or the touch pad' },
    ],
    'keys',
    (v) => (joystick = v === 'joystick'),
    'start-how',
  );
  const startButton = h('button', { type: 'button', class: 'btn btn-primary start-go' }, icon('play'), h('span', { class: 'btn-label' }, 'Start the mission'));
  startButton.addEventListener('click', () => hooks.start({ joystick, skill }));
  const startStatus = h('p', { class: 'start-status', role: 'status' });
  const starter = h('div', { class: 'start-row' }, startButton, h('label', { class: 'skill-label' }, 'Skill ', skillSelect), how.el);
  const start = h('div', { class: 'game-start' }, h('h4', {}, 'To start'), starter, startStatus, steps);
  const keys = h('div', { class: 'game-keys' });
  const text = h('div', { class: 'manual-text booklet' });
  const manualStatus = h('p', { class: 'manual-status' });
  const manual = h('details', { class: 'manual' }, h('summary', {}, 'The manual'), manualStatus, text);
  const slotRow = h('div', { class: 'slots', role: 'group', 'aria-label': 'Save slots' });

  const el = h(
    'section',
    { class: 'panel game', 'aria-label': 'The game', hidden: true },
    h('header', { class: 'panel-head' }, h('h2', {}, 'Now playing'), share),
    h('div', { class: 'game-top' }, inlay, h('div', { class: 'game-facts' }, title, meta, controls)),
    start,
    keys,
    h('div', { class: 'slots-head' }, h('span', {}, 'Saves'), h('span', { class: 'slots-hint' }, 'F2 saves the quick slot, F4 loads it')),
    slotRow,
    manual,
  );

  let routeKeys: readonly { key: string; does: string }[] = [];
  let joystickText = '';
  /** A slot whose Save was pressed once, waiting for a second press to replace what is in it. */
  let armed = -1;
  let armedTimer = 0;

  const showKeys = (table: Manual['table']) => {
    if (routeKeys.length) {
      keys.replaceChildren(h('h4', {}, 'Keys'), h('div', { class: 'key-tiles' }, ...routeKeys.map((k) => h('div', { class: 'key-tile' }, keycap(k.key), h('span', {}, k.does)))));
      if (joystickText) keys.append(h('p', { class: 'key-joystick' }, icon('joystick'), joystickText));
      return;
    }
    keys.replaceChildren(
      ...(table
        ? [
            h('h4', {}, `Keys, from the manual’s “${table.heading.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase())}”`),
            h('table', { class: 'keys-table' }, h('tbody', {}, ...table.rows.map((r) => h('tr', {}, h('th', {}, r[0]), h('td', {}, r.slice(1).join(' · ')))))),
          ]
        : []),
    );
  };

  const panel: GamePanel = {
    el,
    show(game) {
      el.hidden = !game;
      if (!game) return;
      title.textContent = game.title;
      meta.textContent = game.meta;
      controls.textContent = game.controls.length ? game.controls.join(' · ') : '';
      controls.hidden = !game.controls.length;
      share.hidden = !game.share;
      inlay.hidden = !game.inlay;
      if (game.inlay) inlay.src = game.inlay;
      else inlay.removeAttribute('src');
      const route = game.route;
      start.hidden = !route;
      routeKeys = route?.keys ?? [];
      joystickText = route?.joystick ?? '';
      if (route) {
        steps.replaceChildren(...route.steps.map((s) => h('li', {}, ...withKeycaps(s.text, s.keys))));
        const [lo, hi] = route.skills ?? [1, 1];
        skillSelect.replaceChildren(...Array.from({ length: hi - lo + 1 }, (_, i) => h('option', { value: lo + i }, String(lo + i))));
        skill = Math.max(lo, Math.min(hi, skill));
        skillSelect.value = String(skill);
        skillSelect.parentElement!.hidden = !route.skills;
        joystick = game.joystickFirst;
        how.set(joystick ? 'joystick' : 'keys');
        panel.startState('waiting');
      }
      showKeys(null);
      text.replaceChildren();
      manual.hidden = !game.hasManual;
      manual.open = false;
      manualStatus.textContent = '';
    },
    manual(m) {
      if (m === 'loading') {
        manualStatus.textContent = 'Fetching the manual from the archive…';
        return;
      }
      if (typeof m === 'string') {
        manualStatus.textContent = m;
        return;
      }
      manualStatus.textContent = '';
      text.replaceChildren(...booklet(m.text));
      // The keys as the manual sets them out, where the page knows none better; the rest is in the booklet.
      showKeys(m.table);
    },
    slots(slots, palette) {
      slotRow.replaceChildren(
        ...Array.from({ length: SLOTS }, (_, i) => {
          const s = slots[i] ?? null;
          const name = i ? `slot ${i}` : 'the quick slot';
          const picture = s
            ? h('div', { class: 'slot-shot' }, thumbnail(s.picture, palette), h('span', { class: 'slot-badge' }, `${SLOT_NAMES[i]} · ${when(s.savedAt)}`))
            : h('div', { class: 'slot-shot slot-empty' }, h('span', {}, SLOT_NAMES[i]));
          const load = h('button', { type: 'button', class: 'btn slot-load', disabled: !s, title: s ? `Load ${name}, saved ${when(s.savedAt)}${i ? '' : ' (F4)'}` : `Nothing in ${name} yet`, 'aria-label': s ? `Load ${SLOT_NAMES[i]}, saved ${when(s.savedAt)}` : `${SLOT_NAMES[i]}: empty` }, 'Load');
          load.addEventListener('click', () => s && hooks.load(i));
          const saveLabel = s ? (armed === i ? 'Replace?' : 'Save') : '+ Save here';
          const save = h('button', { type: 'button', class: `btn slot-save${armed === i ? ' armed' : ''}`, title: s ? `Save over ${name} (press twice)` : `Save in ${name}${i ? '' : ' (F2)'}`, 'aria-label': s ? `Save over ${SLOT_NAMES[i]}` : `Save in ${SLOT_NAMES[i]}` }, saveLabel);
          save.addEventListener('click', () => {
            // What is in a slot is replaced only on a second press, within a few seconds.
            if (s && armed !== i) {
              armed = i;
              clearTimeout(armedTimer);
              armedTimer = window.setTimeout(() => {
                armed = -1;
                panel.slots(slots, palette);
              }, 4000);
              panel.slots(slots, palette);
              return;
            }
            armed = -1;
            clearTimeout(armedTimer);
            hooks.save(i);
          });
          return h('div', { class: `slot${s ? ' filled' : ''}`, 'data-slot': i }, picture, h('div', { class: 'slot-buttons' }, s ? load : null, save));
        }),
      );
    },
    startState(state) {
      el.dataset.start = state;
      startButton.disabled = state === 'driving' || state === 'done' || state === 'armed';
      startStatus.textContent = {
        waiting: 'It starts from the game’s first screen (the £100 REWARD): pressed before, it waits for it.',
        ready: 'Ready: the page presses the keys for you, as the steps below say.',
        armed: 'It starts as soon as the £100 REWARD screen shows.',
        driving: 'Pressing the keys…',
        done: 'The mission has begun.',
        'gave up': 'The game did not answer as expected: the steps below are the way by hand.',
      }[state];
    },
  };
  return panel;
}
