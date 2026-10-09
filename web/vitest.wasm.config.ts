// The WebAssembly build's own tests (tests/wasm/), apart from the page's unit tests: they need the module built
// (scripts/build-wasm.sh) and, for one, the native build run beside it. `nerd test wasm` runs them.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/wasm/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Each test a part of nerd's report, where nerd asks for one.
    reporters: process.env.NERD_REPORT ? ['default', './tests/nerd-reporter.mjs'] : ['default'],
  },
});
