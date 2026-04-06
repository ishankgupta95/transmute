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
        "group relative flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-10 cursor-pointer transition-all duration-300",
        dragging
          ? "border-accent bg-accent-muted"
          : "border-border hover:border-[rgba(86,184,230,0.3)] hover:bg-[rgba(255,255,255,0.015)]",
        className,
      )}
    >
      <div className={cn(
        "flex items-center justify-center rounded-md p-3 transition-all duration-300",
        dragging
          ? "bg-accent-muted text-accent scale-110"
          : "bg-bg-elevated text-text-muted group-hover:text-accent group-hover:bg-accent-muted",
      )}>
        <Upload size={28} />
      </div>
      <div className="text-center">
        <span className="text-sm text-text-secondary">
          Drag & drop or{" "}
          <span className="text-accent font-medium">browse files</span>
        </span>
      </div>
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
