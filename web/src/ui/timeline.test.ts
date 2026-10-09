import { describe, expect, it } from 'vitest';
import { clock, placeOf, secondsAt } from './timeline';

describe('the rewind strip’s scale', () => {
  it('gives the newest seconds the room: eight seconds back is a tenth of ten minutes’ strip, a minute back nearly half', () => {
    expect(placeOf(0, 600)).toBe(0);
    expect(placeOf(600, 600)).toBeCloseTo(1, 9);
    expect(placeOf(8, 600)).toBeGreaterThan(0.09);
    expect(placeOf(60, 600)).toBeGreaterThan(0.38);
    // On a strip of a minute (or less: it spans a minute at least), eight seconds is a quarter of it.
    expect(placeOf(8, 20)).toBeCloseTo(placeOf(8, 60), 9);
    expect(placeOf(8, 60)).toBeGreaterThan(0.2);
  });

  it('reads back what it places, and runs one way', () => {
    for (const span of [30, 60, 240, 600])
      for (let s = 0; s <= span; s += span / 37) {
        expect(secondsAt(placeOf(s, span), span)).toBeCloseTo(s, 6);
        expect(placeOf(s + 0.5, span)).toBeGreaterThan(placeOf(s, span));
      }
  });

  it('says times as a clock does', () => {
    expect(clock(8.4)).toBe('8 s');
    expect(clock(65)).toBe('1:05');
    expect(clock(600)).toBe('10:00');
  });
});
