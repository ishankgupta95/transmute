"use client";

import { useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface DropZoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
}

export function DropZone({ accept, multiple = false, onFiles, className }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(multiple ? files : [files[0]]);
    },
    [multiple, onFiles],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onFiles(multiple ? files : [files[0]]);
    },
    [multiple, onFiles],
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
        "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
        dragging
          ? "border-accent bg-accent-muted"
          : "border-border hover:border-border-hover hover:bg-bg-hover",
        className,
      )}
    >
      <Upload className="text-text-muted" size={32} />
      <span className="text-sm text-text-secondary">
        Drag & drop or <span className="text-accent underline">browse</span>
      </span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
      />
    </label>
  );
}
