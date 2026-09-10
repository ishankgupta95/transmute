"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DropZoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  /** Visible heading + aria label describing what the user should drop. */
  label?: string;
  /**
   * Hard input cap the tool enforces (mirror of `Tool.maxSizeMB`). Absent
   * renders "NO SIZE CAP" — only pass it where a limit is actually enforced.
   */
  sizeCapMB?: number;
  /**
   * One sentence saying WHY this tool has a cap, appended to the rejection
   * message. A bare number tells the user nothing they can act on.
   */
  sizeCapReason?: string;
  /**
   * Mirror of `Tool.practicalLimitNote`: the ceiling this tool has but does
   * not enforce. Nothing is checked against it — it only replaces the
   * "NO SIZE CAP" line, which a tool that holds the whole file in memory and
   * then expands it has no business printing. Ignored when `sizeCapMB` is set,
   * because a real cap is the more useful answer.
   */
  practicalLimitNote?: string;
  /**
   * The same ACCEPTS string the pipeline strip and the spec panel show
   * (`getWorkspaceTool(slug).accept`) — alias-collapsed and space-joined.
   * Without it the zone derives a list from the `accept` attribute.
   */
  acceptLabel?: string;
  /**
   * True while the owning tool is mid-run: drops, clicks and ⌘O are ignored
   * so a second file can't land in a job that's already processing.
   */
  disabled?: boolean;
}

/** Lenient accept matcher — only rejects files we're confident don't match. */
function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const tokens = accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length || tokens.includes("*/*")) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  for (const t of tokens) {
    if (t.startsWith(".") && name.endsWith(t)) return true;
    if (t.endsWith("/*") && type && type.startsWith(t.slice(0, -1))) return true;
    if (t.includes("/") && !t.endsWith("/*") && type === t) return true;
  }
  // If the OS didn't report a MIME type, don't hard-block (extension already failed to match).
  return !type;
}

/** "PNG, JPG" from the accept attribute, for the hint line and error copy. */
function acceptList(accept?: string): string {
  if (!accept) return "";
  const tokens = accept
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.some((t) => t === "*/*")) return "";
  const parts: string[] = [];
  for (const t of tokens) {
    if (t.startsWith(".")) parts.push(t.slice(1).toUpperCase());
    else if (t.endsWith("/*")) parts.push(`${t.split("/")[0]}s`);
    else if (t.includes("/")) parts.push(t.split("/")[1].toUpperCase());
  }
  const uniq = [...new Set(parts)];
  return uniq.join(", ");
}

/**
 * The ACCEPTS line, matched to what the pipeline strip already prints: alias
 * pairs collapsed (`jpeg`→`jpg`, `heif`→`heic`) and space-joined, so the zone
 * stops saying "JPG, JPEG" about one format.
 */
function acceptSummary(accept?: string): string {
  const list = acceptList(accept);
  if (!list) return "";
  const collapsed = list
    .split(", ")
    .map((t) => (t === "JPEG" ? "JPG" : t === "HEIF" ? "HEIC" : t));
  return [...new Set(collapsed)].join(" ");
}

/** "1.5 GB" past a gigabyte — a cap printed as "1536 MB" is unreadable. */
function formatCap(mb: number): string {
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(2).replace(/\.?0+$/, "")} GB`;
}

/** The same scale for the file the user actually picked. */
function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * The doc's marching-ants empty-state rule: a 1px, 9-on/9-off dash drawn as
 * four background layers rather than a 2px browser `dashed` border.
 *
 * `animate-tm-march` needs `--animate-tm-march` + its `@keyframes` in
 * `globals.css`'s `@theme` block (that file is another scope this pass); until
 * it lands the class is simply not generated and the rule renders static,
 * which is the correct fallback either way.
 *
 * The dash is `--color-neutral-600`, not `-700`. This rule is the ONLY visible
 * edge of the drop target — the plate's own border is `border-transparent`
 * until hover/focus — so WCAG 1.4.11 applies to it as a user-interface
 * component boundary. `#595d6c` (neutral-700) measures 2.83:1 against
 * `--color-nocturne-canvas` and fails; `#75798c` (neutral-600) measures 4.3:1.
 */
