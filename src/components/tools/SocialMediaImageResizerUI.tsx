"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import {
  defaultFormatFor,
  OutputFormatPicker,
  sourceCanCarryAlpha,
} from "@/components/tools/OutputFormatPicker";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  PageDeck,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, SCROLL_CLASS, STAGE_GROW } from "@/components/workspace/shared";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { cn } from "@/lib/utils/cn";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { downloadFilesAsZip, triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { editImageToMany } from "@/lib/workers/image-client";
import type { EditOutputFormat, EditOutputSpec } from "@/lib/workers/image-protocol";

/*
  One picture out to several named frame sizes at once.

  THE COPY PROBLEM THIS TOOL HAS. Every competitor page in this category says
  something like "the current Instagram post size". A static site cannot know
  that. Platform specs move, this page ships as a prerendered file, and there
  is no runtime check anywhere in this app that could confirm one of these
  numbers against a platform today.

  So the split is drawn explicitly and it holds everywhere on the surface: the
  PIXEL DIMENSIONS are facts — they are exactly what this tool writes, and the
  output proves them — while the platform names are only what a size is
  COMMONLY USED FOR. The cards print the numbers large and the platforms as a
  subordinate line, the footnote states the distinction in words, and no string
  anywhere in this file says "current", "official" or "required".

  The second honesty point is that COVER CROPS. Fitting a 4:3 photo into a
  1080 × 1920 story means most of the picture is not in the file that comes
  out, and a user who does not know that discovers it after posting. The card
  previews use the browser's own `object-fit` — the same geometry the engine
  applies — so the crop is visible on screen before the run, and the rail says
  in words which of the two settings is the one that loses picture.
*/

interface SocialPreset {
  /**
   * The `EditOutputSpec.label`, which the client turns into the filename stem
   * suffix (`photo-square-1080.png`). Lower-case and hyphenated for that
   * reason; the `-<id>.` shape is also what pairs a returned file back to its
   * preset below.
   */
  id: string;
  name: string;
  width: number;
  height: number;
  /** What this SIZE is commonly used for. Never a claim about a current spec. */
  usedFor: string;
}

/**
 * The sizes. Chosen because each is a distinct, long-lived aspect ratio that
 * people actually ask for by name — 1:1, 4:5, 9:16, 1.91:1, 16:9, 3:1, 2:3 and
 * square-small — rather than to enumerate one row per social network. Two
 * platforms that want the same rectangle share a card here.
 */
export const SOCIAL_PRESETS: readonly SocialPreset[] = [
  {
    id: "square-1080",
    name: "Square post",
    width: 1080,
    height: 1080,
    usedFor: "Square feed posts — Instagram, Facebook, LinkedIn",
  },
  {
    id: "portrait-1080x1350",
    name: "Tall post",
    width: 1080,
    height: 1350,
    usedFor: "4:5 feed posts — Instagram, Facebook",
  },
  {
    id: "story-1080x1920",
    name: "Story",
    width: 1080,
    height: 1920,
    usedFor: "Full-screen vertical — Stories, Reels, TikTok, Shorts",
  },
  {
    id: "link-1200x630",
    name: "Link preview",
    width: 1200,
    height: 630,
    usedFor: "Open Graph link cards — Facebook, LinkedIn, Slack",
  },
  {
    id: "wide-1600x900",
    name: "Wide image",
    width: 1600,
    height: 900,
    usedFor: "16:9 in-stream images — X, Mastodon, blogs",
  },
  {
    id: "thumbnail-1280x720",
    name: "Video thumbnail",
    width: 1280,
    height: 720,
    usedFor: "Video cover frames — YouTube, Vimeo",
  },
  {
    id: "header-1500x500",
    name: "Profile header",
    width: 1500,
    height: 500,
    usedFor: "3:1 profile banners — X",
  },
  {
    id: "pin-1000x1500",
    name: "Tall pin",
    width: 1000,
    height: 1500,
    usedFor: "2:3 pins — Pinterest",
  },
  {
    id: "avatar-400",
    name: "Avatar",
    width: 400,
    height: 400,
    usedFor: "Profile pictures — most platforms crop these to a circle",
  },
];

type Fit = "cover" | "contain";

/** Every returned file carries its preset's id in its name — pair on that. */
function presetForFile(fileName: string): SocialPreset | null {
  return SOCIAL_PRESETS.find((p) => fileName.includes(`-${p.id}.`)) ?? null;
}

/**
 * How much the source has to be scaled to fill (cover) or to fit inside
 * (contain) a frame. Above 1 the picture is being ENLARGED, which no resizer
 * can do without softening it — so the surface says which frames are in that
 * position instead of quietly handing back a blurry file.
 */
export function frameScale(
  srcWidth: number,
  srcHeight: number,
  frameWidth: number,
  frameHeight: number,
  fit: Fit,
): number {
  const sx = frameWidth / srcWidth;
  const sy = frameHeight / srcHeight;
  return fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
}

/**
 * The frames that have to be enlarged, NAMED — "STORY AND PROFILE HEADER",
 * never a bare comma list.
 *
 * A count on its own is not enough here, and this tool is the reason: it writes
 * several files in one run, so "2 of them are enlarged" leaves the reader
 * holding a ZIP with no way to tell which two are the soft ones. The count
 * stays as well, because it is what the FAQ for this page promises.
 */
function enlargementNote(
  dims: { w: number; h: number },
  enlarged: readonly SocialPreset[],
): string {
  const names = enlarged.map((p) => p.name.toUpperCase());
  const named =
    names.length < 2
      ? names[0]
      : `${names.slice(0, -1).join(", ")} AND ${names[names.length - 1]}`;
  const one = enlarged.length === 1;
  return (
    `THIS PICTURE IS ${dims.w} × ${dims.h} — ${enlarged.length} OF THE SELECTED FRAMES ` +
    `${one ? "IS" : "ARE"} BIGGER THAN THAT (${named}), SO ` +
    `${one ? "THAT FILE IS" : "THOSE FILES ARE"} ENLARGED AND WILL LOOK SOFTER`
  );
}

/** One produced file and the object URL its preview is painted from. */
interface SocialOutput {
  result: ProcessedResult;
  url: string;
}

interface SocialMediaImageResizerUIProps {
  acceptFormats: string;
}

export function SocialMediaImageResizerUI({ acceptFormats }: SocialMediaImageResizerUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<readonly string[]>(["square-1080", "link-1200x630"]);
  const [fit, setFit] = useState<Fit>("cover");
  const [padColour, setPadColour] = useState("#ffffff");
  // Replaced by `defaultFormatFor` the moment a file lands — the picker is
  // only ever on screen once one has, so this value is never the one shown.
  const [format, setFormat] = useState<EditOutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [results, setResults] = useState<SocialOutput[] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = useObjectUrl(file);
  const dims = useImageDimensions(file);

  // Kept in preset order, not click order, so the deck and the ZIP read the
  // same way round as the matrix the user was looking at.
  const chosen = useMemo(
    () => SOCIAL_PRESETS.filter((p) => selected.includes(p.id)),
    [selected],
  );

  /*
    Each output's object URL is allocated WITH the output, in the handler that
    produced it, and the pair is one piece of state.

    Mirroring the results into a second `urls` state from an effect is the
    obvious alternative and it is wrong twice over: it is a cascading render
    that `react-hooks/set-state-in-effect` refuses outright, and it splits one
    fact across two states that disagree for a frame. `useObjectUrl` cannot
    serve a LIST, so its two disciplines are kept by hand instead — every URL
    is revoked when the list it belongs to is replaced, and again on unmount,
    and the revoke is deferred a second because a synchronous one aborts an
    <img> still loading the URL the deck has just swapped away from.
  */
  const liveUrls = useRef<string[]>([]);
  const showResults = useCallback((produced: ProcessedResult[] | null) => {
    const stale = liveUrls.current;
    const next =
      produced?.map((result) => ({ result, url: URL.createObjectURL(result.blob) })) ?? null;
    liveUrls.current = next?.map((o) => o.url) ?? [];
    setResults(next);
    if (stale.length > 0) {
      setTimeout(() => {
        for (const url of stale) URL.revokeObjectURL(url);
      }, 1000);
    }
  }, []);

  useEffect(
    () => () => {
      const outstanding = liveUrls.current;
      liveUrls.current = [];
      setTimeout(() => {
        for (const url of outstanding) URL.revokeObjectURL(url);
      }, 1000);
    },
    [],
  );

  const change = useCallback(
    (apply: () => void) => {
      showResults(null);
      apply();
    },
    [showResults],
  );

  const togglePreset = useCallback(
    (id: string) => {
      change(() =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id])),
      );
    },
    [change],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      // The source's own format, the way every other verb that carries this
      // picker starts. Opening on JPG regardless meant a dropped logo was
      // white-flattened by a control the user never touched.
      setFormat(defaultFormatFor(f));
      showResults(null);
      setError(null);
    },
    [showResults],
  );

  const handleResize = useCallback(async () => {
    if (!file || chosen.length === 0) return;
    setIsProcessing(true);
    setError(null);
    try {
      const outputs: EditOutputSpec[] = chosen.map((p) => ({
        label: p.id,
        width: p.width,
        height: p.height,
      }));
      const produced = await editImageToMany(file, {
        edit: { kind: "presets", outputs, fit, padColour },
        format,
        quality,
      });
      showResults(produced);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resize this image");
    }
    setIsProcessing(false);
  }, [file, chosen, fit, padColour, format, quality, showResults]);

  const handleReset = useCallback(() => {
    setFile(null);
    showResults(null);
    setError(null);
  }, [showResults]);

  const downloadAll = useCallback(() => {
    if (!file || !results) return;
    void downloadFilesAsZip(
      results.map((o) => ({ blob: o.result.blob, name: o.result.fileName })),
      `${file.name.replace(/\.[^.]+$/, "")}-social.zip`,
    );
  }, [file, results]);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to resize for social" />
    );
  }

  const warnings = [...new Set((results ?? []).flatMap((o) => o.result.warnings ?? []))];

  // Derived from this picture against these frames, not asserted as a general
  // caveat: a 2400 px photo enlarges into none of them and gets no notice.
  const enlarged = dims
    ? chosen.filter((p) => frameScale(dims.w, dims.h, p.width, p.height, fit) > 1)
    : [];

  return (
    <>
      {/* ── Canvas: the size matrix, then the files it produced ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(dims, formatFileSize(file.size))}
          // After a run, the count of files that came BACK.
          trailing={results ? `${results.length} SIZES` : `${chosen.length} SELECTED`}
        />

        {results ? (
          <PageDeck>
            {results.map((o) => {
              const preset = presetForFile(o.result.fileName);
              return (
                <figure key={o.result.fileName} className="m-0 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => triggerDownload(o.result.blob, o.result.fileName)}
                    aria-label={`Download ${o.result.fileName}`}
                    className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-[5px] border border-neutral-800 bg-[linear-gradient(170deg,#f3f5fe_0%,#dfe3f0_100%)] p-0 transition-opacity duration-200 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */}
                    <img src={o.url} alt="" className="size-full object-contain" />
                  </button>
                  <figcaption className="flex flex-col gap-1">
                    <span className="truncate font-body text-[10.5px] leading-none text-neutral-300">
                      {preset ? preset.name : o.result.fileName}
                    </span>
                    <span className="font-mono text-[9.5px] leading-none text-accent-300">
                      {preset ? `${preset.width} × ${preset.height} · ` : ""}
                      {formatFileSize(o.result.newSize)}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </PageDeck>
        ) : (
          <CanvasStage className={cn(STAGE_GROW, "flex flex-col p-4")}>
            <div className={cn("min-h-0 flex-1 overflow-y-auto max-h-[min(62vh,720px)]", SCROLL_CLASS)}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
                {SOCIAL_PRESETS.map((p) => {
                  const on = selected.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePreset(p.id)}
                      aria-pressed={on}
                      aria-label={`${p.name} — ${p.width} by ${p.height} pixels`}
                      disabled={isProcessing}
                      className={cn(
                        "flex cursor-pointer flex-col gap-2 rounded-[6px] border p-2 text-left transition-colors duration-200",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        on
                          ? "border-accent bg-accent/12"
                          : "border-border hover:border-accent/40",
                      )}
                    >
                      {/*
                        The preview box carries the TARGET aspect ratio and the
                        browser's own object-fit does the framing — `cover`
                        crops to fill, `contain` letterboxes onto the pad
                        colour. That is the same geometry the engine applies,
                        so what is missing from this thumbnail is what will be
                        missing from the file.
                      */}
                      <span
                        className="relative block w-full overflow-hidden rounded-[4px] border border-neutral-800"
                        style={{
                          aspectRatio: `${p.width} / ${p.height}`,
                          backgroundColor: fit === "contain" ? padColour : "#0c0e17",
                        }}
                      >
                        {previewUrl && (
                          // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
                          <img
                            src={previewUrl}
                            alt=""
                            className={cn(
                              "size-full",
                              fit === "cover" ? "object-cover" : "object-contain",
                            )}
                          />
                        )}
                      </span>
                      <span className="flex flex-col gap-0.5">
                        {/* The number is the fact, so it is the loud line. */}
                        <span className="font-mono text-[11px] leading-none font-medium text-accent-300">
                          {p.width} × {p.height}
                        </span>
                        <span className="font-body text-[11px] leading-none text-neutral-300">
                          {p.name}
                        </span>
                        <span className="font-body text-[9.5px] leading-[1.35] text-text-muted">
                          {p.usedFor}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CanvasStage>
        )}

        <StatStrip
          stats={[
            { label: "SOURCE", value: dims ? `${dims.w}×${dims.h}` : "—", tone: "neutral" },
            { label: "SIZES", value: results ? String(results.length) : String(chosen.length) },
            { label: "FIT", value: fit.toUpperCase(), tone: "neutral" },
            {
              label: "OUT",
              value: results
                ? formatFileSize(results.reduce((n, o) => n + o.result.newSize, 0))
                : "—",
              tone: "ok",
            },
          ]}
        />

        {/* The standing disclosure. It is on screen before the run, not after. */}
        <CanvasFootnote>
          THE PIXEL SIZES ARE THE FACT HERE — THE PLATFORM NAMES ARE WHAT EACH SIZE IS COMMONLY
          USED FOR, NOT A READING OF ANY PLATFORM&rsquo;S CURRENT SPEC
        </CanvasFootnote>

        {chosen.length === 0 && !results && (
          <CanvasFootnote>PICK AT LEAST ONE SIZE — NOTHING IS SELECTED</CanvasFootnote>
        )}

        {/* One derived string rather than six interleaved expressions: JSX eats
            the space between an expression and the next word, and this repo has
            already shipped `at most 300frames` from that shape. */}
        {dims && enlarged.length > 0 && (
          <CanvasFootnote>{enlargementNote(dims, enlarged)}</CanvasFootnote>
        )}

        {results && <CanvasFootnote>CLICK A SIZE TO SAVE IT ON ITS OWN</CanvasFootnote>}

        {error && <ErrorMessage message={error} />}

        {warnings.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {isProcessing && (
              <ToolProgress phase="RESIZING" percent={null} label="Writing the social sizes" />
            )}
            {results && results.length === 1 ? (
              // `downloadFilesAsZip` saves a one-member list bare, so a button
              // promising a ZIP would be a promise the download breaks.
              <DownloadButton
                blob={results[0].result.blob}
                fileName={results[0].result.fileName}
                className="w-full justify-center"
              />
            ) : results ? (
              <ToolActions
                primaryLabel={`Download ${results.length} sizes (ZIP)`}
                onPrimary={downloadAll}
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Resizing…" : "Resize"}
                onPrimary={handleResize}
                primaryDisabled={isProcessing || chosen.length === 0}
              />
            )}
            {results && (
              <ToolResetLink onClick={() => showResults(null)} label="CHANGE THE SIZES" />
            )}
            <ToolResetLink onClick={handleReset} label={results ? "RESIZE ANOTHER" : "CLEAR"} />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="FIT">
            <ToolChoice
              label="How each frame is filled"
              fill
              disabled={isProcessing}
              value={fit}
              onChange={(v: Fit) => change(() => setFit(v))}
              options={[
                { value: "cover" as const, label: "Cover" },
                { value: "contain" as const, label: "Contain" },
              ]}
            />
            {/*
              Named plainly, and named for the setting that is ACTIVE. "Cover
              crops, contain pads" as a standing pair reads as a definition;
              this reads as a description of what the next run will do.
            */}
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {fit === "cover"
                ? "Cover fills every frame edge to edge and crops whatever does not fit. This is the one that loses parts of the picture — the previews show exactly what each frame keeps."
                : "Contain fits the whole picture inside every frame and fills the space left over with the pad colour. Nothing is cropped."}
            </span>
          </ToolControl>

          {fit === "contain" && (
            <ToolControl label="PAD">
              <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
                Pad colour
                <input
                  type="color"
                  value={padColour}
                  onChange={(e) => change(() => setPadColour(e.target.value))}
                  aria-label="Pad colour"
                  disabled={isProcessing}
                  className="size-8 cursor-pointer rounded-sm border border-border"
                />
              </label>
            </ToolControl>
          )}

          {/* `alphaWarning` is the SOURCE half of the question — whether the
              file that was dropped can carry transparency at all; the picker
              owns the "is JPG selected" half. Without it a PNG logo written to
              nine frames comes back with every transparent pixel white and
              nothing on the page says so. */}
          <OutputFormatPicker
            value={format}
            onChange={(v) => change(() => setFormat(v))}
            quality={quality}
            onQualityChange={(q) => change(() => setQuality(q))}
            disabled={isProcessing}
            alphaWarning={sourceCanCarryAlpha(file)}
          />
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Files", results ? String(results.length) : String(chosen.length)],
              [
                "Out",
                results ? formatFileSize(results.reduce((n, o) => n + o.result.newSize, 0)) : "—",
              ],
              ["Fit", fit === "cover" ? "COVER (CROPS)" : "CONTAIN (PADS)"],
              ["In", formatFileSize(file.size)],
            ]}
          />
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Padding", fit === "contain" ? padColour.toUpperCase() : "NONE — CROPPED INSTEAD"],
            ["Aspect ratio", "SET BY THE FRAME, NOT THE SOURCE"],
            ["EXIF + GPS", "STRIPPED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
