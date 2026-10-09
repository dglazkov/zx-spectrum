// The play cards' checks (tests/wasm/games/): each game loaded from its own tape on the WebAssembly machine, started as
// its card says, and its controls tried. They need the module built (scripts/build-wasm.sh) and the games' tapes
// (scripts/fixture). `nerd test cards` runs them.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/wasm/games/*.spec.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    reporters: process.env.NERD_REPORT ? ['default', './tests/nerd-reporter.mjs'] : ['default'],
  },
});
