"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { PdfPermissionControls } from "@/components/tools/PdfPermissionControls";
import {
  isUnreadablePdf,
  QpdfPasswordField,
  QpdfToolShell,
} from "@/components/tools/QpdfToolShell";
import type { QpdfPreflightVerdict } from "@/components/tools/QpdfToolShell";
import {
  protectPdf,
  maxPasswordBytes,
  passwordByteLength,
  QPDF_PERMISSIONS_ALLOW_ALL,
} from "@/lib/tools/qpdf";
import type {
  QpdfEncryptionBits,
  QpdfModifyPermission,
  QpdfPermissions,
  QpdfPrintPermission,
  QpdfProtection,
} from "@/lib/tools/qpdf";
import {
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CanvasFootnote } from "@/components/tools/ToolCanvas";
import { formatFileSize } from "@/lib/utils/file-helpers";

/*
  Sets what a reader may do with a PDF — print it, edit it, copy out of it —
  without putting a password on the front door.

  Mechanically this is the same qpdf `--encrypt` call protect-pdf makes, with
  an EMPTY user password: that is how the PDF format records permissions, and
  it is measured (empty user password + an owner password is accepted, rc 0).
  An owner password is therefore not optional here — qpdf refuses to write the
  encryption dictionary without one.

  THE DISCLOSURE THIS TOOL OWES ITS USER, and the reason it is on the canvas
  rather than buried in the rail: because the file opens without a password,
  `--decrypt` with NO password strips every one of these restrictions back off
  (rc 0, measured — this site's own Unlock PDF does exactly that). Permissions
  are a number readers agree to honour, not a lock. A page that let someone
  think otherwise would be selling protection it cannot deliver.
*/

const BITS_OPTIONS: readonly { value: QpdfEncryptionBits; label: string }[] = [
  { value: 256, label: "AES-256" },
  { value: 128, label: "AES-128" },
];

const PRINT_STAT: Record<QpdfPrintPermission, string> = {
  full: "FULL",
  low: "LOW-RES",
  none: "NONE",
};

const MODIFY_STAT: Record<QpdfModifyPermission, string> = {
  all: "ALL",
  annotate: "ANNOTATE",
  form: "FORMS",
  assembly: "ASSEMBLE",
  none: "NONE",
};

