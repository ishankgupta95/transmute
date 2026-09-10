"use client";

import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { classifyPdfProtection } from "@/lib/tools/qpdf";
import type { QpdfJobResult, QpdfProtection } from "@/lib/tools/qpdf";
import {
  ToolActions,
  ToolAside,
  ToolDone,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, DocCard, DocStrip, StatStrip } from "@/components/tools/ToolCanvas";
import type { StatCell } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";
import { CANVAS_COLUMN, SCROLL_CLASS } from "@/components/workspace/shared";

/*
  The shared body of the four qpdf tools — protect-pdf, unlock-pdf,
  pdf-permissions and repair-pdf. They differ in their controls and in what
  they say about the result; everything around that is identical, and pinning
  it here is what keeps four pages from drifting into telling the user four
  different things about the same engine.

  This file owns: the loaded file, the status machine, the run token, the
  elapsed readout, the error and warning display, the download, the reset, and
  the ONE pre-flight probe the three encryption tools depend on for their
  honesty.

  THE PRE-FLIGHT IS NOT DECORATION. `--requires-password` classifies how a
  document is protected today (rc 0 = a password is required, rc 3 = encrypted
  but opens without one, rc 2 with clean stderr = not encrypted, rc 2 with
  damage on stderr = not a readable PDF at all), and each of the three tools is
  wrong about at least one of those four states without it:

    protect-pdf   re-encrypting an already-password-protected file fails with
                  "invalid password" — measured. Better to say so up front.
    unlock-pdf    `--decrypt` on an UNENCRYPTED pdf is a silent no-op success
                  — measured. Without the probe the tool would report a
                  successful unlock of a file it did not touch.
    pdf-permissions  it cannot read or rewrite permissions it cannot decrypt.

  repair-pdf deliberately passes no `preflight`: a damaged file may not survive
  the probe, and repairing it is the whole point of the tool.
*/

export type QpdfShellStatus = "idle" | "loading" | "processing" | "done" | "error";

/**
 * Whether a failure is a fact about the user's DOCUMENT or about our own
 * ENGINE never having loaded.
 *
 * The distinction is not cosmetic. Everything these four tools do runs on a
 * 2.3 MB WebAssembly engine fetched on first use, and a failed fetch —
 * hotel Wi-Fi, an offline tab, a blocker — arrives at the UI as a thrown
 * Error exactly like "this PDF is damaged" does. Reported as a document
 * failure it tells the user their intact file is unreadable and then sends
 * them to another tool that loads the SAME engine from the SAME URL.
 */
export type QpdfErrorKind = "engine" | "document";

/**
 * The measured shapes an engine-transport failure arrives in. Matching is on
 * lowercased substrings because two of the four are the browser's own wording
 * and differ per engine:
 *
 *   qpdf.worker.ts loadWasm()  "The PDF security engine could not be loaded (HTTP 503)."
 *   the glue import           Chromium "Failed to fetch dynamically imported module: <url>"
 *                             Firefox  "error loading dynamically imported module: <url>"
 *                             WebKit   "Importing a module script failed."
 *   pool.ts worker "error"    "Worker crashed" (the worker script itself did not load)
 *   qpdf.ts, no Worker at all "PDF encryption needs a browser with Web Workers."
 *
 * Anything unrecognised is treated as a fact about the document, which is the
 * conservative way round: the engine branch makes a claim about our own
 * infrastructure, and it should only be made on evidence.
 */
const ENGINE_FAILURE_MARKERS = [
  "security engine could not be loaded",
  "dynamically imported module",
  "importing a module script failed",
  "worker crashed",
  "needs a browser with web workers",
];

function qpdfErrorKind(message: string): QpdfErrorKind {
  const text = message.toLowerCase();
  return ENGINE_FAILURE_MARKERS.some((marker) => text.includes(marker)) ? "engine" : "document";
}

