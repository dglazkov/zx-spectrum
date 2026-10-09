// What to type to load a tape, and when: on a 48K (or 16K), LOAD "" and ENTER, which in K mode is J (LOAD), then
// SYMBOL SHIFT and P twice (the quotes), then ENTER; on a machine with the 128's menu, ENTER, which takes its first
// item (Tape Loader; Loader on the +2A and +3). Either is typed once the ROM is ready for keys, which the screen says.

import { MODELS, type Model } from '../emulator/emulator';
import { ENTER, KEY, SYMBOL_SHIFT } from '../emulator/keys';
import type { Chord } from './keymap';

export function loadKeys(model: Model): Chord[] {
  if (MODELS[model].menu) return [[ENTER]];
  return [[KEY.J], [SYMBOL_SHIFT, KEY.P], [SYMBOL_SHIFT, KEY.P], [ENTER]];
}

/**
 * Whether the ROM is ready for keys, from the screen read as text (Emulator.screenText): the 128's menu (its first
 * item, Tape Loader, or Loader on the +2A and +3), or the 48K's copyright on the bottom line ("© 1982 Sinclair
 * Research Ltd"; Amstrad's on the +2's and +3's 48 BASIC). The 48K shows it about 1.7 s after switching on, the 128
 * its menu after 1.1 s, the +3 after 2.7 s (it looks for its disk drive first): zx (crates/cli) waits the same way.
 */
export function romReady(screen: string, menu: boolean): boolean {
  if (menu) return screen.includes('Loader');
  const bottom = screen.split('\n')[23] ?? '';
  return bottom.includes('Sinclair Research') || bottom.includes('Amstrad');
}

/** Frames to wait for the ROM at most, whatever the screen says (a machine with another ROM): 8 s. */
export const BOOT_FRAMES_MAX = 400;
