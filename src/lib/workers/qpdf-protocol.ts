/**
 * Message shapes shared by the qpdf wrapper (main thread), qpdf.worker.ts and
 * the four security UIs, plus every pure function the engine needs.
 *
 * LEAF MODULE — no runtime imports at all, for the two reasons
 * pdf-image-protocol.ts spells out: the UIs import the permission types and
 * the password limit at render time, and a worker entrypoint whose import
 * chain reaches a module naming the worker's own URL hangs `next build` at 0%
 * CPU.
 *
 * Argv building, exit classification and the stderr→copy mapping all live here
 * rather than in the worker, because they are the half that can be tested
 * without a browser: jsdom has no WebAssembly artifact to instantiate and no
 * Worker, so anything left inside qpdf.worker.ts is untested by construction.
 *
 * Every rule encoded below was measured against the shipped artifact
 * (qpdf 12.4.1, vendor/qpdf/qpdf.wasm); the comments say what was run.
 */

export type QpdfPrintPermission = "full" | "low" | "none";
export type QpdfModifyPermission = "all" | "annotate" | "form" | "assembly" | "none";

export interface QpdfPermissions {
  print: QpdfPrintPermission;
  modify: QpdfModifyPermission;
  /** false emits --extract=n (copying text and graphics is denied). */
  extract: boolean;
}

/** Everything allowed — the P = -4 baseline. */
export const QPDF_PERMISSIONS_ALLOW_ALL: QpdfPermissions = {
  print: "full",
  modify: "all",
  extract: true,
};

export type QpdfEncryptionBits = 256 | 128;

export interface QpdfEncryptOptions {
  /** "" means the document opens without a password (restrictions-only). */
  userPassword: string;
  /** MUST be non-empty. qpdf rejects a user password with no owner password. */
  ownerPassword: string;
  permissions: QpdfPermissions;
  bits: QpdfEncryptionBits;
}

export type QpdfJob =
  | { op: "encrypt"; data: Uint8Array; options: QpdfEncryptOptions }
  | { op: "decrypt"; data: Uint8Array; password: string }
  | { op: "repair"; data: Uint8Array }
  | { op: "classify"; data: Uint8Array };

/**
 * How a document is protected today. Derived from `--requires-password`'s exit
 * code AND its stderr — the code alone cannot tell the last member apart from
 * the first. See `protectionFromResult`.
 *
 * "unreadable" is not a kind of protection; it is the honest answer when qpdf
 * could not parse the file well enough to have an opinion. It exists because
 * the alternative — reporting an empty file, a JPEG or a truncated PDF as
 * "none" — makes every security tool state, as a fact, that a file it never
 * read carries no password and no restrictions.
 */
export type QpdfProtection = "none" | "restrictions-only" | "password-required" | "unreadable";

export interface QpdfJobResult {
  /** null for `classify`, and whenever qpdf wrote nothing. */
  bytes: Uint8Array | null;
  exitCode: number;
  /** qpdf's WARNING lines, blank lines removed, program prefix stripped. */
  warnings: string[];
  /** Only set by `classify`. */
  protection?: QpdfProtection;
}

/**
 * Longest password an **AES-256** file can round-trip — the R=6 limit, and the
 * ceiling across both modes. Over this qpdf encrypts and silently locks you out.
 *
 * THIS CONSTANT IS MODE-SPECIFIC. It is NOT the limit at `bits: 128`; see
 * `QPDF_MAX_PASSWORD_BYTES_AES128` and `maxPasswordBytes()`, which is what
 * anything writing a file (or telling a user what the limit is) must consult.
 * Kept exported under its old name because it is still the right number
 * wherever AES-256 is the mode.
 *
 * Measured: a 128-byte user password encrypts at 256 with rc 0 and EMPTY
 * stderr, and the resulting file then rejects that password, every truncation
 * of it, and the empty string — only the owner password still opens it. qpdf
 * issues no warning at all, so the check has to happen on this side of the call.
 */
export const QPDF_MAX_PASSWORD_BYTES = 127;

/**
 * Longest password an **AES-128** file can round-trip.
 *
 * At `--bits=128` qpdf writes revision 4, whose standard security handler pads
 * or truncates the password to 32 bytes before it ever reaches the key
 * derivation. Everything past byte 32 is decorative.
 *
 * Measured against the shipped artifact: a 60-character password at
 * `--bits=128 --use-aes=y` encrypts with rc 0 and EMPTY stderr, and the file it
 * writes is then opened by the first 32 characters followed by ANY tail — and
 * refused by the first 31. So a user who "rotates" such a password by editing
 * characters past position 32 produces a file the old one still opens. The same
 * 60-character password at 256 behaves correctly.
 */
export const QPDF_MAX_PASSWORD_BYTES_AES128 = 32;

