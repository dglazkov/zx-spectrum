// Which emulator the page runs: the real machine (wasm.ts, crates/spectrum compiled to WebAssembly), or, when the
// page's address asks for it (`?emulator=stub`, for tests of the page alone), the stand-in (stub.ts). The stand-in is
// never put in the real one's place: a machine that will not start (the module not fetched, a browser without
// WebAssembly) is an error the page says, with a way to try again, rather than a Spectrum whose games stop at their
// loading screens.

import type { Emulator } from './emulator';

type Core = { createWasmEmulator(): Promise<Emulator> };

// A glob, so that the page builds whether or not the core's wrapper exists yet.
const cores = import.meta.glob<Core>('./wasm.ts');

export interface Running {
  readonly emulator: Emulator;
  /** 'wasm' for the real core, 'stub' for the stand-in. */
  readonly kind: 'wasm' | 'stub';
}

export async function createEmulator(prefer: 'wasm' | 'stub' = 'wasm'): Promise<Running> {
  if (prefer === 'stub') {
    const { createStub } = await import('./stub');
    return { emulator: await createStub(), kind: 'stub' };
  }
  const wasm = cores['./wasm.ts'];
  if (!wasm) throw new Error('this page was built without the machine');
  if (typeof WebAssembly !== 'object') throw new Error('this browser runs no WebAssembly');
  return { emulator: await (await wasm()).createWasmEmulator(), kind: 'wasm' };
}
