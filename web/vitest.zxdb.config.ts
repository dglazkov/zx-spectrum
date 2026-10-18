// The ZXDB's own index built from the real dump the image is built from (tests/zxdb-dump.spec.mjs), from the fixture
// cache (scripts/fixture): a few seconds. `nerd test zxdb-dump` runs it.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/zxdb-dump.spec.mjs'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: process.env.NERD_REPORT ? ['default', './tests/nerd-reporter.mjs'] : ['default'],
  },
});
