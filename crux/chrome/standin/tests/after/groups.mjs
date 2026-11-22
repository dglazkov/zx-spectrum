// Two groups so a filtered or changed run runs only one of them.
import { group } from "../../../harness.ts";

const first = group("first", { covers: ["standin/tests/after/first.mjs"], why: "testing after on a whole run" });
first("passes", () => undefined);

const second = group("second", { covers: ["standin/tests/after/second.mjs"], why: "testing after on a partial run" });
second("passes", () => undefined);
