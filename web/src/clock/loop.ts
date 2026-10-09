// The page's heartbeat: on every display refresh the scheduler says how many frames are due and they are run, and
// the latest picture is shown; and whenever the sound card says it has played a frame, the scheduler may ask for
// frames then too (when the refreshes have stopped: a hidden tab keeps playing).
//
// Flat out, a refresh runs frames for most of the time until the next one: a share of the display's period as
// measured, so that a 120 Hz display runs as many frames a second as a 60 Hz one, and a slow one (software drawing,
// a power-saving 30 Hz) more a refresh rather than fewer a second. The batch ends as soon as the machine is not to
// run flat out any more (the tape has stopped).
//
// Nothing that goes wrong in a frame stops the heartbeat: the next refresh is asked for whatever happens, and the
// error is handed to `failed` (the page pauses the machine and says so).

import type { FrameScheduler } from './scheduler';

/** Flat out, frames are run for this share of the display's period (the rest is the browser's, and the picture's). */
const FLAT_OUT_SHARE = 0.65;
/** Within these bounds, ms: no less however fast the display, and no more however slow (the page must answer). */
const FLAT_OUT_MIN_MS = 4;
const FLAT_OUT_MAX_MS = 40;
/**
 * And no more than this many frames, whatever the clock says: a clock that does not move (a test's) must not hang
 * the page. The longest budget's worth of the dearest machine's frames (a 128K's, about a quarter of a millisecond).
 */
const FLAT_OUT_MAX = 160;

export interface LoopHooks {
  /** Runs one machine frame, with all that goes with it (input, sound, rewind). */
  runFrame(): void;
  /** Shows the latest picture, and whatever else follows the display (the deck's reels, the keys). */
  present(now: number): void;
  now(): number;
  /** Something threw in a frame or in showing it. The loop goes on; the page decides what to do. */
  failed?(error: unknown): void;
}

export class Loop {
  private running = false;
  private handle = 0;
  /** The display's period, ms, as measured between refreshes (for the flat-out budget). */
  private period = 1000 / 60;
  private lastTick = Number.NaN;

  constructor(
    private readonly scheduler: FrameScheduler,
    private readonly hooks: LoopHooks,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      try {
        const now = this.hooks.now();
        this.measure(now);
        this.pump(now, true);
        this.hooks.present(now);
      } catch (e) {
        this.fail(e);
      } finally {
        if (this.running) this.handle = requestAnimationFrame(tick);
      }
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** The sound card has played `played` sample frames in all. */
  played(played: number): void {
    try {
      const now = this.hooks.now();
      this.scheduler.reported(played, now);
      if (this.running) this.pump(now, false);
    } catch (e) {
      this.fail(e);
    }
  }

  /** How long a flat-out refresh runs frames for, ms. */
  get budget(): number {
    return Math.max(FLAT_OUT_MIN_MS, Math.min(FLAT_OUT_MAX_MS, this.period * FLAT_OUT_SHARE));
  }

  private measure(now: number): void {
    const gap = now - this.lastTick;
    this.lastTick = now;
    // A gap of a hidden tab or a stall is no refresh period.
    if (gap > 0 && gap < 250) this.period += (gap - this.period) * 0.1;
  }

  private fail(e: unknown): void {
    if (this.hooks.failed) this.hooks.failed(e);
    else console.error(e);
  }

  private pump(now: number, refresh: boolean): void {
    const due = this.scheduler.due(now, refresh);
    if (due === Infinity) {
      const deadline = now + this.budget;
      for (let i = 0; i < FLAT_OUT_MAX && (i === 0 || this.hooks.now() < deadline); i++) {
        this.hooks.runFrame();
        if (this.scheduler.speed !== 'max') break;
      }
      return;
    }
    for (let i = 0; i < due; i++) this.hooks.runFrame();
  }
}
