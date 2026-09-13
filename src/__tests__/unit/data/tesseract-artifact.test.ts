import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The gate on the OCR engine and the language model it reads.
 *
 * Two different worries, one file:
 *
 *   1. THE MODEL IS CHECKED IN, so it is the one artifact here that no package
 *      manager will ever re-verify. `vendor/tessdata/eng.traineddata.gz` is
 *      1.9 MB of opaque bytes that a reader cannot eyeball, and the whole
 *      reason it is in the repo rather than fetched is that fetching it at
 *      build time would mean trusting a CDN at exactly the moment this site
 *      promises not to. A checked-in binary with no gate behind it is just a
 *      CDN with worse latency.
 *
 *   2. THE VARIANT IS PINNED, and pinning is load-bearing rather than tidy.
 *      `ocr.ts` names one core file explicitly because tesseract.js's own
 *      selector, given a directory, appends one of six `*.wasm.js` names —
 *      the single-file builds with the binary base64'd inside, 3.9–4.7 MB
 *      each. If a future edit re-points `corePath` at the directory, the site
 *      would serve a file it does not stage, 404, and fall back to nothing.
 *      Asserting the staged filenames is how that stays true.
 *
 * WHY THE BUFFER IS SEARCHED DIRECTLY rather than through `strings`: the same
 * reason qpdf-artifact.test.ts gives at length —
 *
 *     if strings core.wasm | grep -qi gpl; then …
 *
 * cannot fail. grep exits at the first match, `strings` dies of SIGPIPE, and
 * under `set -o pipefail` the pipeline status is 141, so the `if` takes the
 * ELSE branch precisely when it found something. There is no pipeline here.
 *
 * And a negative search that finds nothing is indistinguishable from a failed
 * read, an empty file or a typo'd path — so every negative below is paired
 * with a positive over the same bytes. Proven to fail in both directions:
 * splicing "GPL" into a scratch copy of the core reddens the licence scan, and
 * blanking Tesseract's own version string reddens the positive.
 */

const root = process.cwd();

/** What `copy:wasm` stages into `public/tesseract/`, and where each comes from. */
const STAGED = {
  "tesseract.esm.min.js": "node_modules/tesseract.js/dist/tesseract.esm.min.js",
  "worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "tesseract-core-simd-lstm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
} as const;

/** See vendor/tessdata/README.md — both hashes are recorded there too. */
const MODEL_GZ = resolve(root, "vendor/tessdata/eng.traineddata.gz");
const MODEL_GZ_BYTES = 1967599;
const MODEL_GZ_SHA256 = "f1c22599ed6fd3eb821d87fdb43e09f98b61179a4abe38c43cfca2cdcb9f5ec2";
const MODEL_RAW_BYTES = 4113088;
const MODEL_RAW_SHA256 = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2";

/** The measured total the homepage, /privacy and /offline-access all quote. */
const BUNDLE_BYTES = 5_088_998;

