import { group } from "../../../harness.ts";

group("two", { covers: ["src/two"], why: "a stand-in's" })("runs", () => "two ran");
