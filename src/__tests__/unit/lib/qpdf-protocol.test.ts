import { describe, it, expect } from "vitest";

import {
  QPDF_MAX_PASSWORD_BYTES,
  QPDF_MAX_PASSWORD_BYTES_AES128,
  QPDF_PERMISSIONS_ALLOW_ALL,
  buildQpdfArgv,
  isQpdfSuccess,
  maxPasswordBytes,
  passwordByteLength,
  protectionFromResult,
  qpdfErrorMessage,
  qpdfWarnings,
  type QpdfEncryptOptions,
  type QpdfJob,
  type QpdfModifyPermission,
  type QpdfPrintPermission,
  type QpdfProtection,
} from "@/lib/workers/qpdf-protocol";

/**
 * The pure half of the qpdf engine.
 *
 * jsdom cannot instantiate the WASM artifact and has no Worker, so this is the
 * only layer of the security cluster a unit test can reach at all — which is
 * exactly why the argv building, the exit classification and the error mapping
 * were put in a leaf module rather than left inside qpdf.worker.ts.
 *
 * Every expectation here is a MEASURED qpdf behaviour (qpdf 12.4.1,
 * vendor/qpdf/qpdf.wasm), not a reading of the manual. Where a flag is absent
 * from an expected argv, its absence is the point and there is a test for it.
 */

const data = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" — never parsed here.

function encryptOptions(overrides: Partial<QpdfEncryptOptions> = {}): QpdfEncryptOptions {
  return {
    userPassword: "u",
    ownerPassword: "o",
    permissions: QPDF_PERMISSIONS_ALLOW_ALL,
    bits: 256,
    ...overrides,
  };
}