/**
 * What to print for an engine failure.
 *
 * ONE sentence of our own, plus the HTTP status when there is one — that is the
 * single detail from the engine's own message worth carrying, and the rest of
 * every such message is ours or the browser's, not the user's. The
 * dynamic-import failures in particular are the browser's strings and carry a
 * full asset URL: "Failed to fetch dynamically imported module:
 * https://…/qpdf.js" tells the user nothing about their file and leaks how the
 * page is built, so it never reaches the surface.
 */
function engineFailureMessage(message: string): string {
  const status = /\(HTTP (\d{3})\)/.exec(message);
  const detail = status ? ` The download came back HTTP ${status[1]}.` : "";
  return `The PDF security engine could not be loaded, so this file was never read — there is nothing wrong with it.${detail}`;
}

/**
 * Said in one place because all four tools need it and all four are wrong
 * without it. Every claim here is measured: the engine is
 * /qpdf.js (63 KB) + /qpdf.wasm (2,340,730 B), fetched on the first RUN rather
 * than at page load, shared by all four tools, and the worker drops its
 * memoised promises on failure so the next attempt really does hit the network
 * again (a re-drop reissues /qpdf.js?retry=1 — measured).
 *
 * The offline clause used to end at "an offline tab", which was true and
 * useless: it named a cause the reader could do nothing about. Since the PWA
 * work landed, /offline-access lets them store this exact engine on the device
 * — qpdf is one of its listed bundles — so the sentence now points there. It
 * deliberately does NOT claim the engine IS stored: whether it is depends on a
 * Cache API lookup this component does not make, and eviction is per-origin,
 * total and silent, so a stored boolean asserted here would be a lie waiting to
 * happen. Offering the page is a fact; the state of the cache is not.
 */
function EngineFailureNote() {
  return (
    <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
      The engine is a 2.3 MB WebAssembly download this page fetches the first time you run one of
      the PDF security tools, and all four of them — Protect, Unlock, Permissions and Repair — run
      on it, so none of them will work until it arrives. Running again retries the download.
      Something blocking the network, an offline tab, or an extension that blocks WebAssembly are
      the usual causes. If you want these tools to keep working without a connection,{" "}
      <Link href="/offline-access" className="text-accent underline hover:text-accent-hover">
        Offline access
      </Link>{" "}
      can store this engine on your device.
    </p>
  );
}

/**
 * True for the pre-flight verdict the engine returns when qpdf could not parse
 * the file at all — a truncated PDF, an empty one, or a JPEG someone renamed.
 *
 * A named helper rather than a bare comparison because all three pre-flighting
 * tools need it and `null` (the probe still running) must not be mistaken for
 * it. The verdict exists because the alternative — reporting an unreadable
 * file as "not encrypted" — made unlock-pdf tell the owner of a damaged
 * document, as an error-styled fact, that it had "no password and no usage
 * restrictions on it".
 */
export function isUnreadablePdf(protection: QpdfProtection | null): boolean {
  return protection === "unreadable";
}

/** What a tool makes of the pre-flight's verdict about the loaded file. */
export interface QpdfPreflightVerdict {
  /**
   * Set to refuse the file: the primary goes dead and this is the reason
   * shown. Only ever set for a state the tool genuinely cannot handle.
   */
  blocked?: string;
  /**
   * Rendered under the verdict, blocked or not — the link to the tool that
   * can help, or the note that this file carries restrictions but no password.
   */
  detail?: ReactNode;
}

/** What the shell hands each tool's render props. */
export interface QpdfShellState {
  file: File;
  status: QpdfShellStatus;
  /**
   * What the pre-flight found. `null` while it is still running, and always
   * `null` for a tool that does not pre-flight.
   */
  protection: QpdfProtection | null;
  /** True while the pre-flight refuses this file — controls should read as dead. */
  blocked: boolean;
  /** True while the probe or a run is in flight. */
  busy: boolean;
  result: QpdfJobResult | null;
  /** The finished PDF. Non-null exactly when there is something to download. */
  output: Blob | null;
  /** The last click's refusal or failure, verbatim. `null` when nothing failed. */
  error: string | null;
  /**
   * Which kind of failure `error` is. `null` when there is no error. A tool
   * must not print its own diagnosis of the user's file over an "engine"
   * failure — the file was never read.
   */
  errorKind: QpdfErrorKind | null;
  /**
   * Drops the finished output. Every control change must call this: the footer
   * swaps the primary out for a Download the moment a run lands, so leaving it
   * in place would hand over a file built from the previous settings.
   */
  invalidate: () => void;
}

