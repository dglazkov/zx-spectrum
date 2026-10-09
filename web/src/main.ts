// The page starts here: the emulator (the real core if it is wired in, the stand-in if not) and the screen are made
// together, then the app around them. `?emulator=stub` asks for the stand-in; `?renderer=2d` for the 2D canvas.
// When everything is up, <body> gets data-ready, and window.zx holds the parts, for tests and for the curious.

import './style.css';
import { App } from './app';
import { createEmulator } from './emulator';
import type { Emulator } from './emulator/emulator';
import { createRenderer, type Renderer } from './video/renderer';

declare global {
  interface Window {
    zx?: { app: App; emulator: Emulator; renderer: Renderer; kind: 'wasm' | 'stub' };
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const canvas = document.createElement('canvas');
  const [running, renderer] = await Promise.all([
    createEmulator(params.get('emulator') === 'stub' ? 'stub' : 'auto'),
    createRenderer(canvas, params.get('renderer') === '2d' ? 'canvas2d' : 'webgl2'),
  ]);
  const app = new App({ emulator: running.emulator, kind: running.kind, renderer, canvas });
  window.zx = { app, emulator: running.emulator, renderer, kind: running.kind };
  document.body.dataset.emulator = running.kind;
  document.body.dataset.renderer = renderer.kind;
  document.body.dataset.ready = '';
}

main().catch((e: Error) => {
  console.error(e);
  const p = document.createElement('p');
  p.className = 'fatal';
  p.textContent = `The Spectrum would not start: ${e.message}`;
  document.body.append(p);
});
