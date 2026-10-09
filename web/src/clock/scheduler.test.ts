import { describe, expect, it } from 'vitest';
import { AUDIO_TARGET_FRAMES, FrameScheduler } from './scheduler';

const FRAME_RATE = 3_500_000 / 69_888; // the 48K: 50.08 Hz

/** A random source that is the same every run. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('frames on the display’s clock (no sound yet)', () => {
  const refreshes = (hz: number, seconds: number, speed: 1 | 2 = 1) => {
    const s = new FrameScheduler(FRAME_RATE);
    s.speed = speed;
    let frames = 0;
    for (let i = 0; i <= hz * seconds; i++) frames += s.due((i * 1000) / hz, true);
    return frames;
  };

  it('runs the machine at its own rate whatever the display refreshes at', () => {
    for (const hz of [50, 60, 75, 120, 144]) expect(Math.abs(refreshes(hz, 60) - FRAME_RATE * 60)).toBeLessThanOrEqual(1);
  });

  it('runs twice as many at 2×, none paused', () => {
    expect(Math.abs(refreshes(60, 60, 2) - FRAME_RATE * 120)).toBeLessThanOrEqual(1);
    const s = new FrameScheduler(FRAME_RATE);
    s.speed = 'pause';
    expect(s.due(0, true) + s.due(1000, true)).toBe(0);
  });

  it('does not catch up a long gap (a hidden tab) with a burst of frames', () => {
    const s = new FrameScheduler(FRAME_RATE);
    s.due(0, true);
    s.due(16, true);
    expect(s.due(5016, true)).toBe(1);
    expect(s.due(5032, true)).toBeLessThanOrEqual(1);
  });

  it('asks for as many as there is time for, flat out', () => {
    const s = new FrameScheduler(FRAME_RATE);
    s.speed = 'max';
    expect(s.due(0, true)).toBe(Infinity);
    expect(s.due(0, false)).toBe(0);
  });
});

/**
 * The sound card, simulated: a worklet playing 128-sample blocks at its own crystal's rate (which drifts from the
 * page's clock), saying when it has played a frame's worth, its messages arriving late by a few milliseconds; and the
 * page, refreshing at 60 Hz with jitter, running the frames the scheduler asks for (each frame 958 or 959 samples).
 */
