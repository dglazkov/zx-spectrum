import { describe, expect, it } from 'vitest';
import { coloursOf, Rewind } from './rewind';

const moment = (frame: number, size = 10) => ({ frame, state: new Uint8Array(size), picture: new Uint8Array(size), colours: new Uint16Array(16) });

describe('rewinding', () => {
  it('keeps a moment every so often, and only the last so many', () => {
    const r = new Rewind(50, 4);
    for (let f = 0; f <= 1000; f++) if (r.due(f)) r.add(moment(f));
    expect(r.list().map((m) => m.frame)).toEqual([850, 900, 950, 1000]);
  });

  it('keeps no more than its bytes allow', () => {
    // Each moment is its state, its picture and 32 bytes besides: 72.
    const r = new Rewind(1, 100, 150);
    for (let f = 0; f < 10; f++) r.add(moment(f, 20));
    expect(r.length).toBe(2);
    expect(r.bytes).toBe(144);
  });

  it('keeps ten minutes, a moment every half second, by default', () => {
    const r = new Rewind();
    for (let f = 0; f <= 50 * 60 * 12; f++) if (r.due(f)) r.add({ frame: f, state: new Uint8Array(9000), colours: new Uint16Array(16) });
    expect(r.length).toBe(1200);
    expect(r.list()[1].frame - r.list()[0].frame).toBe(25);
    expect(r.bytes).toBeLessThan(12 * 1024 * 1024);
  });

  it('samples a picture’s colours', () => {
    const picture = new Uint8Array(352 * 296).fill(7);
    picture.fill(9, 0, 97 * 10);
    const c = coloursOf(picture);
    expect(c[9]).toBe(10);
    expect(c[7] + c[9]).toBe(Math.ceil(picture.length / 97));
  });

  it('goes back to a moment and lets go of the ones after it', () => {
    const r = new Rewind(10, 10);
    for (let f = 0; f < 50; f += 10) r.add(moment(f));
    expect(r.goBack(2)?.frame).toBe(20);
    expect(r.list().map((m) => m.frame)).toEqual([0, 10, 20]);
    expect(r.due(25)).toBe(false);
    expect(r.due(30)).toBe(true);
    expect(r.goBack(9)).toBeUndefined();
  });
});
