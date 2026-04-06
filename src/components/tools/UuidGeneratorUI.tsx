"use client";

import { useCallback, useState } from "react";

function generateUUIDv4(): string {
  return crypto.randomUUID();
}

function generateUUIDv7(): string {
  const timestamp = Date.now();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set timestamp (first 48 bits)
  const ts = timestamp & 0xffffffffffff;
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts / 2 ** 24) & 0xff;
  bytes[3] = (ts / 2 ** 16) & 0xff;
  bytes[4] = (ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  // Set version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Set variant 10xx
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function UuidGeneratorUI() {
  const [version, setVersion] = useState<"v4" | "v7">("v4");
  const [count, setCount] = useState(1);
  const [uuids, setUuids] = useState<string[]>([]);
  const [copied, setCopied] = useState<number | "all" | null>(null);

  const handleGenerate = useCallback(() => {
    const gen = version === "v4" ? generateUUIDv4 : generateUUIDv7;
    setUuids(Array.from({ length: count }, () => gen()));
    setCopied(null);
  }, [version, count]);

  const handleCopyOne = useCallback((i: number) => {
    navigator.clipboard.writeText(uuids[i]);
    setCopied(i);
    setTimeout(() => setCopied(null), 2000);
  }, [uuids]);

  const handleCopyAll = useCallback(() => {
    navigator.clipboard.writeText(uuids.join("\n"));
    setCopied("all");
    setTimeout(() => setCopied(null), 2000);
  }, [uuids]);

  return (
    <div className="space-y-4">
      {/* Options */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className="flex gap-2">
          {(["v4", "v7"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVersion(v)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                version === v ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
              }`}
            >
              UUID {v}
            </button>
          ))}
        </div>
        <select
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary"
        >
          {[1, 5, 10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n} UUID{n > 1 ? "s" : ""}</option>
          ))}
        </select>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleGenerate}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Generate
        </button>
      </div>

      {uuids.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">
              {uuids.length} UUID{uuids.length > 1 ? "s" : ""}
            </label>
            {uuids.length > 1 && (
              <button onClick={handleCopyAll} className="text-xs text-accent hover:text-accent-hover transition-colors">
                {copied === "all" ? "Copied!" : "Copy all"}
              </button>
            )}
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {uuids.map((uuid, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border border-border bg-bg-elevated px-3 py-2"
              >
                <code className="text-sm text-text-primary font-mono">{uuid}</code>
                <button
                  onClick={() => handleCopyOne(i)}
                  className="text-xs text-accent hover:text-accent-hover transition-colors ml-2 shrink-0"
                >
                  {copied === i ? "Copied!" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
