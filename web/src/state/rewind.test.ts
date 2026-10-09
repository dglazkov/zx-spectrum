import { describe, expect, it } from 'vitest';
import { Rewind } from './rewind';

const moment = (frame: number, size = 10) => ({ frame, state: new Uint8Array(size), picture: new Uint8Array(size) });

describe('rewinding', () => {
  it('keeps a moment every so often, and only the last so many', () => {
    const r = new Rewind(50, 4);
    for (let f = 0; f <= 1000; f++) if (r.due(f)) r.add(moment(f));
    expect(r.list().map((m) => m.frame)).toEqual([850, 900, 950, 1000]);
  });

  it('keeps no more than its bytes allow', () => {
    const r = new Rewind(1, 100, 100);
    for (let f = 0; f < 10; f++) r.add(moment(f, 20));
    expect(r.length).toBe(2);
    expect(r.bytes).toBe(80);
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
