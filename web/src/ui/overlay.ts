// The game's controls over the screen, as the person presses them now (howto.ts): a translucent card along the foot of
// the picture, shown for a few seconds when play begins and whenever it is asked for (F3, or the small button on the
// set), and gone at a press of its ×. The picture shows through it, and it never stays long over play unless asked.
// While a game with a card shows its first screen, the way in is on the picture too: a button that starts it.

import type { Cap, HowTo, Press } from './howto';
import { h } from './dom';
import { icon } from './icons';

export interface ControlsOverlay {
  /** A layer over the screen (it takes the screen's size): the card along its foot, the small button in its corner. */
  readonly el: HTMLElement;
  /** The card. */
  readonly card: HTMLElement;
  /** The small button on the set that shows it, or hides it. */
  readonly button: HTMLButtonElement;
  readonly shown: boolean;
  /** What it shows; shown or not. `auto`: it showed by itself (play began), and goes by itself. */
  show(howto: HowTo, title: string, auto: boolean): void;
  /** What it says, changed while it shows (the way of playing chosen again). */
  update(howto: HowTo, title: string): void;
  hide(): void;
  /** Whether there is a game to show the controls of: the button shows only then. */
  available(on: boolean): void;
  /** The button on the picture that starts the game, with what it says under it; null: none. */
  prompt(hint: string | null): void;
}

export interface OverlayHooks {
  /** Its × pressed: it is not to show by itself for this game again. */
  dismissed(): void;
  /** The button pressed. */
  toggle(): void;
  /** The start button on the picture pressed. */
  start(): void;
}

const ARROW_ICONS: Readonly<Record<string, string>> = { '↑': 'up', '↓': 'down', '←': 'left', '→': 'right' };

/** Keycaps held together, joined by a plus; or (`together` false) keycaps side by side, any of them. */
export function caps(press: Press, together = true): HTMLElement {
  const el = h('span', { class: `caps${together ? '' : ' any'}` });
  press.forEach((c: Cap, i) => {
    if (i && together) el.append(h('span', { class: 'caps-plus', 'aria-hidden': 'true' }, '+'));
    // An arrow drawn, as the arrow keys print theirs (a font's arrows are small and uneven); its glyph is the text.
    const arrow = ARROW_ICONS[c.label];
    const face = arrow ? [icon(arrow), h('span', { class: 'visually-hidden' }, c.label)] : [c.label];
    el.append(h('kbd', { class: `keycap ${c.kind}${c.label.length > 2 ? ' wide' : ''}`, title: c.title, 'aria-label': c.title }, ...face));
  });
  return el;
}

export function createOverlay(hooks: OverlayHooks, touch = false): ControlsOverlay {
  const mode = h('span', { class: 'ov-mode' });
  const title = h('strong', { class: 'ov-title' });
  const how = h('span', { class: 'ov-how' });
  const close = h('button', { type: 'button', class: 'ov-close', 'aria-label': 'Close, and do not show by itself for this game again', title: 'Close (it will not show by itself for this game again; F3 shows it)' }, icon('close'));
  close.addEventListener('click', () => hooks.dismissed());
  const stepList = h('ol', { class: 'ov-steps', hidden: true });
  const list = h('ul', { class: 'ov-rows' });
  const note = h('p', { class: 'ov-note' });
  const hint = h('span', { class: 'ov-hint' });
  const card = h(
    'section',
    { class: 'controls-overlay', 'aria-label': 'The game’s controls', role: 'region', hidden: true },
    h('header', { class: 'ov-head' }, h('span', { class: 'ov-label' }, icon('joystick'), title, mode), how, close),
    stepList,
    list,
    h('footer', { class: 'ov-foot' }, note, hint),
  );
  card.addEventListener('contextmenu', (e) => e.preventDefault());

  const button = h('button', { type: 'button', class: 'controls-button', title: touch ? 'The game’s controls' : 'The game’s controls (F3)', 'aria-label': 'The game’s controls', 'aria-expanded': 'false', hidden: true }, icon('joystick'), h('span', { class: 'cb-label' }, 'Controls'));
  button.addEventListener('click', () => hooks.toggle());
  const promptHint = h('span', { class: 'sp-hint' });
  const startPrompt = h('button', { type: 'button', class: 'start-prompt', hidden: true }, icon('play'), h('span', { class: 'sp-text' }, h('strong', {}, 'Start the game'), promptHint));
  startPrompt.addEventListener('click', () => hooks.start());
  const el = h('div', { class: 'controls-layer' }, card, startPrompt, button);

  let shown = false;

  const fill = (howto: HowTo, name: string) => {
    title.textContent = name;
    mode.textContent = howto.mode;
    how.textContent = howto.how;
    // A start by hand: its steps first, the keys they name as keycaps.
    const steps = howto.steps ?? [];
    stepList.replaceChildren(...steps.map((st) => h('li', { class: 'ov-step' }, ...st.map((p) => (typeof p === 'string' ? p : caps([p]))))));
    stepList.hidden = !steps.length;
    const rows = [...howto.rows.map((r) => ({ ...r, extra: false })), ...howto.extras.map((r) => ({ ...r, extra: true }))];
    list.replaceChildren(
      ...rows.map((r) => h('li', { class: `ov-row${r.extra ? ' extra' : ''}` }, r.press ? caps(r.press) : h('span', { class: 'caps none' }, '—'), h('span', { class: 'ov-does' }, r.does))),
    );
    list.classList.toggle('many', rows.length > 6);
    note.textContent = howto.note ?? '';
    note.hidden = !howto.note;
  };

  return {
    el,
    card,
    button,
    get shown() {
      return shown;
    },
    show(howto, name, auto) {
      fill(howto, name);
      shown = true;
      card.hidden = false;
      card.classList.toggle('auto', auto);
      const again = touch ? 'the Controls button' : 'F3';
      hint.textContent = auto ? `It goes in a moment: ${again} brings it back.` : `${touch ? 'The Controls button' : 'F3'} hides it.`;
      button.classList.add('on');
      button.setAttribute('aria-expanded', 'true');
      // Shown afresh: the entrance plays again.
      card.classList.remove('entering');
      void card.offsetWidth;
      card.classList.add('entering');
    },
    update(howto, name) {
      if (shown) fill(howto, name);
    },
    hide() {
      shown = false;
      card.hidden = true;
      button.classList.remove('on');
      button.setAttribute('aria-expanded', 'false');
    },
    available(on) {
      button.hidden = !on;
      if (!on && shown) this.hide();
    },
    prompt(hint) {
      startPrompt.hidden = hint === null;
      promptHint.textContent = hint ?? '';
    },
  };
}

/** Where the page remembers the games whose controls the person closed, so that they do not show by themselves again. */
const DISMISSED_KEY = 'zx-spectrum.controls-closed';

/** Whether the person closed this game's controls before (storage that is missing or refuses: never). */
export function wasDismissed(game: string, store: Pick<Storage, 'getItem'> | null = storage()): boolean {
  try {
    return (JSON.parse(store?.getItem(DISMISSED_KEY) ?? '[]') as string[]).includes(game);
  } catch {
    return false;
  }
}

/** Remembers that the person closed this game's controls (the last 200 games). */
export function rememberDismissed(game: string, store: Pick<Storage, 'getItem' | 'setItem'> | null = storage()): void {
  try {
    const list = (JSON.parse(store?.getItem(DISMISSED_KEY) ?? '[]') as string[]).filter((g) => g !== game);
    store?.setItem(DISMISSED_KEY, JSON.stringify([game, ...list].slice(0, 200)));
  } catch {
    // Not kept: it shows by itself again next time, which is all that is lost.
  }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
