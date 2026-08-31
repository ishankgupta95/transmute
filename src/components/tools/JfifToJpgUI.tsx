"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { useFileProcessor } from "@/hooks/useFileProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, CanvasStage, StatStrip } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

interface JfifToJpgUIProps {
  acceptFormats: string;
}

/**
 * The simplest honest tool page in the app: verify the bytes are JPEG, hand
 * the SAME bytes back under a .jpg name. There are no settings because there
 * is nothing to decide — the run happens on drop, and the only failure mode
 * is a file that isn't JPEG data underneath.
 */
export function JfifToJpgUI({ acceptFormats }: JfifToJpgUIProps) {
  const [file, setFile] = useState<File | null>(null);

  const processFn = useCallback(async (f: File) => {
    const { jfifToJpg } = await import("@/lib/tools/jfif-to-jpg");
    return jfifToJpg(f);
  }, []);

  // `void` options: this tool has nothing to configure.
  const { status, result, error, process, reset } = useFileProcessor<void>(processFn);

  // Preview off the RESULT blob, not the source: the result only exists once
  // the bytes verified as JPEG, so the <img> below never draws a broken frame
  // for an impostor .jfif.
  const previewUrl = useObjectUrl(result?.blob ?? null);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      // A byte check plus a rename is instantaneous — run it on drop.
      process(f);
    },
    [process],
  );

  const handleRun = useCallback(() => {
    if (!file) return;
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    setFile(null);
    reset();
  }, [reset]);

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        onFiles={handleFiles}
        label="Drop a JFIF to begin"
      />
    );
  }

  return (
    <>
      {/* ── Canvas ─────────────────────────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing="JPG"
        />

        <CanvasStage
          className={cn(STAGE_GROW, "flex min-h-[220px] items-center justify-center")}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
            <img src={previewUrl} alt="" className={STAGE_MEDIA} />
          ) : (
            <span className="px-6 text-center font-mono text-[10.5px] leading-[1.6] text-text-muted">
              {status === "error"
                ? "NOTHING TO PREVIEW — THE BYTES ARE NOT A JPEG"
                : "CHECKING THE BYTES…"}
            </span>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            {
              // The honesty stat this tool exists for: the output is the input.
              label: "BYTES CHANGED",
              value: result ? "0" : "—",
              tone: result ? "ok" : "neutral",
            },
          ]}
        />

        {status === "error" && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: nothing to configure, so the rail is the
             readout plus the one action. ───────────────────────── */}
      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel="Rename to .jpg"
                onPrimary={handleRun}
                primaryDisabled={status === "processing"}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "RENAME ANOTHER" : "CANCEL"}
            />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", file.name],
              ["Out", result ? result.fileName : "—"],
              ["Size", formatFileSize(file.size)],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A .jfif already is a JPEG, so the download is byte-identical —
            nothing is re-encoded, quality cannot change, and EXIF stays
            exactly as it was. The tool only verifies the bytes really are
            JPEG before renaming.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
