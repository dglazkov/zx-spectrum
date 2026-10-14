// The game in the machine: its cassette's inlay and what ZXDB says of it, a link to share that loads it straight
// away, and its play card (library/card.ts) where the shelf has one: what the game is and what you are trying to do,
// a button that takes it from its first screen to playing (choosing the joystick for you), the steps by hand with their
// keys as keycaps, the controls as a table (by the joystick and by the game's keys), a few tips, and where it all came
// from. A game with no card (one found by searching) gets what is known: ZXDB's controls read out, the manual's table of
// keys where one is found, and one honest line about the joystick. Then save slots of its own, and the whole manual,
// set as a booklet, folded.

import { language, m, Msg, onLanguage, say, t, textOf, type Words } from '../i18n/i18n';
import { isByHand, type GameCard } from '../library/card';
import type { Manual } from '../library/manual';
import type { StartChoice } from '../library/start';
import type { Slot } from '../state/saves';
import { SLOTS, THUMB_HEIGHT, THUMB_WIDTH } from '../state/saves';
import { FRAME_HEIGHT, FRAME_WIDTH } from '../emulator/emulator';
import { segmented } from './controls';
import { h } from './dom';
import { controlsTable, fireName, hasJoystick, joystickLine, keyCaps, padCaps, zxdbLine, zxdbName, type Hands } from './howto';
import { icon } from './icons';
import { caps } from './overlay';

export interface GameInfo {
  /** The saves' key: `zxdb:<id>`, `file:<name>`, ... */
  readonly key: string;
  readonly title: string;
  /** "1985 · Durell Software Ltd · 48K", or the page's words for a file opened. */
  readonly meta: Words;
  /** The inlay's picture, as an address to show. */
  readonly inlay: string | null;
  /** The address that loads it straight away (a ZXDB entry's), to share. */
  readonly share: string | null;
  /** Its play card, where the shelf has one (library/games/). */
  readonly card: GameCard | null;
  /** ZXDB's controls: "Kempston Joystick", ... */
  readonly controls: readonly string[];
  /** It is a ZXDB entry (from the shelf, a search or a link), not a file opened. */
  readonly inZxdb: boolean;
  /** Whether it has a manual to fetch. */
  readonly hasManual: boolean;
}

/** Where starting the game stands: its first screen not there yet, there, asked for and waiting for it, being driven, begun, or not managed. */
export type StartState = 'waiting' | 'ready' | 'armed' | 'driving' | 'done' | 'gave up';

export interface GamePanel {
  readonly el: HTMLElement;
  /** The game (or none), and how the page's joystick reaches the person. */
  show(game: GameInfo | null, hands: Hands): void;
  /** How the joystick reaches the person changed (the fire key, a gamepad plugged in): the controls said again. */
  hands(hands: Hands): void;
  /** The manual: coming, here, or not to be had (a message). */
  manual(manual: 'loading' | Manual | Words): void;
  /** The game's save slots (null: empty), and the palette to draw their pictures in. */
  slots(slots: readonly (Slot | null)[], palette: Uint8Array): void;
  /** Where starting the game stands, for its button. */
  startState(state: StartState): void;
  /** How the person means to play, as chosen (the joystick by default, where the game has one). */
  choice(): StartChoice;
}

export interface GameHooks {
  save(slot: number): void;
  load(slot: number): void;
  share(): void;
  /** Drive the game from its first screen to playing, as chosen. */
  start(choice: StartChoice): void;
  /** The way of playing chosen again (joystick or keys). */
  chose(choice: StartChoice): void;
  /** The controls over the screen, asked for. */
  showControls(): void;
}

/** A slot's name on its picture: the quick slot's, or a numbered one's. */
const slotName = (i: number) => (i ? t('Slot {n}', { n: i }) : t('Quick'));

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

function when(time: number): string {
  const d = new Date(time);
  const today = new Date();
  // In the page's language: the browser's own way for English, Russian's for Russian.
  const locale = language() === 'en' ? [] : language();
  const clock = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? clock : `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${clock}`;
}

