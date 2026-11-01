import { group } from "../../../harness.ts";

group("shares", { each: false, why: "a stand-in's" })("says its own", { covers: ["src/mine.ts"] }, () => "ran");
