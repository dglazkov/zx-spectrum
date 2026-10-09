// Gamepads (the Gamepad API), read on each display refresh: the left stick or the pad's cross is the joystick's
// directions, any face button fires; Start is ENTER and Select is SPACE, which games ask for between lives.

import { JOY } from '../emulator/emulator';

const DEAD_ZONE = 0.4;

export interface PadState {
  readonly bits: number;
  readonly enter: boolean;
  readonly space: boolean;
  /** A gamepad is connected. */
  readonly present: boolean;
}

const NONE: PadState = { bits: 0, enter: false, space: false, present: false };

/** The state of every connected gamepad, together. */
export function readGamepads(): PadState {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let bits = 0;
  let enter = false;
  let space = false;
  let present = false;
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    present = true;
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const [x = 0, y = 0] = pad.axes;
    if (x > DEAD_ZONE || pressed(15)) bits |= JOY.right;
    if (x < -DEAD_ZONE || pressed(14)) bits |= JOY.left;
    if (y > DEAD_ZONE || pressed(13)) bits |= JOY.down;
    if (y < -DEAD_ZONE || pressed(12)) bits |= JOY.up;
    if (pressed(0) || pressed(1) || pressed(2) || pressed(3) || pressed(6) || pressed(7)) bits |= JOY.fire;
    if (pressed(9)) enter = true;
    if (pressed(8)) space = true;
  }
  return present ? { bits, enter, space, present } : NONE;
}
