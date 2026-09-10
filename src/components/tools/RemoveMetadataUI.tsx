"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, CanvasHeader, StatStrip, TagGrid } from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { triggerDownload } from "@/lib/utils/download";
import type { ExifEntry } from "@/lib/tools/exif-viewer";

/*
  ONE PAGE, TWO ENGINES, AND ONE ACTION.

  A PDF's identifying metadata and a photograph's are the same problem to the
  person holding the file and nothing alike underneath, so this page carries
  both paths and says which one it is running.

    • PDF  — `readPdfMetadata` lists the /Info dictionary and counts the XMP
      packets; `removePdfMetadata` deletes both. Nothing about the pages
      changes: the engine touches the /Info keys and the /Metadata streams and
      nothing else (pdf-engine-core.ts:2592-2617).
    • IMAGE — `readExifData` lists what ExifReader can find; `stripExifData`
      decodes the picture and encodes it again through a canvas, which is what
      leaves the tags behind (exif-viewer.ts:75-118). That is a NEW PICTURE,
      not the original bytes with the tags cut out, and everything the
      re-encode costs is stated on this page rather than left for the user to
      discover in the file.

  THE TWO-CLICK GRIPE THIS PAGE EXISTS TO FIX. /exif-viewer's primary produces
  a cleaned copy and then swaps itself for a Download button, so the file the
  user came for is two clicks away. Here the primary runs the clean and hands
  the file to the browser in the same gesture (`triggerDownload`, the call the
  Download button itself makes). The Download button still appears afterwards —
  it is the "save it again" affordance, and the fallback if the browser held
  the automatic save back — but nobody has to press it to get their file.

  WHY THE RESULT IS RE-READ. Every claim on this page about the DOWNLOAD is a
  measurement of the download, not a restatement of intent: after the run the
  produced bytes are parsed again by the same reader that listed the source,
  and the count that comes back is printed. A clean that quietly left something
  behind would say so here.
*/

/** Mirrors the registry's `acceptFormats`; the prop supplies it in the app. */
const DEFAULT_ACCEPT = ".jpg,.jpeg,.png,.webp,.tiff,.tif,.heic,.heif,.pdf";

type Status = "idle" | "reading" | "processing" | "done" | "error";

/** What the source turned out to be carrying, per path. */
type Found =
  | { kind: "pdf"; info: Record<string, string>; xmpStreams: number }
  | { kind: "image"; entries: ExifEntry[] };

/** The same reader, run over the file that was just handed to the user. */
type Verified =
  | { kind: "pdf"; infoFields: number; xmpStreams: number }
  | { kind: "image"; tags: number; groups: string[] }
  | { kind: "unavailable" };

/*
  THE RUN'S FACTS RIDE ON THE RESULT OBJECT — the house cure written out at
  ChangeImageDpiUI.tsx:141-166. The elapsed time, the produced blob and the
  re-read of that blob are one object set in one commit, so no render reads a
  ref and a superseded run's numbers can never be printed beside this run's
  file. (`react-hooks/refs` rejects reading a ref during render, and it is an
  error in this repo, not a warning.)
*/
interface Run {
  blob: Blob;
  fileName: string;
  /** Already formatted, e.g. "1.4 s" — the clean only, not the re-read. */
  elapsed: string;
  verified: Verified;
}

function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
}

/**
 * What the image path will write, mirroring `stripExifData`'s own branch
 * (exif-viewer.ts:91-97): PNG stays PNG, WebP stays WebP, and everything else
 * — JPEG, HEIC, HEIF, TIFF — is encoded as JPEG, because no browser canvas can
 * write those containers.
 *
 * A PREDICTION, and labelled as one wherever it is shown. What the encoder
 * actually produced is read back off the result blob's own type after the run.
 */
function plannedOutput(name: string): { mime: string; label: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return { mime: "image/png", label: "PNG" };
  if (ext === "webp") return { mime: "image/webp", label: "WEBP" };
  return { mime: "image/jpeg", label: "JPEG" };
}

/** `image/jpeg` → `JPEG`, for stating what the encoder said it wrote. */
function containerLabel(mime: string): string | null {
  if (!mime.startsWith("image/")) return null;
  const label = mime.slice("image/".length).toUpperCase();
  return label === "JPG" ? "JPEG" : label;
}

/**
 * The container the user DROPPED, for the header line beside the file name.
 *
 * Deliberately not `plannedOutput().label`: that is what will be written, and
 * printing it next to the source's size would tell a `.heic` file it is a
 * JPEG. `.jpg`/`.jpeg` and `.tif`/`.tiff` are spelling rather than format, so
 * they collapse — the same rule /exif-viewer's readout follows.
 */
function sourceLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "IMAGE";
  const raw = name.slice(dot + 1).toUpperCase();
  return raw === "JPG" ? "JPEG" : raw === "TIF" ? "TIFF" : raw;
}

const GROUP_LABELS: Record<string, string> = {
  exif: "Camera & image",
  gps: "GPS location",
  iptc: "IPTC",
  xmp: "XMP",
  icc: "Colour profile",
};

/** A tiny PDF finishes in tens of ms; "0.0 s" reads like a stopped watch. */
function formatElapsed(ms: number): string {
  return ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function RemoveMetadataUI({
  acceptFormats = DEFAULT_ACCEPT,
}: {
  acceptFormats?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  /**
   * Set when ExifReader itself refused the file. Deliberately NOT an error:
   * the canvas can still decode and re-encode a picture whose metadata block
   * this reader cannot parse, so the listing is empty and the run is still
   * offered — with a line saying the listing is empty for that reason.
   */
  const [readNote, setReadNote] = useState<string | null>(null);
  /** Percent, for the lossy containers. Sent as `quality / 100`. */
  const [quality, setQuality] = useState(92);
  const [status, setStatus] = useState<Status>("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
    STALE RESULTS ARE A SHIPPED BUG CLASS HERE. Both async paths — the read on
    load and the clean — can be superseded by a new file or a moved slider
    while they are in flight, and a promise that resolves afterwards must not
    write anything: a cleaned copy built at 92% must never sit under a rail
    that now reads 60%, and the OUT/verified readouts describe one specific
    blob. Every invalidation bumps the token; a run captures it before its
    first await and commits nothing unless it still matches.
  */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setRun(null);
    setError(null);
    setStatus("idle");
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    const token = (runToken.current += 1);
    setFile(f);
    setFound(null);
    setReadNote(null);
    setRun(null);
    setError(null);
    setStatus("reading");

    try {
      if (isPdfFile(f)) {
        // Dynamic, and from `pdf-engine` rather than `pdf-engine-core`: the
        // core drags pdf-lib's chunk into the eager bundle of every page.
        const { readPdfMetadata } = await import("@/lib/tools/pdf-engine");
        const report = await readPdfMetadata(await f.arrayBuffer());
        if (runToken.current !== token) return;
        setFound({ kind: "pdf", info: report.info, xmpStreams: report.xmpStreams });
      } else {
        const { readExifData } = await import("@/lib/tools/exif-viewer");
        let entries: ExifEntry[] = [];
        try {
          entries = await readExifData(f);
        } catch {
          if (runToken.current !== token) return;
          setReadNote(
            "This page's metadata reader could not open this file, so the list below is empty. That is not the same as the file being clean — running it still re-encodes the picture.",
          );
        }
        if (runToken.current !== token) return;
        setFound({ kind: "image", entries });
      }
      setStatus("idle");
    } catch (err) {
      if (runToken.current !== token) return;
      // The engine's own sentences — a password-protected or damaged PDF gets
      // told which tool can open it — so they are rendered verbatim.
      setError(err instanceof Error ? err.message : "Could not read this file");
      setStatus("error");
    }
  }, []);

  /** The re-read of the produced file, with the reader that listed the source. */
  const verifyOutput = useCallback(
    async (blob: Blob, fileName: string, pdf: boolean): Promise<Verified> => {
      try {
        if (pdf) {
          const { readPdfMetadata } = await import("@/lib/tools/pdf-engine");
          const report = await readPdfMetadata(await blob.arrayBuffer());
          return {
            kind: "pdf",
            infoFields: Object.keys(report.info).length,
            xmpStreams: report.xmpStreams,
          };
        }
        const { readExifData } = await import("@/lib/tools/exif-viewer");
        const entries = await readExifData(new File([blob], fileName, { type: blob.type }));
        return {
          kind: "image",
          tags: entries.length,
          groups: [...new Set(entries.map((e) => e.group))],
        };
      } catch {
        // A reader that cannot open the output proves nothing either way, and
        // printing "0 tags left" off a failed parse would be the worst lie
        // this page could tell.
        return { kind: "unavailable" };
      }
    },
    [],
  );

  const handleClean = useCallback(async () => {
    if (!file) return;
    const pdf = isPdfFile(file);
    const token = (runToken.current += 1);
    setStatus("processing");
    setError(null);
    setRun(null);
    const startedAt = performance.now();
    try {
      let blob: Blob;
      let fileName: string;
      if (pdf) {
        const { removePdfMetadata } = await import("@/lib/tools/pdf-engine");
        const bytes = await removePdfMetadata(await file.arrayBuffer());
        blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
        fileName = file.name.replace(/\.pdf$/i, "-clean.pdf");
      } else {
        const { stripExifData } = await import("@/lib/tools/exif-viewer");
        const result = await stripExifData(file, quality / 100);
        blob = result.blob;
        fileName = result.fileName;
      }
      if (runToken.current !== token) return;
      const elapsed = formatElapsed(performance.now() - startedAt);
      // The point of the page: the file goes to the browser here, in the same
      // gesture that produced it, before anything else is measured or drawn.
      triggerDownload(blob, fileName);
      const verified = await verifyOutput(blob, fileName, pdf);
      if (runToken.current !== token) return;
      setRun({ blob, fileName, elapsed, verified });
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Failed to remove the metadata from this file");
      setStatus("error");
    }
  }, [file, quality, verifyOutput]);

  const handleReset = useCallback(() => {
    runToken.current += 1;
    setFile(null);
    setFound(null);
    setReadNote(null);
    setRun(null);
    setError(null);
    setStatus("idle");
  }, []);

  if (!file) return <DropZone accept={acceptFormats} onFiles={handleFiles} />;

  const pdf = isPdfFile(file);
  const planned = plannedOutput(file.name);
  const lossy = planned.mime !== "image/png";
  const infoEntries = found?.kind === "pdf" ? Object.entries(found.info) : [];
  const entries = found?.kind === "image" ? found.entries : [];
  const hasGps = entries.some((e) => e.group === "gps");
  const nothingFound = pdf
    ? found?.kind === "pdf" && infoEntries.length === 0 && found.xmpStreams === 0
    : found?.kind === "image" && entries.length === 0;

  /*
    MEASURED, not assumed: `canvas.toBlob` silently serialises PNG for any type
    the browser cannot write, and the Blob's own type is the encoder saying
    which it produced (WebKit is the live case for WebP). `stripExifData` names
    the file from the extension it planned, so on such a browser the download
    is a `.webp` holding PNG bytes — and this is the only place that says so.
  */
  const writtenLabel = run && !pdf ? containerLabel(run.blob.type) : null;
  const substituted = writtenLabel !== null && writtenLabel !== planned.label;

  const groupedEntries = entries.reduce<Record<string, ExifEntry[]>>((acc, entry) => {
    (acc[entry.group] ??= []).push(entry);
    return acc;
  }, {});

  const verifiedLine = ((): string | null => {
    if (!run) return null;
    const v = run.verified;
    if (v.kind === "unavailable") {
      return "THE DOWNLOAD COULD NOT BE RE-READ HERE, SO NOTHING ON THIS PAGE HAS CHECKED IT";
    }
    if (v.kind === "pdf") {
      return v.infoFields === 0 && v.xmpStreams === 0
        ? "RE-READ FROM THE DOWNLOAD: NO /INFO ENTRIES AND NO XMP PACKETS LEFT"
        : `RE-READ FROM THE DOWNLOAD: ${v.infoFields} /INFO ENTRIES AND ${v.xmpStreams} XMP PACKETS STILL PRESENT`;
    }
    return v.tags === 0
      ? "RE-READ FROM THE DOWNLOAD WITH THE SAME READER: NO EXIF, GPS, IPTC, XMP OR COLOUR-PROFILE TAGS LEFT"
      : `RE-READ FROM THE DOWNLOAD WITH THE SAME READER: ${v.tags} TAG${
          v.tags === 1 ? "" : "S"
        } LEFT IN ${v.groups.map((g) => (GROUP_LABELS[g] ?? g).toUpperCase()).join(", ")}`;
  })();

  const advancedRows: (readonly [string, string])[] = pdf
    ? [
        ["/Info entries", "DELETED, NOT BLANKED"],
        ["XMP packets", "DELETED EVERYWHERE FOUND"],
        ["Page content", "UNTOUCHED"],
        ["Trailer /ID", "LEFT IN PLACE"],
      ]
    : [
        ["Pixel data", "DECODED AND RE-ENCODED"],
        ["Colour space", "sRGB"],
        ["Bit depth", "8 PER CHANNEL"],
        [
          "Container",
          writtenLabel === null ? `${planned.label} (PLANNED)` : writtenLabel,
        ],
        ["Transparency", planned.mime === "image/jpeg" ? "WHITE FILL" : "PRESERVED"],
        ["JPEG APP1 sweep", planned.mime === "image/jpeg" ? "AFTER ENCODING" : "NOT APPLICABLE"],
      ];

  return (
    <>
      {/* ── Canvas: what the file is carrying, and what the download carries ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${pdf ? "PDF" : sourceLabel(file.name)} · ${formatFileSize(file.size)}`}
          trailing={
            run
              ? "CLEANED COPY SAVED"
              : status === "reading"
                ? "READING"
                : found?.kind === "pdf"
                  ? `${infoEntries.length} INFO · ${found.xmpStreams} XMP`
                  : `${entries.length} FIELD${entries.length === 1 ? "" : "S"} FOUND`
          }
        />

        {status === "reading" && <StatusMessage>Reading metadata…</StatusMessage>}

        <StatStrip
          stats={
            pdf
              ? [
                  { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
                  { label: "OUT", value: run ? formatFileSize(run.blob.size) : "—" },
                  {
                    label: "INFO FIELDS",
                    value: found ? String(infoEntries.length) : "—",
                    tone: "neutral",
                  },
                  {
                    label: "XMP PACKETS",
                    value: found?.kind === "pdf" ? String(found.xmpStreams) : "—",
                    tone: "neutral",
                  },
                ]
              : [
                  { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
                  { label: "OUT", value: run ? formatFileSize(run.blob.size) : "—" },
                  { label: "TAGS FOUND", value: found ? String(entries.length) : "—", tone: "neutral" },
                  { label: "LOCATION", value: found ? (hasGps ? "PRESENT" : "NONE") : "—", tone: "neutral" },
                ]
          }
        />

        {readNote && <WarningMessage message={readNote} />}

        {substituted && (
          <WarningMessage
            message={`This browser wrote ${writtenLabel} rather than ${planned.label}. The download is named .${run?.fileName.split(".").pop()} but its bytes are ${writtenLabel} — rename it if something downstream reads the extension.`}
          />
        )}

        {error && <ErrorMessage message={error} />}

        {/* Once a cleaned copy exists the listing is history, not the state of
            the file the user now has. */}
        {run && (infoEntries.length > 0 || entries.length > 0) && (
          <p className="font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase text-text-muted">
            Original file — these are gone from the cleaned copy
          </p>
        )}

        {pdf && infoEntries.length > 0 && (
          <TagGrid
            tags={infoEntries.map(([label, value]) => ({ label, value }))}
            /* Author and Creator are the two /Info keys that routinely name a
               person or their machine's account; the tint marks them the way
               the GPS group is marked on the image path. */
            identifying={(label) => label === "Author" || label === "Creator"}
          />
        )}

        {!pdf &&
          Object.entries(groupedEntries).map(([group, groupEntries]) => (
            <div key={group} className="space-y-2">
              <h3 className="flex items-baseline gap-2 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] uppercase text-text-muted">
                {GROUP_LABELS[group] ?? group.toUpperCase()}
                {group === "gps" && !run && (
                  <span className="text-warning">⚠ Contains location data</span>
                )}
              </h3>
              <TagGrid
                tags={groupEntries.map((e) => ({ label: e.tag, value: String(e.value) }))}
                identifying={() => group === "gps"}
              />
            </div>
          ))}

        {/*
          The measured line. Everything else on this page describes what the
          code intends to do; this one describes the bytes the user now has,
          read back by the same parser that listed the source.
        */}
        {verifiedLine && <CanvasFootnote>{verifiedLine}</CanvasFootnote>}

        {/*
          A run that removes nothing must not read as a success, so the case is
          stated BEFORE the button rather than explained after it. The two
          sentences differ because the two paths differ: the PDF reader looks at
          exactly the two things the PDF cleaner deletes, while the image reader
          covers only the blocks ExifReader parses — a PNG text chunk or a
          Photoshop resource block is not in the list above and is still dropped
          by the re-encode.
        */}
        {nothingFound && !run && (
          <CanvasFootnote>
            {pdf
              ? "NO /INFO ENTRIES AND NO XMP PACKETS WERE FOUND — A RUN WOULD ONLY RE-SAVE THIS DOCUMENT"
              : "NO EXIF, GPS, IPTC, XMP OR COLOUR-PROFILE TAGS WERE FOUND — A RUN STILL RE-ENCODES THE PICTURE, WHICH DROPS BLOCKS THIS READER CANNOT SEE"}
          </CanvasFootnote>
        )}

        {!run && (
          <CanvasFootnote>
            {pdf
              ? "ONLY WHAT THE FILE SAYS ABOUT ITSELF IS REMOVED — A NAME PRINTED INSIDE A PAGE STAYS ON THE PAGE"
              : "THIS IS A RE-ENCODE, NOT AN EDIT — THE DOWNLOAD IS A NEW PICTURE BUILT FROM THE PIXELS. KEEP YOUR ORIGINAL."}
          </CanvasFootnote>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "reading" || status === "processing") && (
              <ToolProgress
                phase={status === "reading" ? "READING METADATA" : "REMOVING METADATA"}
                percent={null}
                label={status === "reading" ? "Reading metadata" : "Removing metadata"}
              />
            )}
            {/* `savedToRecent` is true here for real: the run's own
                `triggerDownload` is what records it. */}
            {run && <ToolDone elapsed={run.elapsed} savedToRecent />}
            {run ? (
              <DownloadButton
                blob={run.blob}
                fileName={run.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing" ? "Removing…" : "Remove metadata and download"
                }
                onPrimary={handleClean}
                primaryDisabled={status === "reading" || status === "processing" || !found}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        {!pdf && (
          <ToolControlGroup>
            <ToolControl label="RE-ENCODE">
              {lossy ? (
                <ToolSlider
                  label="Output quality"
                  display={`${quality}%`}
                  min={50}
                  max={100}
                  value={quality}
                  onChange={(v) => {
                    // A finished copy describes the quality it was built at,
                    // so moving this drops it rather than leaving it
                    // downloadable under a number that no longer made it.
                    invalidate();
                    setQuality(v);
                  }}
                  disabled={status === "processing"}
                  hint={`The cleaned copy is encoded as ${planned.label} at this quality. Lower means a smaller file and visibly softer detail; the pixels given up here cannot be recovered from the download.`}
                />
              ) : (
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  PNG comes off the canvas losslessly — every pixel the browser decoded is written
                  back — so there is no quality to set. The decode itself still reduces anything
                  deeper than 8 bits per channel.
                </span>
              )}
            </ToolControl>
          </ToolControlGroup>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={
              pdf
                ? [
                    ["In", formatFileSize(file.size)],
                    ["Out", run ? formatFileSize(run.blob.size) : "—"],
                    ["Info fields", found ? String(infoEntries.length) : "—"],
                    [
                      "XMP packets",
                      found?.kind === "pdf" ? String(found.xmpStreams) : "—",
                    ],
                  ]
                : [
                    ["In", formatFileSize(file.size)],
                    ["Out", run ? formatFileSize(run.blob.size) : "—"],
                    ["Tags found", found ? String(entries.length) : "—"],
                    ["Writes", writtenLabel ?? `${planned.label} (planned)`],
                  ]
            }
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {run
              ? "The cleaned file went to your browser's downloads the moment the run finished. Download saves it again — use it if you want a second copy, or if your browser held the first one back."
              : "One press cleans the file and saves it. You do not have to press anything else afterwards."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label={pdf ? "WHAT IS REMOVED" : "WHAT THE CLEAN COSTS"}>
          {pdf ? (
            <>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Every key in the document&apos;s <strong>/Info</strong> dictionary is deleted
                rather than emptied — Title, Author, Subject, Keywords, Creator, Producer and both
                dates — and so is every <strong>XMP</strong> packet: the one on the catalog, any a
                page carries, and the ones that arrived inside embedded photographs.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Clearing the properties alone would not be enough. An XMP packet routinely repeats
                the title and the author, so a tool that only touched /Info would report success
                over a document still naming you.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Nothing on the pages changes: no text, image, annotation or form field is
                rewritten, so the file still looks and prints exactly as it did. What a page shows
                is not metadata — a name typed into the document stays visible. The trailer&apos;s
                two /ID strings are left in place as well.
              </span>
            </>
          ) : (
            <>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                The picture is decoded, drawn onto a canvas and encoded again — that is what leaves
                the tags behind, and it means the download is a{" "}
                <strong>new image built from the pixels</strong> rather than your bytes with the
                tags cut out. Keep the original if you need it untouched.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                What the round trip costs: the embedded colour profile is not carried over, because
                the canvas works in sRGB; anything deeper than 8 bits per channel comes back at 8;
                an animated PNG or WebP keeps only its first frame and a multi-page TIFF only its
                first page; and transparency survives only in PNG and WebP, since a JPEG has no
                alpha channel and transparent areas are filled white.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                PNG stays PNG and WebP stays WebP, but HEIC, HEIF and TIFF come back as JPEG — no
                browser can write those containers from a canvas. When the output is a JPEG, every
                APP1 segment is then swept out of the encoded bytes, because Safari writes a fresh
                Exif block of its own into JPEGs it encodes; the JFIF and colour-profile markers an
                encoder writes are left alone, as they describe how to draw the picture rather than
                where it came from.
              </span>
            </>
          )}
        </ToolAsideSection>

        <ToolAdvanced rows={advancedRows} />
      </ToolAside>
    </>
  );
}