export interface QpdfToolShellProps {
  /** The primary's label at rest. Pinned per tool — the e2e suite asserts it. */
  primaryLabel: string;
  /** The primary's label mid-run: present participle plus an ellipsis. */
  runningLabel: string;
  /** Short, all-caps, true of what is running: "ENCRYPTING", "REPAIRING". */
  phase: string;
  /** Replaces the `.pdf` extension, e.g. "-protected.pdf". */
  outputSuffix: string;
  /** Shown when the engine throws something that is not an Error. */
  failureMessage: string;
  /**
   * Omit to skip the pre-flight entirely. Called with the probe's verdict once
   * it lands; never called while `protection` is null.
   */
  preflight?: (protection: QpdfProtection) => QpdfPreflightVerdict;
  /** The engine call. The shell owns the token fence around it. */
  run: (file: File) => Promise<QpdfJobResult>;
  /**
   * Checked on click. Returning a string blocks the run and shows it — this is
   * where the password guards live, because a silently dead button cannot
   * explain that a password is four bytes too long.
   *
   * Handed the pre-flight's verdict, which is the one fact a tool needs that
   * the shell owns rather than the tool.
   */
  validate?: (protection: QpdfProtection | null) => string | null;
  /** Greys the primary out: the tool's inputs are not complete yet. */
  runDisabled?: (protection: QpdfProtection | null) => boolean;
  /** Called whenever the loaded file changes. Tools clear their secrets here. */
  onFileChange?: () => void;
  /**
   * Called once a run has landed successfully. Tools clear their secrets here
   * too: a password left in state after the download is a password still in
   * the field, still revealable by the eye toggle, on a machine the user may
   * have walked away from.
   */
  onSuccess?: () => void;
  stats: (state: QpdfShellState) => StatCell[];
  /** The rail's contents. */
  controls: (state: QpdfShellState) => ReactNode;
  /** Extra canvas rows under the stat strip — the tool's own result readout. */
  canvas?: (state: QpdfShellState) => ReactNode;
  /**
   * Rendered directly under the error, in the footer beside the button that
   * produced it. Never called for an "engine" failure: the shell says that one
   * itself, because a tool's advice about the user's document is wrong when the
   * document was never read.
   */
  errorDetail?: (state: QpdfShellState) => ReactNode;
  /** The accent stat in the canvas header. */
  headerTrailing?: (state: QpdfShellState) => string | undefined;
  /** One sentence above qpdf's raw warning lines, when there are any. */
  warningsLead?: (result: QpdfJobResult) => string;
}

/**
 * The rail field shape, copy-pasted rather than shared in this codebase (see
 * `CssGradientGeneratorUI`, `ColorPickerUI`, `AddPageNumbersUI` — each carries
 * its own). Kept verbatim so the password fields sit at the same height as
 * every other field in a rail.
 */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

/**
 * The repo's first password input.
 *
 * `type="password"` so a shoulder cannot read it, plus a reveal toggle because
 * a password you cannot check is a password you mistype — and here a mistyped
 * password is a file nobody can open again. `autoComplete` is the caller's
 * call: "new-password" where the field creates a secret (so a manager offers
 * to generate and store one), "off" where it enters an existing one for a
 * document the browser has no account for.
 *
 * NOT A CONTROLLED INPUT, and that is the whole point. React syncs a `value`
 * PROP onto the DOM `value` ATTRIBUTE, so a controlled password field puts the
 * cleartext password into `document.documentElement.outerHTML` — measured:
 * `<input … type="password" value="hunter2">` — which is exactly what
 * `type="password"` is there to prevent. Anything that serialises the live DOM
 * (DevTools "Copy outerHTML", "Save page as", an extension content script, a
 * session-replay tag) reads it straight out.
 *
 * So the DOM node owns its own value and the attribute is written once, empty,
 * by `defaultValue`. The caller's state is still the source of truth — the
 * layout effect below pushes it down as a PROPERTY on every render, which is
 * what makes a programmatic clear (a file swap, or a finished run) actually
 * empty the box.
 */