export function PdfPermissionsUI() {
  const [permissions, setPermissions] = useState<QpdfPermissions>(QPDF_PERMISSIONS_ALLOW_ALL);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [bits, setBits] = useState<QpdfEncryptionBits>(256);

  const restrictionCount =
    (permissions.print !== "full" ? 1 : 0) +
    (permissions.modify !== "all" ? 1 : 0) +
    (permissions.extract ? 0 : 1);

  const maxBytes = maxPasswordBytes(bits);

  /**
   * Dropped on a file swap AND on a finished run — see `onSuccess` below. An
   * owner password left in state is a password React has mirrored into the DOM
   * `value` attribute and left revealable by the eye toggle.
   */
  const clearSecrets = useCallback(() => setOwnerPassword(""), []);

  const validate = useCallback((): string | null => {
    if (restrictionCount === 0) {
      // Every control is still at its allow-everything default. Running would
      // encrypt the file and restrict nothing — a change with no effect, sold
      // as a finished job. Say what has to happen instead.
      return "Nothing is restricted yet: printing, editing and copying are all still allowed. Change at least one of them, or this run would encrypt the file without limiting anything.";
    }
    /*
      UTF-8 bytes, not characters — and the limit is the one the SELECTED
      strength can actually round-trip: 127 at AES-256, 32 at AES-128 (measured
      both). Over it qpdf writes the file with no warning at all; at 256 the
      password can then never be entered again, at 128 everything past byte 32
      is silently ignored.
    */
    const bytes = passwordByteLength(ownerPassword);
    if (bytes > maxBytes) {
      return `That owner password is ${bytes} bytes long and the limit at AES-${bits} is ${maxBytes}. Past the limit qpdf writes the file without complaining — at AES-128 it keeps only the first ${maxBytes} bytes, at AES-256 the password can never be entered again — so this run is blocked instead. The limit counts bytes, not characters: an accented letter costs 2, most CJK characters 3, an emoji 4.`;
    }
    return null;
  }, [restrictionCount, ownerPassword, bits, maxBytes]);

  const run = useCallback(
    async (file: File) =>
      protectPdf(await file.arrayBuffer(), {
        // Empty on purpose: the document must still open for anyone. This is
        // the one thing that separates this tool from protect-pdf.
        userPassword: "",
        ownerPassword,
        permissions,
        bits,
      }),
    [ownerPassword, permissions, bits],
  );

  const preflight = useCallback((protection: QpdfProtection): QpdfPreflightVerdict => {
    if (isUnreadablePdf(protection)) {
      // Permissions live in the encryption dictionary, which qpdf has to parse
      // the document to write. It could not parse this one.
      return {
        blocked:
          "This file could not be read as a PDF, so no permissions can be written into it. qpdf has to parse a document before it can rewrite its encryption dictionary.",
        detail: (
          <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
            If it is a damaged PDF rather than a file that is not a PDF at all,{" "}
            <Link href="/repair-pdf" className="text-accent underline hover:text-accent-hover">
              Repair PDF
            </Link>{" "}
            rebuilds what it can read. Come back here once it opens.
          </p>
        ),
      };
    }
    if (protection === "password-required") {
      return {
        blocked:
          "This PDF needs a password to open it, so its permissions cannot be read or rewritten here.",
        detail: (
          <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
            If you have that password,{" "}
            <Link href="/unlock-pdf" className="text-accent underline hover:text-accent-hover">
              Unlock PDF
            </Link>{" "}
            removes it. Then come back here to set what readers may do.
          </p>
        ),
      };
    }
    if (protection === "restrictions-only") {
      return {
        detail: (
          <WarningMessage message="This PDF already carries usage restrictions — it opens without a password but limits what readers may do. The settings below are what it will carry instead." />
        ),
      };
    }
    return {};
  }, []);

  return (
    <QpdfToolShell
      primaryLabel="Apply restrictions"
      runningLabel="Applying…"
      phase="WRITING PERMISSIONS"
      outputSuffix="-restricted.pdf"
      failureMessage="Failed to apply restrictions to this PDF"
      preflight={preflight}
      run={run}
      validate={validate}
      runDisabled={() => ownerPassword === ""}
      onFileChange={clearSecrets}
      /*
        The owner password goes the moment the restricted file exists. The
        download is already published by the time this runs, so nothing is lost
        but the secret — and a secret sitting in a re-enabled field behind an
        eye toggle is the whole exposure.
      */
      onSuccess={clearSecrets}
      headerTrailing={({ output }) => (output ? formatFileSize(output.size) : `AES-${bits}`)}
      stats={({ file, output }) => [
        { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
        { label: "OUT", value: output ? formatFileSize(output.size) : "—" },
        { label: "PRINTING", value: PRINT_STAT[permissions.print], tone: "neutral" },
        { label: "EDITING", value: MODIFY_STAT[permissions.modify], tone: "neutral" },
      ]}
      canvas={({ output }) => (
        <>
          {/*
            Always on, before and after the run. This is not a footnote about
            an edge case — it is what these restrictions ARE, and the user has
            to know it before choosing them, not after downloading the file.
          */}
          <WarningMessage message="These restrictions do not keep anyone out. The file still opens for everyone with no password, and any tool that can open it can write it back out without them — including Unlock PDF on this site, which needs no password for a file like this." />
          <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
            For a file that will not open at all without a password, use{" "}
            <Link href="/protect-pdf" className="text-accent underline hover:text-accent-hover">
              Protect PDF
            </Link>
            .
          </p>
          {output && (
            <CanvasFootnote>
              THE DOWNLOAD STILL OPENS FOR ANYONE — WHAT CHANGED IS WHAT READERS ARE ASKED TO
              ALLOW.
            </CanvasFootnote>
          )}
        </>
      )}
      controls={({ busy, blocked, output, invalidate }) => {
        const disabled = busy || blocked;
        return (
          <>
            <ToolControlGroup>
              <PdfPermissionControls
                value={permissions}
                onChange={(next) => {
                  invalidate();
                  setPermissions(next);
                }}
                disabled={disabled}
              />

              <ToolControl label="OWNER PASSWORD">
                <QpdfPasswordField
                  label="Owner password"
                  value={ownerPassword}
                  onChange={(v) => {
                    invalidate();
                    setOwnerPassword(v);
                  }}
                  autoComplete="new-password"
                  placeholder="Required"
                  disabled={disabled}
                />
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  {`Required, and it does not lock the document — the file still opens for anyone. It is the password a reader asks for before letting someone change these settings, and qpdf will not write them without one. Up to ${maxBytes} bytes at AES-${bits}.`}
                </span>
                {output && (
                  <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                    The owner password was cleared from this page the moment the restricted file
                    was written, so nothing here is still holding it. Type it again to run once
                    more.
                  </span>
                )}
              </ToolControl>

              <ToolControl label="ENCRYPTION">
                <ToolChoice
                  label="Encryption strength"
                  fill
                  disabled={disabled}
                  value={bits}
                  onChange={(v: QpdfEncryptionBits) => {
                    invalidate();
                    setBits(v);
                  }}
                  options={BITS_OPTIONS}
                />
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  Permissions are stored in the file&apos;s encryption dictionary, so writing them
                  means encrypting — with an empty open password, which is why the file still
                  opens for anyone. AES-128 opens in more places; the old RC4 modes are not
                  offered at all.
                </span>
              </ToolControl>
            </ToolControlGroup>

            <ToolAsideSection label="OUTPUT">
              <ToolOutput
                rows={[
                  ["Opens with", "No password"],
                  ["Printing", PRINT_STAT[permissions.print]],
                  ["Editing", MODIFY_STAT[permissions.modify]],
                  ["Copying", permissions.extract ? "Allowed" : "Denied"],
                ]}
              />
            </ToolAsideSection>

            <ToolAsideSection label="WHAT THIS DOES">
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                qpdf writes the permission settings into the file in this tab. Nothing is
                uploaded, and the pages, text, images and form fields come through unchanged.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                The document opens with no password, exactly as it does now. Only what readers are
                asked to allow changes.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Because it opens without a password, anyone can also take these restrictions back
                off without one. They state intent; they do not enforce it.
              </span>
            </ToolAsideSection>
          </>
        );
      }}
    />
  );
}
