/// <reference types="vitest/config" />
import { defineConfig, type Connect, type Plugin } from 'vite';
// The production server's pass-through (/archive to the archive, /zxinfo to the ZXInfo API), used by the dev server
// as it is, so that the page sees the same thing in both.
// nerd's /nerd/event and /nerd/feedback are answered as the production server answers them, the line printed here.
import { nerdTelemetry, passThrough } from './server.mjs';

const serverPaths: Connect.NextHandleFunction = (req, res, next) => {
  passThrough(req, res)
    .then((handled) => handled || nerdTelemetry(req, res))
    .then((handled) => (handled ? undefined : next()), next);
};

const passThroughPlugin = (): Plugin => ({
  name: 'zx-pass-through',
  configureServer(server) {
    server.middlewares.use(serverPaths);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serverPaths);
  },
});

export default defineConfig({
  base: './',
  plugins: [passThroughPlugin()],
  // The ROMs live at the repository's root (the core compiles them in); the stand-in reads the 48K's font from there.
  server: { port: 5173, fs: { allow: ['..'] } },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: true,
    // Two pages: the emulator, and how.html, the log of how it was built (src/how/).
    rollupOptions: { input: { main: 'index.html', how: 'how.html' } },
  },
  worker: { format: 'es' },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.mjs'],
    environment: 'node',
  },
});
