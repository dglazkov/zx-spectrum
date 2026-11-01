import { group } from "../../../harness.ts";

// A group of three: two that say their files, in place of the group's, and one that goes by the group's.
const test = group("apart", { each: true, covers: ["src/apart"], why: "a stand-in's" });
test("says one file", { covers: ["src/mine.ts"] }, () => "ran");
test("says more", { covers: ["src/mine.ts", "src/more/**", "!src/more/README.md"] }, () => "ran");
test("says none", () => "ran");

// A group whose one part puts aside what the group covers.
group("wide", { each: true, covers: ["src/wide"], why: "a stand-in's" })("says its own", { covers: ["src/wide/a.ts"] }, () => "ran");
