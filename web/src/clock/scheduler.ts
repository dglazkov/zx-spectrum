// When to run the machine's frames. The emulator never reads a clock: the page decides how many frames to run, and
// this decides for it, from one of two clocks.
//
// - The sound card's, once sound is allowed: the audio worklet plays each frame's samples and says how many it has
//   played; frames are run to keep about 3 frames' worth queued ahead of it. The machine then runs at exactly its own
//   rate measured against the sound card's crystal, whatever the display's refresh is and however the two drift
//   apart: a frame more or a frame less now and then absorbs the drift, and no sample is ever dropped or invented.
//   While the page is shown, frames are run on its refreshes only, as many as the time since the last refresh owes
//   at the machine's rate, nudged a little each refresh towards the queue it should have: so a 50 Hz machine on a
//   60 Hz display shows a new frame on five refreshes in six and never two on one (a frame run between two
//   refreshes would never be seen, and the motion would judder). Frames are run on the sound card's reports when
//   the refreshes stop (a hidden tab), or when the queue is about to run dry.
// - The display's, before that (no gesture yet: the browser holds sound back) or flat out: frames are owed at the
//   machine's frame rate by the time between display refreshes, and run as they come due.
//
// Time comes in as an argument (milliseconds, as performance.now() gives it), so tests drive it with a fake clock.

export type Speed = 'pause' | 1 | 2 | 'max';

/** The frames kept queued at the sound card: about 3 before a refresh's frame goes in, 4 after. */
export const AUDIO_TARGET_FRAMES = 3;

/** The most frames run at once on the sound card's clock, after a stall. */
const AUDIO_BURST = 4;

/**
 * How far the queue may stray from its target, in frames, before a frame is added or left out to bring it back: its
 * measure is noisy, so it is smoothed over a second or so first, and a correction is made at most once a second. On a
 * 60 Hz display a frame is added on a refresh that would have had none, so no refresh ever has two; only the drift
 * between the sound card's crystal and the page's clock needs one, every few seconds or less often.
 */
const AUDIO_BAND = 0.5;
const QUEUE_SMOOTHING = 0.05;
const CORRECTION_EVERY_MS = 1000;

/** A queue this short (frames) is filled at once, refresh or report: it is a frame or so from running dry. */
const AUDIO_LOW = 1.5;

/** How fast the measure of the display's period follows the refreshes. */
const PERIOD_LEARN = 0.02;

/** Past this many milliseconds without a refresh the display has stopped (a hidden tab): the reports run frames. */
const REFRESH_STALE_MS = 60;

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
  /** The display's refresh period, ms, as measured (on the sound card's clock, frames are paced by it). */
  private period = Number.NaN;
  /** The sound card's queue at the refreshes, frames, smoothed; a frame to add (1) or leave out (-1) for the drift, and when the next may be. */
  private queueSmoothed = Number.NaN;
  private pending = 0;
  private pendingSince = 0;
  private correctAfter = -Infinity;

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
    this.queueSmoothed = Number.NaN;
    this.pending = 0;
    this.correctAfter = -Infinity;
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
    if (this.audioLed) return this.dueOnAudio(now, refresh);
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

  /** On the sound card's clock: see the top of this file. */
  private dueOnAudio(now: number, refresh: boolean): number {
    const perFrame = this.samplesPerFrame();
    const queued = this.queued(now) / perFrame;
    const fill = () => Math.max(0, Math.min(AUDIO_BURST, Math.ceil(AUDIO_TARGET_FRAMES - queued)));
    if (!refresh) {
      // A report: frames only if the refreshes have stopped, or the queue is nearly dry.
      const shown = !Number.isNaN(this.lastRefresh) && now - this.lastRefresh <= REFRESH_STALE_MS;
      return !shown || queued < AUDIO_LOW ? fill() : 0;
    }
    const gap = now - this.lastRefresh;
    this.lastRefresh = now;
    if (Number.isNaN(gap) || gap > MAX_GAP_MS) {
      // The first refresh, or the first after a long while: the queue made up at once.
      this.owed = 0;
      return fill();
    }
    // The time a refresh stands for: the display's period, as measured over many (a refresh handled a millisecond
    // late, the next on time, are each one period), times the periods the gap spans (a refresh missed is two).
    if (Number.isNaN(this.period) || this.period <= 0) this.period = gap;
    const periods = Math.max(1, Math.round(gap / this.period));
    if (periods === 1) this.period += (gap - this.period) * PERIOD_LEARN;
    const time = periods * this.period;
    this.owed += (time / 1000) * this.frameRate * (this.speedNow as number);
    // Rounded rather than cut: on a display as fast as the machine (50 Hz) a refresh handled late then never makes
    // one of two frames and one of none, and the frames keep in step with the refreshes.
    let n = Math.max(0, Math.round(this.owed));
    this.owed -= n;
    // The drift, made up a frame at a time.
    this.queueSmoothed = Number.isNaN(this.queueSmoothed) ? queued : this.queueSmoothed + (queued - this.queueSmoothed) * QUEUE_SMOOTHING;
    if (now >= this.correctAfter && !this.pending) {
      const error = AUDIO_TARGET_FRAMES - this.queueSmoothed;
      this.pending = error > AUDIO_BAND ? 1 : error < -AUDIO_BAND ? -1 : 0;
      this.pendingSince = now;
    }
    // An extra frame goes on a refresh that has none (or, on a display no faster than the machine, which has none,
    // on any after a few); one left out comes off a refresh that has one.
    if ((this.pending > 0 && (n === 0 || now - this.pendingSince > 100)) || (this.pending < 0 && n > 0)) {
      n += this.pending;
      this.queueSmoothed += this.pending;
      this.pending = 0;
      this.correctAfter = now + CORRECTION_EVERY_MS;
    }
    // Never so few that the queue nearly runs dry, nor so many that it piles up (the sound card silent, its reports
    // stopped: nothing plays what is sent).
    const before = n;
    if (queued + n < AUDIO_LOW) n = Math.ceil(AUDIO_TARGET_FRAMES - queued);
    n = Math.min(n, AUDIO_BURST, Math.max(0, Math.ceil(AUDIO_TARGET_FRAMES + 2.5 - queued)));
    this.owed += before - n;
    this.owed = Math.max(-1, Math.min(1, this.owed));
    return n;
  }
}
