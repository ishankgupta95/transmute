import { Fragment } from "react";
import { cn } from "@/lib/utils/cn";

const FROMS = ["JPG", "PNG", "HEIC", "WEBP", "PDF", "MP4", "WAV", "JSON"] as const;
const TOS = ["JPG", "PNG", "WEBP", "PDF", "GIF", "MP3", "WAV", "CSV"] as const;

/** Which targets each source actually has a tool for. */
const ROUTES: Record<string, readonly string[]> = {
  JPG: ["PNG", "WEBP", "PDF", "JPG"],
  PNG: ["JPG", "WEBP", "PDF", "PNG"],
  HEIC: ["JPG", "PNG"],
  WEBP: ["JPG", "PNG", "PDF"],
  PDF: ["JPG", "PDF"],
  MP4: ["GIF", "MP3"],
  WAV: ["MP3", "WAV"],
  JSON: ["CSV"],
};

const HEAD =
  "flex aspect-square items-center justify-center font-mono text-[10px] leading-none font-medium tracking-[0.02em] text-neutral-400";

export function ConversionMatrix() {
  return (
    <div
      className="grid grid-cols-9 gap-[5px]"
      role="table"
      aria-label="Which formats convert to which"
    >
      <span className={HEAD} aria-hidden="true" />
      {TOS.map((t) => (
        <span key={`head-${t}`} className={HEAD}>
          {t}
        </span>
      ))}

      {FROMS.map((f) => (
        <Fragment key={f}>
          <span className={cn(HEAD, "justify-end pr-1")}>{f}</span>
          {TOS.map((t) => {
            const on = ROUTES[f]?.includes(t) ?? false;
            const same = f === t;
            return (
              <span
                key={`${f}-${t}`}
                title={
                  on
                    ? same
                      ? `${f} — optimises in place`
                      : `${f} → ${t}`
                    : undefined
                }
                aria-label={on ? `${f} to ${t}` : undefined}
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
        </Fragment>
      ))}
    </div>
  );
}