describe("buildQpdfArgv", () => {
  it("builds the measured argv for each of the four operations", () => {
    expect(buildQpdfArgv({ op: "encrypt", data, options: encryptOptions() })).toEqual([
      "--encrypt",
      "--user-password=u",
      "--owner-password=o",
      "--bits=256",
      "--print=full",
      "--modify=all",
      "--",
      "in.pdf",
      "out.pdf",
    ]);

    expect(buildQpdfArgv({ op: "decrypt", data, password: "p" })).toEqual([
      "--password=p",
      "--decrypt",
      "--",
      "in.pdf",
      "out.pdf",
    ]);

    // No flags at all: writing the document back out IS the repair.
    expect(buildQpdfArgv({ op: "repair", data })).toEqual(["in.pdf", "out.pdf"]);

    // Exit-code-only query — no password, no output file.
    expect(buildQpdfArgv({ op: "classify", data })).toEqual(["--requires-password", "in.pdf"]);
  });

  it("never puts the user's filename into MEMFS", () => {
    /*
      qpdf echoes the input filename into every line it prints ("qpdf: in.pdf:
      invalid password"), so the internal names are fixed. This also pins the
      pair qpdf.worker.ts writes and reads — the two must agree.
    */
    for (const argv of [
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions() }),
      buildQpdfArgv({ op: "decrypt", data, password: "p" }),
      buildQpdfArgv({ op: "repair", data }),
    ]) {
      expect(argv.slice(-2)).toEqual(["in.pdf", "out.pdf"]);
    }
    // The query reads only.
    expect(buildQpdfArgv({ op: "classify", data }).slice(-1)).toEqual(["in.pdf"]);
  });

  it("emits --use-aes=y at 128 bits and NOT at 256", () => {
    /*
      Measured: `--bits=128` alone exits 2 ("refusing to write a file with RC4,
      a weak cryptographic algorithm") and `--bits=256 --use-aes=y` also exits 2
      ("unrecognized argument --use-aes=y"). The flag is 128-bit-only and
      mandatory there.
    */
    const at128 = buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ bits: 128 }) });
    expect(at128).toContain("--bits=128");
    expect(at128).toContain("--use-aes=y");
    expect(at128.indexOf("--use-aes=y")).toBe(at128.indexOf("--bits=128") + 1);

    const at256 = buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ bits: 256 }) });
    expect(at256).toContain("--bits=256");
    expect(at256).not.toContain("--use-aes=y");
  });

  it("maps every print and modify level to its qpdf flag", () => {
    const printFlags: Record<QpdfPrintPermission, string> = {
      full: "--print=full",
      low: "--print=low",
      none: "--print=none",
    };
    for (const [level, flag] of Object.entries(printFlags) as [QpdfPrintPermission, string][]) {
      const argv = buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({
          permissions: { ...QPDF_PERMISSIONS_ALLOW_ALL, print: level },
        }),
      });
      expect(argv).toContain(flag);
      expect(argv.filter((a) => a.startsWith("--print="))).toHaveLength(1);
    }

    const modifyFlags: Record<QpdfModifyPermission, string> = {
      all: "--modify=all",
      annotate: "--modify=annotate",
      form: "--modify=form",
      assembly: "--modify=assembly",
      none: "--modify=none",
    };
    for (const [level, flag] of Object.entries(modifyFlags) as [QpdfModifyPermission, string][]) {
      const argv = buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({
          permissions: { ...QPDF_PERMISSIONS_ALLOW_ALL, modify: level },
        }),
      });
      expect(argv).toContain(flag);
      expect(argv.filter((a) => a.startsWith("--modify="))).toHaveLength(1);
    }
  });

  it("emits --extract=n only when extraction is denied", () => {
    // --extract=y is qpdf's default, so only the denial is worth sending.
    const allowed = buildQpdfArgv({ op: "encrypt", data, options: encryptOptions() });
    expect(allowed.some((a) => a.startsWith("--extract="))).toBe(false);

    const denied = buildQpdfArgv({
      op: "encrypt",
      data,
      options: encryptOptions({
        permissions: { ...QPDF_PERMISSIONS_ALLOW_ALL, extract: false },
      }),
    });
    expect(denied).toContain("--extract=n");
  });

  it("puts every permission flag before the -- terminator", () => {
    // Measured: a permission flag after `--` is read as a filename, not an
    // option, and qpdf exits 2.
    const argv = buildQpdfArgv({
      op: "encrypt",
      data,
      options: encryptOptions({ permissions: { print: "none", modify: "none", extract: false } }),
    });
    const terminator = argv.indexOf("--");
    for (const flag of ["--print=none", "--modify=none", "--extract=n"]) {
      expect(argv.indexOf(flag)).toBeGreaterThan(-1);
      expect(argv.indexOf(flag)).toBeLessThan(terminator);
    }
  });

  it("never emits --accessibility, --allow-weak-crypto or --allow-insecure", () => {
    /*
      Each of these three would be a lie of a different kind:
        --accessibility  measured NO-OP at R=6 (P stays -4) — a checkbox for it
                         would claim a restriction the file does not carry.
        --allow-weak-crypto  writes RC4.
        --allow-insecure     measured: the resulting file opens with NO
                             password at all, i.e. it is not protected.
    */
    const everyEncryptArgv = ([256, 128] as const).flatMap((bits) =>
      [true, false].flatMap((extract) =>
        (["full", "low", "none"] as const).flatMap((print) =>
          (["all", "annotate", "form", "assembly", "none"] as const).map((modify) =>
            buildQpdfArgv({
              op: "encrypt",
              data,
              options: encryptOptions({ bits, permissions: { print, modify, extract } }),
            }),
          ),
        ),
      ),
    );

    expect(everyEncryptArgv).toHaveLength(60);
    for (const argv of everyEncryptArgv) {
      for (const forbidden of ["--accessibility", "--allow-weak-crypto", "--allow-insecure"]) {
        expect(argv.some((a) => a.startsWith(forbidden))).toBe(false);
      }
    }
  });

  it("rejects a password over the limit in UTF-8 BYTES, not characters", () => {
    /*
      The silent-data-loss case. Measured at 256: a 128-byte user password
      encrypts with rc 0 and EMPTY stderr, and the file then rejects that
      password, every truncation of it, and the empty string — only the owner
      password still opens it. qpdf never warns, so this check is the only thing
      standing between a user and a document they can never open again.
    */
    expect(QPDF_MAX_PASSWORD_BYTES).toBe(127);

    const ascii = (n: number) => "x".repeat(n);
    expect(passwordByteLength(ascii(127))).toBe(127);
    expect(() =>
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ userPassword: ascii(127) }) }),
    ).not.toThrow();
    expect(() =>
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ userPassword: ascii(128) }) }),
    ).toThrow(RangeError);

    // 密 is three UTF-8 bytes, so 43 of them is 129 bytes in 43 characters —
    // a `.length` check would wave it straight through. Measured: 42 × 密
    // round-trips, 43 × 密 does not.
    const cjk = (n: number) => "密".repeat(n);
    expect(cjk(42).length).toBe(42);
    expect(passwordByteLength(cjk(42))).toBe(126);
    expect(passwordByteLength(cjk(43))).toBe(129);
    expect(() =>
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ userPassword: cjk(42) }) }),
    ).not.toThrow();
    expect(() =>
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ userPassword: cjk(43) }) }),
    ).toThrow(RangeError);

    // The owner password goes through the same gate.
    expect(() =>
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ ownerPassword: cjk(43) }) }),
    ).toThrow(RangeError);
  });

  it("uses the AES-128 limit of 32 bytes at 128 bits, not the AES-256 limit of 127", () => {
    /*
      F1. `--bits=128` makes qpdf write revision 4, whose standard security
      handler truncates the password to 32 bytes before key derivation — rc 0,
      EMPTY stderr, no warning of any kind.

      Measured against the shipped artifact with a 60-character password at
      --bits=128 --use-aes=y:
        opens with the real 60-char password            rc 0
        opens with ONLY its first 32 characters         rc 0
        opens with first 32 + a totally different tail  rc 0
        opens with its first 31 characters              rc 2, invalid password
      The same 60-char password at 256 is refused by its first 32 characters, so
      the limit genuinely differs by mode and a single constant cannot express it.
    */
    expect(maxPasswordBytes(256)).toBe(127);
    expect(maxPasswordBytes(128)).toBe(32);
    expect(QPDF_MAX_PASSWORD_BYTES_AES128).toBe(32);

    const at = (n: number) => "x".repeat(n);

    // 32 bytes is the last one that survives a round trip at 128.
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 128, userPassword: at(32) }),
      }),
    ).not.toThrow();

    // 33 is refused at 128 and perfectly fine at 256 — the whole point.
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 128, userPassword: at(33) }),
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 256, userPassword: at(33) }),
      }),
    ).not.toThrow();

    // The reproduction from the finding, verbatim: 60 characters at AES-128.
    const sixty = "PassphraseAAAAAAAAAAAAAAAAAAAAAAZZZZZZZZZZZZZZZZZZZZZZZZZZZZ".padEnd(60, "Z");
    expect(sixty).toHaveLength(60);
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 128, userPassword: sixty }),
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 256, userPassword: sixty }),
      }),
    ).not.toThrow();

    // The owner password is truncated by exactly the same handler.
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 128, ownerPassword: at(33) }),
      }),
    ).toThrow(RangeError);

    // And the message must name the limit that actually applies, or it sends
    // the user back to trim to a number that was never the constraint.
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 128, userPassword: at(33) }),
      }),
    ).toThrow(/32 bytes/);
    expect(() =>
      buildQpdfArgv({
        op: "encrypt",
        data,
        options: encryptOptions({ bits: 256, userPassword: at(128) }),
      }),
    ).toThrow(/127 bytes/);
  });

  it("puts NO length limit on the password used to OPEN a file", () => {
    /*
      F3. 127 bounds what qpdf can WRITE at R=6. It is not a bound on what qpdf
      will ACCEPT when opening a document some other tool produced.

      Measured: a file encrypted elsewhere at --bits=128 --use-aes=y with a
      200-byte password is opened by that full 200-byte password (rc 0) and by
      its first 32 bytes (rc 0) — R=4 truncates on both sides, so it matches.
      Refusing it here blocked a file qpdf opens on the first try.
    */
    const long = "x".repeat(200);
    expect(passwordByteLength(long)).toBe(200);
    expect(buildQpdfArgv({ op: "decrypt", data, password: long })).toEqual([
      `--password=${long}`,
      "--decrypt",
      "--",
      "in.pdf",
      "out.pdf",
    ]);

    // Multi-byte too — nothing about the decrypt branch counts bytes.
    const cjk = "密".repeat(200);
    expect(passwordByteLength(cjk)).toBe(600);
    expect(() => buildQpdfArgv({ op: "decrypt", data, password: cjk })).not.toThrow();
  });

  it("refuses to encrypt without an owner password", () => {
    /*
      Measured: `--encrypt --user-password=secret --bits=256 --` exits 2 —
      qpdf will not write a user-password-only 256-bit file without
      --allow-insecure, and that flag's output opens with no password at all.
      An empty USER password is fine and is exactly the permissions-only shape.
    */
    expect(() =>
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ ownerPassword: "" }) }),
    ).toThrow(/owner password/i);

    expect(() =>
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ userPassword: "" }) }),
    ).not.toThrow();
    expect(
      buildQpdfArgv({ op: "encrypt", data, options: encryptOptions({ userPassword: "" }) }),
    ).toContain("--user-password=");
  });

  it("passes awkward passwords through verbatim — there is no shell", () => {
    // callMain takes a real argv array, so each element becomes one char*.
    // Measured: spaces, =, a leading -, quotes, backslashes, accents, CJK and
    // emoji all round-trip.
    const password = `-a "b" \\c = d é 密 🔐`;
    expect(buildQpdfArgv({ op: "decrypt", data, password })[0]).toBe(`--password=${password}`);
  });
});

