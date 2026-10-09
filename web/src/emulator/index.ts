// Which emulator the page runs. The real core, when it is wired in, is web/src/emulator/wasm.ts, exporting
// `createWasmEmulator(): Promise<Emulator>` (docs/web.md says what it must do); until that file exists the page runs
// the stand-in (stub.ts). `?emulator=stub` in the page's address asks for the stand-in whatever there is.

import type { Emulator } from './emulator';

type Core = { createWasmEmulator(): Promise<Emulator> };

// A glob, so that the page builds whether or not the core's wrapper exists yet.
const cores = import.meta.glob<Core>('./wasm.ts');

export interface Running {
  readonly emulator: Emulator;
  /** 'wasm' for the real core, 'stub' for the stand-in. */
  readonly kind: 'wasm' | 'stub';
}

export async function createEmulator(prefer: 'auto' | 'stub' = 'auto'): Promise<Running> {
  const wasm = cores['./wasm.ts'];
  if (prefer === 'auto' && wasm) {
    try {
      return { emulator: await (await wasm()).createWasmEmulator(), kind: 'wasm' };
    } catch (e) {
      console.error('The emulator core would not start; running the stand-in instead.', e);
    }
  }
  const { createStub } = await import('./stub');
  return { emulator: await createStub(), kind: 'stub' };
}
