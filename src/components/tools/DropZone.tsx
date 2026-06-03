"use client";

import { useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DropZoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
  /** Visible heading + aria label describing what the user should drop. */
  label?: string;
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

/** Human-readable "Accepts PNG, JPG" hint from the accept attribute. */
function describeAccept(accept?: string): string {
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
  return uniq.length ? `Accepts ${uniq.join(", ")}` : "";
}

export function DropZone({
  accept,
  multiple = false,
  onFiles,
  className,
  label = "Drag & drop a file here",
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptHint = describeAccept(accept);

  const emit = useCallback(
    (selected: File[]) => {
      if (selected.length === 0) return;
      const accepted = selected.filter((f) => matchesAccept(f, accept));
      if (accepted.length === 0) {
        setError(acceptHint ? `Unsupported file type. ${acceptHint}.` : "Unsupported file type.");
        return;
      }
      setError(
        accepted.length < selected.length ? "Some files were skipped (unsupported type)." : null,
      );
      onFiles(multiple ? accepted : [accepted[0]]);
    },
    [accept, acceptHint, multiple, onFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      emit(Array.from(e.dataTransfer.files));
    },
    [emit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      emit(Array.from(e.target.files ?? []));
      // Allow re-uploading the same file by clearing the input value.
      e.target.value = "";
    },
    [emit],
  );

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "group relative flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-10 cursor-pointer transition-all duration-300 motion-reduce:transition-none focus-within:border-accent focus-within:bg-accent-muted",
        dragging
          ? "border-accent bg-accent-muted"
          : "border-border hover:border-[rgba(86,184,230,0.3)] hover:bg-[rgba(255,255,255,0.015)]",
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
      <div className="text-center space-y-1">
        <span className="block text-sm font-medium text-text-secondary">{label}</span>
        <span className="block text-xs text-text-muted">
          Drag &amp; drop or <span className="text-accent font-medium">browse</span>
          {acceptHint && <> &middot; {acceptHint}</>}
          {multiple && <> &middot; multiple files</>}
        </span>
        {error && (
          <span role="alert" className="block text-xs text-error">
            {error}
          </span>
        )}
      </div>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        aria-label={label}
        className="sr-only"
      />
    </label>
  );
}
