"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  disabled = false,
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /*
    dragenter/dragleave fire again for every CHILD the cursor crosses, so a
    plain boolean flickered the highlight while dragging over the icon and
    copy. Counting enters/leaves only clears when the pointer truly exits.
  */
  const dragDepth = useRef(0);

  const formats = acceptList(accept);

  const emit = useCallback(
    (selected: File[]) => {
      if (selected.length === 0) return;
      const accepted = selected.filter((f) => matchesAccept(f, accept));
      if (accepted.length === 0) {
        setError(formats ? `Unsupported file type. Accepts ${formats}.` : "Unsupported file type.");
        return;
      }
      setError(
        accepted.length < selected.length ? "Some files were skipped (unsupported type)." : null,
      );
      onFiles(multiple ? accepted : [accepted[0]]);
    },
    [accept, formats, multiple, onFiles],
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
        "group relative flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-10 cursor-pointer transition-all duration-300 motion-reduce:transition-none focus-within:border-accent focus-within:bg-accent-muted",
        dragging
          ? "border-accent bg-accent-muted"
          : "border-border hover:border-accent/40 hover:bg-text-primary/3",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-md p-3 transition-all duration-300 motion-reduce:transition-none",
          dragging
            ? "bg-accent-muted text-accent scale-110 motion-reduce:scale-100"
            : "bg-bg-elevated text-text-muted group-hover:text-accent group-hover:bg-accent-muted",
        )}
        aria-hidden="true"
      >
        <Upload size={28} />
      </div>
      <div className="text-center space-y-2">
        <span className="block font-display text-base font-medium text-text-primary">
          {label}
        </span>
        <span className="block text-xs text-text-muted">
          Nothing uploads. The engine runs in this tab, on this machine.
        </span>
        <span className="mx-auto mt-1 inline-flex h-8 items-center rounded-lg border border-accent px-4 font-display text-[13px] leading-none font-medium text-accent transition-colors duration-200 group-hover:bg-accent/10">
          Choose file
        </span>
        <span className="block font-mono text-[10px] leading-none tracking-[0.06em] text-text-muted">
          {formats && (
            <>
              {formats}
              <span aria-hidden="true" className="px-1.5 opacity-40">
                ·
              </span>
            </>
          )}
          {multiple && (
            <>
              BATCH OK
              <span aria-hidden="true" className="px-1.5 opacity-40">
                ·
              </span>
            </>
          )}
          {sizeCapMB ? `MAX ${sizeCapMB} MB` : "NO SIZE CAP"}
        </span>
        {error && (
          <span role="alert" className="block text-xs text-error">
            {error}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
        aria-label={label}
        className="sr-only"
      />
    </label>
  );
}
