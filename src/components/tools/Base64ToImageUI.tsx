"use client";

import { useCallback, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import {
  CanvasHeader,
  CanvasStage,
  lineCount,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN, STAGE_MEDIA } from "@/components/workspace/shared";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { decodeBase64Image } from "@/lib/tools/base64-image";
import type {
  Base64ImageFailure,
  DecodedBase64Image,
} from "@/lib/tools/base64-image";
import { formatFileSize } from "@/lib/utils/file-helpers";

/*
  The exact inverse of `image-to-base64`, and the only image tool on this site
  whose input is a string rather than a file. It mounts NO file picker at all:
  the registry entry carries `takesNoFile: true`, and
  `file-input-claims.test.ts` reads THIS file to check that claim, so a drop
  zone must never appear here.

  Everything the page reports is read back off the decode rather than assumed:

  - the format comes from the decoded magic bytes, never from the `data:`
    mediatype in front of them. That is the house rule from
    `image-frames.ts:24-26` — a caller's MIME can lie — and
    `data:image/png;base64,` in front of JPEG bytes is one of the commonest
    pastes there is, which is why the disagreement gets said out loud;
  - the "URL-safe" and "padding added" readouts are set only when the decoder
    actually had to do those things;
  - "not an image" and "the browser could not draw it" are two DIFFERENT
    failures with two different messages, because they have two different
    causes. See PREVIEW_FAILED_COPY.
*/

/** How each sniffed byte format is spelled in the readouts. */
const FORMAT_LABELS: Record<DecodedBase64Image["format"], string> = {
  png: "PNG",
  jpeg: "JPEG",
  gif: "GIF",
  webp: "WEBP",
  bmp: "BMP",
  avif: "AVIF",
  ico: "ICO",
  svg: "SVG",
};

/*
  The mediatypes people type that mean the same thing as a sniffed one. Without
  this, `data:image/jpg;base64,` in front of genuine JPEG bytes would raise a
  "the bytes disagree" warning about a file that is exactly what it says it is.
*/
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
  "image/x-ms-bmp": "image/bmp",
  "image/x-icon": "image/vnd.microsoft.icon",
  "image/x-ico": "image/vnd.microsoft.icon",
};

/** Mediatype → comparable form: no parameters, lower case, aliases collapsed. */
function normalizeMime(raw: string): string {
  const base = raw.split(";")[0].trim().toLowerCase();
  return MIME_ALIASES[base] ?? base;
}

/*
  One message per refusal. `atob` throws the identical `InvalidCharacterError`
  for every one of them (measured — scout-07 §6.1), which is why the decoder
  classifies the paste itself and hands back a reason: someone who pasted a
  percent-encoded data URI and someone whose clipboard truncated need opposite
  advice, and "Invalid Base64 string" gives neither of them any.
*/
const FAILURE_COPY: Record<Base64ImageFailure, string> = {
  empty: "There is nothing to decode yet — paste a Base64 string into the pane.",
  "percent-encoded":
    "That data: URI is percent-encoded, not Base64 — there is no ;base64 marker in front of the payload, so its characters are literal text rather than encoded bytes. Paste the Base64 form instead.",
  "not-base64":
    "This is not Base64. The URL-safe alphabet (- and _) is translated for you, line wraps are stripped and missing padding is added back, so a character outside A-Z a-z 0-9 + / = got through all three repairs.",
  truncated:
    "This paste is one character longer than a whole number of four-character Base64 groups, and no complete Base64 string ever has that length — the copy was cut short. Paste the whole string.",
  // Rebuilt with the real byte count in `failureCopy` below: the number is the
  // thing that tells the user their paste decoded and their BYTES are wrong.
  "not-an-image": "",
};

/**
 * The other failure, and the one worth keeping separate: the bytes carry a
 * real image signature, so the decoder accepted them, and the browser then
 * refused to draw them. A truncated paste does exactly this — the signature
 * lives in the first few characters and survives any cut, the pixels do not.
 */
const PREVIEW_FAILED_COPY =
  "These bytes start with a valid image signature, but this browser could not draw them. A paste that was cut short does exactly that: the signature is in the first few characters and survives the cut, the pixel data does not. The file is still yours to download if you want to try it elsewhere.";

interface Decoded {
  image: DecodedBase64Image;
  blob: Blob;
}

