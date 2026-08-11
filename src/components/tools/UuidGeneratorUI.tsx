"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, GenList } from "@/components/tools/ToolCanvas";

function generateUUIDv4(): string {
  return crypto.randomUUID();
}

function generateUUIDv7(): string {
  const timestamp = Date.now();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set timestamp (first 48 bits). Use floored division rather than a 48-bit
  // bitwise mask — JS bitwise operators coerce to signed 32-bit, which would
  // truncate the timestamp and destroy v7's time-ordering.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
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

  // Option changes clear the list — v4 UUIDs sitting under a lit "v7" chip
  // would be a claim the controls no longer back (same rule as presets).
  const changeVersion = useCallback((v: "v4" | "v7") => {
    setVersion(v);
    setUuids([]);
  }, []);
  const changeCount = useCallback((n: number) => {
    setCount(n);
    setUuids([]);
  }, []);

  const handleGenerate = useCallback(() => {
    const gen = version === "v4" ? generateUUIDv4 : generateUUIDv7;
    setUuids(Array.from({ length: count }, () => gen()));
    setCopied(null);
  }, [version, count]);

  const handleCopyOne = useCallback((i: number) => {
    copyText(uuids[i]).then((ok) => {
      if (ok) {
        setCopied(i);
        setTimeout(() => setCopied(null), 2000);
      }
    });
  }, [uuids]);

  const handleCopyAll = useCallback(() => {
    copyText(uuids.join("\n")).then((ok) => {
      if (ok) {
        setCopied("all");
        setTimeout(() => setCopied(null), 2000);
      }
    });
  }, [uuids]);

  return (
    <>
      {/* ── Canvas: the doc's numbered value list ──────────── */}
      <div className="min-w-0 space-y-[13px]">
        {uuids.length === 0 ? (
          <p className="py-10 text-center font-body text-sm text-text-muted">
            Pick a version and a count, then generate.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-[13px] leading-none font-medium text-text-primary">
                {uuids.length} UUID{uuids.length > 1 ? "s" : ""}
              </span>
              {uuids.length > 1 && (
                <button
                  onClick={handleCopyAll}
                  aria-label={copied === "all" ? "Copied all UUIDs" : "Copy all UUIDs"}
                  className="ml-auto cursor-pointer font-mono text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
                >
                  {copied === "all" ? "Copied!" : "Copy all"}
                </button>
              )}
            </div>

            <GenList
              rows={uuids.map((uuid) => ({ value: uuid }))}
              copiedIndex={typeof copied === "number" ? copied : null}
              onCopy={(_, i) => handleCopyOne(i)}
            />

            <CanvasFootnote>
              GENERATED LOCALLY · CRYPTO.GETRANDOMVALUES · NOTHING LOGGED
            </CanvasFootnote>
          </>
        )}
      </div>

      <ToolAside footer={<ToolActions primaryLabel="Generate" onPrimary={handleGenerate} />}>
        <ToolAsideSection label="VERSION">
          <ToolChoice
            label="UUID version"
            fill
            value={version}
            onChange={changeVersion}
            options={[
              { value: "v4" as const, label: "UUID v4" },
              { value: "v7" as const, label: "UUID v7" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            v4 is random. v7 embeds a timestamp, so IDs sort by creation time.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="HOW MANY">
          <ToolChoice
            label="Number of UUIDs"
            value={count}
            onChange={changeCount}
            options={[1, 5, 10, 25, 50, 100].map((n) => ({ value: n, label: String(n) }))}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