describe("isQpdfSuccess", () => {
  it("treats 3 as a success, because it is", () => {
    /*
      rc 3 is "operation succeeded with warnings" and the output file IS
      written and valid — it is the normal result of repairing a damaged xref.
      A wrapper that collapses "non-zero means failed" breaks repair-pdf on the
      very files it exists to fix.
    */
    expect(isQpdfSuccess(0)).toBe(true);
    expect(isQpdfSuccess(3)).toBe(true);
    expect(isQpdfSuccess(2)).toBe(false);
  });
});

describe("protectionFromResult", () => {
  /**
   * The literal stderr `--requires-password` produces for input it cannot read.
   * Measured this session against the shipped artifact, identically for garbage
   * bytes, a truncated PDF and an empty file.
   */
  const DAMAGED_STDERR = [
    "WARNING: in.pdf: can't find PDF header",
    "WARNING: in.pdf: file is damaged",
    "WARNING: in.pdf: can't find startxref",
    "WARNING: in.pdf: Attempting to reconstruct cross-reference table",
    "qpdf: in.pdf: unable to find trailer dictionary while recovering damaged file",
  ];

  it("classifies the full measured matrix, exit code AND stderr", () => {
    /*
      F8. The exit code alone CANNOT tell "not encrypted" from "not a readable
      PDF" — both are rc 2. Measured:
        rc 0                     → a password is required
        rc 3                     → encrypted, opens without a password
        rc 2 + EMPTY stderr      → a valid, unencrypted PDF
        rc 2 + damage markers    → not a readable PDF at all
      Folding the last into "none" is what made unlock-pdf tell the owner of a
      corrupt file that it "has no password and no usage restrictions on it".
    */
    const matrix: [number, string[], QpdfProtection][] = [
      [0, [], "password-required"],
      [3, [], "restrictions-only"],
      [2, [], "none"],
      [2, DAMAGED_STDERR, "unreadable"],
    ];
    for (const [exitCode, stderr, expected] of matrix) {
      expect(protectionFromResult(exitCode, stderr)).toBe(expected);
    }
  });

  it("does not report a file it could not read as unprotected", () => {
    // The four inputs the finding reproduced with — a JPEG renamed .pdf, plain
    // text, an empty file and a truncated PDF. Every one exits 2, exactly as an
    // ordinary unencrypted document does, so stderr is the only discriminator.
    for (const marker of [
      "can't find PDF header",
      "unable to find trailer dictionary",
      "file is damaged",
    ]) {
      expect(protectionFromResult(2, [`WARNING: in.pdf: ${marker}`])).toBe("unreadable");
      expect(protectionFromResult(2, [`WARNING: in.pdf: ${marker}`])).not.toBe("none");
    }
  });

  it("keeps rc 2 with a clean stderr as a genuine 'not encrypted'", () => {
    // An unencrypted-but-VALID PDF gives rc 2 with EMPTY stderr (measured), so
    // the new state must not swallow the ordinary case.
    expect(protectionFromResult(2, [])).toBe("none");
    expect(protectionFromResult(2, [""])).toBe("none");
  });

  it("refuses to guess from an exit code it has never seen", () => {
    // Only 0, 2 and 3 have ever come out of this query. An unknown code is not
    // evidence that a document is unprotected.
    expect(protectionFromResult(1, [])).toBe("unreadable");
    expect(protectionFromResult(9, [])).toBe("unreadable");
  });
});

