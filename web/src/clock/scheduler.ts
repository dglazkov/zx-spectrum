// When to run the machine's frames. The emulator never reads a clock: the page decides how many frames to run, and
// this decides for it, from one of two clocks.
//
// - The sound card's, once sound is allowed: the audio worklet plays each frame's samples and says how many it has
//   played; frames are run to keep 3 to 4 frames' worth queued ahead of it. The machine then runs at exactly its own
//   rate measured against the sound card's crystal, whatever the display's refresh is and however the two drift
//   apart: a frame more or a frame less now and then absorbs the drift, and no sample is ever dropped or invented.
// - The display's, before that (no gesture yet: the browser holds sound back) or flat out: frames are owed at the
//   machine's frame rate by the time between display refreshes, and run as they come due.
//
// Time comes in as an argument (milliseconds, as performance.now() gives it), so tests drive it with a fake clock.

export type Speed = 'pause' | 1 | 2 | 'max';

/** The frames kept queued at the sound card, at least: topping up rounds up, so 3 to 4 are. */
export const AUDIO_TARGET_FRAMES = 3;

/** The most frames run at once on the sound card's clock, after a stall. */
const AUDIO_BURST = 4;

/** The longest gap between display refreshes that is caught up (a busy moment); a longer one (a hidden tab) is not. */
const MAX_GAP_MS = 250;

/**
 * How far past the sound card's last report its playing is assumed to have gone on. It reports every frame or so
 * (20 ms); one silent for longer has stopped (its context suspended by the system, a phone call, a device gone), and
 * frames run on the page's refreshes would only pile up in a queue nothing plays, to be heard late by as long as it
 * was stopped. Past this the machine waits for it (the page moves to the display's clock: app.ts).
 */
const REPORT_STALE_MS = 100;

export class FrameScheduler {
  /** Frames a second the machine makes (50.08 on the 48K). */
  frameRate: number;
  private speedNow: Speed = 1;

  // On the display's clock.
  private owed = 0;
  private lastRefresh = Number.NaN;

  // On the sound card's.
  private rate: number | null = null;
  private sent = 0;
  private played = 0;
  private reportedAt = Number.NaN;

  constructor(frameRate: number) {
    this.frameRate = frameRate;
  }

  get speed(): Speed {
    return this.speedNow;
  }

  set speed(speed: Speed) {
    if (speed === this.speedNow) return;
    this.speedNow = speed;
    this.owed = 0;
    this.lastRefresh = Number.NaN;
  }

  /** The sound card's rate frames follow, or null: the display's clock. */
  get audioRate(): number | null {
    return this.rate;
  }

  /** The sound card plays `rate` sample frames a second (null: no sound, or not yet). */
  setAudio(rate: number | null): void {
    this.rate = rate;
    this.sent = 0;
    this.played = 0;
    this.reportedAt = Number.NaN;
    this.lastRefresh = Number.NaN;
  }

  /** Frames are being run on the sound card's clock (sound on, at 1× or 2×). */
  get audioLed(): boolean {
    return this.rate !== null && (this.speedNow === 1 || this.speedNow === 2);
  }

  /** The rate the emulator should make samples at so that a frame's worth plays in a frame's time at this speed. */
  sampleRate(): number | null {
    if (!this.audioLed || this.rate === null) return null;
    return this.rate / (this.speedNow as number);
  }

  /** Sample frames one machine frame makes at this speed. */
  samplesPerFrame(): number {
    const rate = this.sampleRate();
    return rate === null ? 0 : rate / this.frameRate;
  }

  /** The worklet has played `played` sample frames in all (since setAudio), as of `now`. */
  reported(played: number, now: number): void {
    this.played = played;
    this.reportedAt = now;
  }

  /** `samples` sample frames were sent to the worklet. */
  sentSamples(samples: number): void {
    this.sent += samples;
  }

  /** Sample frames queued at the worklet now, by the last report and the time since it. */
  queued(now: number): number {
    if (this.rate === null) return 0;
    const since = Number.isNaN(this.reportedAt) ? 0 : Math.min(REPORT_STALE_MS, Math.max(0, now - this.reportedAt));
    const played = Math.min(this.sent, this.played + (since * this.rate) / 1000);
    return this.sent - played;
  }

  /**
   * How many frames to run at `now`: on a display refresh, or when the worklet reports. Infinity flat out: as many as
   * the page has time for.
   */
  due(now: number, refresh: boolean): number {
    if (this.speedNow === 'pause') return 0;
    if (this.speedNow === 'max') return refresh ? Infinity : 0;
    if (this.audioLed) {
      const perFrame = this.samplesPerFrame();
      const short = AUDIO_TARGET_FRAMES * perFrame - this.queued(now);
      return short > 0 ? Math.min(AUDIO_BURST, Math.ceil(short / perFrame)) : 0;
    }
    if (!refresh) return 0;
    if (Number.isNaN(this.lastRefresh)) {
      this.lastRefresh = now;
      return 0;
    }
    const gap = now - this.lastRefresh;
    this.lastRefresh = now;
    if (gap > MAX_GAP_MS) {
      this.owed = 0;
      return 1;
    }
    this.owed += (gap / 1000) * this.frameRate * this.speedNow;
    const n = Math.floor(this.owed);
    this.owed -= n;
    return n;
  }
}