/**
 * The longest password that survives a round trip at a given strength — the
 * number to validate against, and the number to show a user.
 *
 * There is no single limit: 127 is the AES-256 (R=6) figure and 32 is the
 * AES-128 (R=4) one. Validating both modes against 127 is silent data loss at
 * 128, because R=4 truncates rather than complains.
 */
export function maxPasswordBytes(bits: QpdfEncryptionBits): number {
  return bits === 128 ? QPDF_MAX_PASSWORD_BYTES_AES128 : QPDF_MAX_PASSWORD_BYTES;
}

/**
 * UTF-8 byte length — the limit is bytes, not characters.
 *
 * Measured: 42 × U+5BC6 (126 bytes) round-trips, 43 × U+5BC6 (129 bytes) does
 * not. A `.length` check would wave that 43-character password through and
 * lock the user out of their own document.
 */
export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

/**
 * qpdf's flag for each print level. `full` is the default (P = -4), so it
 * could be omitted; it is emitted anyway because an explicit argv is what a
 * test can pin, and qpdf accepts it as a measured no-op.
 */
const PRINT_FLAG: Record<QpdfPrintPermission, string> = {
  full: "--print=full",
  low: "--print=low",
  none: "--print=none",
};

/** Same for the five modify levels; `all` is likewise the P = -4 default. */
const MODIFY_FLAG: Record<QpdfModifyPermission, string> = {
  all: "--modify=all",
  annotate: "--modify=annotate",
  form: "--modify=form",
  assembly: "--modify=assembly",
  none: "--modify=none",
};

/**
 * The internal MEMFS names, fixed and never derived from the user's filename.
 *
 * qpdf echoes the input filename into every line it prints ("qpdf: in.pdf:
 * invalid password"), so a user filename in MEMFS would surface inside UI
 * error text. Fixed names also mean the message mapping below has exactly one
 * string to strip.
 */
const IN_FILE = "in.pdf";
const OUT_FILE = "out.pdf";

/**
 * Guard a password we are about to WRITE into a file.
 *
 * The limit depends on the strength being written, which is why `bits` is a
 * parameter rather than a constant read from module scope. Nothing that OPENS a
 * file goes through here — see the `decrypt` branch below.
 */
function checkWritePassword(password: string, label: string, bits: QpdfEncryptionBits): void {
  const limit = maxPasswordBytes(bits);
  if (passwordByteLength(password) > limit) {
    throw new RangeError(
      `That ${label} is too long — AES-${bits} encryption allows at most ${limit} bytes.`,
    );
  }
}

/**
 * Build the argv for a job. PURE. Input and output files are always the fixed
 * internal names "in.pdf"/"out.pdf".
 *
 * Throws RangeError if an ENCRYPT password exceeds `maxPasswordBytes(bits)`,
 * and Error if an encrypt job has an empty owner password. A decrypt password
 * is not length-checked at all — that limit is about writing, not opening.
 */
export function buildQpdfArgv(job: QpdfJob): string[] {
  switch (job.op) {
    case "encrypt": {
      const { userPassword, ownerPassword, permissions, bits } = job.options;
      checkWritePassword(userPassword, "password", bits);
      checkWritePassword(ownerPassword, "owner password", bits);
      if (ownerPassword.length === 0) {
        /*
          Measured: `--encrypt --user-password=secret --bits=256 --` exits 2
          with "A PDF with a non-empty user password and an empty owner
          password … is insecure", and the only way past it is
          --allow-insecure — whose output then opens with NO password at all.
          So an owner password is not a nicety; without one there is no
          protected file to produce. The caller's default is owner == user,
          which qpdf accepts with rc 0 and no warning.
        */
        throw new Error("An owner password is required — qpdf will not encrypt without one.");
      }
      return [
        "--encrypt",
        `--user-password=${userPassword}`,
        `--owner-password=${ownerPassword}`,
        `--bits=${bits}`,
        /*
          --use-aes=y is a 128-BIT-ONLY option. Measured: `--bits=256
          --use-aes=y` exits 2 with "unrecognized argument --use-aes=y". At 256
          bits qpdf writes AESv3 (R=6) regardless; at 128 this flag is what
          upgrades RC4 to AESv2, and without it qpdf refuses to write the file
          rather than emit weak crypto.
        */
        ...(bits === 128 ? ["--use-aes=y"] : []),
        PRINT_FLAG[permissions.print],
        MODIFY_FLAG[permissions.modify],
        /*
          --extract=y is the default, so only the denial is worth emitting.
          Deliberately absent from this whole list: --accessibility. Measured
          at R=6 it leaves P at -4 with "extract for accessibility: allowed"
          unchanged — qpdf's own help says "usually ignored" — so exposing it
          would be a checkbox claiming a restriction the file does not carry.
          Also never emitted: --allow-weak-crypto (that is RC4) and
          --allow-insecure (measured: its output opens with no password).
        */
        ...(permissions.extract ? [] : ["--extract=n"]),
        // Everything after this terminator is the file list rather than an
        // encryption option — the permission flags MUST sit before it.
        "--",
        IN_FILE,
        OUT_FILE,
      ];
    }
    case "decrypt":
      /*
        DELIBERATELY UNGUARDED. Either the user or the owner password opens the
        document (measured both), and neither 127 nor 32 belongs here: those are
        limits on what qpdf can WRITE, not on what it will ACCEPT when opening a
        file somebody else's tool produced.

        Measured: a file encrypted elsewhere at --bits=128 with a 200-byte
        password is opened by that 200-byte password (rc 0) — R=4 truncates it
        to 32 bytes on both sides, so it simply matches. Refusing it here would
        block a document qpdf opens on the first try, and would do so with a
        sentence claiming a limit that does not exist for reading.
      */
      return [`--password=${job.password}`, "--decrypt", "--", IN_FILE, OUT_FILE];
    case "repair":
      // No flags: writing the document back out IS the repair. qpdf
      // reconstructs a damaged cross-reference table on the way in and exits 3
      // ("succeeded with warnings") having written a valid file.
      return [IN_FILE, OUT_FILE];
    case "classify":
      // Query only: no password, no output file, one call. Its exit code is
      // not enough on its own — see protectionFromResult, which needs stderr
      // too because rc 2 covers both "not encrypted" and "not a PDF".
      return ["--requires-password", IN_FILE];
  }
}

