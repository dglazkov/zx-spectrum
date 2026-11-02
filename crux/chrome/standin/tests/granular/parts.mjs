import { group } from "../../../harness.ts";

const why = "a stand-in's";
group("one", { covers: ["granular/a.ts"], why })("runs", () => "ran");
group("two", { covers: ["granular/b.ts", "granular/wide.ts"], why })("runs", () => "ran");
group("three", { covers: ["granular/c.ts", "granular/wide.ts"], why })("runs", () => "ran");
group("four", { covers: ["granular/d.ts"], why })("runs", () => "ran");
