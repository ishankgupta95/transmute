"use client";

import { ToolChoice } from "@/components/tools/ToolAside";
import { ToolControl } from "@/components/tools/ToolControls";
import { cn } from "@/lib/utils/cn";
import type {
  QpdfModifyPermission,
  QpdfPermissions,
  QpdfPrintPermission,
} from "@/lib/tools/qpdf";

/*
  The permission controls, shared by protect-pdf (behind its "also restrict"
  checkbox) and pdf-permissions (expanded — they are its whole point). One copy
  of the controls means one copy of the copy, and these three settings are
  exactly the ones that have a measured effect.

  THREE CONTROLS, NOT FOUR. qpdf takes a fourth, `--accessibility=n`, and at
  AES-256 (revision 6) it changes the permission word not at all: the measured
  P is -4 with the flag and -4 without it, the same as an unrestricted file. A
  checkbox that cannot do what it says is worse than a missing one, so it is
  not offered — and because the flag is never emitted, extraction for
  accessibility is never denied at any strength.

  The three that ARE offered are disjoint and were each measured against a
  round-tripped file (P values at bits=256): --print=low is -2052 and
  --print=none is -2056; --modify walks -4 / -12 / -44 / -300 / -1324 as it
  tightens; --extract=n is -20.
*/

const PRINT_OPTIONS: readonly { value: QpdfPrintPermission; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "low", label: "Low-res" },
  { value: "none", label: "None" },
];

/**
 * `--modify` is a ladder, not a set: each rung denies everything the rung
 * above it denied plus one more. The labels name what the rung still ALLOWS,
 * which is the way a user thinks about it, and the hint below spells the rung
 * out in full so a three-word chip never has to carry the whole meaning.
 */
const MODIFY_OPTIONS: readonly { value: QpdfModifyPermission; label: string }[] = [
  { value: "all", label: "All" },
  { value: "annotate", label: "Annotate" },
  { value: "form", label: "Fill forms" },
  { value: "assembly", label: "Assemble" },
  { value: "none", label: "None" },
];

const MODIFY_HINT: Record<QpdfModifyPermission, string> = {
  all: "Any change is allowed — this is the same as setting no editing restriction at all.",
  annotate:
    "Commenting, filling in forms and rearranging pages stay allowed. Changing the page content itself does not.",
  form: "Filling in forms and rearranging pages stay allowed. Adding comments and changing content do not.",
  assembly:
    "Only rearranging pages — inserting, deleting, rotating — stays allowed. Nothing else does.",
  none: "No editing of any kind is allowed.",
};

const PRINT_HINT: Record<QpdfPrintPermission, string> = {
  full: "Printing is allowed at any quality.",
  low: "Printing is allowed, but not at high resolution — readers that honour this degrade the print rather than refusing it.",
  none: "Printing is not allowed.",
};

export interface PdfPermissionControlsProps {
  value: QpdfPermissions;
  onChange: (next: QpdfPermissions) => void;
  disabled?: boolean;
}

export function PdfPermissionControls({
  value,
  onChange,
  disabled,
}: PdfPermissionControlsProps) {
  return (
    <>
      <ToolControl label="PRINTING">
        <ToolChoice
          label="Printing"
          fill
          disabled={disabled}
          value={value.print}
          onChange={(print: QpdfPrintPermission) => onChange({ ...value, print })}
          options={PRINT_OPTIONS}
        />
        <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
          {PRINT_HINT[value.print]}
        </span>
      </ToolControl>

      <ToolControl label="EDITING">
        {/*
          Five chips, so `fill` is off: at flex-1 they share the rail's width
          evenly and "Fill forms" is clipped rather than wrapped. Hugging their
          text they wrap onto a second row instead, which is legible.
        */}
        <ToolChoice
          label="Editing"
          fill={false}
          disabled={disabled}
          value={value.modify}
          onChange={(modify: QpdfModifyPermission) => onChange({ ...value, modify })}
          options={MODIFY_OPTIONS}
        />
        <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
          {MODIFY_HINT[value.modify]}
        </span>
      </ToolControl>

      <ToolControl label="COPYING">
        <label
          className={cn(
            "flex items-center gap-2.5 font-body text-[12.5px] text-neutral-300",
            disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
          )}
        >
          <input
            type="checkbox"
            checked={value.extract}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, extract: e.target.checked })}
            className="size-4 rounded-sm border-border accent-accent"
          />
          Allow copying text and images
        </label>
        <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
          Off means readers that honour it refuse copy and paste out of the document. Extracting
          text for accessibility is a separate permission, and this tool never denies it.
        </span>
      </ToolControl>

      {/*
        The disclosure that makes the three controls above honest. A PDF
        permission is a number written into the encryption dictionary and a
        promise readers choose to keep — it is not enforced by the encryption
        itself. Said once, here, so both tools that show these controls say it.
      */}
      <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
        These are recorded in the file as requests. Readers that honour them enforce them; nothing
        else does, and a tool that can open the document can write it back out without them.
      </span>
    </>
  );
}
