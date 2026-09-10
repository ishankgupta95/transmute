import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * The licensing gate on the checked-in qpdf artifact.
 *
 * qpdf is Apache-2.0, but it can be built against GnuTLS (LGPL) or OpenSSL for
 * its crypto. The whole reason this repo compiles qpdf itself
 * (scripts/build-qpdf-wasm.sh, -DUSE_IMPLICIT_CRYPTO=OFF
 * -DREQUIRE_CRYPTO_NATIVE=ON) is to be able to PROVE that only qpdf's own
 * Apache-2.0 "native" provider is in the static-link set. That proof is worth
 * nothing if it only ran once on one laptop, so it runs here too, against the
 * exact bytes in vendor/qpdf/.
 *
 * WHY THE BUFFER IS SEARCHED DIRECTLY, and not through `strings`:
 *
 *     if strings big.wasm | grep -qi openssl; then …
 *
 * is a gate that CANNOT FAIL. grep exits at the first match, `strings` dies of
 * SIGPIPE, and under `set -o pipefail` the pipeline status is 141 — so the
 * `if` takes the ELSE branch precisely when it found something. Its cousin,
 * `grep … || echo "clean"`, swallows the exit status outright. Both idioms are
 * on this repo's record (see the LICENSING GATE block in
 * scripts/build-qpdf-wasm.sh, which reads the strings into a variable for the
 * same reason). Reading the file into a Buffer and asking it for byte offsets
 * has no pipeline and no exit status to lose.
 *
 * And an all-clear from a negative search is also what a failed read, an empty
 * file or a typo'd path would produce — so the POSITIVE assertion at the
 * bottom is what makes this gate real. Proven to fail: splicing the bytes
 * "openssl" into a scratch copy turns the negative red, and blanking the
 * "native" string turns the positive red.
 */

const WASM = resolve(process.cwd(), "vendor/qpdf/qpdf.wasm");
const GLUE = resolve(process.cwd(), "vendor/qpdf/qpdf.js");

/** qpdf 12.4.1, built by scripts/build-qpdf-wasm.sh. See vendor/qpdf/README.md. */
const WASM_BYTES = 2340730;
const WASM_SHA256 = "9c85419773af72b1883533225f63dc3c609f305a610944a27a954cd0d9159e1a";
const GLUE_BYTES = 63089;

/**
 * A copy with every ASCII A–Z folded to lower case, so a case-insensitive
 * search stays a byte comparison. `toString().toLowerCase()` would drag the
 * binary through Unicode case-folding rules it has no business obeying.
 */
function asciiLowercased(buffer: Buffer): Buffer {
  const out = Buffer.from(buffer);
  for (let i = 0; i < out.length; i += 1) {
    const byte = out[i];
    if (byte >= 0x41 && byte <= 0x5a) out[i] = byte + 0x20;
  }
  return out;
}

describe("the vendored qpdf artifact", () => {
  const wasm = readFileSync(WASM);
  const lowercased = asciiLowercased(wasm);

  it("is the exact binary this repo measured", () => {
    // A swapped or re-linked artifact fails here rather than shipping quietly:
    // every behaviour the engine's comments cite was measured against these
    // bytes. Rebuilding qpdf means updating these pins and vendor/qpdf/README.md.
    expect(wasm.length).toBe(WASM_BYTES);
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(WASM_SHA256);

    const glue = readFileSync(GLUE);
    expect(glue.length).toBe(GLUE_BYTES);
    // The glue and the binary must come from the same link. This is the line
    // the wasm lookup and the module factory both depend on.
    expect(glue.toString("utf8")).toContain("export default createQpdfModule;");
  });

  it.each(["gnutls", "openssl", "libgcrypt", "nettle"])(
    "links no %s",
    (name) => {
      const at = lowercased.indexOf(Buffer.from(name, "ascii"));
      expect(
        at,
        `found "${name}" at byte ${at} of vendor/qpdf/qpdf.wasm — a non-permissive crypto backend is linked in. Rebuild with -DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON.`,
      ).toBe(-1);
    },
  );

  it("does contain qpdf's own Apache-2.0 native crypto provider", () => {
    /*
      The assertion that makes the four above mean something. qpdf registers
      its providers by name, so the NUL-delimited C string "native" is present
      exactly when the native provider was compiled in — and absent from a
      truncated, empty or wrong file, which is also how the negative searches
      would look.
    */
    const nulDelimited = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from("native", "ascii"),
      Buffer.from([0x00]),
    ]);
    expect(
      wasm.indexOf(nulDelimited),
      "vendor/qpdf/qpdf.wasm does not contain the native crypto provider's name — check that -DREQUIRE_CRYPTO_NATIVE=ON survived configure.",
    ).toBeGreaterThan(-1);
  });
});
