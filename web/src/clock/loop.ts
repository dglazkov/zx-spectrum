// The page's heartbeat: on every display refresh the scheduler says how many frames are due and they are run, and
// the latest picture is shown; and whenever the sound card says it has played a frame, the frames it is short of
// are run then, so that a hidden tab (which gets no refreshes) keeps playing.

import type { FrameScheduler } from './scheduler';

/** Flat out, frames are run until this much of a refresh has gone, ms (the rest is the browser's). */
const FLAT_OUT_BUDGET_MS = 11;
/** And no more than this many, whatever the clock says: a clock that does not move (a test's) must not hang the page. */
const FLAT_OUT_MAX = 64;

export interface LoopHooks {
  /** Runs one machine frame, with all that goes with it (input, sound, rewind). */
  runFrame(): void;
  /** Shows the latest picture, and whatever else follows the display (the deck's reels, the keys). */
  present(now: number): void;
  now(): number;
}

export class Loop {
  private running = false;
  private handle = 0;

  constructor(
    private readonly scheduler: FrameScheduler,
    private readonly hooks: LoopHooks,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      const now = this.hooks.now();
      this.pump(now, true);
      this.hooks.present(now);
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** The sound card has played `played` sample frames in all. */
  played(played: number): void {
    const now = this.hooks.now();
    this.scheduler.reported(played, now);
    if (this.running) this.pump(now, false);
  }

  private pump(now: number, refresh: boolean): void {
    const due = this.scheduler.due(now, refresh);
    if (due === Infinity) {
      const deadline = now + FLAT_OUT_BUDGET_MS;
      for (let i = 0; i < FLAT_OUT_MAX && (i === 0 || this.hooks.now() < deadline); i++) this.hooks.runFrame();
      return;
    }
    for (let i = 0; i < due; i++) this.hooks.runFrame();
  }
}