describe("qpdfErrorMessage", () => {
  /** Every stderr shape measured against the shipped artifact. */
  const SAMPLES: { name: string; exitCode: number; stderr: string[] }[] = [
    {
      name: "wrong or missing password",
      exitCode: 2,
      stderr: ["qpdf: in.pdf: invalid password"],
    },
    {
      name: "default thisProgram (should be unreachable, but must not leak either)",
      exitCode: 2,
      stderr: ["this.program: in.pdf: invalid password"],
    },
    {
      name: "random bytes",
      exitCode: 2,
      stderr: [
        "WARNING: in.pdf: can't find PDF header",
        "WARNING: in.pdf: file is damaged",
        "WARNING: in.pdf: can't find startxref",
        "WARNING: in.pdf: Attempting to reconstruct cross-reference table",
        "qpdf: in.pdf: unable to find trailer dictionary while recovering damaged file",
      ],
    },
    {
      name: "PDF header then garbage",
      exitCode: 2,
      stderr: [
        "WARNING: in.pdf: file is damaged",
        "WARNING: in.pdf: can't find startxref",
        "WARNING: in.pdf: Attempting to reconstruct cross-reference table",
        "qpdf: in.pdf: unable to find trailer dictionary while recovering damaged file",
      ],
    },
    {
      name: "input never reached MEMFS (our bug)",
      exitCode: 2,
      stderr: ["qpdf: open missing.pdf: No such file or directory"],
    },
    {
      name: "weak-crypto refusal (our bug)",
      exitCode: 2,
      stderr: [
        "qpdf: refusing to write a file with RC4, a weak cryptographic algorithm",
        "Please use 256-bit keys for better security.",
        "Pass --allow-weak-crypto to enable writing insecure files.",
        "See also https://qpdf.readthedocs.io/en/stable/weak-crypto.html",
        "qpdf: refusing to write a file with weak crypto",
      ],
    },
    {
      name: "usage error, with the blank lines printErr really emits",
      exitCode: 2,
      stderr: [
        "",
        "qpdf: encryption key length is required",
        "",
        "For help:",
        "  qpdf --help=usage       usage information",
        "",
      ],
    },
    { name: "nothing on stderr at all", exitCode: 2, stderr: [] },
  ];

  const OPS: QpdfJob["op"][] = ["encrypt", "decrypt", "repair", "classify"];

  it.each(SAMPLES)("leaks no internal name for: $name", ({ exitCode, stderr }) => {
    // Every operation, because the mapping now branches on it.
    for (const op of OPS) {
      const message = qpdfErrorMessage(exitCode, stderr, op);
      expect(message.length).toBeGreaterThan(0);
      // The MEMFS filename, the program prefix, and the glue's placeholder
      // argv[0] are all ours; none of the three means anything to a user.
      expect(message).not.toContain("in.pdf");
      expect(message).not.toContain("qpdf:");
      expect(message).not.toContain("this.program");
    }
  });

  it("tells repair-pdf's user about Unlock PDF instead of a password field it does not have", () => {
    /*
      F2. repair-pdf runs argv ["in.pdf","out.pdf"] — no password, and
      deliberately no pre-flight — so an encrypted input exits 2 with
      ": invalid password". The old mapping had one sentence for that line, and
      it was written for unlock-pdf: "Enter the password the document was
      created with." repair-pdf has no password input anywhere on the page, and
      the file is not damaged at all — /unlock-pdf opens it.
    */
    const stderr = ["qpdf: in.pdf: invalid password"];

    const repair = qpdfErrorMessage(2, stderr, "repair");
    expect(repair).toContain("Unlock PDF");
    // The instruction that cannot be followed on that page.
    expect(repair).not.toMatch(/enter the password/i);
    // And it must not call an intact encrypted document damaged or lost.
    expect(repair).not.toMatch(/damaged|trailer|cannot be recovered/i);

    // unlock-pdf DOES have the field, and keeps the sentence that names it.
    const decrypt = qpdfErrorMessage(2, stderr, "decrypt");
    expect(decrypt).toMatch(/enter the password/i);
    expect(decrypt).not.toBe(repair);

    /*
      protect-pdf / pdf-permissions: measured, re-encrypting an already-protected
      file is what produces this line, and the password box on those pages is the
      one being SET — pointing at it would send the user to the wrong field.
    */
    const encrypt = qpdfErrorMessage(2, stderr, "encrypt");
    expect(encrypt).toMatch(/already password-protected/i);
    expect(encrypt).toContain("Unlock PDF");
    expect(encrypt).not.toBe(decrypt);
    expect(encrypt).not.toBe(repair);
  });

  it("keeps the non-password buckets identical across every operation", () => {
    // Only the invalid-password line is operation-dependent; a file qpdf cannot
    // parse is the same fact whichever tool asked.
    const damaged = ["qpdf: in.pdf: unable to find trailer dictionary while recovering damaged file"];
    const generic = ["qpdf: refusing to write a file with weak crypto"];
    for (const stderr of [damaged, generic]) {
      const messages = OPS.map((op) => qpdfErrorMessage(2, stderr, op));
      expect(new Set(messages).size).toBe(1);
    }
  });

  it("sorts the measured stderr into the three buckets", () => {
    const password = qpdfErrorMessage(2, ["qpdf: in.pdf: invalid password"], "decrypt");
    expect(password).toMatch(/password/i);

    const damaged = qpdfErrorMessage(
      2,
      ["qpdf: in.pdf: unable to find trailer dictionary while recovering damaged file"],
      "decrypt",
    );
    expect(damaged).toMatch(/not a PDF|damaged/i);
    expect(damaged).not.toBe(password);

    const headerless = qpdfErrorMessage(2, ["WARNING: in.pdf: can't find PDF header"], "decrypt");
    expect(headerless).toBe(damaged);

    // Anything else is a bug on our side, so the user gets the generic
    // sentence and the exit code rides along for a bug report.
    const generic = qpdfErrorMessage(2, ["qpdf: refusing to write a file with weak crypto"], "decrypt");
    expect(generic).not.toBe(password);
    expect(generic).not.toBe(damaged);
    expect(generic).toContain("2");
  });
});

