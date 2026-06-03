"use client";

import { useCallback, useState } from "react";
import { md5 as md5Lib } from "js-md5";
import { DropZone } from "@/components/tools/DropZone";
import { copyText } from "@/lib/utils/clipboard";

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
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2">
        {(["text", "file"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setHashes(null); setInput(""); setFileName(""); }}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === m ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {m === "text" ? "Text" : "File"}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Input Text</label>
          <textarea
            value={input}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Enter text to hash..."
            rows={4}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
          />
        </div>
      ) : (
        <>
          {!fileName ? (
            <DropZone accept="*/*" onFiles={handleFiles} />
          ) : (
            <div className="rounded-lg border border-border bg-bg-secondary p-4 text-sm text-text-primary">
              Hashing: <span className="font-medium">{fileName}</span>
            </div>
          )}
        </>
      )}

      {hashes && (
        <div className="space-y-2">
          {(["md5", "sha1", "sha256", "sha512"] as const).map((algo) => (
            <div
              key={algo}
              className="flex items-start justify-between gap-2 rounded-md border border-border bg-bg-elevated px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs text-text-muted uppercase mb-0.5">{algo.replace("sha", "SHA-")}</p>
                <code className="text-xs text-text-primary font-mono break-all">{hashes[algo]}</code>
              </div>
              <button
                onClick={() => handleCopy(algo, hashes[algo])}
                className="text-xs text-accent hover:text-accent-hover transition-colors shrink-0"
              >
                {copied === algo ? "Copied!" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
