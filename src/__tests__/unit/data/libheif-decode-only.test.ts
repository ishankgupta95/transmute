import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * THE /licenses PAGE MAKES A LICENSING CLAIM ABOUT THESE BYTES. This file is
 * that claim, re-derived from the artifact on every `npm test`.
 *
 * The claim: libheif-js's build is DECODE-ONLY, and that is what keeps the
 * HEIC engine LGPL rather than GPL. libheif can be built against x265 to
 * ENCODE HEVC, and x265 is GPL-2.0 — conveying it would put the whole closed
 * app under the GPL, which is the exact outcome MuPDF was removed to avoid.
 * "We picked the decode build" is not a thing to remember; a version bump is
 * one `npm update` away from changing it silently.
 *
 * Why a byte scan and not a package-metadata check: the npm `license` field
 * says LGPL-3.0 whatever is compiled in. The binary is the only witness.
 *
 * ⚠ NEVER `strings file | grep -q PATTERN` for this. Under `set -o pipefail`
 * that construct returns 141 and reports clean on a binary that matches — the
 * repo has been bitten by exactly that. Bytes are read into a Buffer and
 * matched with indexOf, and every negative scan has a POSITIVE CONTROL beside
 * it so a scan that read nothing cannot pass as a scan that found nothing.
 */

const root = resolve(__dirname, "../../../..");

/*
 * Measured in node_modules, where `copy:wasm` READS them from, not in public/
 * where it writes them — the copies there are gitignored, so a public/ path
 * would go red on a clean checkout for the wrong reason.
 */
const ARTIFACTS = [
  "node_modules/libheif-js/libheif-wasm/libheif.js",
  "node_modules/libheif-js/libheif-wasm/libheif.wasm",
] as const;

/** Every GPL-licensed encoder libheif can be built against. */
const GPL_ENCODERS = [
  "x265",
  "x264",
  "libaom",
  "rav1e",
  "SvtAv1",
  "kvazaar",
  "openh264",
  "vvenc",
  "uvg266",
] as const;

/**
 * One string per artifact that MUST be present. Without these the scan below
 * proves nothing: an empty buffer, a path typo or a stubbed file would all
 * report "no GPL encoders" just as loudly as a clean decode build.
 */
const POSITIVE_CONTROLS: Record<string, readonly string[]> = {
  "node_modules/libheif-js/libheif-wasm/libheif.js": ["de265", "heif_context_read"],
  "node_modules/libheif-js/libheif-wasm/libheif.wasm": ["libde265", "HEVC"],
};

function occurrences(haystack: Buffer, needle: string): number {
  const pattern = Buffer.from(needle, "latin1");
  let count = 0;
  let at = 0;
  while ((at = haystack.indexOf(pattern, at)) !== -1) {
    count++;
    at++;
  }
  return count;
}

describe("the shipped libheif build is decode-only", () => {
  it.each(ARTIFACTS)("%s contains no GPL encoder", (relative) => {
    const bytes = readFileSync(resolve(root, relative));
    expect(bytes.length, "artifact is empty — the scan would read nothing").toBeGreaterThan(0);

    // Positive controls FIRST: if these are absent the negative result below
    // is meaningless, and the failure should say which half broke.
    for (const control of POSITIVE_CONTROLS[relative]) {
      expect(
        occurrences(bytes, control),
        `positive control "${control}" is absent — this scan is not reading libheif`,
      ).toBeGreaterThan(0);
    }

    for (const encoder of GPL_ENCODERS) {
      expect(
        occurrences(bytes, encoder),
        `"${encoder}" is linked into ${relative}. It is GPL, the app is closed-source, ` +
          `and /licenses states this build encodes nothing. Do not ship this.`,
      ).toBe(0);
    }
  });

  /*
   * ⚠ A TEST THAT USED TO STAND HERE HAS BEEN DELETED, and what it was is worth
   * more than what it asserted. It scanned the two shipped artifacts for
   * "Affero" and required 0 hits — and those artifacts are compiled code that
   * contains no licence text of any kind, so the scan could not have failed on
   * any input. It is the same shape as this repo's recorded `grep || echo good`
   * class: a licensing gate that reads as vigilance and asserts nothing.
   *
   * What replaced it can actually fail: the package's DECLARED licence. A
   * version bump is the realistic way this changes, and npm metadata is where
   * it would show first.
   */
  it("is still declared LGPL-3.0 by the package itself", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(root, "node_modules/libheif-js/package.json"), "utf8"),
    ) as { license?: string; version?: string };
    expect(pkg.license, "libheif-js changed its declared licence").toBe("LGPL-3.0");
    // Pinned because /licenses names this exact version, and because the
    // decode-only fact above is a property of a BUILD, not of the project.
    expect(pkg.version, "/licenses names the version — update both together").toBe("1.23.2");
  });

  it("is the pair /licenses says it is, at the size the homepage quotes", () => {
    // The disclosure is the SUM, because loadLibheif() fetches the glue and
    // then the binary — a browser that gets one gets both.
    const total = ARTIFACTS.reduce(
      (sum, relative) => sum + readFileSync(resolve(root, relative)).length,
      0,
    );
    expect(`${(total / 1024 / 1024).toFixed(1)} MB`).toBe("1.4 MB");
  });
});