/** As in qpdf-artifact.test.ts: fold ASCII A–Z only, so the search stays byte work. */
function asciiLowercased(buffer: Buffer): Buffer {
  const out = Buffer.from(buffer);
  for (let i = 0; i < out.length; i += 1) {
    const byte = out[i];
    if (byte >= 0x41 && byte <= 0x5a) out[i] = byte + 0x20;
  }
  return out;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("the checked-in OCR language model", () => {
  const gz = readFileSync(MODEL_GZ);

  it("is the exact tessdata_fast English model this repo measured", () => {
    expect(gz.length).toBe(MODEL_GZ_BYTES);
    expect(sha256(gz)).toBe(MODEL_GZ_SHA256);
  });

  it("decompresses to the upstream file, byte for byte", () => {
    /*
      The pin that actually matters. The .gz is OUR artifact — we produced it
      with `gzip -9 -n` — so hashing it proves only that nobody re-compressed
      it. Hashing what comes OUT is what ties it to
      tesseract-ocr/tessdata_fast's published eng.traineddata, and it is what
      would catch a model quietly swapped for the `best` line (15.4 MB) or the
      legacy one, either of which the LSTM-only core cannot drive.
    */
    const raw = gunzipSync(gz);
    expect(raw.length).toBe(MODEL_RAW_BYTES);
    expect(sha256(raw)).toBe(MODEL_RAW_SHA256);
  });

  it("was compressed reproducibly, with no filename or timestamp in the header", () => {
    /*
      gzip writes the source filename and mtime into the header unless told
      not to. With them, this file's bytes differ on every machine that
      regenerates it and the hash above stops meaning anything. FLG is byte 3;
      bit 3 (FNAME) must be clear, and MTIME is bytes 4-7.
    */
    expect(gz[0], "not a gzip stream").toBe(0x1f);
    expect(gz[1], "not a gzip stream").toBe(0x8b);
    expect(gz[3] & 0b0000_1000, "FNAME set — regenerate with `gzip -9 -n`").toBe(0);
    expect(gz.readUInt32LE(4), "MTIME set — regenerate with `gzip -9 -n`").toBe(0);
  });
});

describe("the OCR engine artifacts", () => {
  it("stages exactly the files ocr.ts names, at the sizes disclosed", () => {
    /*
      POSITIVE CONTROL for everything below, and a real check in its own
      right: `ocr.ts` builds each URL through `engineUrl(...)`, so a rename on
      either side is a runtime 404 that no type system sees.
    */
    const ocr = readFileSync(resolve(root, "src/lib/tools/ocr.ts"), "utf8");
    expect(ocr.length).toBeGreaterThan(1000);

    /*
      ⚠ THE .wasm IS DELIBERATELY ABSENT FROM ocr.ts, and that asymmetry is the
      single most surprising thing about this engine. tesseract.js hands
      Emscripten no `locateFile`, so the core glue resolves its own binary
      against `self.location.href` — which, inside the worker, is
      worker.min.js's URL. Nothing on our side ever writes that filename.
      So the glue is what must name it, and asserting that here is what keeps
      the "all five stay siblings" rule from being merely a comment.
    */
    const glue = readFileSync(resolve(root, STAGED["tesseract-core-simd-lstm.js"]), "utf8");
    expect(glue, "the core glue no longer names its own binary").toContain(
      "tesseract-core-simd-lstm.wasm",
    );

    let total = statSync(MODEL_GZ).size;
    for (const [served, source] of Object.entries(STAGED)) {
      const size = statSync(resolve(root, source)).size;
      expect(size, `${source} is empty`).toBeGreaterThan(0);
      if (served.endsWith(".wasm")) {
        expect(glue, `nothing resolves ${served}`).toContain(served);
      } else {
        expect(ocr, `ocr.ts never names ${served}`).toContain(served);
      }
      total += size;
    }

    // The figure the homepage ENGINES row, /privacy and the offline bundle all
    // quote. Derived from the files rather than repeated from them.
    expect(total, "the disclosed bundle size no longer matches the artifacts").toBe(BUNDLE_BYTES);
  });

  it("pins the LSTM-only SIMD core rather than letting the library choose", () => {
    const ocr = readFileSync(resolve(root, "src/lib/tools/ocr.ts"), "utf8");
    /*
      tesseract.js decides `corePath` is a FILE with a literal two-character
      test — `corePath.slice(-2) === "js"`. Anything else is a directory and
      the six fat single-file builds come back into play, none of which this
      repo stages or discloses. So: the specifier must end in `.js`, and it
      must not be the bare directory.
    */
    expect(ocr).toContain('engineUrl("tesseract-core-simd-lstm.js"');
    expect(ocr, "the blob worker default hangs with no error — see ocr.ts").toContain(
      "workerBlobURL: false",
    );
    // Relaxed SIMD is false in WebKit (measured with wasm-feature-detect's own
    // probe); a relaxedsimd core would fail one of this repo's own e2e projects.
    expect(ocr).not.toContain("relaxedsimd");
  });

  it("links in no copyleft component", () => {
    /*
      Tesseract is Apache-2.0 and leptonica (its image layer) is BSD-2, so the
      expected answer is "nothing". This repo has settled that AGPL is
      disqualifying and that GPL is not extended beyond the FFmpeg core, and
      that decision is only worth anything if it is checked against the bytes
      that actually ship rather than against an npm field.
    */
    const core = asciiLowercased(
      readFileSync(resolve(root, STAGED["tesseract-core-simd-lstm.wasm"])),
    );

    // POSITIVE CONTROLS FIRST. Without these a typo'd path passes every line below.
    expect(core.length, "core read as empty").toBeGreaterThan(1_000_000);
    expect(core.includes(Buffer.from("tesseract")), "not the Tesseract binary").toBe(true);
    expect(core.includes(Buffer.from("leptonica")), "leptonica absent — wrong build?").toBe(true);

    for (const forbidden of ["gnu general public", "affero", "lgpl", "gpl-3", "copyleft"]) {
      expect(
        core.includes(Buffer.from(forbidden)),
        `"${forbidden}" appears in the shipped OCR core`,
      ).toBe(false);
    }
  });

  it("declares both packages as devDependencies, so the notices generator skips them", () => {
    /*
      NOT a style preference. `scripts/generate-license-notices.mjs` walks
      RUNTIME dependencies transitively; tesseract.js pulls in ~130 packages,
      almost all of them for its Node build, none of which reach a browser
      here because nothing is bundled — the five artifacts are served and
      loaded at runtime. Moving either package into `dependencies` would pour
      all of that into third-party-notices.txt and claim it ships.
      @ffmpeg/core is a devDependency for the identical reason, and both are
      named by hand on /licenses instead.
    */
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const name of ["tesseract.js", "tesseract.js-core"]) {
      expect(pkg.devDependencies[name], `${name} should be a devDependency`).toBeDefined();
      expect(pkg.dependencies[name], `${name} must not be a runtime dependency`).toBeUndefined();
    }
  });
});
