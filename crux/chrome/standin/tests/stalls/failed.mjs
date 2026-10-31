// What the machine cannot have done: this fails however long it stalled, so it runs only when asked for.
import { group } from "../../../harness.ts";
import { stall } from "../../serve.mjs";

group("failing", { why: "a machine that stops" })("fails beside a stall", async () => {
  await stall(100);
  throw new Error("this is the code's");
});
