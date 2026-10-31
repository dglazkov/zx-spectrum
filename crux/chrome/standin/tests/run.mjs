// The runner of a stand-in product whose harness is at tests/ (crux#118): harness.test.mts runs it.
import { run } from "../../harness.ts";

await run({ root: process.env.STANDIN_ROOT ?? new URL("..", import.meta.url), tests: new URL(".", import.meta.url) });
