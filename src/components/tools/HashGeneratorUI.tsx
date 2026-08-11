"use client";

import { useCallback, useState } from "react";
import { md5 as md5Lib } from "js-md5";
import { DropZone } from "@/components/tools/DropZone";
import { copyText } from "@/lib/utils/clipboard";
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

async function sha(algo: string, data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest(algo, new Uint8Array(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface Hashes {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
}

export function HashGeneratorUI() {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [hashes, setHashes] = useState<Hashes | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const computeHashes = useCallback(async (data: ArrayBuffer) => {
    const [s1, s256, s512] = await Promise.all([
      sha("SHA-1", data),
      sha("SHA-256", data),
      sha("SHA-512", data),
    ]);
    const bytes = new Uint8Array(data);
    const m = md5Lib(bytes);
    setHashes({ md5: m, sha1: s1, sha256: s256, sha512: s512 });
  }, []);

  const handleTextChange = useCallback(
    async (text: string) => {
      setInput(text);
      setHashes(null);
      if (!text) return;
      const data = new TextEncoder().encode(text).buffer as ArrayBuffer;
      await computeHashes(data);
    },
    [computeHashes],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFileName(f.name);
      setHashes(null);
      const data = await f.arrayBuffer();
      await computeHashes(data);
    },
    [computeHashes],
  );

  const handleCopy = useCallback((algo: string, value: string) => {
    copyText(value).then((ok) => {
      if (ok) {
        setCopied(algo);
        setTimeout(() => setCopied(null), 2000);
      }
    });
  }, []);

  return (
    <>
      {/* ── Canvas: the source, then every digest ──────────── */}
      <div className="min-w-0 space-y-[13px]">
        {mode === "text" ? (
          <TextPanes columns={1}>
            <TextPane label="Input Text" lines={lineCount(input)}>
              <textarea
                value={input}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="Enter text to hash..."
                aria-label="Input text"
                className={TEXT_PANE_BODY}
              />
            </TextPane>
          </TextPanes>
        ) : !fileName ? (
          <DropZone accept="*/*" onFiles={handleFiles} />
        ) : (
          <CanvasHeader file={fileName} meta="HASHING" />
        )}

        {hashes && (
          <>
            <GenList
              rows={(["md5", "sha1", "sha256", "sha512"] as const).map((algo) => ({
                value: hashes[algo],
                meta: algo.replace("sha", "SHA-").toUpperCase(),
              }))}
              copiedIndex={
                copied ? ["md5", "sha1", "sha256", "sha512"].indexOf(copied) : null
              }
              onCopy={(value, i) =>
                handleCopy((["md5", "sha1", "sha256", "sha512"] as const)[i], value)
              }
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
              setMode(m);
              setHashes(null);
              setInput("");
              setFileName("");
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
              ["State", hashes ? "Hashed" : "Waiting"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
