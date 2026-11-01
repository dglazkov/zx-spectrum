import { group } from "../../../harness.ts";

const test = group("suite's", { why: "a stand-in's" });
test("says its own", { covers: ["src/mine.ts"] }, () => "ran");
test("says none", () => "ran");