export function Base64ToImageUI() {
  const [input, setInput] = useState("");
  const [stem, setStem] = useState("image");
  const [output, setOutput] = useState<Decoded | null>(null);
  const [failure, setFailure] = useState<{
    reason: Base64ImageFailure;
    byteLength?: number;
  } | null>(null);
  /** Set from the preview img's own onError — an actual decode attempt. */
  const [previewFailed, setPreviewFailed] = useState(false);

  const previewUrl = useObjectUrl(output?.blob ?? null);
  const pixels = useImageDimensions(output?.blob ?? null);

  const handleDecode = useCallback(() => {
    setOutput(null);
    setFailure(null);
    setPreviewFailed(false);

    const decoded = decodeBase64Image(input);
    if (!decoded.ok) {
      setFailure({ reason: decoded.reason, byteLength: decoded.byteLength });
      return;
    }
    const { image } = decoded;
    setOutput({
      image,
      blob: new Blob([image.bytes as BlobPart], { type: image.mime }),
    });
  }, [input]);

  const handleInput = useCallback((text: string) => {
    setInput(text);
    // Every readout below describes the PREVIOUS paste. Leaving them up under
    // an edited textarea — with a Download that saves the old file — is the
    // shape of lie QrCodeGeneratorUI:98-100 records having shipped once.
    setOutput(null);
    setFailure(null);
    setPreviewFailed(false);
  }, []);

  const handleClear = useCallback(() => {
    setInput("");
    setOutput(null);
    setFailure(null);
    setPreviewFailed(false);
  }, []);

  const image = output?.image ?? null;
  const fileName = `${stem.trim() || "image"}.${image?.ext ?? "png"}`;
  const format = image ? FORMAT_LABELS[image.format] : null;

  const failureCopy =
    failure === null
      ? null
      : failure.reason === "not-an-image"
        ? `That decoded cleanly into ${formatFileSize(failure.byteLength ?? 0)} of data, but the first bytes match no image format this tool can name — PNG, JPEG, GIF, WebP, BMP, AVIF, ICO and SVG are the ones it looks for.`
        : FAILURE_COPY[failure.reason];

  /*
    The mediatype in a data URI is a label somebody typed; the format is what
    the bytes are. When they disagree the bytes win and the download is named
    from them — so the disagreement has to be stated, because silently renaming
    someone's "PNG" to .jpg is the surprise.
  */
  const mismatch =
    image &&
    image.declaredMime &&
    normalizeMime(image.declaredMime) !== normalizeMime(image.mime)
      ? `The data: URI says ${image.declaredMime}, but the bytes are ${format}. The download is named from the bytes.`
      : null;

  return (
    <>
      {/* ── Canvas: the paste, then whatever came out of it ────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file="Pasted Base64"
          meta={`${input.length} chars`}
          trailing={format ?? "PASTE TO DECODE"}
          trailingTone={format ? "accent" : "muted"}
        />

        <TextPanes columns={1}>
          <TextPane label="Base64" lines={lineCount(input)} size={`${input.length} CHARS`}>
            <textarea
              value={input}
              onChange={(e) => handleInput(e.target.value)}
              placeholder="iVBORw0KGgoAAAANSUhEUg… or data:image/png;base64,iVBORw0KGgo…"
              aria-label="Base64"
              className={TEXT_PANE_BODY}
            />
          </TextPane>
        </TextPanes>

        {output && (
          <CanvasStage className="flex min-h-[220px] items-center justify-center">
            {previewUrl && !previewFailed ? (
              // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
              <img
                src={previewUrl}
                alt=""
                onError={() => setPreviewFailed(true)}
                className={STAGE_MEDIA}
              />
            ) : (
              <span className="px-6 text-center font-mono text-[10.5px] leading-[1.6] text-text-muted">
                {previewFailed ? "NOTHING TO PREVIEW" : "DECODING…"}
              </span>
            )}
          </CanvasStage>
        )}

        <StatStrip
          stats={[
            { label: "PASTED", value: `${input.length} chars`, tone: "neutral" },
            { label: "DECODED", value: output ? formatFileSize(output.blob.size) : "—" },
            { label: "FORMAT", value: format ?? "—" },
            {
              label: "PIXELS",
              value: pixels ? `${pixels.w}×${pixels.h}` : "—",
              tone: "neutral",
            },
          ]}
        />

        <ErrorMessage message={failureCopy} />
        {previewFailed && <ErrorMessage message={PREVIEW_FAILED_COPY} />}
        <WarningMessage message={mismatch} />
      </div>

      {/* ── Controls: the name to save under, and the readout ──── */}
      <ToolAside
        footer={
          <>
            <ToolActions
              primaryLabel="Decode to image"
              onPrimary={handleDecode}
              primaryDisabled={!input.trim()}
            />
            {output && (
              <DownloadButton
                blob={output.blob}
                fileName={fileName}
                className="w-full justify-center"
              />
            )}
            {input && <ToolResetLink onClick={handleClear} label="CLEAR" />}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="FILE NAME">
            <div className="flex items-center gap-2">
              <input
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                aria-label="File name"
                className="min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span className="flex-none font-mono text-xs leading-none text-text-muted">
                .{image?.ext ?? "…"}
              </span>
            </div>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              The extension is not yours to pick — it comes from the decoded
              bytes, so a payload labelled one format and encoded as another
              still saves as the format it really is.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", `${input.length} chars`],
              ["Out", output ? formatFileSize(output.blob.size) : "—"],
              ["Saves as", output ? fileName : "—"],
              [
                "Alphabet",
                image ? (image.urlSafe ? "URL-safe → standard" : "Standard") : "—",
              ],
              [
                "Padding",
                image
                  ? image.paddingAdded > 0
                    ? `${image.paddingAdded} added`
                    : "Complete"
                  : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        {/* Reference, not settings — so it sits behind the disclosure rather
            than in the surface height every visitor pays for on load. */}
        <ToolAdvanced
          rows={[
            ["URL-safe - and _", "TRANSLATED"],
            ["Line wraps and missing padding", "REPAIRED"],
            ["A whole data: URI", "SPLIT AT THE FIRST COMMA"],
            ["A pasted img tag", "SRC EXTRACTED"],
            ["Percent-encoded data URI", "REFUSED"],
            ["Format", "READ FROM THE BYTES"],
            ["SVG payload", "DRAWN IN AN img, NEVER INLINED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
