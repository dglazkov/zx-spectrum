import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Loop } from './loop';
import { FrameScheduler } from './scheduler';

const FRAME_RATE = 3_500_000 / 69_888;

/** Display refreshes, simulated: requestAnimationFrame's callbacks run when the test says, on a clock it moves. */
function display() {
  let callbacks: (() => void)[] = [];
  let now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => (callbacks.push(cb), callbacks.length));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    /** The next refresh of a display of `period` ms: on its grid, the first after what has run (an overrun misses one). */
    refresh(period: number) {
      now = period ? (Math.floor(now / period + 1e-9) + 1) * period : now;
      const run = callbacks;
      callbacks = [];
      for (const cb of run) cb();
    },
    get pending() {
      return callbacks.length;
    },
  };
}

describe('the loop', () => {
  let d: ReturnType<typeof display>;
  beforeEach(() => {
    d = display();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('goes on after a frame throws, and hands the error over', () => {
    const s = new FrameScheduler(FRAME_RATE);
    let frames = 0;
    let fail = true;
    const errors: unknown[] = [];
    const loop = new Loop(s, {
      runFrame: () => {
        frames++;
        if (fail) {
          fail = false;
          throw new WebAssembly.RuntimeError('unreachable');
        }
      },
      present: () => {},
      now: () => d.now,
      failed: (e) => errors.push(e),
    });
    loop.start();
    for (let i = 0; i < 120; i++) d.refresh(1000 / 60);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(WebAssembly.RuntimeError);
    // The next refresh was asked for all along: the machine ran on.
    expect(d.pending).toBe(1);
    expect(frames).toBeGreaterThan(90);
  });

  it('goes on after showing a picture throws', () => {
    const s = new FrameScheduler(FRAME_RATE);
    let presents = 0;
    const errors: unknown[] = [];
    const loop = new Loop(s, {
      runFrame: () => {},
      present: () => {
        if (++presents === 3) throw new Error('lost the context');
      },
      now: () => d.now,
      failed: (e) => errors.push(e),
    });
    loop.start();
    for (let i = 0; i < 10; i++) d.refresh(1000 / 60);
    expect(presents).toBe(10);
    expect(errors).toHaveLength(1);
  });

  it('flat out, runs frames for the same share of each second whatever the display’s rate', () => {
    const share = (hz: number) => {
      const s = new FrameScheduler(FRAME_RATE);
      s.speed = 'max';
      let busy = 0;
      const loop = new Loop(s, {
        // Each frame costs a fifth of a millisecond of the page's clock.
        runFrame: () => {
          d.advance(0.2);
          busy += 0.2;
        },
        present: () => {},
        now: () => d.now,
      });
      const from = d.now;
      loop.start();
      while (d.now - from < 2000) d.refresh(1000 / hz);
      loop.stop();
      return busy / (d.now - from);
    };
    const at60 = share(60);
    const at120 = share(120);
    const at30 = share(30);
    expect(at60).toBeGreaterThan(0.4);
    expect(Math.abs(at120 - at60)).toBeLessThan(0.08);
    expect(Math.abs(at30 - at60)).toBeLessThan(0.08);
  });

  it('flat out, stops the batch once the machine is not to run flat out any more', () => {
    const s = new FrameScheduler(FRAME_RATE);
    s.speed = 'max';
    let frames = 0;
    const loop = new Loop(s, {
      runFrame: () => {
        frames++;
        // The tape stops on the fifth frame: the page goes back to 1×.
        if (frames === 5) s.speed = 1;
      },
      present: () => {},
      // A clock that does not move (a test's): only the cap would end the batch.
      now: () => d.now,
    });
    loop.start();
    d.refresh(0);
    expect(frames).toBe(5);
  });
});
