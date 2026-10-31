import { group } from "../../../../harness.ts";

const why = "a stand-in's";
group("library", { covers: ["web/src/library/**"], why })("opens", async ({ page }) => void (await page.locator("p").waitFor()));
group("playback", { covers: ["web/src/playback/**"], why })("opens", async ({ page }) => void (await page.locator("p").waitFor()));
