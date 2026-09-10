"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
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
import { ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { parseIco, extractIcoEntry, type IcoEntry } from "@/lib/tools/ico-decode";
import { loadImage, canvasToBlob } from "@/lib/tools/canvas-utils";
import { triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";
import { CANVAS_COLUMN, SCROLL_CLASS, STAGE_GROW } from "@/components/workspace/shared";

/**
 * One directory entry, paired with the bytes a browser can actually open.
 *
 * `preview` is what the tile draws. For a PNG entry it IS the output — the
 * same byte slice — so the preview and the download can never disagree. For a
 * BMP entry it is the rebuilt one-entry .ico `extractIcoEntry` wraps around
 * the DIB, which the browser's own ICO decoder reads; the PNG for that entry
 * does not exist until the run, because making it costs a decode and a
 * re-encode.
 *
 * The entries `parseIco` dropped are counted in `IcoDirectory.unreadable` and
 * disclosed separately. The ones it kept are bounds-checked and their headers
 * agree with their payloads, but a decode still runs in the browser and a
 * browser is allowed to say no — so the run models a per-entry failure
 * (`IcoFailure`) rather than assuming one cannot happen.
 */
interface IcoImage {
  entry: IcoEntry;
  preview: Blob;
}

/**
 * One selected entry the run could not turn into a PNG, with the reason it
 * gave. Kept per entry, because the other entries in the same `.ico` are
 * untouched by it: a PNG entry is a byte slice that cannot fail at all, and
 * losing three finished icons because a fourth would not decode is the run
 * throwing away work it had already done.
 */
interface IcoFailure {
  entry: IcoEntry;
  reason: string;
}

/** One extracted PNG, with how it was made. */
interface IcoOutput {
  entry: IcoEntry;
  blob: Blob;
  fileName: string;
  /**
   * True only for entries that were already PNG inside the container and came
   * out as a byte slice. Read off the directory, never assumed: an .ico may
   * mix PNG and BMP entries in one file, and this repo's own png-to-ico
   * writes every entry as PNG while Windows tooling writes BMP.
   */
  lossless: boolean;
}

/** The sizes the user is looking at on screen, so the sentence names them. */
function describeSizes(failures: IcoFailure[]): string {
  return failures.map((f) => `${f.entry.width}×${f.entry.height}`).join(", ");
}

/**
 * The distinct reasons a run collected, deduplicated — four entries that all
 * failed the same way have one reason between them, not four copies of it.
 * These are the messages the failing call threw, never a message written here
 * over the top of one.
 */
function describeReasons(failures: IcoFailure[]): string {
  return [...new Set(failures.map((f) => f.reason))].join("; ");
}

interface IcoToPngUIProps {
  acceptFormats: string;
}

export function IcoToPngUI({ acceptFormats }: IcoToPngUIProps) {
  const [file, setFile] = useState<File | null>(null);
  // ICO and CUR share the container byte-for-byte, and a .cur really does
  // turn up named .ico. The parse says which, so the page can too.
  const [kind, setKind] = useState<"ico" | "cur">("ico");
  // Entries the directory declared and the file does not contain. Counted by
  // the parser, not by this component: it is the only place a partly-broken
  // file shows up, and staying silent about it would drop a size the user
  // came here for without a word.
  const [unreadable, setUnreadable] = useState(0);
  const [images, setImages] = useState<IcoImage[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [outputs, setOutputs] = useState<IcoOutput[]>([]);
  const [failures, setFailures] = useState<IcoFailure[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Outputs and failures are two halves of one run's result, so nothing is
  // allowed to clear one without the other.
  const clearRun = useCallback(() => {
    setOutputs([]);
    setFailures([]);
  }, []);

  /*
    One Object URL per tile, allocated inside the effect and revoked when the
    list changes or the component unmounts — the discipline `useObjectUrl`
    documents, spread over a list that hook cannot serve, exactly as
    ExtractPdfImagesUI does it. The revoke is deferred for that hook's reason:
    revoking synchronously aborts an <img> still LOADING the URL when the list
    swaps under it. Held in their own array rather than folded back into
    `images`, so the effect never writes the state it reads.
  */
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  useEffect(() => {
    const made = images.map((img) => URL.createObjectURL(img.preview));
    setPreviewUrls(made);
    return () => {
      setTimeout(() => {
        for (const url of made) URL.revokeObjectURL(url);
      }, 1000);
    };
  }, [images]);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    clearRun();
    setError(null);
    setImages([]);
    setSelected(new Set());
    setKind("ico");
    setUnreadable(0);

    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      /*
        `parseIco` throws with a sentence written for the screen — one per
        failure, the way `jfif-to-jpg.ts` does — so the catch below prints the
        message rather than inventing a generic one over it.
      */
      const directory = parseIco(bytes);
      const built: IcoImage[] = directory.entries.map((entry) => {
        const payload = extractIcoEntry(bytes, entry);
        // `payload.mime` labels what the bytes ARE, not what the entry will
        // become: image/png for a stored PNG, image/x-icon for the one-entry
        // .ico wrapped around a DIB.
        return {
          entry,
          preview: new Blob([payload.bytes as BlobPart], { type: payload.mime }),
        };
      });

      setKind(directory.kind);
      setUnreadable(directory.unreadable);
      setImages(built);
      // Everything in the file, pre-selected: a favicon.ico with three sizes
      // in it is three things the user came for, not one.
      setSelected(new Set(built.map((img) => img.entry.index)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "This file's icon directory could not be read.",
      );
    }
  }, [clearRun]);

  const toggle = useCallback(
    (index: number) => {
      clearRun();
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    },
    [clearRun],
  );

  const selectAll = useCallback(() => {
    clearRun();
    setSelected(new Set(images.map((img) => img.entry.index)));
  }, [clearRun, images]);

  const selectNone = useCallback(() => {
    clearRun();
    setSelected(new Set());
  }, [clearRun]);

  const handleExtract = useCallback(async () => {
    if (!file || selected.size === 0) return;
    setIsProcessing(true);
    setError(null);
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const made: IcoOutput[] = [];
    const failed: IcoFailure[] = [];

    /*
      Size alone does not name an entry uniquely. A real favicon.ico routinely
      carries the SAME pixel size twice at different colour depths — a 32x32
      4-bit entry beside a 32x32 32-bit one is the classic Windows shape — and
      naming both `icon-32x32.png` hands the user two download buttons with
      identical labels, the second of which overwrites the first on disk.
      Silent data loss, in a tool whose whole selling point is that it gives
      you EVERY image in the container.

      So the depth is added only where it is needed to tell two outputs apart.
      A .ico with one entry per size — which is most of them — keeps the plain
      `icon-32x32.png` name it had.
    */
    const chosen = images.filter((image) => selected.has(image.entry.index));
    const sizeCounts = new Map<string, number>();
    for (const { entry } of chosen) {
      const key = `${entry.width}x${entry.height}`;
      sizeCounts.set(key, (sizeCounts.get(key) ?? 0) + 1);
    }

    /*
      One try per ENTRY, not one around the loop.

      An .ico is a bag of independent images and they are extracted by two
      different routes: a PNG entry is a byte slice that cannot fail, a BMP
      entry is a browser decode that can. Wrapping the loop would let one bad
      DIB throw away every icon already finished — three real PNGs replaced by
      an empty list and one opaque sentence — so a failure is recorded against
      the entry that caused it and the run carries on.
    */
    for (const image of chosen) {
      const { entry, preview } = image;
      const size = `${entry.width}x${entry.height}`;
      const fileName =
        (sizeCounts.get(size) ?? 0) > 1
          ? `${baseName}-${size}-${entry.bitsPerPixel}bit.png`
          : `${baseName}-${size}.png`;

      try {
        /*
          `entry.lossless` is the parser's own word for "extractIcoEntry
          returned the stored bytes unchanged", and it is the ONLY thing this
          arm is allowed to key on. Guessing from the file's name, or from the
          entry's size, or from the fact that this site's own png-to-ico
          writes PNG entries, would all be inference — and one .ico can carry
          PNG and BMP entries side by side.
        */
        if (entry.lossless) {
          // No decode, no canvas, no re-encode: the PNG that was already
          // inside the container, byte for byte.
          made.push({ entry, blob: preview, fileName, lossless: true });
          continue;
        }

        /*
          A BMP entry is a headerless DIB, and it is the browser's own ICO
          decoder that reads it — the entry was rebuilt as a one-entry .ico
          for exactly this. That decode plus the canvas re-encode is why this
          arm cannot claim what the PNG arm can: the pixels are re-written,
          even though a BMP entry is uncompressed and nothing is quantised.
        */
        const img = await loadImage(preview);
        const canvas = document.createElement("canvas");
        canvas.width = entry.width;
        canvas.height = entry.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context not available");
        ctx.drawImage(img, 0, 0, entry.width, entry.height);
        made.push({
          entry,
          blob: await canvasToBlob(canvas, "image/png"),
          fileName,
          lossless: false,
        });
      } catch (err) {
        failed.push({
          entry,
          reason: err instanceof Error ? err.message : "the browser would not decode it",
        });
      }
    }

    setOutputs(made);
    setFailures(failed);
    // A failure is only fatal when it took the whole run with it. Otherwise it
    // is a warning beside the icons that did come out — which are downloadable
    // and are not made less true by the entry beside them.
    if (made.length === 0 && failed.length > 0) {
      setError(
        `None of the ${failed.length} selected ${failed.length === 1 ? "icon" : "icons"} could be extracted: ${describeReasons(failed)}.`,
      );
    }
    setIsProcessing(false);
  }, [file, images, selected]);

  const handleReset = useCallback(() => {
    setFile(null);
    setImages([]);
    setSelected(new Set());
    clearRun();
    setUnreadable(0);
    setError(null);
  }, [clearRun]);

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        onFiles={(files) => void handleFiles(files)}
        label="Upload an .ico to unpack"
      />
    );
  }

  const selectedImages = images.filter((img) => selected.has(img.entry.index));
  const pngEntries = images.filter((img) => img.entry.encoding === "png").length;
  const bmpEntries = images.filter((img) => img.entry.encoding === "bmp").length;
  // Counted off the OUTPUTS, so it describes what was written rather than
  // what was asked for.
  const losslessOut = outputs.filter((o) => o.lossless).length;
  const outputBytes = outputs.reduce((sum, o) => sum + o.blob.size, 0);
  // Every row the ICONDIR declared: the parser walks exactly `count` of them
  // and every one lands in `entries` or in `unreadable`, so the sum is the
  // number the file's own header states.
  const declaredEntries = images.length + unreadable;
  const largestEdge = images.reduce(
    (max, img) => Math.max(max, img.entry.width, img.entry.height),
    0,
  );

  return (
    <>
      {/* ── Canvas: every image the container holds, at its own size ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${images.length} ${images.length === 1 ? "IMAGE" : "IMAGES"} · ${formatFileSize(file.size)}`}
          trailing={outputs.length > 0 ? `${outputs.length} PNG` : `${selected.size} SELECTED`}
        />

        {/*
          Not `PageDeck`/`PageTile`: those are 3:4 portrait page thumbnails and
          an icon is square. Not `IconSizes` either — it paints ONE preview URL
          into every box, and the whole point here is that each entry in an
          .ico is a DIFFERENT image, drawn at a different size, sometimes in a
          different encoding.
        */}
        <CanvasStage className={cn(STAGE_GROW, "flex flex-col bg-[#0c0e17] p-4")}>
          <div className={cn("min-h-0 flex-1 overflow-y-auto", SCROLL_CLASS)}>
            <div className="flex flex-wrap items-start gap-4">
              {images.map((img, i) => {
                const { entry } = img;
                const previewUrl = previewUrls[i];
                const isSelected = selected.has(entry.index);
                /*
                  The badge is the parser's word, not a guess: `lossless` is
                  true only where `extractIcoEntry` returns the stored bytes
                  unchanged. Guessing from the extension, from the entry size,
                  or from the fact that this site's own png-to-ico writes PNG
                  entries would all be inference — one .ico can carry both.
                */
                const badge = entry.lossless ? "PNG · BYTE SLICE" : "BMP · RE-ENCODED";
                // Bigger entries get a bigger plate, capped so a 256×256 does
                // not push the 16×16 off the row.
                const box = Math.min(96, Math.max(34, entry.width));
                return (
                  <button
                    key={entry.index}
                    type="button"
                    onClick={() => toggle(entry.index)}
                    aria-pressed={isSelected}
                    aria-label={`${entry.width} × ${entry.height}, ${entry.bitsPerPixel}-bit, ${badge}`}
                    className="flex cursor-pointer flex-col items-center gap-[9px]"
                  >
                    <span
                      className={cn(
                        "flex items-center justify-center overflow-hidden rounded-[5px] border-2 transition-all duration-200",
                        "bg-[#e4e7f5] bg-[repeating-conic-gradient(#161826_0%_25%,#e4e7f5_0%_50%)] bg-[length:12px_12px]",
                        isSelected
                          ? "border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]"
                          : "border-transparent opacity-55 hover:opacity-80",
                      )}
                      style={{ width: box, height: box }}
                    >
                      {previewUrl && (
                        /* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */
                        <img src={previewUrl} alt="" className="size-full object-contain" />
                      )}
                    </span>
                    <span className="font-mono text-[10.5px] leading-none font-medium text-neutral-300">
                      {entry.width}×{entry.height}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[9.5px] leading-none",
                        entry.lossless ? "text-accent-300" : "text-text-muted",
                      )}
                    >
                      {badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "IN THE FILE", value: String(images.length), tone: "neutral" },
            { label: "SELECTED", value: String(selected.size) },
            { label: "EXTRACTED", value: outputs.length > 0 ? String(outputs.length) : "—" },
            {
              label: "OUT",
              value: outputs.length > 0 ? formatFileSize(outputBytes) : "—",
              tone: "neutral",
            },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/* The container is byte-identical for cursors, so the parse is what
            says which one this is — not the extension it arrived under. */}
        {kind === "cur" && (
          <WarningMessage message="This file is a cursor (.cur), not an icon. The container is the same and every image in it comes out the same way; the hotspot coordinates a cursor carries are not part of a PNG and are dropped." />
        )}

        {unreadable > 0 && (
          <WarningMessage
            message={`${unreadable} of the ${declaredEntries} images this file's directory declares cannot be unpacked — the payload runs past the end of the file, is in neither of the two encodings an .ico may use, or its bitmap header describes a picture the payload does not hold. ${unreadable === 1 ? "That entry is" : "Those entries are"} not shown above, because there is nothing in ${unreadable === 1 ? "it" : "them"} a decoder would read.`}
          />
        )}

        {/*
          A run that lost an entry and kept the rest. Named by size, because
          that is what the tiles above are labelled with, and carrying the
          reason the failing call actually gave rather than a sentence written
          over the top of it.
        */}
        {outputs.length > 0 && failures.length > 0 && (
          <WarningMessage
            message={`${outputs.length} of ${outputs.length + failures.length} selected icons came out. The ${describeSizes(failures)} ${failures.length === 1 ? "entry" : "entries"} could not be extracted — ${describeReasons(failures)} — so ${failures.length === 1 ? "it is" : "they are"} not in the downloads below. The rest are untouched by it.`}
          />
        )}

        {/*
          Said only when it is true of THIS run, and counted off the outputs.
          A file whose entries are all BMP must never see the byte-slice
          sentence, and a mixed file must see both halves.
        */}
        {outputs.length > 0 && losslessOut < outputs.length && (
          <WarningMessage
            message={`${outputs.length - losslessOut} of ${outputs.length} icons were stored as bitmaps, not as PNGs, so they were decoded and written out again. Nothing is quantised and no quality setting applies — a bitmap in an .ico is uncompressed — but those files are a re-encoding rather than the original bytes.`}
          />
        )}

        <CanvasFootnote>
          {/* "EVERY ICON" has to mean every icon, so a run that dropped one
              does not get to say it. */}
          {outputs.length > 0 && failures.length === 0 && losslessOut === outputs.length
            ? "EVERY ICON CAME OUT AS THE PNG ALREADY INSIDE THE FILE — NO DECODE, NO RE-ENCODE"
            : "CLICK AN ICON TO INCLUDE OR EXCLUDE IT"}
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The PNG entries are a byte slice and the BMP ones are a canvas
                decode of a ≤256px image, so nothing here reports progress —
                an indeterminate bar is the whole truth. */}
            {isProcessing && (
              <ToolProgress phase="EXTRACTING" percent={null} label="Extracting icons" />
            )}
            {/*
              Three branches, and the middle one is deliberately empty. With
              several icons extracted there is no single file to put behind a
              primary, and routing them through `downloadFilesAsZip` would put
              a ZIP between the user and a 32×32 they are already looking at —
              so each one is its own button in the rail's DOWNLOADS list.
            */}
            {outputs.length === 1 ? (
              <DownloadButton
                blob={outputs[0].blob}
                fileName={outputs[0].fileName}
                className="w-full justify-center"
              />
            ) : outputs.length > 1 ? null : (
              <ToolActions
                primaryLabel={
                  isProcessing
                    ? "Extracting…"
                    : `Extract ${selected.size} PNG${selected.size === 1 ? "" : "s"}`
                }
                onPrimary={handleExtract}
                primaryDisabled={isProcessing || selected.size === 0}
              />
            )}
            {outputs.length > 0 && !isProcessing && (
              <ToolResetLink onClick={handleExtract} label="EXTRACT AGAIN" />
            )}
            <ToolResetLink onClick={handleReset} label={outputs.length > 0 ? "OPEN ANOTHER" : "CLEAR"} />
          </>
        }
      >
        <ToolAsideSection label="SIZES">
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              disabled={images.length === 0}
              className="cursor-pointer text-xs text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:text-text-muted"
            >
              Select all
            </button>
            <button
              onClick={selectNone}
              disabled={images.length === 0}
              className="cursor-pointer text-xs text-text-muted transition-colors hover:text-text-secondary disabled:cursor-not-allowed"
            >
              Deselect all
            </button>
          </div>
          <p className="m-0 font-body text-[11px] leading-[1.4] text-text-muted">
            An .ico is a container, not one picture. Every size in it is listed above; pick the
            ones you want and each comes out as its own PNG.
          </p>
          <ToolOutput
            rows={[
              ["Selected", `${selected.size} of ${images.length}`],
              [
                "Largest",
                selectedImages.length > 0
                  ? `${Math.max(...selectedImages.map((i) => i.entry.width))} px`
                  : "—",
              ],
              ["Written", outputs.length > 0 ? `${outputs.length} PNG` : "—"],
              ["Out", outputs.length > 0 ? formatFileSize(outputBytes) : "—"],
            ]}
          />
        </ToolAsideSection>

        {/*
          Every output is its own file and its own click. There is no ZIP on
          purpose: an .ico holds a handful of icons, and a ZIP would put a
          second unpacking step between the user and a 32×32 they can already
          see on screen.
        */}
        {outputs.length > 1 && (
          <ToolAsideSection label="DOWNLOADS">
            {outputs.map((out) => (
              <button
                key={out.entry.index}
                type="button"
                onClick={() => triggerDownload(out.blob, out.fileName)}
                aria-label={`Download ${out.fileName}`}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors duration-200 hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span className="font-mono text-[11px] text-neutral-300">
                  {out.entry.width}×{out.entry.height}
                </span>
                <span className="font-body text-[10.5px] text-text-muted">
                  {formatFileSize(out.blob.size)} · {out.lossless ? "byte slice" : "re-encoded"}
                </span>
              </button>
            ))}
          </ToolAsideSection>
        )}

        {/*
          Engine facts, counted off the directory this file actually has —
          which is `entries + unreadable` rows of 16 bytes after the 6-byte
          ICONDIR, not just the rows that survived the parse. Sizing it off the
          survivors made this row contradict the warning above it, which says
          in the same view that the directory declares MORE than the file
          holds.
        */}
        <ToolAdvanced
          rows={[
            ["Container", kind === "cur" ? "CUR" : "ICO"],
            [
              "Directory",
              unreadable > 0
                ? `${declaredEntries} ENTRIES (${images.length} READABLE), ${6 + 16 * declaredEntries} BYTES`
                : `${declaredEntries} ENTRIES, ${6 + 16 * declaredEntries} BYTES`,
            ],
            ["Stored as PNG", `${pngEntries} OF ${images.length}`],
            ["Stored as BMP", `${bmpEntries} OF ${images.length}`],
            ["Largest", largestEdge > 0 ? `${largestEdge} PX` : "—"],
          ]}
        />

        <ToolAsideSection label="WHAT COMES OUT">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            An icon stored as a PNG is copied straight out of the container — no decode, no
            canvas, no re-encode, so the file you get is byte for byte the one that was inside.
            An icon stored as a bitmap cannot be, because a bitmap is not a PNG; it is decoded
            and written out again. The badge under each icon says which one you are looking at,
            and it is read out of the icon directory rather than inferred.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Your browser, left to itself, would decode an .ico to exactly one image and never
            say which — decoders generally prefer the largest, then the deepest colour. Reading
            the directory is what lets every size be offered.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Going the other way?{" "}
            <Link href="/png-to-ico" className="text-accent underline hover:text-accent-hover">
              PNG to ICO
            </Link>{" "}
            builds a multi-size .ico, and every entry it writes is a PNG — so a file made there
            comes back through here as a byte slice.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
