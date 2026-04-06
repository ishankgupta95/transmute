"use client";

import { useCallback, useState } from "react";

export function TimestampConverterUI() {
  const [unixSec, setUnixSec] = useState("");
  const [unixMs, setUnixMs] = useState("");
  const [iso, setIso] = useState("");
  const [human, setHuman] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const updateAll = useCallback((date: Date) => {
    if (isNaN(date.getTime())) return;
    setUnixSec(String(Math.floor(date.getTime() / 1000)));
    setUnixMs(String(date.getTime()));
    setIso(date.toISOString());
    setHuman(date.toLocaleString());
  }, []);

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

  const handleCopy = useCallback((label: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <button
          onClick={handleNow}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Now
        </button>
      </div>

      <div className="space-y-3 max-w-lg mx-auto">
        {[
          { label: "Unix (seconds)", value: unixSec, onChange: handleUnixSec, placeholder: "1700000000" },
          { label: "Unix (milliseconds)", value: unixMs, onChange: handleUnixMs, placeholder: "1700000000000" },
          { label: "ISO 8601", value: iso, onChange: handleIso, placeholder: "2024-01-01T00:00:00.000Z" },
          { label: "Human-readable", value: human, onChange: () => {}, placeholder: "Local date string", readOnly: true },
        ].map((field) => (
          <div key={field.label} className="flex items-center gap-2">
            <label className="w-36 text-sm text-text-muted shrink-0">{field.label}</label>
            <input
              type="text"
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              readOnly={"readOnly" in field}
              placeholder={field.placeholder}
              className="flex-1 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted"
            />
            <button
              onClick={() => handleCopy(field.label, field.value)}
              className="text-xs text-accent hover:text-accent-hover transition-colors shrink-0"
            >
              {copied === field.label ? "Copied!" : "Copy"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
