// The runner of a stand-in product whose harness is in web/tests (crux#118), a page of its own, its covers from the root.
import { run } from "../../../harness.ts";

await run({ root: new URL("../..", import.meta.url), tests: new URL(".", import.meta.url), limit: 20 });
