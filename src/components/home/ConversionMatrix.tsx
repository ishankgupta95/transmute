import { cn } from "@/lib/utils/cn";

const FROMS = ["JPG", "PNG", "HEIC", "WEBP", "PDF", "MP4", "WAV", "JSON"] as const;
const TOS = ["JPG", "PNG", "WEBP", "PDF", "GIF", "MP3", "WAV", "CSV"] as const;

/**
 * Which targets each source actually has a tool for.
 *
 * The section's own legend promises "a filled cell is a tool that already
 * exists", so every entry here must correspond to a slug in `data/tools.ts`.
 * HEIC has exactly one — `heic-to-jpg` — so it lists one target; a HEIC→PNG
 * cell was claiming a tool that does not exist.
 */
const ROUTES: Record<string, readonly string[]> = {
  JPG: ["PNG", "WEBP", "PDF", "JPG"],
  PNG: ["JPG", "WEBP", "PDF", "PNG"],
  HEIC: ["JPG"],
  WEBP: ["JPG", "PNG", "PDF"],
  PDF: ["JPG", "PDF"],
  MP4: ["GIF", "MP3"],
  WAV: ["MP3", "WAV"],
  JSON: ["CSV"],
};

const HEAD =
  "flex aspect-square items-center justify-center font-mono text-[10px] leading-none font-medium tracking-[0.02em] text-neutral-400";

/**
 * The grid declares `role="table"`, so it has to supply the row/cell levels an
 * ARIA table requires — bare spans under it made axe flag the whole section as
 * a broken table and threw away all 64 cell labels. `display: contents` adds
 * the row wrappers without disturbing the CSS grid.
 */
export function ConversionMatrix() {
  return (
    <div
      className="grid grid-cols-9 gap-[5px]"
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
