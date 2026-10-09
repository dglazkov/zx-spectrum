// The screen without WebGL: the frame through the palette into an ImageData, scaled up with no smoothing. The
// television here is only its lines: a darker gap below each Spectrum line, drawn over the picture.

import { FRAME_HEIGHT, FRAME_WIDTH } from '../emulator/emulator';
import type { Crop, DisplayMode, Fit } from './fit';
import type { Pixels, Renderer } from './renderer';

export class Canvas2dRenderer implements Renderer {
  readonly kind = 'canvas2d';
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly source = document.createElement('canvas');
  private readonly sourceCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly words: Uint32Array;
  private readonly lut = new Uint32Array(16);
  private readonly last = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  private mode: DisplayMode = 'sharp';
  private crop: Crop = { id: 'full', name: '', x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('this browser can draw neither WebGL 2 nor 2D');
    this.ctx = ctx;
    this.source.width = FRAME_WIDTH;
    this.source.height = FRAME_HEIGHT;
    const sourceCtx = this.source.getContext('2d');
    if (!sourceCtx) throw new Error('no 2D canvas');
    this.sourceCtx = sourceCtx;
    this.image = sourceCtx.createImageData(FRAME_WIDTH, FRAME_HEIGHT);
    this.words = new Uint32Array(this.image.data.buffer);
  }

  setPalette(rgb: Uint8Array): void {
    // ImageData is RGBA in memory, so a little-endian word is ABGR.
    for (let i = 0; i < 16; i++) this.lut[i] = (0xff << 24) | (rgb[i * 3 + 2] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3];
    this.draw(this.last);
  }

  setView(mode: DisplayMode, crop: Crop): void {
    this.mode = mode;
    this.crop = crop;
  }

  setSize(size: Fit): void {
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.canvas.style.width = `${size.cssWidth}px`;
    this.canvas.style.height = `${size.cssHeight}px`;
  }

  draw(frame: Uint8Array): void {
    if (frame !== this.last) this.last.set(frame);
    const { words, lut } = this;
    for (let i = 0; i < words.length; i++) words[i] = lut[frame[i] & 15];
    this.sourceCtx.putImageData(this.image, 0, 0);
    this.present();
  }

  present(): void {
    const { ctx, canvas, crop } = this;
    ctx.imageSmoothingEnabled = this.mode === 'tv';
    ctx.drawImage(this.source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    if (this.mode === 'tv') {
      const line = canvas.height / crop.height;
      if (line >= 3) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        for (let y = 0; y < crop.height; y++) ctx.fillRect(0, Math.round((y + 0.62) * line), canvas.width, Math.max(1, Math.round(line * 0.38)));
      }
    }
  }

  readPixels(): Pixels {
    const { width, height } = this.canvas;
    return { width, height, data: new Uint8Array(this.ctx.getImageData(0, 0, width, height).data.buffer) };
  }
}