export function QpdfPasswordField({
  label,
  value,
  onChange,
  onEnter,
  autoComplete,
  placeholder,
  disabled,
}: {
  /** The accessible name. There is no visible <label>; the rail heading is a div. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter in the field runs the tool, the way the range fields commit on Enter. */
  onEnter?: () => void;
  autoComplete: "new-password" | "off";
  placeholder?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  /*
    Runs on EVERY render rather than on a `value` dep: the node is uncontrolled,
    so React will not put the value back if the DOM and the caller's state ever
    disagree, and the comparison is one string compare per keystroke.
    `useLayoutEffect` so the box is never painted holding a secret the caller
    has already dropped.
  */
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  });
  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        // Empty, and the only thing ever written to the `value` ATTRIBUTE.
        defaultValue=""
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        disabled={disabled}
        aria-label={label}
        autoComplete={autoComplete}
        // A password field that autocapitalises or autocorrects silently
        // changes what the user typed, and they cannot see it to notice.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        className={cn(FIELD_CLASS, "min-w-0 flex-1")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        className="flex-none cursor-pointer rounded-[7px] border border-border px-2 py-[7px] text-text-muted transition-colors duration-200 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        {visible ? (
          <EyeOff size={14} aria-hidden="true" />
        ) : (
          <Eye size={14} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function QpdfToolShell({
  primaryLabel,
  runningLabel,
  phase,
  outputSuffix,
  failureMessage,
  preflight,
  run,
  validate,
  runDisabled,
  onFileChange,
  onSuccess,
  stats,
  controls,
  canvas,
  errorDetail,
  headerTrailing,
  warningsLead,
}: QpdfToolShellProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<QpdfShellStatus>("idle");
  const [protection, setProtection] = useState<QpdfProtection | null>(null);
  const [result, setResult] = useState<QpdfJobResult | null>(null);
  const [output, setOutput] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
    Bumped every time a message is shown. It keys the alert, so a REPEATED
    refusal REMOUNTS the node instead of re-rendering the same text into it.
    Measured on the shipped build: clicking a refusing primary a second time
    produced ZERO mutations inside [data-tool-surface], so the `role="alert"`
    region had nothing to announce and a screen-reader user got silence for a
    button that had just refused them twice.
  */
  const [errorSeq, setErrorSeq] = useState(0);
  /*
    Kept apart from `error` on purpose: a failed probe is a fact about the FILE
    and must survive every control change, where a failed run is a fact about
    the last click and must not.
  */
  const [preflightError, setPreflightError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    The three tool-supplied callbacks close over the tool's own control state,
    so they are a fresh function on every keystroke. Read through refs, the
    shell's own handlers stay referentially stable — `ToolActions` binds ⌘↵ in
    an effect keyed on `onPrimary`, and an unstable handler would tear that
    listener down and rebuild it on every character typed into a password box.
  */
  const preflightRef = useRef(preflight);
  const runRef = useRef(run);
  const validateRef = useRef(validate);
  const fileChangeRef = useRef(onFileChange);
  const successRef = useRef(onSuccess);
  useEffect(() => {
    preflightRef.current = preflight;
    runRef.current = run;
    validateRef.current = validate;
    fileChangeRef.current = onFileChange;
    successRef.current = onSuccess;
  });

  /** One place to set a message, so the alert's remount key can never drift. */
  const showError = useCallback((message: string) => {
    setError(message);
    setErrorSeq((n) => n + 1);
  }, []);

  /*
    A run is async and nothing cancels it, so clearing the state is not enough
    on its own: swap the file (or change a control) while qpdf is working and
    the settling promise would still call setOutput(), binding the OLD
    document's bytes to the NEW file — the download then hands over the wrong
    PDF under the right name. The same fence covers the pre-flight probe, which
    would otherwise classify a file the user has already replaced.

    Every invalidation bumps this token; a run captures it at the start and
    commits nothing unless it still matches. A ref, not state, because the
    check has to see the value at the moment the promise settles rather than
    the one captured when the callback was created.
  */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setOutput(null);
    setElapsed(null);
    setError(null);
    setStatus("idle");
  }, []);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    runToken.current += 1;
    const token = runToken.current;
    setFile(f);
    setProtection(null);
    setResult(null);
    setOutput(null);
    setElapsed(null);
    setError(null);
    setPreflightError(null);
    fileChangeRef.current?.();

    if (!preflightRef.current) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    void (async () => {
      try {
        const found = await classifyPdfProtection(await f.arrayBuffer());
        if (runToken.current !== token) return;
        setProtection(found);
        setStatus("idle");
      } catch (err) {
        if (runToken.current !== token) return;
        // Nothing this tool does is safe on a file it could not even classify,
        // so the primary stays shut and the canvas points at repair-pdf, which
        // is the one tool here that does not need to read the file first.
        setPreflightError(
          err instanceof Error ? err.message : "Could not read this PDF's encryption",
        );
        setStatus("idle");
      }
    })();
  }, []);

  const handleReset = useCallback(() => {
    runToken.current += 1;
    setFile(null);
    setProtection(null);
    setResult(null);
    setOutput(null);
    setElapsed(null);
    setError(null);
    setPreflightError(null);
    setStatus("idle");
    fileChangeRef.current?.();
  }, []);

  const handleRun = useCallback(async () => {
    if (!file) return;
    const verdict =
      preflightRef.current && protection ? preflightRef.current(protection) : undefined;
    if (verdict?.blocked) return;
    const invalid = validateRef.current?.(protection) ?? null;
    if (invalid) {
      // Not a status change: nothing ran, so nothing failed. The message says
      // what has to change before the click will do anything.
      showError(invalid);
      return;
    }
    // Starting a run is itself an invalidation, and it is what stamps the
    // token this run will be checked against.
    runToken.current += 1;
    const token = runToken.current;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    setOutput(null);
    const startedAt = performance.now();
    try {
      const out = await runRef.current(file);
      // Superseded while it ran: the file or a control changed under it, so
      // this output belongs to a document the user is no longer looking at.
      // Drop it on the floor — the invalidation has already reset the surface.
      if (runToken.current !== token) return;
      if (!out.bytes || out.bytes.length === 0) {
        // qpdf writes a 0-byte out.pdf on some refusals. Publishing that as a
        // download would be an empty file wearing a success.
        throw new Error(failureMessage);
      }
      setResult(out);
      setOutput(new Blob([out.bytes as BlobPart], { type: "application/pdf" }));
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
      /*
        The output is committed FIRST and the secrets dropped after, in this
        order: the tools clear their password state here, and clearing it before
        the download existed would leave a surface with neither. Nothing in here
        invalidates, so the download survives its own tool forgetting the
        password that produced it.
      */
      successRef.current?.();
    } catch (err) {
      // Same fence on the failure path: a superseded run's error must not
      // land on the document the user has since loaded.
      if (runToken.current !== token) return;
      showError(err instanceof Error ? err.message : failureMessage);
      setStatus("error");
    }
  }, [file, protection, failureMessage, showError]);

  if (!file) {
    return <DropZone accept=".pdf" onFiles={handleFiles} />;
  }

  const verdict = preflight && protection ? preflight(protection) : undefined;
  const blocked = Boolean(verdict?.blocked);
  const busy = status === "loading" || status === "processing";

  const errorKind = error === null ? null : qpdfErrorKind(error);
  const preflightKind = preflightError === null ? null : qpdfErrorKind(preflightError);

  const state: QpdfShellState = {
    file,
    status,
    protection,
    blocked,
    busy,
    result,
    output,
    error,
    errorKind,
    invalidate,
  };

  return (
    <>
      {/* ── Canvas: the document, and exactly what happened to it ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={headerTrailing?.(state)}
        />

        <DocStrip>
          <DocCard index={1} name={file.name} meta={formatFileSize(file.size)} badge="PDF" />
        </DocStrip>

        <StatStrip stats={stats(state)} />

        {verdict?.blocked && <ErrorMessage message={verdict.blocked} />}
        {verdict?.detail}

        {/*
          A failed pre-flight is a fact about the LOAD, not about a click, so it
          stays on the canvas where it appeared. What it is a fact ABOUT is the
          thing that has to be got right. A file qpdf cannot parse now comes
          back as the "unreadable" VERDICT rather than a throw, so what reaches
          here is overwhelmingly the 2.3 MB engine failing to arrive — a failed
          wasm fetch, a failed glue import, a worker that did not load — and
          none of that is about the user's document. Reported as "This PDF
          could not be read" it told someone with a perfectly good file that it
          was broken, then sent them to Repair PDF, which loads the same engine
          from the same URL and fails identically. Two branches, one true
          sentence each; the document branch stays for anything else the worker
          can throw.
        */}
        {preflightError &&
          (preflightKind === "engine" ? (
            <>
              <ErrorMessage message={engineFailureMessage(preflightError)} />
              <EngineFailureNote />
            </>
          ) : (
            <>
              <ErrorMessage message={`This PDF could not be read — ${preflightError}`} />
              <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
                Nothing on this page can be applied to a file it cannot open first. If the file is
                damaged rather than protected, try{" "}
                <Link href="/repair-pdf" className="text-accent underline hover:text-accent-hover">
                  Repair PDF
                </Link>
                , which rebuilds what it can read without parsing the file first.
              </p>
            </>
          ))}

        {canvas?.(state)}

        {/*
          qpdf's own WARNING lines, verbatim. On repair-pdf these ARE the
          result — the honest account of what was wrong with the file — so they
          are printed rather than folded into a count. Blank lines and the
          program prefix are already stripped by the engine.
        */}
        {result && result.warnings.length > 0 && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3"
          >
            <span className="font-body text-sm leading-[1.45] text-warning">
              {warningsLead?.(result) ?? "qpdf finished this file and reported the following."}
            </span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {result.warnings.map((warning) => (
                <li
                  key={warning}
                  className="font-mono text-[11px] leading-[1.5] break-words text-warning"
                >
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/*
              THE ERROR LIVES WITH THE BUTTON THAT PRODUCED IT, not on the
              canvas. Below `xl` the aside is a sheet UNDERNEATH the canvas, so
              a refusal rendered in the canvas column landed hundreds of pixels
              above the fold: measured at 375×812, tapping a refusing "Protect
              PDF" put the message at top:-623 — 517px above the viewport — with
              no scroll, no focus move and no visible change anywhere near the
              finger. The button simply looked dead. Here the message opens
              directly above the control that was pressed, at every width.

              Capped and scrollable because these sentences are long and the
              rail's footer is not: an uncapped block would push the primary off
              a short viewport, which is the same bug pointing the other way.
            */}
            {error && (
              <div
                key={errorSeq}
                className={cn(
                  "flex max-h-[40vh] flex-col gap-2 overflow-y-auto xl:max-h-[46vh]",
                  SCROLL_CLASS,
                )}
              >
                <ErrorMessage
                  message={errorKind === "engine" ? engineFailureMessage(error) : error}
                />
                {errorKind === "engine" ? <EngineFailureNote /> : errorDetail?.(state)}
              </div>
            )}
            {busy && (
              <ToolProgress
                phase={status === "loading" ? "READING ENCRYPTION" : phase}
                // qpdf reports no progress of any kind: one callMain, one exit
                // code. An invented percentage would be a number we made up.
                percent={null}
                label={status === "loading" ? "Reading this PDF's encryption" : runningLabel}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {output ? (
              <DownloadButton
                blob={output}
                fileName={file.name.replace(/\.pdf$/i, outputSuffix)}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? runningLabel : primaryLabel}
                primaryDisabled={
                  busy ||
                  blocked ||
                  preflightError !== null ||
                  Boolean(runDisabled?.(protection))
                }
                onPrimary={handleRun}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        {controls(state)}
      </ToolAside>
    </>
  );
}
