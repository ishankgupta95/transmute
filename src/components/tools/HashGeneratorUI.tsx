"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { ProgressBar } from "@/components/tools/ProgressBar";
import {
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  GenList,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { getToolBySlug } from "@/data/tools";
import type { Hashes } from "@/lib/tools/hash-digest";
import { computeHashesGuarded } from "@/lib/workers/hash-client";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

const ALGOS = ["md5", "sha1", "sha256", "sha512"] as const;

/*
  The File arm reads the whole file into one ArrayBuffer before hashing
  anything, so this zone may not print the absolute "NO SIZE CAP" — see the
  block on `practicalLimitNote` in the registry entry for the measurement.
  Read off the registry rather than retyped, so the spec row on the page and
  the line under the zone cannot drift apart.
*/
const PRACTICAL_LIMIT_NOTE = getToolBySlug("hash-generator")?.practicalLimitNote;

export function HashGeneratorUI() {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [hashes, setHashes] = useState<Hashes | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopied<string>();

  /*
    Text mode fires a run per keystroke, so an earlier, slower run can land
    after a later one and leave digests of text the user has already replaced.
    A monotonic id makes the last run the only one allowed to write.
  */
  const runIdRef = useRef(0);

  const run = useCallback(async (data: ArrayBuffer) => {
    const id = ++runIdRef.current;
    setProgress(0);
    try {
      const result = await computeHashesGuarded(data, (pct) => {
        if (runIdRef.current === id) setProgress(pct);
      });
      if (runIdRef.current !== id) return;
      setHashes(result);
    } finally {
      if (runIdRef.current === id) setProgress(null);
    }
  }, []);

  const handleTextChange = useCallback(
    async (text: string) => {
      setInput(text);
      setHashes(null);
      if (!text) {
        // Bump the id so an in-flight run cannot repopulate an empty input.
        runIdRef.current++;
        setProgress(null);
        return;
      }
      await run(new TextEncoder().encode(text).buffer as ArrayBuffer);
    },
    [run],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFileName(f.name);
      setHashes(null);
      setError(null);
      /*
        `f.arrayBuffer()` is one allocation of the WHOLE file, and past V8's
        single-buffer wall it REJECTS rather than resolving short. Unhandled,
        that rejection escaped as a page error and left the canvas showing a
        file name with no digests, no progress and nothing to read — the
        ceiling the registry note now discloses had no visible failure to
        match it. The token keeps a slow read that fails from posting its
        error over a file the user has since replaced.
      */
      const id = ++runIdRef.current;
      let data: ArrayBuffer;
      try {
        data = await f.arrayBuffer();
      } catch {
        if (runIdRef.current !== id) return;
        setProgress(null);
        setError(
          `Could not read ${f.name}. Hashing needs the whole file in one buffer, and this browser would not allocate one that large — files much past 2 GB do not load.`,
        );
        return;
      }
      if (runIdRef.current !== id) return;
      await run(data);
    },
    [run],
  );

  const handleCopy = useCallback(
    (algo: string, value: string) => {
      void copy(value, algo);
    },
    [copy],
  );

  const hashing = progress !== null;

  return (
    <>
      {/* ── Canvas: the source, then every digest ──────────── */}
      <div className={CANVAS_COLUMN}>
        {mode === "text" ? (
          <TextPanes columns={1}>
            <TextPane
              label="Input Text"
              lines={lineCount(input)}
              size={formatFileSize(new Blob([input]).size)}
            >
              <textarea
                value={input}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="Enter text to hash..."
                aria-label="Input text"
                className={TEXT_PANE_BODY}
              />
            </TextPane>
          </TextPanes>
        ) : (
          <>
            {/* The zone stays mounted, as it does in the sibling Base64 tool:
                swapping it for a header made hashing a SECOND file impossible
                without toggling the INPUT chip to Text and back. */}
            <DropZone
              accept="*/*"
              onFiles={handleFiles}
              practicalLimitNote={PRACTICAL_LIMIT_NOTE}
            />
            {error && <ErrorMessage message={error} />}
            {fileName && (
              <CanvasHeader
                file={fileName}
                meta={hashing ? "HASHING…" : hashes ? "HASHED" : "WAITING"}
                trailing={hashes ? "4 DIGESTS" : undefined}
              />
            )}
          </>
        )}

        {hashing && <ProgressBar progress={progress} label="Hashing" />}

        {hashes && (
          <>
            <GenList
              rows={ALGOS.map((algo) => ({
                value: hashes[algo],
                meta: algo.replace("sha", "SHA-").toUpperCase(),
              }))}
              copiedIndex={
                copied ? ALGOS.indexOf(copied as (typeof ALGOS)[number]) : null
              }
              onCopy={(value, i) => handleCopy(ALGOS[i], value)}
            />
            <CanvasFootnote>COMPUTED IN THIS TAB · SUBTLECRYPTO · NOTHING UPLOADED</CanvasFootnote>
          </>
        )}
      </div>

      <ToolAside>
        <ToolAsideSection label="INPUT">
          <ToolChoice
            label="Input mode"
            fill
            value={mode}
            onChange={(m) => {
              runIdRef.current++;
              setMode(m);
              setHashes(null);
              setInput("");
              setFileName("");
              setProgress(null);
              setError(null);
            }}
            options={[
              { value: "text" as const, label: "Text" },
              { value: "file" as const, label: "File" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Hashes recompute as you type — there is nothing to run.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Algorithms", "4"],
              ["Source", mode === "file" ? (fileName ? "File" : "—") : input ? "Text" : "—"],
              ["State", hashing ? "Hashing" : hashes ? "Hashed" : "Waiting"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
