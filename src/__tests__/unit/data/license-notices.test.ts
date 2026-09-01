import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The /licenses page tells every visitor that the generated notices file
 * "cannot quietly drift from what is actually installed". Nothing made that
 * true: `scripts/generate-license-notices.mjs` is run by hand, so adding a
 * dependency and shipping would have left the claim standing over a stale file
 * with every other gate green. This is the mechanism that backs the sentence.
 *
 * It regenerates into a temporary location and compares. A failure here is not
 * a test problem — it means the checked-in notices no longer describe the
 * installed tree, and the fix is to run:
 *
 *     node scripts/generate-license-notices.mjs
 *
 * and commit the result.
 */

const ROOT = process.cwd();
const NOTICES = ["public/licenses/third-party-notices.txt", "public/licenses/font-notices.txt"];

describe("generated license notices are current", () => {
  it("regenerating produces byte-identical files", () => {
    const before = NOTICES.map((file) => readFileSync(resolve(ROOT, file), "utf8"));

    execFileSync("node", ["scripts/generate-license-notices.mjs"], {
      cwd: ROOT,
      stdio: "pipe",
    });

    const after = NOTICES.map((file) => readFileSync(resolve(ROOT, file), "utf8"));

    NOTICES.forEach((file, i) => {
      expect(
        after[i],
        `${file} is out of date — run: node scripts/generate-license-notices.mjs`,
      ).toBe(before[i]);
    });
  });

  it("names every package the generator could not cover", () => {
    /*
       Packages that publish no license file have to be listed by hand on
       /licenses, and the generator prints them precisely so that list can be
       maintained. If this fails, the generator found a package the page does
       not mention — add it there before shipping.
    */
    const output = execFileSync("node", ["scripts/generate-license-notices.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });

    const uncovered = output
      .split("\n")
      .filter((line) => line.trim().startsWith("- "))
      .map((line) => line.trim().slice(2).split(" ")[0]);

    const page = readFileSync(resolve(ROOT, "src/app/licenses/page.tsx"), "utf8");
    for (const name of uncovered) {
      expect(page, `${name} ships no license file and is not named on /licenses`).toContain(name);
    }
  });
});
