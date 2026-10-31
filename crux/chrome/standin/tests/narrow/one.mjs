import { group } from "../../../harness.ts";

group("one", { covers: ["src/one/**", "!src/one/README.md"], why: "a stand-in's" })("runs", () => "one ran");
