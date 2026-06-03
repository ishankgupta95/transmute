"use client";

import { useCallback, useMemo, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";

const MINUTES = ["*", ...Array.from({ length: 60 }, (_, i) => String(i))];
const HOURS = ["*", ...Array.from({ length: 24 }, (_, i) => String(i))];
const DAYS = ["*", ...Array.from({ length: 31 }, (_, i) => String(i + 1))];
const MONTHS = ["*", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["*", "0", "1", "2", "3", "4", "5", "6"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeCron(parts: string[]): string {
  const [min, hour, day, month, weekday] = parts;
  const pieces: string[] = [];

  if (min === "*" && hour === "*") pieces.push("Every minute");
  else if (min !== "*" && hour === "*") pieces.push(`At minute ${min} of every hour`);
  else if (min !== "*" && hour !== "*") pieces.push(`At ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`);
  else pieces.push(`Every minute of hour ${hour}`);

  if (day !== "*") pieces.push(`on day ${day} of the month`);
  if (month !== "*") pieces.push(`in ${MONTH_NAMES[Number(month)] || month}`);
  if (weekday !== "*") pieces.push(`on ${WEEKDAY_NAMES[Number(weekday)] || weekday}`);

  return pieces.join(" ");
}

function getNextRuns(expression: string, count: number): string[] {
  const parts = expression.split(" ");
  if (parts.length !== 5) return [];

  const runs: string[] = [];
  const now = new Date();
  const check = new Date(now);
  check.setSeconds(0, 0);
  check.setMinutes(check.getMinutes() + 1);

  const matches = (val: string, current: number): boolean => {
    if (val === "*") return true;
    if (val.includes(",")) return val.split(",").some((v) => Number(v) === current);
    if (val.includes("-")) {
      const [start, end] = val.split("-").map(Number);
      return current >= start && current <= end;
    }
    if (val.includes("/")) {
      const [, step] = val.split("/").map(Number);
      return current % step === 0;
    }
    return Number(val) === current;
  };

  let iterations = 0;
  while (runs.length < count && iterations < 525600) {
    iterations++;
    const m = check.getMinutes();
    const h = check.getHours();
    const d = check.getDate();
    const mo = check.getMonth() + 1;
    const wd = check.getDay();

    if (
      matches(parts[0], m) &&
      matches(parts[1], h) &&
      matches(parts[2], d) &&
      matches(parts[3], mo) &&
      matches(parts[4], wd)
    ) {
      runs.push(check.toLocaleString());
    }
    check.setMinutes(check.getMinutes() + 1);
  }
  return runs;
}

export function CronExpressionGeneratorUI() {
  const [minute, setMinute] = useState("0");
  const [hour, setHour] = useState("9");
  const [day, setDay] = useState("*");
  const [month, setMonth] = useState("*");
  const [weekday, setWeekday] = useState("1");
  const [manualInput, setManualInput] = useState("");
  const [copied, setCopied] = useState(false);

  const expression = manualInput || `${minute} ${hour} ${day} ${month} ${weekday}`;
  const parts = expression.trim().split(/\s+/);
  const isValid = parts.length === 5;

  const description = useMemo(() => (isValid ? describeCron(parts) : "Invalid expression"), [parts, isValid]);
  const nextRuns = useMemo(() => (isValid ? getNextRuns(expression, 5) : []), [expression, isValid]);

  const handleCopy = useCallback(() => {
    copyText(expression).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [expression]);

  const handleManualChange = useCallback((val: string) => {
    setManualInput(val);
    const p = val.trim().split(/\s+/);
    if (p.length === 5) {
      setMinute(p[0]);
      setHour(p[1]);
      setDay(p[2]);
      setMonth(p[3]);
      setWeekday(p[4]);
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Manual input */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Cron Expression</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualInput || expression}
            onChange={(e) => handleManualChange(e.target.value)}
            placeholder="0 9 * * 1"
            className="flex-1 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted"
          />
          <button onClick={handleCopy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Visual builder */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: "Minute", value: minute, options: MINUTES, set: (v: string) => { setMinute(v); setManualInput(""); } },
          { label: "Hour", value: hour, options: HOURS, set: (v: string) => { setHour(v); setManualInput(""); } },
          { label: "Day", value: day, options: DAYS, set: (v: string) => { setDay(v); setManualInput(""); } },
          { label: "Month", value: month, options: MONTHS, set: (v: string) => { setMonth(v); setManualInput(""); } },
          { label: "Weekday", value: weekday, options: WEEKDAYS, set: (v: string) => { setWeekday(v); setManualInput(""); } },
        ].map((field) => (
          <div key={field.label}>
            <label className="block text-xs text-text-muted mb-1">{field.label}</label>
            <select
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text-primary"
            >
              {field.options.map((o) => {
                let label = o;
                if (field.label === "Weekday" && o !== "*") label = WEEKDAY_NAMES[Number(o)];
                if (field.label === "Month" && o !== "*") label = MONTH_NAMES[Number(o)];
                return <option key={o} value={o}>{label}</option>;
              })}
            </select>
          </div>
        ))}
      </div>

      {/* Description */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4 text-center">
        <p className="text-sm text-text-secondary">{description}</p>
      </div>

      {/* Next runs */}
      {nextRuns.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Next 5 Run Times</label>
          <div className="space-y-1">
            {nextRuns.map((run, i) => (
              <div key={i} className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono">
                {run}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
