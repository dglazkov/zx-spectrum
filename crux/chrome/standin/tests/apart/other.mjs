import { group } from "../../../harness.ts";

// A file of its own: a change to the other runs nothing here.
group("other", { each: true, why: "a stand-in's" })("says its own", { covers: ["src/other.ts"] }, () => "ran");