/**
 * rc 0 and rc 3 are success; rc 3 means "succeeded with warnings".
 *
 * This is the single most dangerous thing to get wrong here. Collapsing
 * "non-zero means failed" breaks repair-pdf on exactly the damaged files it
 * exists to fix — a reconstructed xref exits 3 and the output it wrote is
 * valid (measured: the repaired file re-parses under both qpdf --check and
 * pdf-lib).
 */
export function isQpdfSuccess(exitCode: number): boolean {
  return exitCode === 0 || exitCode === 3;
}

/**
 * The stderr tokens that mean qpdf never got a document out of the bytes.
 *
 * Measured literals from `--requires-password` on garbage, a truncated PDF and
 * an empty file. Kept as fragments rather than whole lines because every one of
 * them arrives prefixed with "WARNING: in.pdf: " or "qpdf: in.pdf: ".
 */
const DAMAGE_MARKERS = [
  "can't find PDF header",
  "unable to find trailer dictionary",
  "file is damaged",
];

/**
 * `--requires-password`'s exit code AND stderr → protection.
 *
 * THE EXIT CODE ALONE IS NOT ENOUGH, and this is the whole reason this function
 * takes stderr. Measured against the shipped artifact:
 *
 *   rc 0                         → a password is required to open it
 *   rc 3                         → encrypted, opens without a password (restrictions only)
 *   rc 2, EMPTY stderr           → a valid PDF that is not encrypted
 *   rc 2, damage markers         → NOT A READABLE PDF AT ALL
 *
 * An empty file, a JPEG renamed .pdf, plain text and a truncated PDF all exit
 * **2** — exactly as an ordinary unencrypted document does. Collapsing that to
 * "none" is what let unlock-pdf tell a user, as an error-styled fact, that their
 * corrupt file "has no password and no usage restrictions on it" and that a run
 * "would succeed without changing anything". stderr is the only discriminator.
 *
 * A recoverably-damaged but unencrypted PDF (xref rebuilt, no fatal line) also
 * lands on "unreadable" here, because "file is damaged" is one of the markers.
 * That is deliberate: the security tools have nothing to do to such a file, and
 * pointing at Repair PDF is a truer answer than "no protection found".
 *
 * Any code other than 0, 2 or 3 has never been observed from this query. It is
 * likewise "unreadable" — a code we cannot interpret is not evidence that a
 * document is unprotected.
 */
export function protectionFromResult(exitCode: number, stderr: string[]): QpdfProtection {
  if (exitCode === 0) return "password-required";
  if (exitCode === 3) return "restrictions-only";
  if (exitCode !== 2) return "unreadable";
  const text = stderr.join("\n");
  return DAMAGE_MARKERS.some((marker) => text.includes(marker)) ? "unreadable" : "none";
}

/**
 * The `: invalid password` bucket, one sentence per operation.
 *
 * qpdf reports the same stderr line for three different situations, and only
 * the operation tells them apart. Writing one sentence for all three meant
 * repair-pdf — which sends no password and has no password field — told users
 * to "Enter the password the document was created with".
 */
