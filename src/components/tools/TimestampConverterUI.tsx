"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";

type DisplayZone = "local" | "utc";

function formatHuman(date: Date, zone: DisplayZone): string {
  return zone === "utc"
    ? `${date.toLocaleString(undefined, { timeZone: "UTC" })} UTC`
    : date.toLocaleString();
}

export function TimestampConverterUI() {
  const [unixSec, setUnixSec] = useState("");
  const [unixMs, setUnixMs] = useState("");
  const [iso, setIso] = useState("");
  const [human, setHuman] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  // The human-readable line was silently local-only — ambiguous the moment a
  // reader assumes server time. The zone is now an explicit choice.
  const [zone, setZone] = useState<DisplayZone>("local");

  const updateAll = useCallback((date: Date, z: DisplayZone = zone) => {
    if (isNaN(date.getTime())) return;
    setUnixSec(String(Math.floor(date.getTime() / 1000)));
    setUnixMs(String(date.getTime()));
    setIso(date.toISOString());
    setHuman(formatHuman(date, z));
  }, [zone]);

  const handleZoneChange = useCallback(
    (z: DisplayZone) => {
      setZone(z);
      const d = iso ? new Date(iso) : null;
      if (d && !isNaN(d.getTime())) setHuman(formatHuman(d, z));
    },
    [iso],
  );

  const handleNow = useCallback(() => {
    updateAll(new Date());
  }, [updateAll]);

  const handleUnixSec = useCallback(
    (val: string) => {
      setUnixSec(val);
      const n = Number(val);
      if (!isNaN(n) && val) updateAll(new Date(n * 1000));
    },
    [updateAll],
  );

  const handleUnixMs = useCallback(
    (val: string) => {
      setUnixMs(val);
      const n = Number(val);
      if (!isNaN(n) && val) updateAll(new Date(n));
    },
    [updateAll],
  );

  const handleIso = useCallback(
    (val: string) => {
      setIso(val);
      const d = new Date(val);
      if (!isNaN(d.getTime())) updateAll(d);
    },
    [updateAll],
  );

  const handleClear = useCallback(() => {
    setUnixSec("");
    setUnixMs("");
    setIso("");
    setHuman("");
  }, []);

  const handleCopy = useCallback((label: string, value: string) => {
    copyText(value).then((ok) => {
      if (ok) {
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
      }
    });
  }, []);

  // Both readouts are locale-dependent, so they stay "—" until the user acts —
  // computing them during the prerender would hydrate differently per device.
  const parsed = iso ? new Date(iso) : null;
  const weekday =
    parsed && !isNaN(parsed.getTime())
      ? parsed.toLocaleDateString(undefined, {
          weekday: "long",
          ...(zone === "utc" ? { timeZone: "UTC" } : {}),
        })
      : "—";
  const localZone = iso ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local") : "—";

  return (
    <>
      {/* ── Canvas: every representation of the same instant ─── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={1}>
          <TextPane label="The same instant, four ways" lines={undefined}>
            <div className="flex flex-col">
              {[
                { label: "Unix (seconds)", value: unixSec, onChange: handleUnixSec, placeholder: "1700000000" },
                { label: "Unix (milliseconds)", value: unixMs, onChange: handleUnixMs, placeholder: "1700000000000" },
                { label: "ISO 8601", value: iso, onChange: handleIso, placeholder: "2024-01-01T00:00:00.000Z" },
                { label: "Human-readable", value: human, onChange: () => {}, placeholder: "Local date string", readOnly: true },
              ].map((field) => (
                <div
                  key={field.label}
                  className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0"
                >
                  <label className="w-36 shrink-0 font-body text-[11.5px] leading-none text-text-muted">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    readOnly={"readOnly" in field}
                    placeholder={field.placeholder}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] leading-none text-neutral-200 placeholder:text-text-muted focus:outline-none"
                  />
                  <button
                    onClick={() => handleCopy(field.label, field.value)}
                    aria-label={copied === field.label ? `Copied ${field.label}` : `Copy ${field.label}`}
                    className="flex-none cursor-pointer font-body text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
                  >
                    {copied === field.label ? "Copied!" : "Copy"}
                  </button>
                </div>
              ))}
            </div>
          </TextPane>
        </TextPanes>

        <CanvasFootnote>
          EDIT ANY FIELD AND THE REST FOLLOW · CONVERTED IN THIS TAB
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel="Now"
            onPrimary={handleNow}
            onReset={handleClear}
            resetLabel="CLEAR"
          />
        }
      >
        <ToolAsideSection label="DISPLAY">
          <ToolChoice
            label="Human-readable time zone"
            fill
            value={zone}
            onChange={handleZoneChange}
            options={[
              { value: "local" as const, label: "Local" },
              { value: "utc" as const, label: "UTC" },
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Weekday", weekday],
              ["UTC time", iso.length >= 19 ? `${iso.slice(11, 19)}Z` : "—"],
              ["Local zone", localZone],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Edit any field above and the rest follow. Human-readable uses this
            device&apos;s locale, in the zone picked above.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
