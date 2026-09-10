"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  isUnreadablePdf,
  QpdfPasswordField,
  QpdfToolShell,
} from "@/components/tools/QpdfToolShell";
import type { QpdfPreflightVerdict } from "@/components/tools/QpdfToolShell";
import { unlockPdf } from "@/lib/tools/qpdf";
import type { QpdfProtection } from "@/lib/tools/qpdf";
import { ToolAsideSection, ToolOutput } from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CanvasFootnote } from "@/components/tools/ToolCanvas";
import { formatFileSize } from "@/lib/utils/file-helpers";

/*
  Removes a PDF's password, and with it any usage restrictions it carries.

  THE PRE-FLIGHT IS THIS TOOL'S HONESTY. `--decrypt` on a file that was never
  encrypted is a SILENT NO-OP SUCCESS: rc 0, empty stderr, an output file that
  is a re-serialisation of the input. Without the `--requires-password` probe
  the tool would print "Done in 40 ms" and hand over a `-unlocked.pdf` for a
  document that had nothing to unlock. So a file with no protection is refused
  outright, and the refusal says exactly that.

  Two of the four verdicts run, and they mean different things:

    password-required   a password is needed to open it, and one is needed here.
    restrictions-only   it opens without a password, but carries permission
                        flags. Measured: `--decrypt` with NO password strips
                        them (rc 0). So the field is not shown at all — there
                        is nothing to type, and typing something would only
                        risk qpdf rejecting a password the file never had.

  The fourth, "unreadable", is refused too: qpdf could not parse the file, so
  nothing is known about its protection and there is nothing to remove.
*/

/**
 * The probe's verdict as the stat strip prints it — and as the rail's "Found"
 * row and the canvas header repeat it.
 *
 * A function rather than a `Record` for two reasons. It is total over the union
 * even as it grows (a lookup printed an EMPTY cell for a verdict the map had
 * no key for, which is how "unreadable" would have arrived), and its answers
 * are exactly what the alert two rows above says in words: a permuted map made
 * the surface contradict itself — "PROTECTION · PASSWORD" over "This PDF has
 * no password and no usage restrictions on it" — with every test still green.
 * The unit suite now pins all four.
 */
function protectionStat(protection: QpdfProtection): string {
  switch (protection) {
    case "password-required":
      return "PASSWORD";
    case "restrictions-only":
      return "RESTRICTIONS";
    case "none":
      return "NONE";
    default:
      // "unreadable", once the engine tells it apart from "not encrypted".
      return "UNREADABLE";
  }
}

