// The page starts here: the emulator (the real machine, compiled to WebAssembly) and the screen are made together, then
// the app around them. `?emulator=stub` asks for the stand-in; `?renderer=2d` for the 2D canvas; `?sound=off` for no
// sound card at all (the machine then runs on the display's clock alone, as the page's tests want it); `?game=<ZXDB id>`
// loads that game.
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
    createEmulator(params.get('emulator') === 'stub' ? 'stub' : 'wasm'),
    createRenderer(canvas, params.get('renderer') === '2d' ? 'canvas2d' : 'webgl2'),
  ]);
  const app = new App({ emulator: running.emulator, kind: running.kind, renderer, canvas, sound: params.get('sound') !== 'off' });
  window.zx = { app, emulator: running.emulator, renderer, kind: running.kind };
  document.body.dataset.emulator = running.kind;
  document.body.dataset.renderer = renderer.kind;
  document.body.dataset.ready = '';
}

main().catch((e: Error) => {
  console.error(e);
  // In the set the first paint drew (index.html), or on its own: what happened, and a way to try again.
  const card = document.createElement('div');
  card.className = 'fatal';
  card.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = 'The Spectrum would not start';
  const why = document.createElement('p');
  why.textContent = `${e.message.replace(/^./, (c) => c.toUpperCase())}. The page may not have come through whole (the network), or this browser may be too old for it.`;
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn btn-primary';
  again.textContent = 'Try again';
  again.addEventListener('click', () => location.reload());
  card.append(title, why, again);
  (document.querySelector('.boot-tube') ?? document.body).append(card);
  document.body.dataset.failed = '';
});