function simulate(o: { seconds: number; drift: number; speed?: 1 | 2; stallAt?: number; stallMs?: number; seed?: number; audioStopAt?: number; audioStopMs?: number; hiddenAt?: number; hiddenMs?: number; refreshHz?: number; burstSamples?: number }) {
  const rate = 48_000;
  const rnd = random(o.seed ?? 1);
  const s = new FrameScheduler(FRAME_RATE);
  s.speed = o.speed ?? 1;
  s.setAudio(rate);
  const chunks: number[] = []; // samples in each queued frame
  let head = 0; // samples of chunks[0] played
  let played = 0;
  let owed = 0;
  let framesRun = 0;
  let underruns = 0;
  let starving = false;
  let minQueued = Infinity;
  let maxQueued = 0;
  const queuedFrames = () => (chunks.reduce((a, b) => a + b, 0) - head) / s.samplesPerFrame();
  const inbox: { at: number; played: number }[] = [];
  const runFrames = (n: number) => {
    for (let i = 0; i < n; i++) {
      owed += (s.sampleRate() ?? rate) / FRAME_RATE;
      const samples = Math.floor(owed);
      owed -= samples;
      chunks.push(samples);
      s.sentSamples(samples);
      framesRun++;
    }
  };
  const blockMs = (128 / (rate * (1 + o.drift))) * 1000;
  let nextBlock = 0;
  let nextRefresh = 0;
  let refreshes = 0;
  const end = o.seconds * 1000;
  let t = 0;
  let framesWhileStopped = 0;
  let maxSent = 0;
  // Frames run on each refresh, and on reports while the page is shown (frames no refresh shows), after the start.
  const perRefresh = new Map<number, number>();
  let onReportsShown = 0;
  const burst = o.burstSamples ?? 128;
  let blockCount = 0;
  while (t < end) {
    t = Math.min(nextBlock, nextRefresh, inbox[0]?.at ?? Infinity);
    const stalled = o.stallAt !== undefined && t >= o.stallAt && t < o.stallAt + (o.stallMs ?? 0);
    // The sound card stops: its context suspended (a phone call, the system's), or the device gone. No blocks are
    // played and nothing is reported, while the page goes on refreshing.
    const stopped = o.audioStopAt !== undefined && t >= o.audioStopAt && t < o.audioStopAt + (o.audioStopMs ?? Infinity);
    // The tab hidden: no display refreshes, the sound card's reports only.
    const hidden = o.hiddenAt !== undefined && t >= o.hiddenAt && t < o.hiddenAt + (o.hiddenMs ?? 0);
    if (t === nextBlock && stopped) {
      nextBlock += blockMs;
      continue;
    }
    if (t === nextBlock) {
      // The audio thread plays a block, stall or not.
      let finished = false;
      for (let i = 0; i < 128; i++) {
        if (!chunks.length) {
          if (!starving && t > 500) underruns++;
          starving = true;
          continue;
        }
        starving = false;
        played++;
        if (++head >= chunks[0]) {
          chunks.shift();
          head = 0;
          finished = true;
        }
      }
      // The audio thread renders a hardware buffer's blocks back to back: its reports come in bursts.
      if (finished) inbox.push({ at: t + 1 + rnd() * 7 + (burst > 128 ? ((blockCount % (burst / 128)) * -blockMs) % (burst / rate * 1000) : 0), played });
      blockCount++;
      if (t > 1000) {
        const q = queuedFrames();
        minQueued = Math.min(minQueued, q);
        maxQueued = Math.max(maxQueued, q);
      }
      nextBlock += blockMs;
    } else if (t === nextRefresh) {
      if (!stalled && !hidden) {
        const before = framesRun;
        runFrames(s.due(t, true));
        if (stopped) framesWhileStopped += framesRun - before;
        if (t > 2000) perRefresh.set(framesRun - before, (perRefresh.get(framesRun - before) ?? 0) + 1);
      }
      maxSent = Math.max(maxSent, queuedFrames());
      // The display's refreshes keep their own crystal's time; each is handled a little late, by up to 3 ms.
      refreshes++;
      nextRefresh = (refreshes * 1000) / (o.refreshHz ?? 60) + rnd() * 3;
    } else {
      if (stalled) {
        inbox[0].at = o.stallAt! + o.stallMs!; // the main thread is busy: the message waits
        inbox.sort((a, b) => a.at - b.at);
        continue;
      }
      const m = inbox.shift()!;
      s.reported(m.played, t);
      const before = framesRun;
      runFrames(s.due(t, false));
      if (t > 2000 && !hidden && !stalled) onReportsShown += framesRun - before;
    }
  }
  return { framesRun, played, underruns, minQueued, maxQueued, perFrame: s.samplesPerFrame(), framesWhileStopped, maxQueuedEver: maxSent, perRefresh, onReportsShown };
}

