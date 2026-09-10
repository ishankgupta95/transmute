import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
 *
 * ⚠ THAT SENTENCE USED TO BE FALSE, AND THE FALSEHOOD MATTERED. This test ran
 * the generator with `cwd: ROOT` and the generator wrote to its own repo-root
 * path — so it OVERWROTE the checked-in file between the `before` read and the
 * `after` read. A stale notices file therefore went red exactly ONCE and was
 * silently repaired by the very run that reported it; the next run was green
 * with no further action, which reads as "I fixed it" when nothing was fixed.
 * A gate that cannot fail twice is the subtle form of this repo's "a
 * verification gate that cannot fail proves nothing" rule, and it also meant a
 * unit test mutated the working tree. `--out-dir` was added to the generator
 * for this; the comparison is now real and the tree is left alone.
 */

const ROOT = process.cwd();
const NOTICES = ["public/licenses/third-party-notices.txt", "public/licenses/font-notices.txt"];

describe("generated license notices are current", () => {
  it("regenerating produces byte-identical files", () => {
    const checkedIn = NOTICES.map((file) => readFileSync(resolve(ROOT, file), "utf8"));

    const scratch = mkdtempSync(join(tmpdir(), "transmute-notices-"));
    try {
      execFileSync("node", ["scripts/generate-license-notices.mjs", "--out-dir", scratch], {
        cwd: ROOT,
        stdio: "pipe",
      });

      const regenerated = NOTICES.map((file) =>
        readFileSync(join(scratch, file.split("/").pop() as string), "utf8"),
      );

      NOTICES.forEach((file, i) => {
        expect(
          regenerated[i],
          `${file} is out of date — run: node scripts/generate-license-notices.mjs`,
        ).toBe(checkedIn[i]);
      });

      // The checked-in files must be exactly as they were: this test reads the
      // tree, it does not repair it.
      NOTICES.forEach((file, i) => {
        expect(readFileSync(resolve(ROOT, file), "utf8")).toBe(checkedIn[i]);
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("names every package the generator could not cover", () => {
    /*
       Packages that publish no license file have to be listed by hand on
       /licenses, and the generator prints them precisely so that list can be
       maintained. If this fails, the generator found a package the page does
       not mention — add it there before shipping.
    */
    /*
      --out-dir here too, and for the same reason as above: without it this
      second run ALSO rewrote the checked-in notices, which is how the stale-file
      failure kept repairing itself even after the first test stopped doing it.
      Found by mutation-testing the fix — appending a marker line went red once
      and green on the re-run until this call was changed as well.
    */
    const scratch = mkdtempSync(join(tmpdir(), "transmute-notices-"));
    let output: string;
    try {
      output = execFileSync(
        "node",
        ["scripts/generate-license-notices.mjs", "--out-dir", scratch],
        { cwd: ROOT, encoding: "utf8" },
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

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
