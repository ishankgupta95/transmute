import type { QpdfEncryptOptions, QpdfJob, QpdfJobResult, QpdfProtection } from "@/lib/workers/qpdf-protocol";

export type {
  QpdfEncryptOptions,
  QpdfEncryptionBits,
  QpdfJobResult,
  QpdfModifyPermission,
  QpdfPermissions,
  QpdfPrintPermission,
  QpdfProtection,
} from "@/lib/workers/qpdf-protocol";
// Straight from the protocol module, which has zero imports of its own — the
// rule pdf-image.ts states: a value re-export routed through anything heavier
// drags that module's whole dependency graph into every page that imports a
// permission constant.
export {
  QPDF_MAX_PASSWORD_BYTES,
  QPDF_MAX_PASSWORD_BYTES_AES128,
  QPDF_PERMISSIONS_ALLOW_ALL,
  maxPasswordBytes,
  passwordByteLength,
} from "@/lib/workers/qpdf-protocol";

/**
 * Main-thread wrapper for the qpdf-backed security tools — the same
 * worker-routing shape `pdf-engine.ts` gives the pdf-lib operations, so the
 * UIs do not have to care where the work runs.
 *
 * Its own pool, not the pdf-engine one: this worker loads a 2.3 MB WASM
 * engine that the pdf-lib tools have no use for, and nothing should pay for it
 * on a page that only merges documents. One worker, for the reason
 * pdf-engine.ts gives — a job holds a whole document in MEMFS plus qpdf's
 * object model, and these tools process one document at a time.
 */

let pool: import("@/lib/workers/pool").WorkerPool | null = null;

async function runQpdfJob(job: QpdfJob): Promise<QpdfJobResult> {
  /*
    No inline fallback, deliberately, and this is not the same call
    image-client.ts makes when it falls back to a main-thread converter.

    There is no JavaScript qpdf. Nothing in this repo can encrypt, decrypt or
    reconstruct a PDF — pdf-lib cannot even PARSE an AES-256 document (measured:
    it throws "Expected instance of PDFDict" with ignoreEncryption: true). So a
    silent fallback could only hand back the input unchanged, which would tell a
    user their file was protected when it was not, and would make the unit suite
    green over an engine that never ran — this repo's documented blind spot. The
    honest move is the one pdf-image.ts:78-98 makes: say so.
  */
  if (typeof Worker === "undefined") {
    throw new Error("PDF encryption needs a browser with Web Workers.");
  }

  if (!pool) {
    const { WorkerPool } = await import("@/lib/workers/pool");
    pool = new WorkerPool({
      // Pre-bundled by scripts/build-workers.mjs — see image-client.ts.
      createWorker: () =>
        new Worker(`${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/workers/qpdf.worker.js`, {
          type: "module",
        }),
      maxWorkers: 1,
    });
  }

  return pool.run<QpdfJobResult>(job, {
    /*
      Peak ≈ the input sitting in MEMFS + qpdf's parsed object model built from
      it + the output document it writes back into MEMFS — the same ×3 shape,
      and the same reasoning, as pdf-engine.ts. The engine itself is not in
      this number: the compiled module is a per-worker constant, not per-job,
      and the pool's budget is about what a task pins while it runs.
    */
    memoryBytes: job.data.byteLength * 3,
  });
}

/**
 * Encrypt `data`, returning the protected document.
 *
 * This is the engine entry point for BOTH protect-pdf and pdf-permissions —
 * they are the same qpdf operation and differ only in the options. A
 * permissions-only file is `userPassword: ""` (it opens without a password and
 * carries the restriction bits); a password-protected one supplies both
 * passwords, and `ownerPassword` must be non-empty either way.
 *
 * Throws when qpdf refuses the file — most often because it is already
 * protected, which qpdf reports as an invalid password.
 */
export async function protectPdf(
  data: ArrayBuffer | Uint8Array,
  options: QpdfEncryptOptions,
): Promise<QpdfJobResult> {
  return runQpdfJob({ op: "encrypt", data: toUint8Array(data), options });
}

/**
 * Remove encryption from `data`, given a password that opens it. Either the
 * user or the owner password works (measured both).
 *
 * Callers must classify first: `--decrypt` on a document that was never
 * encrypted is a silent no-op success, so an unlock tool without the
 * pre-flight would report having unlocked nothing.
 */
export async function unlockPdf(
  data: ArrayBuffer | Uint8Array,
  password: string,
): Promise<QpdfJobResult> {
  return runQpdfJob({ op: "decrypt", data: toUint8Array(data), password });
}

/**
 * Rewrite `data` through qpdf, which reconstructs a damaged cross-reference
 * table on the way in — writing the document back out IS the repair.
 *
 * Expect `exitCode` 3 and a populated `warnings` on a file that actually
 * needed fixing: that is qpdf's success-with-warnings code, and the warnings
 * are the account of what it had to reconstruct.
 */
export async function repairPdf(data: ArrayBuffer | Uint8Array): Promise<QpdfJobResult> {
  return runQpdfJob({ op: "repair", data: toUint8Array(data) });
}

/**
 * How `data` is protected today, in one pass and without a password.
 *
 * The pre-flight for all three of protect / unlock / permissions. It answers
 * FOUR ways — not encrypted, encrypted but opens without a password
 * (restrictions only), a password is required, or the bytes are not a readable
 * PDF at all — which is what lets each tool say something true before it does
 * anything: "already protected, remove the password first", "this file was not
 * locked", "these restrictions come off with no password at all", "this file
 * cannot be read; try Repair PDF".
 *
 * The fourth answer is not decorative. `--requires-password` exits 2 for an
 * unreadable file exactly as it does for an unencrypted one, so a caller that
 * folds it into "none" tells the owner of a corrupt document, as a fact, that
 * it carries no password and no restrictions.
 */
export async function classifyPdfProtection(
  data: ArrayBuffer | Uint8Array,
): Promise<QpdfProtection> {
  const result = await runQpdfJob({ op: "classify", data: toUint8Array(data) });
  /*
    "unreadable" rather than "none" as the fallback. A missing `protection`
    would be a protocol bug, and the two candidate defaults are not equally
    wrong: "none" is a positive claim about the user's document — no password,
    no restrictions, nothing to remove — made from no evidence at all.
  */
  return result.protection ?? "unreadable";
}

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}
