import { describe, expect, it } from 'vitest';
import { CROPS, fit, PAL_PIXEL_ASPECT } from './fit';

describe('sizing the screen', () => {
  it('makes each Spectrum pixel a whole number of device pixels in sharp mode', () => {
    const f = fit(CROPS.tv, 'sharp', 1000, 800, 1);
    expect(f.scale).toBe(3);
    expect([f.width, f.height]).toEqual([960, 768]);
    const phone = fit(CROPS.tv, 'sharp', 358, 600, 3);
    expect(phone.scale).toBe(3);
    expect(phone.cssWidth).toBeCloseTo(320);
  });

  it('never goes below one device pixel a pixel', () => {
    expect(fit(CROPS.full, 'sharp', 100, 100, 1).scale).toBe(1);
  });

  it('fills the space at a PAL television’s pixel shape in television mode', () => {
    expect(PAL_PIXEL_ASPECT).toBeCloseTo(1.054, 3);
    const f = fit(CROPS.tv, 'tv', 1000, 1000, 1);
    expect(f.width).toBe(1000);
    expect(f.width / f.height).toBeCloseTo((320 * PAL_PIXEL_ASPECT) / 256, 2);
    const tall = fit(CROPS.tv, 'tv', 2000, 500, 2);
    expect(tall.height).toBe(1000);
  });

  it('crops what a television showed, centred on the frame, and the paper exactly', () => {
    const tv = CROPS.tv;
    expect(tv.x * 2 + tv.width).toBe(352);
    expect(tv.y * 2 + tv.height).toBe(296);
    expect(CROPS.paper).toMatchObject({ x: 48, y: 48, width: 256, height: 192 });
  });
});
