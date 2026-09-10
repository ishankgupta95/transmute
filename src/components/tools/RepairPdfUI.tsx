"use client";

import Link from "next/link";
import { useCallback } from "react";
import { QpdfToolShell } from "@/components/tools/QpdfToolShell";
import { repairPdf } from "@/lib/tools/qpdf";
import { ToolAsideSection, ToolOutput } from "@/components/tools/ToolAside";
import { CanvasFootnote } from "@/components/tools/ToolCanvas";
import { formatFileSize } from "@/lib/utils/file-helpers";

/*
  Rebuilds a damaged PDF: qpdf re-reads the whole file and writes a fresh one,
  reconstructing the cross-reference table by scanning for the objects rather
  than trusting the index that is broken.

  NO PRE-FLIGHT, deliberately. The other three tools probe the file with
  `--requires-password` before they touch it; a damaged file is exactly the
  kind that may not survive that probe, and repairing it is the whole point
  here. So this one goes straight at the file.

  THE EXIT CODE IS THE RESULT, and collapsing it would make this tool lie.
  qpdf's rc 3 is "completed with warnings" — a SUCCESS, with a valid output
  file, and the warnings are the honest account of what was wrong. rc 0 means
  nothing was wrong at all. A wrapper that treated non-zero as failure would
  break this tool on the very files it exists to fix, and copy that treated
  rc 0 as a rescue would take credit for a file that was already fine.
*/

export function RepairPdfUI() {
  const run = useCallback(async (file: File) => repairPdf(await file.arrayBuffer()), []);

  return (
    <QpdfToolShell
      primaryLabel="Repair PDF"
      runningLabel="Repairing…"
      phase="REBUILDING"
      outputSuffix="-repaired.pdf"
      failureMessage="Failed to repair this PDF"
      run={run}
      headerTrailing={({ output }) => (output ? formatFileSize(output.size) : undefined)}
      stats={({ file, output, result }) => [
        { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
        { label: "OUT", value: output ? formatFileSize(output.size) : "—" },
        {
          label: "RESULT",
          value: !result ? "—" : result.exitCode === 0 ? "CLEAN" : "REPAIRED",
          tone: result?.exitCode === 0 ? "ok" : "neutral",
        },
        {
          label: "WARNINGS",
          value: result ? String(result.warnings.length) : "—",
          tone: "neutral",
        },
      ]}
      warningsLead={() =>
        "qpdf did not read this file cleanly. It rebuilt what it could, and every line below is a problem it found and worked around."
      }
      /*
        WHAT WENT WRONG IS NOT ONE THING, and printing one paragraph for every
        failure made this tool contradict itself. The fixed copy asserted the
        file had no trailer dictionary and that "nothing on this site can
        recover it" — printed verbatim under an engine message saying the file
        was password-protected (measured: an intact AES-256 PDF exits 2 here
        with "invalid password", because repair runs with no password and
        deliberately no pre-flight). The trailer claim was false, the file was
        byte-intact, and Unlock PDF one page over opens it.

        So the follow-up derives from the failure. It sits beside the message
        in the footer, and the shell never calls it for an engine-load failure —
        that one is not about the document at all.
      */
      errorDetail={({ error }) => (
        <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
          {error && /password|encrypt/i.test(error) ? (
            <>
              There is no password field on this page because a repair does not need one — an
              encrypted document simply has to be opened before anything can read it.{" "}
              <Link href="/unlock-pdf" className="text-accent underline hover:text-accent-hover">
                Unlock PDF
              </Link>{" "}
              removes the password; bring the copy it produces back here. The document itself is
              not damaged, and nothing on this page has changed it.
            </>
          ) : (
            <>
              qpdf rebuilds a document by re-reading it end to end, scanning for the objects
              rather than trusting the index that is broken. It could not get far enough into this
              file to write one back out. No PDF header or trailer dictionary to start from is the
              usual reason, and a file in that state is either damaged past reconstruction or was
              never a PDF.
            </>
          )}
        </p>
      )}
      canvas={({ status, result }) => {
        if (status === "error") {
          // The account of what happened lives beside the button now — see
          // `errorDetail`. Nothing belongs on the canvas for a failed run: the
          // stat strip above already reads RESULT "—", and a second paragraph
          // here is what was contradicting the message in the first place.
          return null;
        }
        if (!result) {
          return (
            <CanvasFootnote>
              A REPAIR IS A FULL RE-READ AND REWRITE. IT CANNOT PUT BACK BYTES THAT ARE MISSING.
            </CanvasFootnote>
          );
        }
        if (result.exitCode === 0) {
          /*
            rc 0 means qpdf found nothing to fix. Saying "repaired" here would
            take credit for a file that arrived intact — the honest line is
            that it parsed cleanly and has simply been written back out.
          */
          return (
            <CanvasFootnote>
              THIS FILE PARSED CLEANLY — NOTHING NEEDED REPAIRING. THE DOWNLOAD IS THE SAME
              DOCUMENT, WRITTEN BACK OUT BY QPDF.
            </CanvasFootnote>
          );
        }
        if (result.warnings.length === 0) {
          // rc 3 with nothing printed: it was rebuilt, but qpdf gave no detail
          // worth showing. Say both halves rather than inventing a diagnosis.
          return (
            <CanvasFootnote>
              QPDF DID NOT READ THIS FILE CLEANLY AND REBUILT WHAT IT COULD, BUT PRINTED NO DETAIL
              ABOUT WHAT WAS WRONG.
            </CanvasFootnote>
          );
        }
        // rc 3 with warnings: the block the shell prints below IS the readout.
        return null;
      }}
      controls={({ result }) => (
        <>
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                [
                  "Result",
                  !result ? "—" : result.exitCode === 0 ? "Parsed cleanly" : "Rebuilt",
                ],
                ["Warnings", result ? String(result.warnings.length) : "—"],
                ["Engine", "QPDF"],
              ]}
            />
          </ToolAsideSection>

          <ToolAsideSection label="WHAT THIS DOES">
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              qpdf reads the whole file and writes a fresh one. A broken cross-reference table, a
              damaged object stream or a file truncated part-way through a save are the cases it
              usually gets past, because it scans for the objects rather than trusting the index
              that is broken.
            </span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              It cannot rebuild a file with no trailer dictionary at all — there is nothing left
              to tell it where the document begins — and it is not an undelete: bytes that are
              missing stay missing, and the pages that were in them stay gone.
            </span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              It cannot open an encrypted document either. A repair is a full re-read, and a PDF
              that needs a password has to be unlocked before anything can read it — that is not
              damage, and Unlock PDF handles it. This page has no password field for that reason.
            </span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              A file that was already fine comes back fine, and this tool says so rather than
              claiming a rescue. When something genuinely was wrong, qpdf&apos;s own report of
              what it found is printed on the canvas.
            </span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              The rebuild happens in this tab. Nothing is uploaded.
            </span>
          </ToolAsideSection>
        </>
      )}
    />
  );
}
