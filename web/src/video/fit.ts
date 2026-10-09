// How much of the picture to show, and how big. The emulator hands out 352 × 296 pixels, the paper at (48, 48) with
// 48 pixels of border at left, right and top and 56 at the bottom; what a television showed of that is the page's.

import { FRAME_HEIGHT, FRAME_WIDTH, PAPER_X, PAPER_Y } from '../emulator/emulator';

export type CropId = 'full' | 'tv' | 'paper';

export interface Crop {
  readonly id: CropId;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The crops. 'tv' is what a PAL television of the time showed: the picture tube overscanned, hiding the edges of the
 * 52 µs active line and of the 288 active lines of a field. At the ULA's 7 MHz pixel clock the active line is 364
 * pixels; a set showing about 88% of it shows 320, and about 89% of the field's lines, 256, centred on the frame.
 * docs/web.md has the arithmetic.
 */
export const CROPS: Readonly<Record<CropId, Crop>> = {
  full: { id: 'full', name: 'All the border', x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT },
  tv: { id: 'tv', name: 'As a television showed it', x: 16, y: 20, width: 320, height: 256 },
  paper: { id: 'paper', name: 'The paper alone', x: PAPER_X, y: PAPER_Y, width: 256, height: 192 },
};

export type DisplayMode = 'sharp' | 'tv';

/**
 * A Spectrum pixel's width over its height on a PAL television: 1/7 MHz wide, against the 13.5 MHz samples of
 * ITU-R BT.601, whose PAL pixels are 59:54; and one line of a non-interlaced field tall, two lines of a 576-line frame.
 * (13.5 / 7) × (59 / 54) / 2 = 1.054.
 */
export const PAL_PIXEL_ASPECT = ((13.5 / 7) * (59 / 54)) / 2;

export interface Fit {
  /** The canvas's size in device pixels. */
  readonly width: number;
  readonly height: number;
  /** And in CSS pixels. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Device pixels a Spectrum pixel is, across (an integer in sharp mode). */
  readonly scale: number;
}

/**
 * The canvas for `crop` in a space `cssWidth` × `cssHeight` CSS pixels on a display of `dpr` device pixels a CSS
 * pixel. Sharp: the largest whole number of device pixels a Spectrum pixel (at least one), square. Television: as
 * large as fits, a Spectrum pixel PAL_PIXEL_ASPECT times as wide as it is tall.
 */
export function fit(crop: Crop, mode: DisplayMode, cssWidth: number, cssHeight: number, dpr: number): Fit {
  const availW = Math.max(1, Math.floor(cssWidth * dpr));
  const availH = Math.max(1, Math.floor(cssHeight * dpr));
  if (mode === 'sharp') {
    const scale = Math.max(1, Math.floor(Math.min(availW / crop.width, availH / crop.height)));
    const width = crop.width * scale;
    const height = crop.height * scale;
    return { width, height, cssWidth: width / dpr, cssHeight: height / dpr, scale };
  }
  const aspect = (crop.width * PAL_PIXEL_ASPECT) / crop.height;
  let width = availW;
  let height = Math.round(width / aspect);
  if (height > availH) {
    height = availH;
    width = Math.round(height * aspect);
  }
  return { width, height, cssWidth: width / dpr, cssHeight: height / dpr, scale: width / crop.width };
}
