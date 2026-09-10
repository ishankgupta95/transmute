"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, CanvasHeader, PageDeck } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { downloadFilesAsZip } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import type {
  ExtractedPdfImage,
  PdfExtractImagesResult,
  PdfExtractSkip,
  PdfExtractSkipReason,
} from "@/lib/tools/pdf-extract-images";

/*
  EXTRACT, DO NOT RE-ENCODE — and say what that means.

  The engine lifts a /DCTDecode stream's bytes out verbatim, because those
  bytes ARE a JPEG file. Nothing is decoded, so nothing is re-encoded, so the
  photograph in the download is the photograph the document was carrying, byte
  for byte. (It is also what keeps this page clear of the EXIF trap that
  `recompress-pdf-images` has to actively defend against — see the header of
  lib/tools/pdf-extract-images.ts.)

  Two claims follow that this surface has to make out loud rather than let a
  user discover:

  1. An extracted image arrives at the resolution it is STORED at. A picture
     placed small on a page is often stored small, so "extract" can hand back
     something visibly smaller than what is on screen. That is the file being
     honest, not the tool failing.
  2. This is NOT a screenshot of a page. There is no rendering here at all —
     no text, no vector art, no layout, and nothing for a page that carries no
     raster image. Page renders are `pdf-to-jpg`, and the copy points there in
     both the "nothing found" case and the standing footnote.

  The skip counts are a first-class readout for the same reason they are on
  the recompressor: the engine refuses everything it cannot write out
  truthfully, and that conservatism is only honest if it is visible.
*/

/**
 * How many previews the canvas paints.
 *
 * The DOWNLOAD always carries every extracted image; only the grid is capped.
 * A magazine PDF can hold several hundred image objects, and painting all of
 * them means several hundred simultaneous `<img>` decodes plus an Object URL
 * apiece — a layout the main thread does not come back from quickly, for a
 * grid nobody scrolls to the bottom of. The footnote below says so whenever
 * the cap bites, so the canvas never quietly pretends to be the whole set.
 */
const PREVIEW_LIMIT = 48;

const MIME: Record<ExtractedPdfImage["format"], string> = {
  jpeg: "image/jpeg",
  png: "image/png",
};

const FORMAT_BADGE: Record<ExtractedPdfImage["format"], string> = {
  jpeg: "JPG",
  png: "PNG",
};

/**
 * The minimum-size chips.
 *
 * A real-world PDF is full of 8 × 8 rules, bullets and UI chrome stored as
 * images, and a ZIP of sixty of those with four photographs buried in it is a
 * worse answer than a ZIP of four. `0` is the default and means no filter at
 * all — nothing is hidden unless the user asks for it, and whatever the filter
 * hides is counted on screen rather than quietly dropped.
 */
const MIN_SIDE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "All" },
  { value: 64, label: "64 px +" },
  { value: 256, label: "256 px +" },
];

/**
 * The one place the engine's skip reasons become English.
 *
 * Every member of `PdfExtractSkipReason` has a row — a missing one would print
 * a raw enum value like `decode-parms` on the canvas — and each is written to
 * follow a count, so "1" agrees with its verb and "2" with its.
 *
 * The vocabulary is shared with `RecompressPdfImagesUI` on purpose, but the
 * sentences are not: an image is skipped THERE because a re-encode would
 * change how the page looks, and HERE because no standalone image file could
 * carry what the PDF is doing with it. Same taxonomy, different reason.
 */
