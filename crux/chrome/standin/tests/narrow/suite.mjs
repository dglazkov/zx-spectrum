import { serve } from "../../serve.mjs";

export default {
  serve,
  shared: ["src/shared.ts"],
  // What a change stands for, read against NERD_BASE (crux#195): serve.mjs, as git has it at the base and unchanged, for
  // two's file; a file neither there nor at the base, for nothing.
  narrow: {
    "serve.mjs": (was, now) => (was !== null && was === now ? ["src/two/b.ts"] : null),
    "src/nothing.ts": (was, now) => (was === null && now === null ? [] : null),
  },
};