const MARCHING_RULE = cn(
  "bg-[image:repeating-linear-gradient(90deg,var(--color-neutral-600)_0_9px,transparent_9px_18px),repeating-linear-gradient(90deg,var(--color-neutral-600)_0_9px,transparent_9px_18px),repeating-linear-gradient(0deg,var(--color-neutral-600)_0_9px,transparent_9px_18px),repeating-linear-gradient(0deg,var(--color-neutral-600)_0_9px,transparent_9px_18px)]",
  "bg-[length:200%_1px,200%_1px,1px_200%,1px_200%]",
  "bg-[position:0_0,0_100%,0_0,100%_0] bg-no-repeat",
  "animate-tm-march motion-reduce:animate-none",
);

/**
 * ⌘O / Ctrl+O opens the file picker (the tool-page docs advertise it). With
 * more than one zone mounted, only the most recently mounted one answers.
 */
const openTargets: HTMLInputElement[] = [];

export function DropZone({
  accept,
  multiple = false,
  onFiles,
  className,
  label = "Drop a file to begin",
  sizeCapMB,
  sizeCapReason,
  practicalLimitNote,
  acceptLabel,
  disabled = false,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /*
    The accepted formats and the size cap are the two facts a user needs
    BEFORE the OS picker opens, and the input's name was only ever the plate's
    heading ("Drop a file to begin"), so a screen-reader user reached the
    picker knowing neither. They are wired as a description rather than folded
    into the name because they are supporting detail, not the control's name.
    Derived from `useId()` because several zones can mount on one page.
  */
  const ids = useId();
  const metaId = `${ids}meta`;
  const noteId = `${ids}note`;
  /*
    dragenter/dragleave fire again for every CHILD the cursor crosses, so a
    plain boolean flickered the highlight while dragging over the icon and
    copy. Counting enters/leaves only clears when the pointer truly exits.
  */
  const dragDepth = useRef(0);

  const formats = acceptList(accept);
  const metaFormats = acceptLabel ?? acceptSummary(accept);

  const emit = useCallback(
    (selected: File[]) => {
      if (selected.length === 0) return;
      const accepted = selected.filter((f) => matchesAccept(f, accept));
      if (accepted.length === 0) {
        setError(formats ? `Unsupported file type. Accepts ${formats}.` : "Unsupported file type.");
        return;
      }
      /*
        The cap was display-only: an over-cap file was accepted, previewed and
        decoded, and only rejected once the user pressed Run. Enforce it where
        it is advertised. The engine-level check (`validateFFmpegInput` in
        lib/tools/ffmpeg-loader.ts) stays as defence in depth for callers that
        bypass this zone.
      */
      const capBytes = sizeCapMB ? sizeCapMB * 1024 * 1024 : Infinity;
      const sized = accepted.filter((f) => f.size <= capBytes);
      if (sized.length === 0) {
        const cap = sizeCapMB ? formatCap(sizeCapMB) : "";
        const why = sizeCapReason ? ` ${sizeCapReason}` : "";
        setError(
          accepted.length === 1
            ? `File is too large (${formatBytes(accepted[0].size)}). Maximum is ${cap}.${why}`
            : `Every file is over the ${cap} maximum.${why}`,
        );
        return;
      }
      setError(
        sized.length < selected.length
          ? "Some files were skipped (unsupported type or over the size cap)."
          : null,
      );
      onFiles(multiple ? sized : [sized[0]]);
    },
    [accept, formats, multiple, onFiles, sizeCapMB, sizeCapReason],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!disabled) emit(Array.from(e.dataTransfer.files));
    },
    [emit, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      emit(Array.from(e.target.files ?? []));
      // Allow re-uploading the same file by clearing the input value.
      e.target.value = "";
    },
    [emit],
  );

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    openTargets.push(input);
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "o" &&
        openTargets[openTargets.length - 1] === input
      ) {
        e.preventDefault();
        if (!input.disabled) input.click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const i = openTargets.indexOf(input);
      if (i !== -1) openTargets.splice(i, 1);
    };
  }, []);

  return (
    <label
      aria-disabled={disabled || undefined}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
      className={cn(
        // The empty state IS the canvas until a file lands, so it fills the
        // plate rather than floating as a 262px card in a viewport-tall band;
        // the doc's `max-width:600px` makes it a plate inside that height
        // rather than a band-wide rectangle.
        "group relative mx-auto flex w-full max-w-[600px] min-h-[min(52vh,460px)] flex-col items-center justify-center gap-[22px] rounded-lg border px-10 py-14 cursor-pointer transition-all duration-300 motion-reduce:transition-none focus-within:border-accent focus-within:bg-none focus-within:bg-accent-muted",
        dragging
          ? "border-accent bg-accent-muted"
          : cn(
              MARCHING_RULE,
              "border-transparent hover:border-accent/40 hover:bg-none hover:bg-text-primary/3",
            ),
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-[12px] border p-3.5 transition-all duration-300 motion-reduce:transition-none",
          dragging
            ? "border-accent bg-accent-muted text-accent scale-110 motion-reduce:scale-100"
            : "border-accent/40 bg-accent/10 text-accent group-hover:bg-accent-muted",
        )}
        aria-hidden="true"
      >
        <Upload size={24} />
      </div>

      <div className="flex flex-col gap-[7px] text-center">
        <span className="block font-display text-[19px] leading-[1.25] font-medium text-text-primary">
          {label}
        </span>
        <span className="mx-auto block max-w-[380px] font-body text-[12.5px] leading-[1.5] text-text-muted">
          Nothing uploads. The engine runs in this tab, on this machine.
        </span>
      </div>

      <span className="inline-flex h-[34px] items-center rounded-md border border-accent px-[18px] font-display text-[13px] leading-none font-medium text-accent transition-colors duration-200 group-hover:bg-accent/12">
        Choose file
      </span>

      <span
        id={metaId}
        className="text-center font-mono text-[10px] leading-none tracking-[0.05em] text-text-muted"
      >
        {metaFormats && (
          <>
            ACCEPTS {metaFormats}
            <span aria-hidden="true" className="px-2 opacity-40">
              ·
            </span>
          </>
        )}
        {multiple && (
          <>
            BATCH OK
            <span aria-hidden="true" className="px-2 opacity-40">
              ·
            </span>
          </>
        )}
        {/*
          Three states, not two. "NO SIZE CAP" is an absolute claim and stays
          reserved for the tools it is true of (mp4-to-mp3 mounts its input and
          never copies it — ffmpeg-loader.ts:54-58). A tool that enforces a cap
          prints the cap; one that merely HAS a ceiling says so and explains it
          below, rather than claiming the ceiling isn't there.
        */}
        {sizeCapMB
          ? `MAX ${formatCap(sizeCapMB)}`
          : practicalLimitNote
            ? "MEMORY-BOUND"
            : "NO SIZE CAP"}
      </span>

      {!sizeCapMB && practicalLimitNote && (
        <span
          id={noteId}
          className="mx-auto block max-w-[420px] text-center font-body text-[11.5px] leading-[1.5] text-text-muted"
        >
          {practicalLimitNote}
        </span>
      )}

      {error && (
        <span role="alert" className="max-w-[420px] text-center text-xs leading-[1.5] text-error">
          {error}
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
        aria-label={label}
        aria-describedby={
          !sizeCapMB && practicalLimitNote ? `${metaId} ${noteId}` : metaId
        }
        className="sr-only"
      />
    </label>
  );
}
