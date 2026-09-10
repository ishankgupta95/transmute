"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { ProgressBar } from "@/components/tools/ProgressBar";
import {
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  GenList,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { getToolBySlug } from "@/data/tools";
import { useCopied } from "@/hooks/useCopied";
import {
  formatSumsFile,
  HASH_ALGORITHMS,
  HASH_LABEL,
  parseChecksumList,
  parseExpectedChecksum,
  SUMS_FILE_NAME,
  verdictForFile,
  type ChecksumVerdict,
  type HashAlgorithm,
} from "@/lib/tools/checksum-compare";
import type { Hashes } from "@/lib/tools/hash-digest";
import { cn } from "@/lib/utils/cn";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { computeHashesGuarded } from "@/lib/workers/hash-client";

/*
  Same shape as /hash-generator's File arm, and the same wall: each file is
  read into ONE ArrayBuffer and that buffer is TRANSFERRED to the hashing
  worker, so V8's single-allocation ceiling binds here too. Read off the
  registry rather than retyped, so the spec row on the page and the line under
  the drop zone cannot drift apart.
*/
const PRACTICAL_LIMIT_NOTE = getToolBySlug("file-checksum")?.practicalLimitNote;

interface FileRow {
  id: number;
  name: string;
  size: number;
  hashes: Hashes | null;
  error: string | null;
}

/**
 * The verdict block. Deliberately the loudest thing on the page: a checksum
 * tool whose answer you have to hunt for is a checksum tool people stop
 * reading, and "no match" reported quietly is indistinguishable from success.
 */
function Verdict({
  tone,
  headline,
  detail,
}: {
  tone: "good" | "bad" | "warn";
  headline: string;
  detail: string;
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-4 py-3.5",
        tone === "good" && "border-success/40 bg-success/8",
        tone === "bad" && "border-error/45 bg-error/10",
        tone === "warn" && "border-warning/30 bg-warning/10",
      )}
    >
      <span
        className={cn(
          "font-mono text-[13px] leading-none font-medium tracking-[0.14em]",
          tone === "good" && "text-success",
          tone === "bad" && "text-error",
          tone === "warn" && "text-warning",
        )}
      >
        {headline}
      </span>
      <span
        className={cn(
          "font-body text-[12.5px] leading-[1.5]",
          tone === "good" && "text-success",
          tone === "bad" && "text-error",
          tone === "warn" && "text-warning",
        )}
      >
        {detail}
      </span>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** `MD5`, `MD5 and SHA-256`, `MD5, SHA-1 and SHA-256`. */
const joinLabels = (labels: readonly string[]): string =>
  labels.length < 2
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

export function FileChecksumUI() {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [expectedText, setExpectedText] = useState("");
  const [sumsAlgo, setSumsAlgo] = useState<HashAlgorithm>("sha256");
  const [progress, setProgress] = useState<{ index: number; percent: number } | null>(null);
  const { copied, copy } = useCopied<string>();

  /*
    `arrayBuffer()` and the worker round trip are both async, so a slow first
    batch can land after a second drop has replaced it and write digests under
    the wrong file names. Every drop and the reset bump the token; a run whose
    token is stale drops its result on the floor.
  */
  const runIdRef = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const id = ++runIdRef.current;
    setRows(files.map((f, i) => ({ id: i, name: f.name, size: f.size, hashes: null, error: null })));

    const patch = (index: number, next: Partial<FileRow>) =>
      setRows((prev) => prev.map((r, j) => (j === index ? { ...r, ...next } : r)));

    for (let i = 0; i < files.length; i++) {
      if (runIdRef.current !== id) return;
      setProgress({ index: i, percent: 0 });
      let data: ArrayBuffer;
      try {
        /*
          One allocation of the WHOLE file, per file — and past V8's
          single-buffer wall it REJECTS rather than resolving short. A fresh
          buffer every time is not an optimisation: `computeHashesGuarded`
          TRANSFERS what it is given, so a reused buffer would arrive detached.
        */
        data = await files[i].arrayBuffer();
      } catch {
        if (runIdRef.current !== id) continue;
        patch(i, {
          error: `Could not read ${files[i].name}. Hashing needs the whole file in one buffer, and this browser would not allocate one that large — files much past 2 GB do not load.`,
        });
        continue;
      }
      if (runIdRef.current !== id) return;
      try {
        const hashes = await computeHashesGuarded(data, (pct) => {
          if (runIdRef.current === id) setProgress({ index: i, percent: pct });
        });
        if (runIdRef.current !== id) return;
        patch(i, { hashes });
      } catch (e) {
        if (runIdRef.current !== id) return;
        patch(i, { error: e instanceof Error ? e.message : "Hashing failed for this file." });
      }
    }
    if (runIdRef.current === id) setProgress(null);
  }, []);

  const handleReset = useCallback(() => {
    runIdRef.current++;
    setRows([]);
    setProgress(null);
  }, []);

  const list = useMemo(() => parseChecksumList(expectedText), [expectedText]);
  const single = useMemo(() => parseExpectedChecksum(expectedText), [expectedText]);

  const verdicts = useMemo(
    (): ChecksumVerdict[] =>
      rows.map((r) => (r.hashes ? verdictForFile(list, r.name, r.hashes) : { kind: "none" })),
    [rows, list],
  );

  const hashed = rows.filter((r) => r.hashes !== null).length;
  const matched = verdicts.filter((v) => v.kind === "match").length;
  const mismatched = verdicts.filter((v) => v.kind === "mismatch").length;
  const unlisted = verdicts.filter((v) => v.kind === "unlisted").length;
  const busy = progress !== null;

  /** The one-line answer, derived from the run rather than assumed. */
  const summary = useMemo((): { tone: "good" | "bad" | "warn"; headline: string; detail: string } | null => {
    if (expectedText.trim() === "") return null;
    if (list.entries.length === 0) {
      const found =
        single.kind === "unreadable" && single.hexRun
          ? ` The longest run of hex digits in it is ${single.hexRun.length} ${plural(single.hexRun.length, "character")} long, and no algorithm here produces a digest that length — MD5 is 32, SHA-1 is 40, SHA-256 is 64 and SHA-512 is 128.`
          : "";
      return {
        tone: "warn",
        headline: "NO CHECKSUM FOUND",
        detail: `Nothing in what you pasted reads as a digest, so nothing is being compared.${found} A truncated paste is refused rather than matched against its first 32 or 40 characters.`,
      };
    }
    if (hashed === 0) {
      return {
        tone: "warn",
        headline: "WAITING FOR A FILE",
        // Every algorithm in the paste, not the first line's — a release page
        // publishes an MD5 block above a SHA-256 one, and on a page whose whole
        // premise is that the algorithm is derived from the digest rather than
        // assumed, naming one of them for all of them is the one wrong answer.
        detail: `${list.entries.length} ${plural(list.entries.length, "checksum")} read, ${joinLabels([...new Set(list.entries.map((e) => HASH_LABEL[e.algorithm]))])} by length. Drop the file to compare.`,
      };
    }
    if (mismatched > 0) {
      const names = rows.filter((_, i) => verdicts[i].kind === "mismatch").map((r) => r.name);
      return {
        tone: "bad",
        headline: "NO MATCH",
        detail: `${names.join(", ")} does not match the checksum you pasted — not under MD5, SHA-1, SHA-256 or SHA-512. Either the file is not the one that checksum describes, or it was corrupted or altered on the way to this machine. Do not run it.`,
      };
    }
    if (matched > 0) {
      const algos = [
        ...new Set(verdicts.flatMap((v) => (v.kind === "match" ? [HASH_LABEL[v.algorithm]] : []))),
      ];
      return {
        tone: "good",
        headline: "MATCH",
        detail: `${matched} of ${hashed} ${plural(hashed, "file")} matched on ${joinLabels(algos)}${unlisted > 0 ? `, and ${unlisted} ${plural(unlisted, "file")} ${plural(unlisted, "is", "are")} not named in the list you pasted` : ""}. The bytes on this machine are the bytes that checksum was taken from.`,
      };
    }
    return {
      tone: "warn",
      headline: "NOT IN THE LIST",
      detail: `No line in what you pasted names ${plural(unlisted, "this file", "these files")}, so nothing was compared. Sums files are matched on the filename; rename the file to match the list, or paste just the one digest.`,
    };
  }, [expectedText, list, single, hashed, matched, mismatched, unlisted, rows, verdicts]);

  const sumsBlob = useMemo(() => {
    const ready = rows.filter((r) => r.hashes !== null);
    if (ready.length === 0) return null;
    return new Blob(
      [formatSumsFile(ready.map((r) => ({ name: r.name, digest: r.hashes![sumsAlgo] })))],
      { type: "text/plain;charset=utf-8" },
    );
  }, [rows, sumsAlgo]);

  return (
    <>
      {/* ── Canvas: the verdict first, then every digest ────────── */}
      <div className={CANVAS_COLUMN}>
        {/* The zone stays mounted, as it does in the sibling hash tool:
            swapping it for a header made checking a SECOND download
            impossible without reloading the page. */}
        <DropZone
          accept="*/*"
          multiple
          onFiles={handleFiles}
          disabled={busy}
          label="Drop a download to check it"
          acceptLabel="ANY FILE"
          practicalLimitNote={PRACTICAL_LIMIT_NOTE}
        />

        {summary && <Verdict {...summary} />}

        {list.unreadableLines > 0 && list.entries.length > 0 && (
          <CanvasFootnote>
            {list.unreadableLines} PASTED {plural(list.unreadableLines, "LINE")} CARRIED NO DIGEST
            AND {plural(list.unreadableLines, "WAS", "WERE")} SKIPPED
          </CanvasFootnote>
        )}

        {busy && (
          <ProgressBar
            progress={progress.percent}
            label={`Hashing ${rows[progress.index]?.name ?? "file"}`}
          />
        )}

        {rows.length > 0 && (
          <StatStrip
            stats={[
              { label: "FILES", value: String(rows.length), tone: "neutral" },
              { label: "HASHED", value: `${hashed} of ${rows.length}`, tone: "neutral" },
              {
                label: "EXPECTED",
                value: list.entries.length > 0 ? String(list.entries.length) : "—",
                tone: "neutral",
              },
              {
                label: "VERDICT",
                value:
                  list.entries.length === 0
                    ? "—"
                    : mismatched > 0
                      ? "NO MATCH"
                      : matched > 0
                        ? "MATCH"
                        : "PENDING",
                tone: mismatched > 0 ? "neutral" : matched > 0 ? "ok" : "neutral",
              },
            ]}
          />
        )}

        {rows.map((row, i) => {
          const verdict = verdicts[i];
          const copiedIndex = HASH_ALGORITHMS.findIndex((a) => copied === `${row.id}:${a}`);
          return (
            <div key={row.id} className="flex flex-col gap-2.5">
              <CanvasHeader
                file={row.name}
                meta={formatFileSize(row.size)}
                trailing={
                  row.error
                    ? "FAILED"
                    : verdict.kind === "match"
                      ? `${HASH_LABEL[verdict.algorithm]} MATCH`
                      : verdict.kind === "mismatch"
                        ? "NO MATCH"
                        : verdict.kind === "unlisted"
                          ? "NOT IN LIST"
                          : row.hashes
                            ? "4 DIGESTS"
                            : "QUEUED"
                }
                trailingTone={verdict.kind === "match" ? "accent" : "muted"}
              />
              {row.error && <ErrorMessage message={row.error} />}
              {row.hashes && (
                <GenList
                  rows={HASH_ALGORITHMS.map((algo) => ({
                    value: row.hashes![algo],
                    meta:
                      verdict.kind === "match" && verdict.algorithm === algo
                        ? `${HASH_LABEL[algo]} · MATCH`
                        : HASH_LABEL[algo],
                  }))}
                  copiedIndex={copiedIndex === -1 ? null : copiedIndex}
                  onCopy={(value, index) => {
                    void copy(value, `${row.id}:${HASH_ALGORITHMS[index]}`);
                  }}
                />
              )}
            </div>
          );
        })}

        {hashed > 0 && (
          <CanvasFootnote>COMPUTED IN THIS TAB · SUBTLECRYPTO · MD5 · NOTHING UPLOADED</CanvasFootnote>
        )}
      </div>

      {/* ── Controls ────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <>
            {sumsBlob && (
              <DownloadButton
                blob={sumsBlob}
                fileName={SUMS_FILE_NAME[sumsAlgo]}
                className="w-full justify-center"
              />
            )}
            {rows.length > 0 && <ToolResetLink onClick={handleReset} label="START OVER" />}
          </>
        }
      >
        <ToolAsideSection label="EXPECTED CHECKSUM">
          <textarea
            value={expectedText}
            onChange={(e) => setExpectedText(e.target.value)}
            rows={3}
            placeholder={"e3b0c442…  ubuntu-24.04.iso"}
            aria-label="Expected checksum"
            spellCheck={false}
            className="min-h-[76px] w-full resize-y rounded-[7px] border border-border bg-bg-elevated px-2.5 py-2 font-mono text-[11px] leading-[1.6] break-all text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Paste the line off the release page as it stands. A bare digest,{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">
              &lt;hash&gt;&nbsp;&nbsp;&lt;file&gt;
            </code>{" "}
            from <code className="font-mono text-[10.5px] text-neutral-300">sha256sum</code>, the
            BSD <code className="font-mono text-[10.5px] text-neutral-300">SHA256 (f) = …</code>{" "}
            form and a <code className="font-mono text-[10.5px] text-neutral-300">sha256:</code>{" "}
            prefix are all read. Paste a whole SHA256SUMS file and each dropped file is matched to
            the line that names it. The algorithm is worked out from the length, and every one of
            the four digests is compared.
          </span>
        </ToolAsideSection>

        {hashed > 0 && (
          <ToolAsideSection label="CHECKSUM FILE">
            <ToolChoice
              label="Checksum file algorithm"
              value={sumsAlgo}
              onChange={setSumsAlgo}
              options={HASH_ALGORITHMS.map((a) => ({ value: a, label: HASH_LABEL[a] }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Downloads a coreutils-format{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">
                {SUMS_FILE_NAME[sumsAlgo]}
              </code>{" "}
              — one{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">
                &lt;hash&gt;&nbsp;&nbsp;&lt;file&gt;
              </code>{" "}
              line per file, which{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">
                {sumsAlgo}sum -c
              </code>{" "}
              reads back.
            </span>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Algorithms", "4 per file"],
              ["Files", rows.length > 0 ? `${hashed} of ${rows.length} hashed` : "—"],
              ["State", busy ? "Hashing" : rows.length > 0 ? "Done" : "Waiting"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT A MATCH PROVES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            That the bytes on this machine are the bytes the published digest was taken from —
            nothing was corrupted in transit and nothing was swapped by a mirror. It does{" "}
            <strong className="font-medium text-neutral-300">not</strong> prove the publisher is
            trustworthy, and it does not prove the checksum itself is genuine: an attacker who can
            change the download can usually change the page it is listed on. A signature you can
            verify against a key you already had is the stronger check; this is the one you can do
            in ten seconds. MD5 and SHA-1 are broken against a deliberate collision and are here for
            the many projects that still publish them — trust SHA-256 or SHA-512 when both are
            offered.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