describe("qpdfWarnings", () => {
  it("keeps the warnings, drops the blanks, strips our names", () => {
    /*
      The literal stderr of a successful repair (rc 3), measured on a PDF whose
      startxref offset was corrupted. repair-pdf shows these lines to the user,
      so the offset — real information about their file — is kept while the
      MEMFS filename is not.
    */
    expect(
      qpdfWarnings([
        "WARNING: in.pdf: file is damaged",
        "WARNING: in.pdf (offset 9999): xref not found",
        "WARNING: in.pdf: Attempting to reconstruct cross-reference table",
        "qpdf: operation succeeded with warnings; resulting file may have some problems",
      ]),
    ).toEqual([
      "WARNING: file is damaged",
      "WARNING: offset 9999: xref not found",
      "WARNING: Attempting to reconstruct cross-reference table",
      "operation succeeded with warnings; resulting file may have some problems",
    ]);
  });

  it("drops the empty strings printErr emits for blank lines", () => {
    expect(qpdfWarnings(["", "WARNING: in.pdf: file is damaged", "", "  "])).toEqual([
      "WARNING: file is damaged",
    ]);
    expect(qpdfWarnings([])).toEqual([]);
  });

  it("keeps usage noise and plain errors out of the warning list", () => {
    // Only WARNING lines and the success-with-warnings summary are shown; an
    // error line is the error message's job, not a warning banner's.
    expect(
      qpdfWarnings([
        "",
        "qpdf: encryption key length is required",
        "For help:",
        "  qpdf --help=usage       usage information",
      ]),
    ).toEqual([]);
    expect(qpdfWarnings(["qpdf: in.pdf: invalid password"])).toEqual([]);
  });
});
