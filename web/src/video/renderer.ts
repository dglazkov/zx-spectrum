// The screen: a frame of palette indices in, a picture on a canvas out. WebGL 2 where there is one (webgl.ts: the
// palette, then sharp pixels or a television), a 2D canvas where there is not (canvas2d.ts).

import type { Crop, DisplayMode, Fit } from './fit';

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, the top row first. */
  readonly data: Uint8Array;
}

export interface Renderer {
  readonly kind: 'webgl2' | 'canvas2d';
  readonly canvas: HTMLCanvasElement;
  /** 16 × RGB, 0–255. */
  setPalette(rgb: Uint8Array): void;
  setView(mode: DisplayMode, crop: Crop): void;
  /** The canvas's size, from fit(). */
  setSize(size: Fit): void;
  /** A new frame, shown. */
  draw(frame: Uint8Array): void;
  /** The last frame again (after a change of size, view or palette). */
  present(): void;
  /** What the canvas shows now. */
  readPixels(): Pixels;
}

export async function createRenderer(canvas: HTMLCanvasElement, prefer: 'webgl2' | 'canvas2d' = 'webgl2'): Promise<Renderer> {
  if (prefer === 'webgl2') {
    const { WebGlRenderer } = await import('./webgl');
    const gl = WebGlRenderer.create(canvas);
    if (gl) return gl;
  }
  const { Canvas2dRenderer } = await import('./canvas2d');
  return new Canvas2dRenderer(canvas);
}