const SKIP_PHRASES: Record<PdfExtractSkipReason, { one: string; many: string }> = {
  mask: {
    one: "IS A TRANSPARENCY MASK, OR CARRIES ONE",
    many: "ARE TRANSPARENCY MASKS, OR CARRY ONE",
  },
  filter: {
    one: "IS NEITHER A JPEG NOR A RAW PIXEL BITMAP",
    many: "ARE NEITHER JPEGS NOR RAW PIXEL BITMAPS",
  },
  "decode-parms": {
    one: "CARRIES FILTER PARAMETERS THIS TOOL WILL NOT SECOND-GUESS",
    many: "CARRY FILTER PARAMETERS THIS TOOL WILL NOT SECOND-GUESS",
  },
  "decode-array": {
    one: "CARRIES A CUSTOM DECODE ARRAY NO IMAGE FILE CAN HOLD",
    many: "CARRY A CUSTOM DECODE ARRAY NO IMAGE FILE CAN HOLD",
  },
  "colour-space": {
    one: "IS IN A COLOUR SPACE THIS TOOL WILL NOT GUESS AT",
    many: "ARE IN COLOUR SPACES THIS TOOL WILL NOT GUESS AT",
  },
  "bit-depth": {
    one: "IS NOT 8 BITS PER CHANNEL",
    many: "ARE NOT 8 BITS PER CHANNEL",
  },
  undecodable: {
    one: "DID NOT HOLD THE IMAGE ITS DICTIONARY DESCRIBES",
    many: "DID NOT HOLD THE IMAGES THEIR DICTIONARIES DESCRIBE",
  },
  /*
    The only row that is about THIS TOOL rather than about the document, and
    it is worded as such. Everything above says "your file does X"; saying
    that here — it used to share `undecodable`'s "DID NOT HOLD THE IMAGE ITS
    DICTIONARY DESCRIBES" — accused an intact large-format scan of being
    corrupt. The detail beside it is the picture's own dimensions.
  */
  "too-large": {
    one: "IS TOO BIG FOR THIS TOOL TO REBUILD IN THE TAB — THE FILE IS FINE",
    many: "ARE TOO BIG FOR THIS TOOL TO REBUILD IN THE TAB — THE FILE IS FINE",
  },
};

function skipPhrase(skip: PdfExtractSkip): string {
  const phrase = skip.count === 1 ? SKIP_PHRASES[skip.reason].one : SKIP_PHRASES[skip.reason].many;
  // `detail` is what the classifier actually found — the filter name, the
  // colour space — so it is printed verbatim rather than paraphrased away.
  return skip.detail
    ? `${skip.count} ${phrase} (${skip.detail.toUpperCase()})`
    : `${skip.count} ${phrase}`;
}

/**
 * The mandatory disclosure, built as ONE string so the sentence a user reads
 * is the sentence the tests assert — JSX interpolation would let whitespace
 * drift between the two.
 *
 * "IMAGE OBJECTS" rather than "images": the engine walks image XObjects, which
 * is every raster picture a normal producer emits but is NOT the tiny inline
 * images some tools write straight into a page's content stream. Claiming the
 * document contains no images at all would be a claim one level stronger than
 * the code can make.
 */
function disclosureText(result: PdfExtractImagesResult): string {
  if (result.imagesFound === 0) {
    return "THIS PDF STORES NO IMAGES AT ALL — THERE IS NOTHING IN IT FOR THIS TOOL TO LIFT OUT";
  }
  const skippedTotal = result.skipped.reduce((sum, s) => sum + s.count, 0);
  if (skippedTotal === 0) {
    return result.imagesFound === 1
      ? "THE ONE IMAGE IN THIS PDF CAME OUT — NOTHING WAS LEFT BEHIND"
      : `ALL ${result.imagesFound} IMAGES CAME OUT — NOTHING WAS LEFT BEHIND`;
  }
  const noun = result.imagesFound === 1 ? "IMAGE WAS" : "IMAGES WERE";
  return `${skippedTotal} OF ${result.imagesFound} ${noun} LEFT IN THE DOCUMENT — ${result.skipped
    .map(skipPhrase)
    .join(", ")}`;
}

