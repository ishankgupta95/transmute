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
import type { QpdfPreflightVerdict, QpdfShellState } from "@/components/tools/QpdfToolShell";
import {
  protectPdf,
  maxPasswordBytes,
  passwordByteLength,
  QPDF_MAX_PASSWORD_BYTES,
  QPDF_PERMISSIONS_ALLOW_ALL,
} from "@/lib/tools/qpdf";
import type {
  QpdfEncryptionBits,
  QpdfPermissions,
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
import { cn } from "@/lib/utils/cn";

/*
  Password-protects a PDF: qpdf writes an encrypted copy that will not open
  without the password you set.

  Three measured facts shape this whole surface.

  ONE — an over-long password is silent data loss, and THE LIMIT DEPENDS ON THE
  STRENGTH BUTTON. At AES-256 it is 127 UTF-8 bytes: past that qpdf takes the
  password, encrypts, exits 0, prints nothing, and the file then refuses that
  password for ever and every truncation of it too. At AES-128 qpdf writes
  revision 4, whose handler keeps only the FIRST 32 BYTES — measured, a 60-
  character password there opens the file by its first 32 characters followed
  by any tail at all. There is no warning to pass on in either case, so the
  guard lives here, before the call, and it reads the strength.

  TWO — qpdf will not write an encrypted file that has a user password and no
  owner password (measured rc 2). Setting owner == user is accepted with rc 0
  and no warning, so that is the default, and the rail says out loud that it is
  what happens rather than leaving the user to assume the owner slot is empty.

  THREE — `--encrypt` writes a NEW encryption dictionary rather than merging
  with the one already there, so a file that arrived carrying usage
  restrictions comes back carrying only what this rail says. That is a loss,
  and the pre-flight says so before the run rather than after the download.
*/

const BITS_OPTIONS: readonly { value: QpdfEncryptionBits; label: string }[] = [
  { value: 256, label: "AES-256" },
  { value: 128, label: "AES-128" },
];

export function ProtectPdfUI() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [separateOwner, setSeparateOwner] = useState(false);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [bits, setBits] = useState<QpdfEncryptionBits>(256);
  const [restrict, setRestrict] = useState(false);
  const [permissions, setPermissions] = useState<QpdfPermissions>(QPDF_PERMISSIONS_ALLOW_ALL);

  // Only the permissions that will actually be sent. With the checkbox off the
  // engine gets the allow-all baseline, so every readout below describes the
  // run rather than the controls the user left behind a closed disclosure.
  const activePermissions = restrict ? permissions : QPDF_PERMISSIONS_ALLOW_ALL;
  const restrictionCount =
    (activePermissions.print !== "full" ? 1 : 0) +
    (activePermissions.modify !== "all" ? 1 : 0) +
    (activePermissions.extract ? 0 : 1);
  const passwordBytes = passwordByteLength(password);
  const maxBytes = maxPasswordBytes(bits);

  /**
   * Secrets do not survive a file swap, and do not survive a finished run
   * either — see `onSuccess` below. Settings do; they are not secrets.
   */
  const clearSecrets = useCallback(() => {
    setPassword("");
    setConfirm("");
    setOwnerPassword("");
  }, []);

  const validate = useCallback((): string | null => {
    /*
      THE BYTE GUARD. Counted with TextEncoder because the limit is UTF-8
      BYTES and `password.length` is UTF-16 code units — "café" is 4 characters
      and 5 bytes, an emoji is 2 code units and 4 bytes. Getting this wrong
      would let exactly the passwords that break through.

      The limit itself tracks the selected strength: 127 at AES-256, 32 at
      AES-128, both measured. A fixed 127 is right for one of the two buttons
      on this rail and silently lossy for the other.
    */
    const bytes = passwordByteLength(password);
    if (bytes > maxBytes) {
      return `That password is ${bytes} bytes long and the limit at AES-${bits} is ${maxBytes}. Past the limit qpdf encrypts the file without complaining — at AES-128 it keeps only the first ${maxBytes} bytes, at AES-256 the password can never be entered again — so this run is blocked instead. The limit counts bytes, not characters: an accented letter costs 2, most CJK characters 3, an emoji 4.`;
    }
    if (confirm !== password) {
      return "The two passwords do not match. Retype the confirmation — a mistyped password on a file nobody can open again is not a mistake this tool can undo for you.";
    }
    if (separateOwner) {
      const ownerBytes = passwordByteLength(ownerPassword);
      if (ownerBytes > maxBytes) {
        return `That owner password is ${ownerBytes} bytes long and the limit at AES-${bits} is ${maxBytes}. The limit counts bytes, not characters.`;
      }
    }
    return null;
  }, [password, confirm, separateOwner, ownerPassword, bits, maxBytes]);

  const run = useCallback(
    async (file: File) =>
      protectPdf(await file.arrayBuffer(), {
        userPassword: password,
        // qpdf rejects a user password with no owner password (measured rc 2),
        // so one is always sent. When the user has not set a separate one it
        // is the same password — which is what the rail says it will be.
        ownerPassword: separateOwner ? ownerPassword : password,
        permissions: activePermissions,
        bits,
      }),
    [password, separateOwner, ownerPassword, activePermissions, bits],
  );

  const preflight = useCallback((protection: QpdfProtection): QpdfPreflightVerdict => {
    if (isUnreadablePdf(protection)) {
      // qpdf could not parse the file, so `--encrypt` has nothing to rewrite.
      // Running would fail on the engine's side with a message about the
      // document; saying it here costs the user nothing and a wasted run.
      return {
        blocked:
          "This file could not be read as a PDF, so there is nothing here to encrypt. qpdf has to parse a document before it can write a protected copy of it.",
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
      // Measured: `--encrypt` on a file that needs a password to open fails
      // rc 2 with "invalid password". Running it would produce nothing but a
      // confusing error, so say what the file is instead.
      return {
        blocked:
          "This PDF already needs a password to open it. qpdf cannot re-encrypt a file it cannot open, so the existing password has to come off first.",
        detail: (
          <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
            If you have that password,{" "}
            <Link href="/unlock-pdf" className="text-accent underline hover:text-accent-hover">
              Unlock PDF
            </Link>{" "}
            removes it. Then come back here to set a new one.
          </p>
        ),
      };
    }
    if (protection === "restrictions-only") {
      /*
        MEASURED, AND IT IS A LOSS THE USER HAS TO BE TOLD ABOUT BEFORE THE RUN.
        `--encrypt` writes a BRAND-NEW encryption dictionary; it does not merge
        with the one already in the file. So the input's permission word is
        dropped and replaced by whatever the controls on this rail say — with
        "Also restrict what readers can do" off, that is the allow-all default.
        A file that arrived denying printing and copying (P = -2072, exactly
        what this site's own Permissions tool writes) comes back at P = -4 with
        both allowed. Saying only "it carries usage restrictions" left the user
        to assume they were kept.
      */
      return {
        detail: (
          <WarningMessage
            message={
              restrict
                ? "This PDF is already encrypted, but it opens without a password — it carries usage restrictions only. Protecting it writes a new encryption dictionary, so the restrictions it carries now are REPLACED by the ones set on this rail, not added to them."
                : "This PDF is already encrypted, but it opens without a password — it carries usage restrictions only. Protecting it writes a new encryption dictionary, so the restrictions it carries now are REPLACED, not kept. The restrictions checkbox on this rail is off, which means the file comes back with printing, editing and copying all allowed again."
            }
          />
        ),
      };
    }
    return {};
  }, [restrict]);

  return (
    <QpdfToolShell
      primaryLabel="Protect PDF"
      runningLabel="Protecting…"
      phase="ENCRYPTING"
      outputSuffix="-protected.pdf"
      failureMessage="Failed to protect this PDF"
      preflight={preflight}
      run={run}
      validate={validate}
      runDisabled={() => password === "" || (separateOwner && ownerPassword === "")}
      onFileChange={clearSecrets}
      /*
        The password is dropped the moment the encrypted file exists. A secret
        that outlives its run is a populated, re-enabled field behind an eye
        toggle — one click from being read off a shared screen by whoever sits
        down next. The download is already published by the time this runs, so
        nothing is lost but the secret. (Keeping it out of the DOM in the first
        place is `QpdfPasswordField`'s job; this is the other half.)
      */
      onSuccess={clearSecrets}
      headerTrailing={({ output }) =>
        output ? formatFileSize(output.size) : `AES-${bits}`
      }
      stats={({ file, output }) => [
        { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
        { label: "OUT", value: output ? formatFileSize(output.size) : "—" },
        { label: "ENCRYPTION", value: `AES-${bits}`, tone: "neutral" },
        {
          /*
            "NEW LIMITS", not "RESTRICTIONS": this cell is derived from the
            controls on the rail and describes the file this run will WRITE. As
            "RESTRICTIONS · NONE" it read as a fact about the loaded document —
            and printed exactly that, "NONE", on the same canvas as the warning
            saying the file carries usage restrictions.
          */
          label: "NEW LIMITS",
          value: restrictionCount === 0 ? "NONE" : String(restrictionCount),
          tone: "neutral",
        },
      ]}
      canvas={({ output }) => (
        <CanvasFootnote>
          {output
            ? "THE PASSWORD HAS BEEN CLEARED FROM THIS PAGE. THERE IS NO RECOVERY — LOSE IT AND THE FILE STAYS SHUT."
            : "THE PASSWORD NEVER LEAVES THIS DEVICE, AND THERE IS NO RECOVERY — LOSE IT AND THE FILE STAYS SHUT."}
        </CanvasFootnote>
      )}
      controls={({ busy, blocked, output, invalidate }: QpdfShellState) => {
        const disabled = busy || blocked;
        return (
          <>
            <ToolControlGroup>
              <ToolControl label="PASSWORD">
                <QpdfPasswordField
                  label="Password"
                  value={password}
                  onChange={(v) => {
                    invalidate();
                    setPassword(v);
                  }}
                  // A new secret: this is what tells a password manager to
                  // offer to generate and store one rather than filling in a
                  // password it has saved for this site.
                  autoComplete="new-password"
                  placeholder="Required"
                  disabled={disabled}
                />
                <QpdfPasswordField
                  label="Confirm password"
                  value={confirm}
                  onChange={(v) => {
                    invalidate();
                    setConfirm(v);
                  }}
                  autoComplete="new-password"
                  placeholder="Type it again"
                  disabled={disabled}
                />
                {/*
                  The live byte count is the only way to see the limit coming:
                  it is a byte limit and the field shows characters. Written as
                  one interpolated sentence so the number and the unit cannot
                  drift apart — and so the limit tracks the ENCRYPTION buttons
                  below, which move it between 127 and 32.
                */}
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  {`Up to ${maxBytes} bytes at AES-${bits}${
                    password === "" ? "" : ` — this one is ${passwordBytes}`
                  }. Bytes, not characters: an accented letter costs 2, most CJK characters 3, an emoji 4.`}
                </span>
                {output && (
                  <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                    The password was cleared from this page the moment the encrypted file was
                    written, so nothing here is still holding it. Type it again to run once more.
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
                  AES-256 is the stronger of the two and what current readers expect. AES-128
                  opens in more places; pick it only if something cannot open an AES-256 file.
                  The old RC4 modes are not offered at all — they are broken.
                </span>
              </ToolControl>

              <ToolControl label="OWNER PASSWORD">
                <label
                  className={cn(
                    "flex items-center gap-2.5 font-body text-[12.5px] text-neutral-300",
                    disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={separateOwner}
                    disabled={disabled}
                    onChange={(e) => {
                      invalidate();
                      setSeparateOwner(e.target.checked);
                    }}
                    className="size-4 rounded-sm border-border accent-accent"
                  />
                  Set a separate owner password
                </label>
                {separateOwner && (
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
                )}
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  {separateOwner
                    ? "The owner password is the one a reader asks for before letting someone change the restrictions. It does not open the document — the password above does that."
                    : "Not set, so the owner password will be the same as the password above. qpdf refuses to encrypt with an open password and no owner password, so one is always written."}
                </span>
              </ToolControl>

              <ToolControl label="RESTRICTIONS">
                <label
                  className={cn(
                    "flex items-center gap-2.5 font-body text-[12.5px] text-neutral-300",
                    disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={restrict}
                    disabled={disabled}
                    onChange={(e) => {
                      invalidate();
                      setRestrict(e.target.checked);
                    }}
                    className="size-4 rounded-sm border-border accent-accent"
                  />
                  Also restrict what readers can do
                </label>
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  Off, the file is unrestricted once the password has opened it — print, edit and
                  copy as normal.
                </span>
              </ToolControl>

              {restrict && (
                <PdfPermissionControls
                  value={permissions}
                  onChange={(next) => {
                    invalidate();
                    setPermissions(next);
                  }}
                  disabled={disabled}
                />
              )}
            </ToolControlGroup>

            <ToolAsideSection label="OUTPUT">
              <ToolOutput
                rows={[
                  [
                    "Opens with",
                    // After a run the field is empty because the secret was
                    // dropped, not because there is no password on the file.
                    output
                      ? "The password you set"
                      : password === ""
                        ? "—"
                        : "The password above",
                  ],
                  ["Encryption", `AES-${bits}`],
                  [
                    "Owner password",
                    separateOwner ? "Separate" : "Same as the password",
                  ],
                  [
                    "Restrictions",
                    restrictionCount === 0 ? "None" : `${restrictionCount} set`,
                  ],
                ]}
              />
            </ToolAsideSection>

            <ToolAsideSection label="WHAT THIS DOES">
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                qpdf writes an encrypted copy of your PDF in this tab. Neither the file nor the
                password is uploaded anywhere.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                The pages, text, images and form fields are written straight back out — the only
                thing that changes is that the file is now encrypted.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                <strong>There is no recovery.</strong> Nothing on this site can reopen the file
                without the password, and nor can anyone else. Keep it somewhere you will still
                have it.
              </span>
              {/*
                ONE INTERPOLATED STRING, not JSX text around an expression. In
                JSX a text node that spans more than one source line loses the
                whitespace at its start, so `{N} bytes because…` wrapped across
                two lines COMPILED to "Passwords stop at 127bytes" — the source
                looked right and the shipped bundle read
                `"Passwords stop at ",i.QPDF_MAX_PASSWORD_BYTES,"bytes beca`.
                Inside a template literal the spacing is data, not layout.
              */}
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                {`Passwords stop at ${maxBytes} bytes because that is qpdf's limit at AES-${bits}: AES-256 carries up to ${QPDF_MAX_PASSWORD_BYTES}, AES-128 only 32. Past the limit qpdf encrypts anyway and reports success — at AES-256 the password is then refused for ever, at AES-128 everything past byte 32 is quietly ignored — so this tool blocks the run rather than letting either happen.`}
              </span>
            </ToolAsideSection>
          </>
        );
      }}
    />
  );
}
