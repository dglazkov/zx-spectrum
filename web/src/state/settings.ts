// What the page remembers between visits, in localStorage. Storage can be missing or refuse (a private window,
// blocked site data), so every read and write is wrapped, and the page works the same without it.

import type { AyStereo, JoystickKind, Model } from '../emulator/emulator';
import type { CropId, DisplayMode } from '../video/fit';

export type KeyboardMapping = 'auto' | 'natural' | 'positional';
export type LoadingStyle = 'authentic' | 'accelerated' | 'instant';

export interface Settings {
  model: Model;
  display: DisplayMode;
  crop: CropId;
  palette: string;
  /** The page's background glows with the colour of the border, as a room lit by a television. */
  ambient: boolean;
  mapping: KeyboardMapping;
  joystick: JoystickKind;
  /** The arrow keys and the fire key are the joystick (when there is one). */
  arrowsJoystick: boolean;
  fireKey: string;
  loading: LoadingStyle;
  autoTape: boolean;
  issue2: boolean;
  ayStereo: AyStereo;
  volume: number;
  muted: boolean;
  /** The drawn keyboard is shown. */
  keyboard: boolean;
}

export const DEFAULTS: Readonly<Settings> = {
  model: '48k',
  display: 'tv',
  crop: 'tv',
  palette: 'ula',
  ambient: true,
  mapping: 'auto',
  joystick: 'kempston',
  arrowsJoystick: true,
  fireKey: 'AltLeft',
  loading: 'authentic',
  autoTape: true,
  issue2: false,
  ayStereo: 'acb',
  volume: 0.8,
  muted: false,
  keyboard: true,
};

const KEY = 'zx-spectrum.settings';

/** Storage as a minimal interface, so tests can give their own. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The settings as last saved, with anything missing or not understood taken from the defaults. */
export function loadSettings(store: Store | null = storage()): Settings {
  let saved: Record<string, unknown> = {};
  try {
    const text = store?.getItem(KEY);
    if (text) saved = JSON.parse(text) as Record<string, unknown>;
  } catch {
    saved = {};
  }
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(DEFAULTS)) if (typeof saved[k] === typeof v) out[k] = saved[k];
  return out as unknown as Settings;
}

export function saveSettings(settings: Settings, store: Store | null = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Full, or refused: the settings last only as long as the page.
  }
}