/** `report.pdf` → `report-images.zip`. */
function zipName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, "")}-images.zip`;
}

export function ExtractPdfImagesUI() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PdfExtractImagesResult | null>(null);
  const [minSide, setMinSide] = useState(0);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Timed for real; cleared the moment the file changes.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    A run is async and nothing cancels it, so a user who drops a second PDF
    while a 200 MB one is still parsing would otherwise get the FIRST
    document's images bound to the second document's name. Every run stamps
    this token and commits nothing unless it still matches. A ref, not state,
    because the check has to see the value at the moment the promise settles
    rather than the one captured when the callback was created — the same
    fence `RecompressPdfImagesUI` documents at length.
  */
  const runToken = useRef(0);

  const run = useCallback(async (f: File) => {
    runToken.current += 1;
    const token = runToken.current;
    setStatus("processing");
    setResult(null);
    setError(null);
    setElapsed(null);
    setPercent(null);
    const startedAt = performance.now();
    try {
      // Dynamic, so pdf-lib is fetched when a PDF is actually dropped rather
      // than sitting in this page's first paint.
      const { extractPdfImages } = await import("@/lib/tools/pdf-extract-images");
      const out = await extractPdfImages(await f.arrayBuffer(), (value) => {
        if (runToken.current === token) setPercent(value);
      });
      if (runToken.current !== token) return;
      setResult(out);
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Could not read the images out of this PDF");
      setStatus("error");
    }
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      // There is nothing to configure before extracting — the size filter acts
      // on what came out — so the run starts on the drop.
      void run(f);
    },
    [run],
  );

  const handleReset = useCallback(() => {
    runToken.current += 1;
    setFile(null);
    setResult(null);
    setError(null);
    setElapsed(null);
    setPercent(null);
    setStatus("idle");
  }, []);

  /*
    The filter is a VIEW, not a second extraction: everything the engine found
    is already in memory, so hiding the small images costs nothing and can be
    undone instantly. It governs the canvas and the download together — a grid
    showing sixty icons under a button that saves four would be two different
    answers on one screen.
  */
  const visible = useMemo(
    () =>
      (result?.images ?? []).filter((img) => Math.max(img.width, img.height) >= minSide),
    [result, minSide],
  );
  const hiddenBySize = (result?.images.length ?? 0) - visible.length;

  const files = useMemo(
    () =>
      visible.map((img) => ({
        image: img,
        name: img.name,
        blob: new Blob([img.bytes as BlobPart], { type: MIME[img.format] }),
      })),
    [visible],
  );

  const previewed = useMemo(() => files.slice(0, PREVIEW_LIMIT), [files]);

  /*
    One Object URL per painted preview, allocated inside the effect and revoked
    when the list changes or the component unmounts — the discipline
    `useObjectUrl` documents, spread over a list it cannot serve. The revoke is
    deferred for that hook's reason too: revoking synchronously aborts an <img>
    that is still LOADING the URL when the list swaps under it.
  */
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    // Allocated inside the effect (not during render) so StrictMode's
    // double-invocation cannot leak an intermediate set; the state write
    // reflects that allocation rather than causing it.
    const made = previewed.map((f) => URL.createObjectURL(f.blob));
    setUrls(made);
    return () => {
      setTimeout(() => {
        for (const url of made) URL.revokeObjectURL(url);
      }, 1000);
    };
  }, [previewed]);

  const downloadAll = useCallback(() => {
    if (!file) return;
    // One ZIP rather than N synchronous downloads — browsers throttle those
    // and only the first would save.
    void downloadFilesAsZip(files, zipName(file.name));
  }, [files, file]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const extractedBytes = visible.reduce((sum, img) => sum + img.bytes.length, 0);
  /*
    What the save actually is. `downloadFilesAsZip` hands over the bare file
    when the list has length 1 rather than zipping a single member — so a
    one-image run saves `image-01.jpg`, NOT a ZIP, and the readout has to say
    that or the copy is a promise the download breaks. (Same trap
    `ExtractPdfPagesUI` documents.)
  */
  const outputName =
    files.length === 0 ? "—" : files.length === 1 ? files[0].name : zipName(file.name);

  return (
    <>
      {/* ── Canvas: the images the document was carrying ─────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={
            result
              ? `${visible.length} IMAGE${visible.length === 1 ? "" : "S"}`
              : status === "processing"
                ? "READING"
                : undefined
          }
        />

        {visible.length > 0 && (
          <PageDeck>
            {previewed.map((f, i) => (
              <figure key={f.name} className="m-0 flex flex-col gap-1.5">
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[5px] border border-neutral-800 bg-[linear-gradient(170deg,#f3f5fe_0%,#dfe3f0_100%)]">
                  {urls[i] && (
                    // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, and next/image cannot optimise one under output: "export"
                    <img
                      src={urls[i]}
                      alt=""
                      className="size-full object-contain"
                      // The extracted file is what it is; nothing here knows
                      // what it depicts, so the caption below carries the
                      // name, the stored size and the format instead of a
                      // guessed alt text.
                    />
                  )}
                  <span className="absolute right-1 bottom-1 rounded-sm bg-[rgba(22,24,38,.82)] px-1 py-0.5 font-mono text-[9px] leading-none font-medium text-neutral-300">
                    {FORMAT_BADGE[f.image.format]}
                  </span>
                </div>
                <figcaption className="flex flex-col gap-1">
                  <span className="truncate font-mono text-[9.5px] leading-none text-text-muted">
                    {f.name}
                  </span>
                  <span className="font-mono text-[9.5px] leading-none text-accent-300">
                    {f.image.width} × {f.image.height} · {formatFileSize(f.blob.size)}
                  </span>
                </figcaption>
              </figure>
            ))}
          </PageDeck>
        )}

        {files.length > PREVIEW_LIMIT && (
          <CanvasFootnote>
            SHOWING THE FIRST {PREVIEW_LIMIT} OF {files.length} IMAGES — THE DOWNLOAD CARRIES ALL
            OF THEM
          </CanvasFootnote>
        )}

        {error && <ErrorMessage message={error} />}

        {/*
          The disclosure is the headline readout of this tool, not a footnote of
          apology: it is the only thing on the page that says whether the count
          above describes the whole document or a part of it.
        */}
        {result && <CanvasFootnote>{disclosureText(result)}</CanvasFootnote>}

        {/*
          The filter is the user's own choice, so it is stated separately from
          the engine's skips — folding the two together would blame the
          document for something this page did.

          Only while something is still SHOWN: "2 more images are smaller than
          64 px" over an empty grid means nothing, and the all-hidden case has
          its own sentence in the warning below, which would then say the same
          thing twice.
        */}
        {hiddenBySize > 0 && visible.length > 0 && (
          <CanvasFootnote>
            {hiddenBySize} MORE {hiddenBySize === 1 ? "IMAGE IS" : "IMAGES ARE"} SMALLER THAN{" "}
            {minSide} PX AND {hiddenBySize === 1 ? "IS" : "ARE"} HIDDEN BY THE SIZE FILTER —
            CHOOSE ALL TO INCLUDE {hiddenBySize === 1 ? "IT" : "THEM"}
          </CanvasFootnote>
        )}

        {/*
          Nothing came out. The two causes are different facts and the fix is
          different for each, so they get different sentences — and both point
          at the tool that DOES render pages, because "extract the images" and
          "turn the pages into pictures" are the two things a person arriving
          here might have meant.
        */}
        {result && visible.length === 0 && (
          <>
            <WarningMessage
              message={
                result.imagesFound === 0
                  ? "No images came out of this PDF, because it does not store any — most often that means its pages are text and vector artwork. This tool lifts out pictures the file already contains; it does not photograph the page."
                  : hiddenBySize > 0
                    ? /*
                        Counted from what the FILTER hid, not from what the
                        document held: images the engine skipped for their own
                        reasons are not small, they are unextractable, and the
                        disclosure above already accounts for them. Saying
                        "all 9 images are smaller than 256 px" over a document
                        whose other seven were CMYK would be false about seven
                        of them.
                      */
                      hiddenBySize === 1
                      ? `The one image that came out is smaller than ${minSide} px, so the size filter is hiding it. Choose All to see it.`
                      : `All ${hiddenBySize} images that came out are smaller than ${minSide} px, so the size filter is hiding them. Choose All to see them.`
                    : /*
                        The trailing clause is a claim about the DOCUMENT, so
                        it may only be made when every skip was one. A picture
                        this tool declined for its own memory ceiling is one a
                        PNG represents perfectly, and telling that user
                        otherwise sends them off to repair a file that is not
                        damaged.
                      */
                      result.skipped.some((s) => s.reason === "too-large")
                      ? `None of this PDF's ${result.imagesFound} image${result.imagesFound === 1 ? "" : "s"} could be written out as a standalone file. The line above says exactly why for each one.`
                      : `None of this PDF's ${result.imagesFound} image${result.imagesFound === 1 ? "" : "s"} could be written out as a standalone file. The line above says exactly why for each one — every case is a picture that a JPEG or a PNG on its own could not represent the way the page does.`
              }
            />
            <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
              To get pictures of the pages themselves — text, artwork, layout and all — use{" "}
              <Link href="/pdf-to-jpg" className="text-accent underline hover:text-accent-hover">
                PDF to JPG
              </Link>
              , which renders each page instead of reading inside it.
            </p>
          </>
        )}

        {/*
          The standing claim, on screen before and after a run: what comes out
          is the stored image, at its stored size. A user who expected a page
          render has to meet this sentence before they meet the download.
        */}
        <CanvasFootnote>
          IMAGES COME OUT AT THE RESOLUTION THEY ARE STORED AT, WHICH IS OFTEN SMALLER THAN THEY
          LOOK ON THE PAGE — THIS IS NOT A SCREENSHOT OF THE PAGE
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase="READING IMAGES"
                percent={percent}
                label="Extracting images from the PDF"
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {files.length === 1 ? (
              // One file: hand it over directly. Routing it through
              // `downloadFilesAsZip` would save it bare anyway, under a button
              // that had promised a ZIP.
              <DownloadButton
                blob={files[0].blob}
                fileName={files[0].name}
                className="w-full justify-center"
              />
            ) : files.length > 1 ? (
              <ToolActions
                primaryLabel={`Download ${files.length} images (ZIP)`}
                onPrimary={downloadAll}
              />
            ) : (
              // Nothing to download, and a retry would produce the same empty
              // result — so no action is offered except on a real failure.
              status === "error" && (
                <ToolActions primaryLabel="Try again" onPrimary={() => void run(file)} />
              )
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Images in the PDF", result ? String(result.imagesFound) : "—"],
              ["Extracted", result ? String(result.images.length) : "—"],
              ["Files out", result ? `${files.length} file${files.length === 1 ? "" : "s"}` : "—"],
              ["Total size", result ? formatFileSize(extractedBytes) : "—"],
              ["Download", outputName],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="MINIMUM SIZE">
          <ToolChoice
            label="Minimum image size"
            fill
            value={minSide}
            onChange={setMinSide}
            options={MIN_SIDE_OPTIONS}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {minSide === 0
              ? "Every image that came out, icons, rules and bullets included. Most PDFs hold a few of those alongside the pictures you came for."
              : `Only images at least ${minSide} px on their longest side. Nothing is deleted — the smaller ones are still in the PDF, and the canvas says how many are hidden.`}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THIS DOES">
          {/*
            The honesty block. Every sentence here is a claim the engine keeps:
            the verbatim lift, the PNG rebuild, the skip list and the inline-
            image gap are all things pdf-extract-images.ts actually implements.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            This lifts out the pictures the document already contains. A JPEG inside a PDF is
            copied out <strong>byte for byte</strong> — not decoded and re-saved — so the file you
            get is the file the PDF was carrying, with no second round of compression and no
            colour shift.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A picture stored as raw pixels rather than as a JPEG has no image file to copy, so
            that one is rebuilt as a PNG around exactly the same pixel values — lossless either
            way.
          </span>
          {/*
            The other side of the byte-for-byte guarantee, and the one worth
            warning about: verified on this repo's own sample-photo-doc.pdf,
            where the extracted JPEG comes out still carrying the source
            photo's full Exif block — camera make and model, timestamp and GPS
            tags included. A re-encode would have destroyed all of it; this
            tool cannot, and the user should know before they send the file on.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Because nothing is re-encoded, an extracted JPEG also keeps whatever metadata the
            original photo carried — camera model, timestamp and any GPS coordinates come with
            it. Strip that with{" "}
            <Link href="/exif-viewer" className="text-accent underline hover:text-accent-hover">
              EXIF Viewer
            </Link>{" "}
            before sharing if it matters.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Each picture comes out once, however many pages it appears on, and at the resolution
            it is stored at — which for an image scaled down on the page is smaller than it looks.
            You get the image alone: no page text, no vector artwork, no layout. Pictures the file
            still holds but no page uses any more come out too.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Some images are left in the document, and the canvas says how many and why. Left out
            by design: anything that is neither a JPEG nor a raw pixel bitmap (JPEG 2000, fax and
            JBIG2 scans), anything carrying a transparency mask, a custom decode array, filter
            parameters this tool does not apply, a colour space other than RGB or greyscale, or
            more than 8 bits per channel. Very small images written directly into a
            page&rsquo;s content stream are not read either.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Want pictures of the pages instead?{" "}
            <Link href="/pdf-to-jpg" className="text-accent underline hover:text-accent-hover">
              PDF to JPG
            </Link>{" "}
            renders each page as an image; this tool reads inside the file and never renders
            anything.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing is removed from your PDF — the original file on your machine is untouched.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
