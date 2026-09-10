import { cn } from "@/lib/utils/cn";

const FROMS = [
  "JPG",
  "PNG",
  "HEIC",
  "WEBP",
  "PDF",
  "MP4",
  "MOV",
  "MKV",
  "AVI",
  "WAV",
  "JSON",
] as const;
const TOS = ["JPG", "PNG", "WEBP", "PDF", "GIF", "MP4", "MP3", "WAV", "CSV"] as const;

/**
 * Which targets each source actually has a tool for.
 *
 * The section's own legend promises "a filled cell is a tool that already
 * exists", and every empty cell says so out loud — its aria-label ends
 * "— no tool". Both halves are claims, so both are pinned by
 * `src/__tests__/unit/components/ConversionMatrix.test.tsx`, which names the
 * proving slug for every filled cell and fails if the set drifts either way.
 *
 * The MOV / MKV / AVI rows and the MP4 column arrived with the six container
 * tools (`mov-to-mp4`, `mkv-to-mp4`, `avi-to-mp4`, `video-to-mp4`,
 * `mp4-to-mov`, `mp4-to-mkv`); without the column those three rows would have
 * been all-empty, i.e. three rows of "no tool" for formats the site converts.
 *
 * The four video → WAV cells were the next instance of the same drift, and
 * they went stale in the silent direction: the WAV column already existed for
 * the audio rows, `video-to-wav` accepts .mp4/.webm/.mov/.avi/.mkv and
 * `mp4-to-wav` accepts .mp4/.m4v/.mov, and every one of those four rows was
 * still telling a screen reader "MP4 to WAV — no tool". A lecture recording in
 * an MKV, needing uncompressed audio for transcription, is the exact user the
 * grid sent away. The test now walks the EMPTY cells back against the registry
 * too, which is the direction nothing checked.
 *
 * The six MP4/MOV -> JPG/PNG/WEBP cells are the third instance, and the empty-cell
 * walk is what caught them: `video-to-images` and `video-thumbnail` both write
 * JPEG, PNG and WebP, so those rows were telling a screen reader "MP4 to JPG -
 * no tool" the moment those two pages landed. Nothing had to go stale for a week
 * first; the gate failed in the same run that added them. The MKV and AVI halves
 * of that block came back out again when both tools' accept lists were narrowed
 * to what the browser's own <video> can actually demux — see the note below.
 *
 * HEIC→WEBP is the fourth instance and, like the third, never had time to go
 * stale: `heic-to-webp` shipped with the Wave 4 image cluster and the
 * empty-cell walk was red until the HEIC row below gained WEBP, in the same
 * run. It is the only one of that batch's nineteen slugs that moves a cell —
 * the edit verbs write PNG/JPG/WebP out of sources whose cells were already
 * filled, and ICO, SVG, TIFF, AVIF and BMP have no row here to move.
 *
 * Deliberately still empty:
 *  - HEIC→PNG: five tools read .heic (`heic-to-jpg`, `heic-to-webp`,
 *    `heic-to-pdf`, `images-to-pdf`, `exif-viewer`) and not one of them writes
 *    a PNG. The WEBP cell beside it is filled by one of those five, so an
 *    empty PNG cell next to a filled WEBP one is the accurate reading rather
 *    than a row somebody stopped halfway through.
 *  - MKV→GIF, AVI→GIF and MKV/AVI→JPG/PNG/WEBP: every tool behind those cells
 *    (`video-to-gif`, `video-to-images`, `video-thumbnail`) decodes through the
 *    browser's own <video> element rather than FFmpeg, and all three therefore
 *    accept .mp4/.webm/.mov only. AVI is the hard case — measured, no engine
 *    has a demuxer for it — and MKV rides with it so the three tools that share
 *    one walk share one accept list. /avi-to-mp4 and /mkv-to-mp4 are the routes in.
 *  - JSON→JSON: `json-formatter` does round-trip JSON, but the diagonal's
 *    legend on the homepage reads "the format stays put and only the file gets
 *    smaller", and its default mode is `"format"` (`JsonFormatterUI.tsx:50`),
 *    which pretty-prints and makes the file BIGGER. Minify is the second tab.
 *    Filling the cell would trade a missing cell for a false one.
 */
const ROUTES: Record<string, readonly string[]> = {
  JPG: ["PNG", "WEBP", "PDF", "JPG"],
  PNG: ["JPG", "WEBP", "PDF", "PNG"],
  HEIC: ["JPG", "PDF", "WEBP"],
  WEBP: ["JPG", "PNG", "PDF", "WEBP"],
  PDF: ["JPG", "PNG", "WEBP", "PDF"],
  MP4: ["JPG", "PNG", "WEBP", "GIF", "MP4", "MP3", "WAV"],
  MOV: ["JPG", "PNG", "WEBP", "GIF", "MP4", "MP3", "WAV"],
  MKV: ["MP4", "MP3", "WAV"],
  AVI: ["MP4", "MP3", "WAV"],
  WAV: ["MP3", "WAV"],
  JSON: ["CSV"],
};

const HEAD =
  "flex aspect-square items-center justify-center font-mono text-[10px] leading-none font-medium tracking-[0.02em] text-neutral-400";

/**
 * The grid declares `role="table"`, so it has to supply the row/cell levels an
 * ARIA table requires — bare spans under it made axe flag the whole section as
 * a broken table and threw away every cell label. `display: contents` adds
 * the row wrappers without disturbing the CSS grid.
 */
export function ConversionMatrix() {
  return (
    <div
      className="grid grid-cols-10 gap-[5px]"
      role="table"
      aria-label="Which formats convert to which"
    >
      <div role="row" className="contents">
        <span className={HEAD} aria-hidden="true" />
        {TOS.map((t) => (
          <span key={`head-${t}`} role="columnheader" className={HEAD}>
            {t}
          </span>
        ))}
      </div>

      {FROMS.map((f) => (
        <div key={f} role="row" className="contents">
          <span role="rowheader" className={cn(HEAD, "justify-end pr-1")}>
            {f}
          </span>
          {TOS.map((t) => {
            const on = ROUTES[f]?.includes(t) ?? false;
            const same = f === t;
            return (
              <span
                key={`${f}-${t}`}
                role="cell"
                title={
                  on
                    ? same
                      ? `${f} — optimises in place`
                      : `${f} → ${t}`
                    : undefined
                }
                // Unconditional: the state is carried by colour alone, so an
                // empty cell has to say it is empty rather than say nothing.
                aria-label={
                  on
                    ? same
                      ? `${f} optimises in place`
                      : `${f} to ${t}`
                    : `${f} to ${t} — no tool`
                }
                className={cn(
                  "aspect-square rounded-sm",
                  same && on && "border-[1.5px] border-accent bg-accent/10",
                  !same &&
                    on &&
                    "bg-accent shadow-[0_0_12px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]",
                  !on && "border border-neutral-800",
                )}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