const PASSWORD_MESSAGE_BY_OP: Record<QpdfJob["op"], string> = {
  // The only operation that actually has a password to get wrong.
  decrypt:
    "This PDF is password-protected and the password entered is wrong or missing. Enter the password the document was created with.",
  /*
    Measured: re-encrypting an already-protected file exits 2 with ": invalid
    password" — qpdf cannot read the input, not the output. protect-pdf and
    pdf-permissions pre-flight for this, so it is the fallback rather than the
    normal path, and the password field on those pages is the one being SET.
    Telling the user to type the document's existing password there would point
    at the wrong field.
  */
  encrypt:
    "This PDF is already password-protected, so it cannot be encrypted again as it is. Remove the existing password with Unlock PDF first, then run this again.",
  /*
    repair sends argv ["in.pdf","out.pdf"] — no password, and deliberately no
    pre-flight. An encrypted input is therefore routine here, and the file is
    not damaged at all: it is byte-intact and Unlock PDF opens it.
  */
  repair:
    "This PDF is password-protected, and repairing it means reading the whole document — which cannot be done while it is encrypted. Remove the password with Unlock PDF first, then repair the file that produces.",
  /*
    Unreachable in practice: `--requires-password` answers with its exit code
    and never prints this line. Present because the record is total, and the
    decrypt sentence is the closest true one.
  */
  classify:
    "This PDF is password-protected and the password entered is wrong or missing. Enter the password the document was created with.",
};

const DAMAGED_MESSAGE =
  "This file could not be read as a PDF — it is damaged past reconstruction, or it is not a PDF at all. Try re-exporting it from the program that produced it.";

const GENERIC_MESSAGE =
  "This PDF could not be processed. The file may be damaged, or built in a way this engine cannot rewrite.";

/**
 * Map an exit code + stderr + THE OPERATION THAT RAN to house copy.
 *
 * `op` is not optional decoration. qpdf's stderr says what went wrong with the
 * file; only the caller knows what was being attempted, and the wrong-password
 * bucket means something different for each of the four operations (see
 * PASSWORD_MESSAGE_BY_OP). Without it, repair-pdf instructed users to type a
 * password into a page that has no password field.
 *
 * Matching is on the measured literal tokens, and the result is always one of
 * our own fixed sentences — qpdf's lines are never passed through. They carry
 * the MEMFS name ("qpdf: in.pdf: invalid password") and, if `thisProgram` were
 * ever dropped, the string "this.program"; neither means anything to a user,
 * and both leak how this is built. The unit test asserts that none of "in.pdf",
 * "qpdf:" or "this.program" can appear in what this returns, for every measured
 * stderr sample and every operation.
 *
 * `op` is REQUIRED rather than defaulted on purpose. The one call site that
 * matters is in qpdf.worker.ts, and this whole bucket existed for months
 * because nothing forced it to say which operation had run; a default would
 * make dropping the argument compile, and quietly restore the sentence that
 * sent repair-pdf's users looking for a field that is not there.
 */
export function qpdfErrorMessage(exitCode: number, stderr: string[], op: QpdfJob["op"]): string {
  const text = stderr.join("\n");
  if (text.includes(": invalid password")) return PASSWORD_MESSAGE_BY_OP[op];
  if (text.includes("unable to find trailer dictionary") || text.includes("can't find PDF header")) {
    return DAMAGED_MESSAGE;
  }
  /*
    Everything else is a bug on this side rather than a fact about the file:
    "refusing to write a file with weak crypto" can only happen if someone
    passes --bits=128 without --use-aes=y, and ": No such file or directory"
    only if the input never reached MEMFS. The user gets the generic sentence;
    the exit code rides along so a bug report can name which one it was.
  */
  return `${GENERIC_MESSAGE} (qpdf exit ${exitCode})`;
}

/**
 * WARNING/summary lines worth showing, blanks and internal names removed.
 *
 * `printErr` is called once per line and emits "" for blank lines (measured in
 * qpdf's usage-error output), so empties go first. WARNING lines carry no
 * program prefix; only the final "operation succeeded with warnings" summary
 * does. Both that "qpdf: " prefix and the "in.pdf" MEMFS name are stripped,
 * because repair-pdf shows these lines to the user verbatim — the offset in
 * "in.pdf (offset 9999): xref not found" is real information about their file
 * and is kept, the filename beside it is ours and is not.
 */
export function qpdfWarnings(stderr: string[]): string[] {
  const shown: string[] = [];
  for (const raw of stderr) {
    // Strip the program prefix first, so the summary line matches too.
    const line = raw.trim().replace(/^qpdf: /, "");
    if (line.length === 0) continue;
    if (!line.startsWith("WARNING: ") && !line.includes("operation succeeded with warnings")) {
      continue;
    }
    shown.push(
      line
        .replace(/in\.pdf \(offset (\d+)\): /g, "offset $1: ")
        .replace(/in\.pdf: /g, "")
        .replace(/in\.pdf/g, "the file"),
    );
  }
  return shown;
}
