"use client";

import { useCallback, useState } from "react";

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
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";

type DisplayZone = "local" | "utc";

function formatHuman(date: Date, zone: DisplayZone): string {
  return zone === "utc"
    ? `${date.toLocaleString(undefined, { timeZone: "UTC" })} UTC`
    : date.toLocaleString();
}

type EditableField = "sec" | "ms" | "iso";
type FieldId = "ts-unix-sec" | "ts-unix-ms" | "ts-iso" | "ts-human";

/*
  Ids exist so each `<label>` can carry `htmlFor` — the four fields ARE the
  tool, and without a name a screen reader announces four bare edit boxes with
  no way to tell seconds from milliseconds from ISO.
*/
const FIELDS: readonly {
  id: FieldId;
  tag?: EditableField;
  label: string;
  placeholder: string;
  readOnly?: boolean;
}[] = [
  { id: "ts-unix-sec", tag: "sec", label: "Unix (seconds)", placeholder: "1700000000" },
  { id: "ts-unix-ms", tag: "ms", label: "Unix (milliseconds)", placeholder: "1700000000000" },
  { id: "ts-iso", tag: "iso", label: "ISO 8601", placeholder: "2024-01-01T00:00:00.000Z" },
  { id: "ts-human", label: "Human-readable", placeholder: "Local date string", readOnly: true },
];

export function TimestampConverterUI() {
  const [unixSec, setUnixSec] = useState("");
  const [unixMs, setUnixMs] = useState("");
  const [iso, setIso] = useState("");
  const [human, setHuman] = useState("");
  const { copied, copy } = useCopied<string>();
  // The human-readable line was silently local-only — ambiguous the moment a
  // reader assumes server time. The zone is now an explicit choice.
  const [zone, setZone] = useState<DisplayZone>("local");
  /*
    Draft vs canonical, the same split `hex`/`hexInput` uses in ColorPickerUI.
    The field being typed into shows exactly what was typed; the other three
    show the canonical value. Without this, `new Date("2024")` parses after
    four keystrokes and `updateAll` wrote the full ISO string back into the
    field mid-word — typing `2024` left `2001-01-31T18:30:00.000Z024`.
  */
  const [draft, setDraft] = useState<{ field: EditableField; value: string } | null>(null);

  const updateAll = useCallback(
    (date: Date, from?: EditableField, z: DisplayZone = zone) => {
      if (isNaN(date.getTime())) return;
      if (from !== "sec") setUnixSec(String(Math.floor(date.getTime() / 1000)));
      if (from !== "ms") setUnixMs(String(date.getTime()));
      if (from !== "iso") setIso(date.toISOString());
      setHuman(formatHuman(date, z));
    },
    [zone],
  );

  const handleZoneChange = useCallback(
    (z: DisplayZone) => {
      setZone(z);
      const d = iso ? new Date(iso) : null;
      if (d && !isNaN(d.getTime())) setHuman(formatHuman(d, z));
    },
    [iso],
  );

  const handleNow = useCallback(() => {
    setDraft(null);
    updateAll(new Date());
  }, [updateAll]);

  const handleUnixSec = useCallback(
    (val: string) => {
      setUnixSec(val);
      setDraft({ field: "sec", value: val });
      const n = Number(val);
      if (!isNaN(n) && val) updateAll(new Date(n * 1000), "sec");
    },
    [updateAll],
  );

  const handleUnixMs = useCallback(
    (val: string) => {
      setUnixMs(val);
      setDraft({ field: "ms", value: val });
      const n = Number(val);
      if (!isNaN(n) && val) updateAll(new Date(n), "ms");
    },
    [updateAll],
  );

  const handleIso = useCallback(
    (val: string) => {
      setIso(val);
      setDraft({ field: "iso", value: val });
      const d = new Date(val);
      if (!isNaN(d.getTime())) updateAll(d, "iso");
    },
    [updateAll],
  );

  const handleClear = useCallback(() => {
    setDraft(null);
    setUnixSec("");
    setUnixMs("");
    setIso("");
    setHuman("");
  }, []);

  const handleCopy = useCallback((label: string, value: string) => {
    void copy(value, label);
  }, [copy]);

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

  const values: Record<FieldId, string> = {
    "ts-unix-sec": unixSec,
    "ts-unix-ms": unixMs,
    "ts-iso": iso,
    "ts-human": human,
  };
  const handlers: Record<FieldId, (v: string) => void> = {
    "ts-unix-sec": handleUnixSec,
    "ts-unix-ms": handleUnixMs,
    "ts-iso": handleIso,
    "ts-human": () => {},
  };

  return (
    <>
      {/* ── Canvas: every representation of the same instant ─── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={1}>
          <TextPane label="The same instant, four ways" lines={undefined}>
            <div className="flex flex-col">
              {FIELDS.map((meta) => {
                const value =
                  meta.tag && draft?.field === meta.tag ? draft.value : values[meta.id];
                return (
                <div
                  key={meta.label}
                  className="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0"
                >
                  <label
                    htmlFor={meta.id}
                    className="w-36 shrink-0 font-body text-[11.5px] leading-none text-text-muted"
                  >
                    {meta.label}
                  </label>
                  <input
                    id={meta.id}
                    type="text"
                    value={value}
                    onChange={(e) => handlers[meta.id](e.target.value)}
                    onBlur={() => setDraft(null)}
                    readOnly={meta.readOnly}
                    aria-readonly={meta.readOnly || undefined}
                    placeholder={meta.placeholder}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] leading-none text-neutral-200 placeholder:text-text-muted focus:outline-none"
                  />
                  <button
                    onClick={() => handleCopy(meta.label, values[meta.id])}
                    aria-label={copied === meta.label ? `Copied ${meta.label}` : `Copy ${meta.label}`}
                    className="flex-none cursor-pointer font-body text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
                  >
                    {copied === meta.label ? "Copied!" : "Copy"}
                  </button>
                </div>
                );
              })}
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
