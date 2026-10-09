// What to type to load a tape: on a 48K (or 16K), LOAD "" and ENTER, which in K mode is J (LOAD), then SYMBOL SHIFT
// and P twice (the quotes), then ENTER; on a machine with the 128's menu, ENTER, which takes its first item (Tape
// Loader; Loader on the +2A and +3).

import { MODELS, type Model } from '../emulator/emulator';
import { ENTER, KEY, SYMBOL_SHIFT } from '../emulator/keys';
import type { Chord } from './keymap';

export function loadKeys(model: Model): Chord[] {
  if (MODELS[model].menu) return [[ENTER]];
  return [[KEY.J], [SYMBOL_SHIFT, KEY.P], [SYMBOL_SHIFT, KEY.P], [ENTER]];
}

/** Frames from switching on to the machine reading its keys: the 48K's RAM test takes about 1.3 s, the 128's a little more. Waiting longer is harmless. */
export const BOOT_FRAMES = 150;
