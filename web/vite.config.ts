/// <reference types="vitest/config" />
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
// The deployed server (crates/app), started beside the dev server, which passes it what is the server's: the
// pass-through (/archive to the archive, /zxinfo/v3 to the ZXInfo API, and the ZXDB's own index where ZXInfo cannot
// answer), nerd's /nerd/event and /nerd/feedback (their lines printed here), and nerd's widget, /nerd-feedback.js.
// So the page sees in both the one server, not a copy of it. ZXINFO_ORIGIN and ZXDB_INDEX go to it from here, as a
// test sets them (tests/page/harness.mjs).
import { startApp } from './app.mjs';

const serverPlugin = (): Plugin => ({
  name: 'zx-server',
  async config(_config, { command }) {
    // Not for a build, nor for Vitest, which serves no page.
    if (command !== 'serve' || process.env.VITEST) return;
    // It serves no files here (the dev server does): an empty directory of its own.
    const dir = mkdtempSync(join(tmpdir(), 'zx-dev-app-'));
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
    const app = await startApp(dir);
    const to: ProxyOptions = { target: app.url };
    const proxy = { '/archive/': to, '/zxinfo/': to, '/nerd/': to, '/nerd-feedback.js': to };
    return { server: { proxy }, preview: { proxy } };
  },
});

// A built page as a reader is sent it: no comment, and no line's indentation, but inside a script, a style, a pre or a
// textarea, where they are the content. The source keeps both, for whoever reads it; the reader is sent ~130 B less of
// the emulator's page, and ~80 B less of how.html, compressed (#23: as much as crux's load script grew by).
export const tight = (html: string) =>
  html
    .split(/(<(script|style|pre|textarea)\b[\s\S]*?<\/\2>)/i)
    .map((part, i) => (i % 3 === 1 ? part : i % 3 === 2 ? '' : part.replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]+|[ \t]+$/gm, '').replace(/\n{2,}/g, '\n')))
    .join('');

const tightPlugin = (): Plugin => ({
  name: 'zx-tight',
  apply: 'build',
  transformIndexHtml: { order: 'post', handler: tight },
});

export default defineConfig({
  base: './',
  plugins: [serverPlugin(), tightPlugin()],
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