export function UnlockPdfUI() {
  const [password, setPassword] = useState("");

  /**
   * Dropped on a file swap AND on a finished run — see `onSuccess` below. The
   * password that opens someone's document has no business sitting in a
   * re-enabled field, behind a reveal toggle, after the unlocked copy has been
   * handed over.
   */
  const clearSecrets = useCallback(() => setPassword(""), []);

  /*
    NO LENGTH GUARD, deliberately.

    127 and 32 are limits on what qpdf can WRITE at revision 6 and revision 4;
    they are not limits on what it will ACCEPT when opening a file somebody
    else's tool produced. Measured: a document encrypted elsewhere at
    --bits=128 with a 200-byte password is opened by that 200-byte password on
    the first try (R=4 truncates it to 32 bytes on both sides, so it matches).
    A guard here refused exactly that document, with a sentence claiming a
    limit that does not exist for reading.
  */

  const run = useCallback(
    // `password` is "" for a restrictions-only file, because the field is not
    // rendered for one and the value is cleared on every file change. That is
    // exactly the argv the measurement covers.
    async (file: File) => unlockPdf(await file.arrayBuffer(), password),
    [password],
  );

  const preflight = useCallback((protection: QpdfProtection): QpdfPreflightVerdict => {
    if (isUnreadablePdf(protection)) {
      /*
        Not the same thing as "not encrypted", and the difference matters here
        more than anywhere: qpdf could not parse the file, so nothing is known
        about its protection. Telling this user their file "has no password and
        no usage restrictions" would be a fact invented out of a parse failure.
      */
      return {
        blocked:
          "This file could not be read as a PDF, so there is no way to tell whether it is protected. Nothing here can be removed from a file that cannot be opened.",
        detail: (
          <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
            If it is a PDF that was damaged rather than one that is not a PDF at all,{" "}
            <Link href="/repair-pdf" className="text-accent underline hover:text-accent-hover">
              Repair PDF
            </Link>{" "}
            rebuilds what it can read. It cannot open an encrypted file, so a document that needs
            a password has to be unlocked here first.
          </p>
        ),
      };
    }
    if (protection === "none") {
      return {
        blocked:
          "This PDF has no password and no usage restrictions on it — there is nothing here to remove.",
        detail: (
          <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
            Running anyway would succeed without changing anything, which would look exactly like
            a successful unlock, so this tool stops instead. To put a password on the file, use{" "}
            <Link href="/protect-pdf" className="text-accent underline hover:text-accent-hover">
              Protect PDF
            </Link>
            .
          </p>
        ),
      };
    }
    if (protection === "restrictions-only") {
      return {
        detail: (
          <WarningMessage message="This PDF opens without a password, but it carries usage restrictions — limits on printing, editing or copying. Those come off without a password, so there is nothing to type." />
        ),
      };
    }
    return {};
  }, []);

  return (
    <QpdfToolShell
      primaryLabel="Remove password"
      runningLabel="Removing…"
      phase="DECRYPTING"
      outputSuffix="-unlocked.pdf"
      failureMessage="Failed to remove the password from this PDF"
      preflight={preflight}
      run={run}
      runDisabled={(protection) => protection === "password-required" && password === ""}
      onFileChange={clearSecrets}
      onSuccess={clearSecrets}
      headerTrailing={({ output, protection }) =>
        output ? formatFileSize(output.size) : protection ? protectionStat(protection) : undefined
      }
      stats={({ file, output, protection }) => [
        { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
        { label: "OUT", value: output ? formatFileSize(output.size) : "—" },
        {
          label: "PROTECTION",
          value: protection ? protectionStat(protection) : "—",
          tone: "neutral",
        },
        { label: "ENGINE", value: "QPDF", tone: "neutral" },
      ]}
      canvas={({ output, protection }) =>
        output ? (
          <CanvasFootnote>
            {protection === "restrictions-only"
              ? "THE USAGE RESTRICTIONS ARE GONE — THE DOWNLOAD IS AN UNENCRYPTED PDF."
              : "THE PASSWORD AND ANY USAGE RESTRICTIONS ARE GONE — THE DOWNLOAD OPENS WITHOUT ONE."}
          </CanvasFootnote>
        ) : null
      }
      controls={({ busy, blocked, protection, output, invalidate }) => {
        const disabled = busy || blocked;
        // Hidden for a restrictions-only file: there is nothing to type, and a
        // field that accepts input it will not use is a field that lies.
        const needsPassword =
          protection !== "restrictions-only" &&
          protection !== "none" &&
          !isUnreadablePdf(protection);
        return (
          <>
            <ToolControlGroup>
              <ToolControl label="PASSWORD">
                {needsPassword ? (
                  <>
                    <QpdfPasswordField
                      label="Password"
                      value={password}
                      onChange={(v) => {
                        invalidate();
                        setPassword(v);
                      }}
                      // Not "new-password": this is an existing secret being
                      // entered for a document, not one being created, and the
                      // browser has no saved credential for it either.
                      autoComplete="off"
                      placeholder="Required"
                      disabled={disabled}
                    />
                    <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                      The password that opens the document. There is no way to guess or crack one
                      here — without it the file stays shut.
                    </span>
                    {output && (
                      <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                        It was cleared from this page the moment the unlocked copy was written, so
                        nothing here is still holding it.
                      </span>
                    )}
                  </>
                ) : (
                  <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                    Not needed for this file. It opens without a password, and its restrictions
                    come off without one too.
                  </span>
                )}
              </ToolControl>
            </ToolControlGroup>

            <ToolAsideSection label="OUTPUT">
              <ToolOutput
                rows={[
                  ["Found", protection ? protectionStat(protection) : "—"],
                  ["Password needed", needsPassword ? "Yes" : "No"],
                  ["Output", "An unencrypted PDF"],
                ]}
              />
            </ToolAsideSection>

            <ToolAsideSection label="WHAT THIS DOES">
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                qpdf decrypts the document in this tab and writes it back out without encryption.
                The pages, text, images and form fields come through unchanged; nothing is
                uploaded.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                You need the password that opens the file. This is not a cracker: there is no
                guessing, no wordlist and no recovery here.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                A file that only carries restrictions is a different case — it opens for anyone,
                and its restrictions come off without a password. That is how PDF permissions
                work: they are recorded in the file and honoured by readers, not held shut by the
                encryption.
              </span>
            </ToolAsideSection>
          </>
        );
      }}
    />
  );
}
