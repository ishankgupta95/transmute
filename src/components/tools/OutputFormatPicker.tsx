"use client";

import { ToolChoice, ToolSlider } from "@/components/tools/ToolAside";
import { ToolControl } from "@/components/tools/ToolControls";
import type { EditOutputFormat } from "@/lib/workers/image-protocol";

/*
  The one output-format toggle the image edit verbs share.

  It is a CONTROL, not a layout: it returns the same loose `ToolControl`s a
  tool would otherwise write by hand, so the caller drops it inside its own
  `ToolControlGroup` and keeps the doc's single bordered block. It renders no
  `ToolActions` (⌘↵ is bound globally and unarbitrated — `ToolAside.tsx:289`)
  and no wrapper element, because `TOOL_SURFACE` is a grid whose children must
  be the canvas column and the aside (`workspace/shared.ts:53-74`).

  Before this existed, `crop-image` shipped PNG-only and said so; the edit
  verbs that landed with it would each have grown their own copy of the toggle,
  the quality slider and the flatten warning.
*/

/**
 * Chip labels. "JPG" rather than "JPEG" — `PdfToJpgUI.tsx:53-57` already
 * spells the toggle that way and every JPEG this site writes lands as `.jpg`.
 */
const FORMAT_LABELS: Record<EditOutputFormat, string> = {
  png: "PNG",
  jpeg: "JPG",
  webp: "WEBP",
};

const DEFAULT_FORMATS: readonly EditOutputFormat[] = ["png", "jpeg", "webp"];

/** "PNG and WEBP", "PNG, WEBP and JPG" — never a bare comma list. */
function joinLabels(labels: readonly string[]): string {
  if (labels.length < 2) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/*
  The two questions every caller of this picker has to answer before it can
  render, kept here rather than in each verb.

  They landed as verbatim six-line copies in `RotateImageUI`, `FlipImageUI` and
  `AddBorderUI` — three UIs, one behaviour, and three places for the list of
  alpha-capable extensions to drift apart. This module is already the shared
  home for "what output format is this tool writing", so it is the one that
  owns them.
*/

/** Lower-cased final extension, or "" for a name that carries none. */
function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * The format a freshly dropped file starts on.
 *
 * Matching the source is the only default that does not ambush someone: a 4 MB
 * JPEG edited and written as PNG comes back several times larger, and a PNG
 * logo written as JPEG loses its transparency. Anything the picker cannot
 * write (BMP, GIF, AVIF) falls to PNG, which holds whatever was decoded.
 */
export function defaultFormatFor(file: File): EditOutputFormat {
  const ext = extensionOf(file);
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  if (ext === "webp") return "webp";
  return "png";
}

/**
 * Whether the SOURCE FORMAT can carry transparency at all — the caller's half
 * of `alphaWarning`.
 *
 * Deliberately not "does this file have transparent pixels": answering that
 * needs a decode plus a `getImageData` probe (`canvas-utils.ts` /
 * `imageHasTransparency`), and the decode happens in the worker, not here. The
 * extension answers the half that can be answered for free, which is why the
 * warning it drives is about what JPEG cannot hold, not about what this
 * particular picture contains.
 */
export function sourceCanCarryAlpha(file: File): boolean {
  return ["png", "webp", "gif", "avif", "svg", "ico"].includes(extensionOf(file));
}

export interface OutputFormatPickerProps {
  value: EditOutputFormat;
  onChange: (v: EditOutputFormat) => void;
  /** Formats to offer, in order. Omit "jpeg" where alpha must survive. */
  formats?: readonly EditOutputFormat[];
  quality: number;
  onQualityChange: (q: number) => void;
  disabled?: boolean;
  /** Rendered when the chosen format cannot carry alpha and the source has it. */
  alphaWarning?: boolean;
}

export function OutputFormatPicker({
  value,
  onChange,
  formats = DEFAULT_FORMATS,
  quality,
  onQualityChange,
  disabled,
  alphaWarning,
}: OutputFormatPickerProps) {
  /*
    Read out of `formats`, never hardcoded to "PNG and WEBP". A verb that drops
    JPG entirely (crop-circle) never reaches this sentence, and a verb that one
    day offers JPG alone must not be made to promise an escape hatch it is not
    rendering a chip for.
  */
  const alphaSafe = formats.filter((f) => f !== "jpeg").map((f) => FORMAT_LABELS[f]);
  const alphaEscape =
    alphaSafe.length > 0
      ? `${joinLabels(alphaSafe)} ${alphaSafe.length === 1 ? "keeps" : "keep"} the transparency.`
      : null;

  return (
    <>
      <ToolControl label="FORMAT">
        <ToolChoice
          label="Output format"
          fill
          disabled={disabled}
          value={value}
          onChange={onChange}
          options={formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] }))}
        />

        {/*
          JPG only. WebP carries an alpha channel — `mimeSupportsAlpha`
          (`canvas-utils.ts:33-35`) lists exactly PNG and WebP — so warning
          about it would be false. Whether the SOURCE actually has
          transparency is the caller's fact to establish; this component is
          told, it does not guess.

          "White" is not a figure of speech: `fillBackground`
          (`canvas-utils.ts:43-52`) paints `#ffffff` before the draw, and
          without it a JPEG flattens transparent pixels to black.
        */}
        {alphaWarning && value === "jpeg" && (
          <span
            role="status"
            className="font-body text-[10.5px] leading-[1.5] text-warning"
          >
            JPG has no alpha channel, so every transparent pixel is filled with
            white before this image is encoded.
            {/* The space before a rendered expression has to be explicit: this
                repo shipped `at most 300frames` from exactly this shape
                (`VideoToImagesUI.tsx:496-515`). */}
            {alphaEscape && <>{" "}{alphaEscape}</>}
          </span>
        )}
      </ToolControl>

      {/*
        Hidden, not disabled. PNG's encoder ignores the quality argument
        outright — `canvas.toBlob`/`convertToBlob` take it only for lossy
        codecs, and the worker protocol says so in as many words
        (`ImageEditJobOptions.quality`: "0-1. Ignored for png."). A greyed-out
        slider still asserts that the number under it means something here.
        `ImageResizerUI.tsx:383` and `PdfToJpgUI.tsx` both hide it for the same
        reason.
      */}
      {value !== "png" && (
        <ToolControl>
          <ToolSlider
            label="Quality"
            display={`${Math.round(quality * 100)}%`}
            hint="Lower quality means a smaller file."
            min={0.1}
            max={1}
            step={0.05}
            value={quality}
            onChange={onQualityChange}
            disabled={disabled}
          />
        </ToolControl>
      )}
    </>
  );
}