/** A key as a keycap: 'any' reads "any key". */
function keycap(name: string): HTMLElement {
  return h('kbd', { class: `keycap${name.length > 2 ? ' wide' : ''}` }, name === 'any' ? m('any key') : name);
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


/** A section's heading, small capitals as the panel's others. */
const heading = (text: Words, ...more: (Node | string)[]) => h('div', { class: 'game-head' }, h('h4', {}, text), ...more);

export function createGamePanel(hooks: GameHooks): GamePanel {
  const inlay = h('img', { class: 'game-inlay', alt: '', decoding: 'async', hidden: true });
  inlay.addEventListener('error', () => (inlay.hidden = true));
  const title = h('h3', { class: 'game-title', translate: 'no' });
  const meta = h('p', { class: 'game-meta' });
  const controls = h('p', { class: 'game-controls' });
  const share = h('button', { type: 'button', class: 'btn', title: m('A link that loads this game straight away') }, icon('share'), h('span', { class: 'btn-label' }, m('Share')));
  share.addEventListener('click', () => hooks.share());

  // What the game is, and what you are trying to do in it.
  const blurb = h('p', { class: 'game-blurb' });
  const goalText = h('p', {});
  const goal = h('div', { class: 'game-goal' }, h('h4', {}, m('Your goal')), goalText);

  // Starting it.
  const steps = h('ol', { class: 'start-steps' });
  let skill = 1;
  const skillSelect = h('select', { class: 'select skill', 'aria-label': m('Skill level') });
  skillSelect.addEventListener('change', () => (skill = Number(skillSelect.value)));
  let joystick = true;
  const joystickChoice = { value: 'joystick' as const, label: m('Joystick'), title: m('The arrow keys and the fire key (Left Alt), a gamepad, or the touch pad') };
  const keysChoice = { value: 'keys' as const, label: m('Keys'), title: m('The game’s own keys') };
  const choose = (v: 'keys' | 'joystick') => {
    joystick = v === 'joystick';
    hooks.chose({ joystick, skill });
  };
  let how = segmented<'keys' | 'joystick'>(m('Play with'), [joystickChoice, keysChoice], 'joystick', choose, 'start-how');
  const startLabel = h('span', { class: 'btn-label' }, m('Start the game'));
  const startButton = h('button', { type: 'button', class: 'btn btn-primary start-go' }, icon('play'), startLabel);
  startButton.addEventListener('click', () => hooks.start({ joystick, skill }));
  const startStatus = h('p', { class: 'start-status', role: 'status' });
  const skillLabel = h('label', { class: 'skill-label' }, m('Skill'), ' ', skillSelect);
  const playWith = h('div', { class: 'play-with' }, h('span', { class: 'play-with-label' }, m('Play with')), how.el);
  const starter = h('div', { class: 'start-row' }, startButton, skillLabel);
  // The steps by hand, folded: the button does them; they open by themselves when it could not.
  const stepsCount = h('span', { class: 'steps-count' });
  const byHand = h('details', { class: 'start-by-hand' }, h('summary', {}, m('Step by step, by hand'), stepsCount), steps);
  const start = h('div', { class: 'game-start' }, starter, playWith, startStatus, byHand);

  // The controls: a table by the joystick and by the keys, the keys around play, and the key map's line.
  const onScreen = h('button', { type: 'button', class: 'btn btn-small', title: m('Show them over the screen (F3)') }, icon('screen'), h('span', { class: 'btn-label' }, m('On the screen')));
  onScreen.addEventListener('click', () => hooks.showControls());
  const table = h('table', { class: 'controls-table' });
  const mapNote = h('p', { class: 'controls-note' });
  const howto = h('div', { class: 'game-howto' }, heading(m('Controls'), onScreen), table, mapNote);
  const tips = h('ul', { class: 'game-tips' });
  const tipsBlock = h('div', { class: 'game-tips-block' }, h('h4', {}, m('Tips')), tips);
  const sources = h('p', { class: 'game-sources' });

  // A game with no card: what is known.
  const said = h('p', { class: 'fallback-said' });
  const honest = h('p', { class: 'fallback-honest' });
  const keys = h('div', { class: 'game-keys' });
  const fallback = h('div', { class: 'game-fallback' }, h('h4', {}, m('How to play')), said, honest, keys);

  // The manual is the archive's, in the language it was written in.
  const text = h('div', { class: 'manual-text booklet', translate: 'no' });
  const manualStatus = h('p', { class: 'manual-status' });
  const manual = h('details', { class: 'manual' }, h('summary', {}, m('The manual')), manualStatus, text);
  const slotRow = h('div', { class: 'slots', role: 'group', 'aria-label': m('Save slots') });

  const el = h(
    'section',
    { class: 'panel game', 'aria-label': m('The game'), hidden: true },
    h('header', { class: 'panel-head' }, h('h2', {}, m('Now playing')), share),
    h('div', { class: 'game-top' }, inlay, h('div', { class: 'game-facts' }, title, meta, controls)),
    blurb,
    goal,
    start,
    howto,
    tipsBlock,
    fallback,
    h('div', { class: 'slots-head' }, h('span', {}, m('Saves')), h('span', { class: 'slots-hint' }, m('F2 saves the quick slot, F4 loads it'))),
    slotRow,
    sources,
    manual,
  );

  let game: GameInfo | null = null;
  let hands: Hands = { fireCode: 'AltLeft', touch: false, gamepad: false };
  let table_: Manual['table'] = null;
  /** A slot whose Save was pressed once, waiting for a second press to replace what is in it. */
  let armed = -1;
  let armedTimer = 0;
  /** What was last shown that is worked out in words, to be worked out again in another language. */
  let shownSlots: { slots: readonly (Slot | null)[]; palette: Uint8Array } | null = null;
  let shownState: StartState | null = null;

  /** The card's controls, by the joystick and by the keys; or, with no card, what is known. */
  const showHowTo = () => {
    const card = game?.card ?? null;
    howto.hidden = !card;
    fallback.hidden = !!card || !game;
    if (card) {
      const rows = controlsTable(card, hands);
      const joystickHead = card.joystick ? t('Joystick') : t('Arrows');
      const head = h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, t('To'))), hasJoystick(card) ? h('th', { scope: 'col' }, joystickHead) : null, h('th', { scope: 'col' }, t('Keys'))));
      const cell = (press: ReturnType<typeof padCaps> | null) => h('td', {}, press ? caps(press) : h('span', { class: 'caps none', title: t('Not this way') }, '—'));
      const body = h(
        'tbody',
        {},
        ...rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.does), hasJoystick(card) ? cell(r.joystick) : null, cell(r.keys))),
        ...card.extras.map((x) => h('tr', { class: 'extra' }, h('th', { scope: 'row' }, t(x.does)), h('td', { colspan: hasJoystick(card) ? 2 : 1 }, caps(keyCaps([x.key], { ...hands, touch: false }))))),
      );
      table.replaceChildren(head, body);
      const fire = fireName(hands.fireCode);
      const gamepad = hands.gamepad ? t(' (or the gamepad)') : '';
      if (card.joystick) mapNote.textContent = hands.touch ? t('The joystick is the pad and FIRE: the Start button chooses it in the game for you.') : t('The joystick is the arrow keys and {fire}{gamepad}: the Start button chooses it in the game for you.', { fire, gamepad });
      else if (hasJoystick(card)) mapNote.textContent = hands.touch ? t('The game takes no joystick, so the pad and FIRE press its own keys for you while it runs.') : t('The game takes no joystick, so the arrow keys and {fire}{gamepad} press its own keys for you while it runs.', { fire, gamepad });
      else mapNote.textContent = t('The game is played with its own keys.');
      return;
    }
    if (!game) return;
    said.textContent = zxdbLine(game.controls, game.inZxdb);
    honest.replaceChildren(joystickLine(game.controls, hands), ' ', caps(padCaps(['UP', 'DOWN', 'LEFT', 'RIGHT'], hands), false), ' ', caps(padCaps(['FIRE'], hands)));
    showKeys();
  };

  /** The manual's table of keys, for a game with no card. */
  const showKeys = () => {
    const table = table_;
    keys.replaceChildren(
      ...(table
        ? [
            h('h5', {}, t('Its keys, from the manual’s “{heading}”', { heading: table.heading.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase()) })),
            h('table', { class: 'keys-table', translate: 'no' }, h('tbody', {}, ...table.rows.map((r) => h('tr', {}, h('th', {}, r[0]), h('td', {}, r.slice(1).join(' · ')))))),
          ]
        : []),
    );
  };

  /** The card's own words (library/games/: each module's `ru`), in the language of the moment. */
  const showCard = (card: GameCard) => {
    blurb.textContent = t(card.blurb);
    goalText.textContent = t(card.goal);
    tips.replaceChildren(...card.tips.map((tip) => h('li', {}, t(tip))));
    sources.replaceChildren(h('span', { class: 'sources-label' }, t('From'), ' '), ...card.sources.flatMap((src, i) => [i ? ' · ' : '', h('a', { href: src.url, target: '_blank', rel: 'noopener' }, t(src.title))]));
    const route = card.start;
    steps.replaceChildren(...route.steps.map((st) => h('li', {}, ...withKeycaps(t(st.text), st.keys))));
    const n = route.steps.length;
    stepsCount.textContent = ` · ${n === 1 ? t('{n} step', { n }) : t('{n} steps', { n })}`;
  };

  // In another language: the card, the controls, the slots and where the start stands, said again; the game, its
  // manual and its slots stay as they are.
  onLanguage(() => {
    if (!game) return;
    meta.textContent = say(game.meta);
    controls.textContent = game.controls.map(zxdbName).join(' · ');
    if (game.card) showCard(game.card);
    showHowTo();
    showKeys();
    if (shownSlots) panel.slots(shownSlots.slots, shownSlots.palette);
    if (shownState) panel.startState(shownState);
  });

  const panel: GamePanel = {
    el,
    show(g, hs) {
      game = g;
      hands = hs;
      table_ = null;
      el.hidden = !g;
      if (!g) return;
      title.textContent = g.title;
      meta.textContent = say(g.meta);
      // The ZXDB's year, publisher and machine are its own; the page's words for a file opened are the page's.
      meta.translate = typeof g.meta !== 'string';
      controls.textContent = g.controls.map(zxdbName).join(' · ');
      controls.hidden = !g.controls.length;
      share.hidden = !g.share;
      inlay.hidden = !g.inlay;
      if (g.inlay) inlay.src = g.inlay;
      else inlay.removeAttribute('src');
      const card = g.card;
      el.classList.toggle('has-card', !!card);
      blurb.hidden = goal.hidden = start.hidden = tipsBlock.hidden = sources.hidden = !card;
      if (card) {
        showCard(card);
        const route = card.start;
        // A start the person makes by hand: no button, no choice of how to play (the steps say which key picks the
        // joystick at the game's menu), and the steps open.
        const manual_ = isByHand(route);
        byHand.open = manual_;
        starter.hidden = startStatus.hidden = manual_;
        const [lo, hi] = route.skills ?? [1, 1];
        skillSelect.replaceChildren(...Array.from({ length: hi - lo + 1 }, (_, i) => h('option', { value: lo + i }, String(lo + i))));
        skill = Math.max(lo, Math.min(hi, skill));
        skillSelect.value = String(skill);
        skillLabel.hidden = !route.skills;
        // The joystick by default wherever the game has one (or the arrows, through its key map): the page's joystick is
        // the same on every game, the keyboard's arrows, a gamepad and the phone's pad alike.
        joystick = hasJoystick(card);
        playWith.hidden = manual_ || !hasJoystick(card);
        const next = segmented<'keys' | 'joystick'>(m('Play with'), [card.joystick ? joystickChoice : { ...joystickChoice, label: m('Arrows'), title: m('The arrow keys and the fire key (a gamepad, the touch pad) pressing the game’s own keys') }, keysChoice], joystick ? 'joystick' : 'keys', choose, 'start-how');
        how.el.replaceWith(next.el);
        how = next;
        panel.startState('waiting');
      }
      showHowTo();
      text.replaceChildren();
      manual.hidden = !g.hasManual;
      manual.open = false;
      manualStatus.textContent = '';
    },
    hands(hs) {
      hands = hs;
      showHowTo();
    },
    manual(manual_) {
      if (manual_ === 'loading') {
        manualStatus.replaceChildren(textOf(m('Fetching the manual from the archive…')));
        return;
      }
      if (typeof manual_ === 'string' || manual_ instanceof Msg) {
        manualStatus.replaceChildren(textOf(manual_));
        return;
      }
      manualStatus.textContent = '';
      text.replaceChildren(...booklet(manual_.text));
      // The keys as the manual sets them out, for a game with no card; the rest is in the booklet.
      table_ = manual_.table;
      showKeys();
    },
    slots(slots, palette) {
      shownSlots = { slots, palette };
      slotRow.replaceChildren(
        ...Array.from({ length: SLOTS }, (_, i) => {
          const s = slots[i] ?? null;
          const name = slotName(i);
          const saved = s ? when(s.savedAt) : '';
          const picture = s
            ? h('div', { class: 'slot-shot' }, thumbnail(s.picture, palette), h('span', { class: 'slot-badge' }, `${name} · ${saved}`))
            : h('div', { class: 'slot-shot slot-empty' }, h('span', {}, name));
          const loadTitle = s ? (i ? t('Load slot {n}, saved {when}', { n: i, when: saved }) : t('Load the quick slot, saved {when} (F4)', { when: saved })) : i ? t('Nothing in slot {n} yet', { n: i }) : t('Nothing in the quick slot yet');
          const load = h('button', { type: 'button', class: 'btn slot-load', disabled: !s, title: loadTitle, 'aria-label': s ? t('Load {slot}, saved {when}', { slot: name, when: saved }) : t('{slot}: empty', { slot: name }) }, t('Load'));
          load.addEventListener('click', () => s && hooks.load(i));
          const saveLabel = s ? (armed === i ? t('Replace?') : t('Save')) : t('+ Save here');
          const saveTitle = s ? (i ? t('Save over slot {n} (press twice)', { n: i }) : t('Save over the quick slot (press twice)')) : i ? t('Save in slot {n}', { n: i }) : t('Save in the quick slot (F2)');
          const save = h('button', { type: 'button', class: `btn slot-save${armed === i ? ' armed' : ''}`, title: saveTitle, 'aria-label': s ? t('Save over {slot}', { slot: name }) : t('Save in {slot}', { slot: name }) }, saveLabel);
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
      shownState = state;
      el.dataset.start = state;
      if (state === 'gave up') byHand.open = true;
      startButton.disabled = state === 'driving' || state === 'done' || state === 'armed';
      startStatus.textContent = {
        waiting: () => t('It starts from the game’s first screen: pressed before that shows, it waits for it.'),
        ready: () => t('Ready: the page presses the keys for you, as the steps below say.'),
        armed: () => t('It starts as soon as the game’s first screen shows.'),
        driving: () => t('Pressing the keys for you…'),
        done: () => (hands.touch ? t('The game has begun. The Controls button on the screen shows the controls over it.') : t('The game has begun. F3 shows the controls over it.')),
        'gave up': () => t('The game did not answer as expected: the steps below are the way by hand.'),
      }[state]();
    },
    choice() {
      return { joystick, skill };
    },
  };
  return panel;
}