describe('frames on the sound card’s clock', () => {
  // The queue: about 3 frames before a refresh's frame goes in and 4 after, let drift a third of a frame either way
  // before it is pulled back (QUEUE_BAND), so never under 1.5 nor over 5 (100 ms).
  const LOW = AUDIO_TARGET_FRAMES - 1.5;
  const HIGH = AUDIO_TARGET_FRAMES + 2;

  it(`keeps about ${AUDIO_TARGET_FRAMES} to 4 frames queued, with no underrun, over ten minutes`, () => {
    const r = simulate({ seconds: 600, drift: 0 });
    expect(r.underruns).toBe(0);
    expect(r.minQueued).toBeGreaterThan(LOW);
    expect(r.maxQueued).toBeLessThan(HIGH);
  });

  it('follows the sound card’s crystal, not the page’s clock, when they drift apart', () => {
    for (const drift of [-0.004, 0.004]) {
      const r = simulate({ seconds: 300, drift });
      expect(r.underruns).toBe(0);
      // Frames run match the samples played, whatever the page's clock said: the queue neither empties nor grows.
      expect(Math.abs(r.framesRun - r.played / r.perFrame)).toBeLessThan(AUDIO_TARGET_FRAMES + 2);
      expect(r.minQueued).toBeGreaterThan(LOW);
      expect(r.maxQueued).toBeLessThan(HIGH);
    }
  });

  it('runs at twice the rate at 2×, the samples made at half the rate', () => {
    const r = simulate({ seconds: 60, drift: 0, speed: 2 });
    expect(r.underruns).toBe(0);
    expect(Math.abs(r.framesRun - 2 * FRAME_RATE * 60)).toBeLessThan(10);
  });

  it('runs dry when the page stalls for longer than the queue, and fills it again at once', () => {
    const r = simulate({ seconds: 20, drift: 0, stallAt: 10_000, stallMs: 150, seed: 7 });
    expect(r.underruns).toBe(1);
    const healthy = simulate({ seconds: 20, drift: 0, stallAt: 10_000, stallMs: 40, seed: 7 });
    expect(healthy.underruns).toBe(0); // a stall shorter than the queue goes unheard
  });

  it('runs no frames on the page’s refreshes when the sound card stops, and queues nothing for it', () => {
    // Ten seconds with the sound card stopped and the page refreshing at 60 Hz: without its reports the machine waits
    // (the page then moves to the display's clock, app.ts), rather than running 3 frames a refresh into a queue that
    // nothing plays.
    const r = simulate({ seconds: 15, drift: 0, audioStopAt: 3000, audioStopMs: 10_000 });
    expect(r.framesWhileStopped).toBeLessThan(10);
    expect(r.maxQueuedEver).toBeLessThan(AUDIO_TARGET_FRAMES + 8);
    // And when it plays again, what little was queued plays out and the queue is as it was.
    expect(r.underruns).toBe(0);
  });

  it('runs frames on the refreshes alone while the page is shown, never two on one: no frame goes unseen', () => {
    for (const [drift, burstSamples, seed] of [[0, 128, 1], [0.004, 128, 2], [-0.004, 512, 3], [0.001, 1024, 4]] as const) {
      const r = simulate({ seconds: 120, drift, burstSamples, seed });
      expect(r.underruns).toBe(0);
      expect(r.onReportsShown).toBe(0);
      // At 60 Hz, 50 frames a second: one on five refreshes in six, none on the sixth.
      expect([...r.perRefresh.keys()].sort()).toEqual([0, 1]);
      const ones = r.perRefresh.get(1)! / (r.perRefresh.get(0)! + r.perRefresh.get(1)!);
      expect(Math.abs(ones - (FRAME_RATE * (1 + drift)) / 60)).toBeLessThan(0.01);
      expect(r.minQueued).toBeGreaterThan(LOW);
      // (What a burst of the audio thread's has not rendered yet counts as queued until the next burst.)
      expect(r.maxQueued).toBeLessThan(HIGH + (burstSamples - 128) / r.perFrame);
    }
    // On a 50 Hz display, a frame a refresh, and now and then two or none for the drift (the machine is 50.08 Hz).
    for (const drift of [0, 0.002, -0.002]) {
      const fifty = simulate({ seconds: 120, drift, refreshHz: 50 });
      expect(fifty.underruns).toBe(0);
      expect(fifty.perRefresh.get(1)! / [...fifty.perRefresh.values()].reduce((a, b) => a + b)).toBeGreaterThan(0.97);
    }
    // And on a fast one (144 Hz), one frame a refresh at most.
    const fast = simulate({ seconds: 60, drift: 0.001, refreshHz: 144 });
    expect([...fast.perRefresh.keys()].sort()).toEqual([0, 1]);
  });

  it('keeps playing in a hidden tab, on the sound card’s reports alone', () => {
    const r = simulate({ seconds: 120, drift: 0.002, hiddenAt: 10_000, hiddenMs: 100_000 });
    expect(r.underruns).toBe(0);
    expect(Math.abs(r.framesRun - r.played / r.perFrame)).toBeLessThan(AUDIO_TARGET_FRAMES + 2);
  });
});
