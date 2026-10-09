// The settings: the machine, the picture, the keyboard and joystick, the tape, the sound. Each change is applied at
// once and remembered (state/settings.ts). A sheet at the side, not a modal: the screen stays live and in view beside
// it, so that the picture, its colours and the room's glow are chosen against the picture itself, and the inspector
// shows the machine it stops. Escape or the close button puts it away.

import { MODEL_IDS, MODELS, type AyStereo, type JoystickKind, type Model } from '../emulator/emulator';
import { FIRE_KEYS } from '../input/keymap';
import type { KeyboardMapping, LoadingStyle, Settings } from '../state/settings';
import { CROPS, type CropId, type DisplayMode } from '../video/fit';
import { PALETTES } from '../video/palette';
import { field, segmented, select, toggle } from './controls';
import { h } from './dom';
import { icon } from './icons';

export interface SettingsPanel {
  readonly el: HTMLDialogElement;
  open(): void;
  /** The controls set from `settings` (after a change made elsewhere: the toolbar, the deck). */
  sync(settings: Settings): void;
}

export function createSettings(initial: Settings, change: (patch: Partial<Settings>) => void, about: () => string, inspector: HTMLElement): SettingsPanel {
  const level = toggle('Lift the 128’s sound to the 48K’s loudness', initial.levelSound, (v) => change({ levelSound: v }));
  const calm = segmented<Settings['calmStripes']>(
    'Loading stripes',
    [
      { value: 'auto', label: 'Automatic', title: 'Calm when the system asks for reduced motion' },
      { value: 'on', label: 'Calm', title: 'The border one colour while a tape loads' },
      { value: 'off', label: 'As they were', title: 'The stripes as the loader drew them' },
    ],
    initial.calmStripes,
    (v) => change({ calmStripes: v }),
  );
  const model = select<Model>('Machine', MODEL_IDS.map((m) => ({ value: m, label: MODELS[m].name })), initial.model, (v) => change({ model: v }));
  const issue2 = toggle('Issue 2 keyboard', initial.issue2, (v) => change({ issue2: v }));
  const stereo = segmented<AyStereo>('AY stereo', [{ value: 'mono', label: 'Mono' }, { value: 'abc', label: 'ABC' }, { value: 'acb', label: 'ACB' }], initial.ayStereo, (v) => change({ ayStereo: v }));
  const display = segmented<DisplayMode>('Display', [{ value: 'sharp', label: 'Sharp' }, { value: 'tv', label: 'Television' }], initial.display, (v) => change({ display: v }));
  const crop = select<CropId>('Picture', (Object.keys(CROPS) as CropId[]).map((c) => ({ value: c, label: CROPS[c].name })), initial.crop, (v) => change({ crop: v }));
  const palette = select<string>('Colours', PALETTES.map((p) => ({ value: p.id, label: p.name })), initial.palette, (v) => change({ palette: v }));
  const ambient = toggle('The room glows with the border', initial.ambient, (v) => change({ ambient: v }));
  const mapping = segmented<KeyboardMapping>(
    'PC keyboard',
    [
      { value: 'auto', label: 'Automatic', title: 'For typing until a program loads, then for games' },
      { value: 'natural', label: 'Typing', title: 'A typed character is the keys that type it' },
      { value: 'positional', label: 'Games', title: 'Each PC key is the Spectrum key in its place' },
    ],
    initial.mapping,
    (v) => change({ mapping: v }),
  );
  const joystick = select<JoystickKind>(
    'Joystick',
    [
      { value: 'none', label: 'None' },
      { value: 'kempston', label: 'Kempston' },
      { value: 'sinclair1', label: 'Sinclair 1 (keys 6–0)' },
      { value: 'sinclair2', label: 'Sinclair 2 (keys 1–5)' },
      { value: 'cursor', label: 'Cursor (keys 5–8, 0)' },
    ],
    initial.joystick,
    (v) => change({ joystick: v }),
  );
  const arrows = toggle('Arrow keys and fire are the joystick', initial.arrowsJoystick, (v) => change({ arrowsJoystick: v }));
  const fire = select<string>('Fire key', FIRE_KEYS.map((k) => ({ value: k.code, label: k.name })), initial.fireKey, (v) => change({ fireKey: v }));
  const loading = segmented<LoadingStyle>('Loading', [{ value: 'authentic', label: 'Authentic' }, { value: 'accelerated', label: 'Accelerated' }, { value: 'instant', label: 'Instant' }], initial.loading, (v) => change({ loading: v }));
  const autoTape = toggle('Start and stop the tape by itself', initial.autoTape, (v) => change({ autoTape: v }));
  const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.01, class: 'range', 'aria-label': 'Volume' });
  volume.value = String(initial.volume);
  volume.addEventListener('input', () => change({ volume: Number(volume.value) }));
  const aboutText = h('p', { class: 'about' });

  const close = h('button', { type: 'button', class: 'btn btn-icon dialog-close', 'aria-label': 'Close' }, icon('close'));
  const el = h(
    'dialog',
    { class: 'settings', 'aria-label': 'Settings' },
    h('header', { class: 'dialog-head' }, h('h2', {}, 'Settings'), close),
    h('div', { class: 'dialog-body' },
      h('section', {}, h('h3', {}, 'Machine'), field('Model', model.el, 'Switching starts it afresh; a tape stays in the deck.'), field('Keyboard', issue2.el, 'Some early games read the EAR bit as the first boards had it.'), field('AY stereo', stereo.el, 'Where the 128’s three channels sit.')),
      h('section', {}, h('h3', {}, 'Picture'), field('Display', display.el), field('Picture', crop.el), field('Colours', palette.el), field('Room', ambient.el), field('Stripes', calm.el, 'A loader’s stripes flash the whole border: calm draws it in one colour while a tape loads.')),
      h('section', {}, h('h3', {}, 'Keyboard and joystick'), field('PC keyboard', mapping.el, 'Typing: “ is SYMBOL SHIFT and P, <> <= >= their own keys, Backspace is DELETE, Tab extended mode. SYMBOL SHIFT with a key is Alt with it (Ctrl too, but the browser keeps Ctrl+W, T and N for itself: Ctrl+W closes the tab). Games: Shift is CAPS SHIFT, Alt SYMBOL SHIFT. Shift+Tab leaves the machine for the page’s controls, Escape goes back; F1 lists every key.'), field('Joystick', joystick.el, 'A gamepad is the joystick too.'), field('Keys', arrows.el, 'When the keyboard is automatic, from when a program is loaded: at BASIC the arrows move the cursor.'), field('Fire', fire.el)),
      h('section', {}, h('h3', {}, 'Tape'), field('Loading', loading.el), field('Motor', autoTape.el)),
      h('section', {}, h('h3', {}, 'Sound'), field('Volume', volume), field('Level', level.el, 'The 128’s music and beeper are quieter than a 48K’s beeper, as their circuits make them.')),
      h('section', {}, h('h3', {}, 'Inside the machine'), inspector),
      h('section', {}, h('h3', {}, 'About'), aboutText),
    ),
  );
  close.addEventListener('click', () => el.close());
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
