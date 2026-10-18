// The settings: the language, the machine, the picture, the keyboard and joystick, the tape, the sound; and feedback. Each change is
// applied at once and remembered (state/settings.ts). A sheet at the side, not a modal: the screen stays live and in view beside
// it, so that the picture, its colours and the room's glow are chosen against the picture itself, and the inspector
// shows the machine it stops. Escape or the close button puts it away.

import { MODEL_IDS, MODELS, type AyStereo, type JoystickKind, type Model } from '../emulator/emulator';
import { LANGUAGES, NAMES, m, onLanguage, type Lang } from '../i18n/i18n';
import { FIRE_KEYS } from '../input/keymap';
import type { KeyboardMapping, LoadingStyle, Settings } from '../state/settings';
import { CROPS, type CropId, type DisplayMode } from '../video/fit';
import { PALETTES } from '../video/palette';
import { button, field, segmented, select, toggle } from './controls';
import { h } from './dom';
import { icon } from './icons';

export interface SettingsPanel {
  readonly el: HTMLDialogElement;
  open(): void;
  /** The controls set from `settings` (after a change made elsewhere: the toolbar, the deck). */
  sync(settings: Settings): void;
}

export function createSettings(initial: Settings, change: (patch: Partial<Settings>) => void, about: () => string, inspector: HTMLElement, lang: Lang, feedback: () => void): SettingsPanel {
  // Each language by its own name, whichever the page speaks: the one that can be read is found in either.
  const language = segmented<Lang>(
    'Language · Язык',
    LANGUAGES.map((l) => ({ value: l, label: NAMES[l].name })),
    lang,
    (v) => change({ language: v }),
    'language-choice',
  );
  language.el.translate = false;
  for (const b of language.el.querySelectorAll('button')) {
    b.lang = b.dataset.value ?? '';
    b.translate = false;
  }
  const level = toggle(m('Lift the 128’s sound to the 48K’s loudness'), initial.levelSound, (v) => change({ levelSound: v }));
  const calm = segmented<Settings['calmStripes']>(
    m('Loading stripes'),
    [
      { value: 'auto', label: m('Automatic'), title: m('Calm when the system asks for reduced motion') },
      { value: 'on', label: m('Calm'), title: m('The border one colour while a tape loads') },
      { value: 'off', label: m('As they were'), title: m('The stripes as the loader drew them') },
    ],
    initial.calmStripes,
    (v) => change({ calmStripes: v }),
  );
  const model = select<Model>(m('Machine'), MODEL_IDS.map((id) => ({ value: id, label: MODELS[id].name })), initial.model, (v) => change({ model: v }));
  model.el.translate = false;
  const issue2 = toggle(m('Issue 2 keyboard'), initial.issue2, (v) => change({ issue2: v }));
  const stereo = segmented<AyStereo>(m('AY stereo'), [{ value: 'mono', label: m('Mono') }, { value: 'abc', label: 'ABC' }, { value: 'acb', label: 'ACB' }], initial.ayStereo, (v) => change({ ayStereo: v }));
  const display = segmented<DisplayMode>(m('Display'), [{ value: 'sharp', label: m('Sharp') }, { value: 'tv', label: m('Television') }], initial.display, (v) => change({ display: v }));
  const crop = select<CropId>(m('crop|Picture'), (Object.keys(CROPS) as CropId[]).map((c) => ({ value: c, label: m(CROPS[c].name) })), initial.crop, (v) => change({ crop: v }));
  const palette = select<string>(m('Colours'), PALETTES.map((p) => ({ value: p.id, label: m(p.name) })), initial.palette, (v) => change({ palette: v }));
  const ambient = toggle(m('The room glows with the border'), initial.ambient, (v) => change({ ambient: v }));
  const mapping = segmented<KeyboardMapping>(
    m('PC keyboard'),
    [
      { value: 'auto', label: m('Automatic'), title: m('For typing until a program loads, then for games') },
      { value: 'natural', label: m('Typing'), title: m('A typed character is the keys that type it') },
      { value: 'positional', label: m('Games'), title: m('Each PC key is the Spectrum key in its place') },
    ],
    initial.mapping,
    (v) => change({ mapping: v }),
  );
  const joystick = select<JoystickKind>(
    m('Joystick'),
    [
      { value: 'none', label: m('None') },
      { value: 'kempston', label: 'Kempston' },
      { value: 'sinclair1', label: m('Sinclair 1 (keys 6–0)') },
      { value: 'sinclair2', label: m('Sinclair 2 (keys 1–5)') },
      { value: 'cursor', label: m('Cursor (keys 5–8, 0)') },
    ],
    initial.joystick,
    (v) => change({ joystick: v }),
  );
  const arrows = toggle(m('Arrow keys and fire are the joystick'), initial.arrowsJoystick, (v) => change({ arrowsJoystick: v }));
  const fire = select<string>(m('Fire key'), FIRE_KEYS.map((k) => ({ value: k.code, label: m(k.name) })), initial.fireKey, (v) => change({ fireKey: v }));
  const loading = segmented<LoadingStyle>(m('Loading'), [{ value: 'authentic', label: m('Authentic') }, { value: 'accelerated', label: m('Accelerated') }, { value: 'instant', label: m('Instant') }], initial.loading, (v) => change({ loading: v }));
  const autoTape = toggle(m('Start and stop the tape by itself'), initial.autoTape, (v) => change({ autoTape: v }));
  const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.01, class: 'range', 'aria-label': m('Volume') });
  volume.value = String(initial.volume);
  volume.addEventListener('input', () => change({ volume: Number(volume.value) }));
  const aboutText = h('p', { class: 'about' });
  const sendFeedback = button({ icon: 'feedback', label: m('Send feedback'), onClick: feedback });

  const close = h('button', { type: 'button', class: 'btn btn-icon dialog-close', 'aria-label': m('Close') }, icon('close'));
  const el = h(
    'dialog',
    { class: 'settings', 'aria-label': m('Settings') },
    h('header', { class: 'dialog-head' }, h('h2', {}, m('Settings')), close),
    h('div', { class: 'dialog-body' },
      h('section', {}, h('h3', { translate: 'no' }, 'Language · Язык'), field(m('Language'), language.el, m('Chosen at first by the browser’s language. The games and the Spectrum’s keys stay as they were.'))),
      h('section', {}, h('h3', {}, m('Machine')), field(m('Model'), model.el, m('Switching starts it afresh; a tape stays in the deck.')), field(m('Keyboard'), issue2.el, m('Some early games read the EAR bit as the first boards had it.')), field(m('AY stereo'), stereo.el, m('Where the 128’s three channels sit.'))),
      h('section', {}, h('h3', {}, m('Picture')), field(m('Display'), display.el), field(m('crop|Picture'), crop.el), field(m('Colours'), palette.el), field(m('Room'), ambient.el), field(m('Stripes'), calm.el, m('A loader’s stripes flash the whole border: calm draws it in one colour while a tape loads.'))),
      h('section', {}, h('h3', {}, m('Keyboard and joystick')), field(m('PC keyboard'), mapping.el, m('Typing: “ is SYMBOL SHIFT and P, <> <= >= their own keys, Backspace is DELETE, Tab extended mode. SYMBOL SHIFT with a key is Alt with it (Ctrl too, but the browser keeps Ctrl+W, T and N for itself: Ctrl+W closes the tab). Games: Shift is CAPS SHIFT, Alt SYMBOL SHIFT. Shift+Tab leaves the machine for the page’s controls, Escape goes back; F1 lists every key.')), field(m('Joystick'), joystick.el, m('A gamepad is the joystick too.')), field(m('Keys'), arrows.el, m('When the keyboard is automatic, from when a program is loaded: at BASIC the arrows move the cursor.')), field(m('Fire'), fire.el)),
      h('section', {}, h('h3', {}, m('Tape')), field(m('Loading'), loading.el), field(m('Motor'), autoTape.el)),
      h('section', {}, h('h3', {}, m('Sound')), field(m('Volume'), volume), field(m('Level'), level.el, m('The 128’s music and beeper are quieter than a 48K’s beeper, as their circuits make them.'))),
      h('section', {}, h('h3', {}, m('Inside the machine')), inspector),
      h('section', {}, h('h3', {}, m('Feedback')), field(m('Feedback'), sendFeedback, m('What you think of the page, what you expected and what happened: it goes to whoever makes it, with the last few things done and any errors. F7 opens it too.'))),
      h('section', {}, h('h3', {}, m('About')), aboutText),
    ),
  );
  close.addEventListener('click', () => el.close());
  // The about line is worked out when the sheet opens: again in the new language, if it is open as the language changes.
  onLanguage(() => {
    if (el.open) aboutText.textContent = about();
  });
  // Not modal, so Escape is not the browser's: it is the sheet's, as long as the keys are in it.
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    e.stopPropagation();
    el.close();
  });

  return {
    el,
    open() {
      aboutText.textContent = about();
      if (!el.open) el.show();
      // The keys go to the sheet, where its controls are.
      close.focus({ preventScroll: true });
    },
    sync(s) {
      if (s.language === 'en' || s.language === 'ru') language.set(s.language);
      model.set(s.model);
      issue2.set(s.issue2);
      stereo.set(s.ayStereo);
      display.set(s.display);
      crop.set(s.crop);
      palette.set(s.palette);
      ambient.set(s.ambient);
      mapping.set(s.mapping);
      joystick.set(s.joystick);
      arrows.set(s.arrowsJoystick);
      fire.set(s.fireKey);
      loading.set(s.loading);
      autoTape.set(s.autoTape);
      volume.value = String(s.volume);
      level.set(s.levelSound);
      calm.set(s.calmStripes);
    },
  };
}
