import { group } from "../../../harness.ts";

for (const name of ["north", "east", "south", "west"]) {
  const test = group(name, { why: "a stand-in's" });
  for (const title of ["first", "second", "third", "fourth"]) test(title, () => undefined);
}
