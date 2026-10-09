import { describe, expect, it } from 'vitest';
import { softLimit } from './sound';

describe('the soft limit after the level', () => {
  it('leaves everything under 0.8 alone, and nothing past full scale', () => {
    const curve = softLimit(4097);
    const at = (x: number) => curve[Math.round(((x + 2) / 4) * 4096)];
    for (const x of [-0.8, -0.5, 0, 0.3, 0.79]) expect(at(x)).toBeCloseTo(x, 3);
    for (const x of [-2, -1.2, 1, 1.5, 2]) expect(Math.abs(at(x))).toBeLessThan(1);
    expect(at(1)).toBeGreaterThan(0.9);
    // It never turns back on itself.
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });
});
