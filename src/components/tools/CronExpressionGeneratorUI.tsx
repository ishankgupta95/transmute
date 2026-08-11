"use client";

import { useCallback, useMemo, useState } from "react";
import { useIsClient } from "@/hooks/useIsClient";

import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
} from "@/components/tools/ToolAside";
import {
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { cn } from "@/lib/utils/cn";

const MINUTES = ["*", ...Array.from({ length: 60 }, (_, i) => String(i))];
const HOURS = ["*", ...Array.from({ length: 24 }, (_, i) => String(i))];
const DAYS = ["*", ...Array.from({ length: 31 }, (_, i) => String(i + 1))];
const MONTHS = ["*", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["*", "0", "1", "2", "3", "4", "5", "6"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CronFieldKind = "minute" | "hour" | "day" | "month" | "weekday";

function cronValueName(kind: CronFieldKind, v: string): string {
  if (kind === "month") return MONTH_NAMES[Number(v)] || v;
  if (kind === "weekday") return WEEKDAY_NAMES[Number(v) % 7] ?? v; // 7 = Sunday too
  return v;
}

function listWords(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

const isPlainValue = (f: string) => /^\d+$/.test(f);

/**
 * One field as words. The old describer only knew `*` and plain values, so
 * the manual input's lists/ranges/steps leaked through raw — "At minute * /5
 * of every hour on day 1,15 of the month". `null` means unrestricted.
 */
function describeCronField(field: string, kind: CronFieldKind): string | null {
  if (field === "*") return null;
  const [base, step] = field.split("/");
  if (step !== undefined) {
    const every = `every ${step} ${kind}s`;
    if (base === "*" || base === "") return every;
    if (base.includes("-")) {
      const [a, b] = base.split("-");
      return `${every} from ${cronValueName(kind, a)} through ${cronValueName(kind, b)}`;
    }
    return `${every} starting at ${cronValueName(kind, base)}`;
  }
  if (field.includes(",")) {
    return listWords(field.split(",").map((v) => cronValueName(kind, v.trim())));
  }
  if (field.includes("-")) {
    const [a, b] = field.split("-");
    return `${cronValueName(kind, a)} through ${cronValueName(kind, b)}`;
  }
  return cronValueName(kind, field);
}

function describeCron(parts: string[]): string {
  const [min, hour, day, month, weekday] = parts;
  const pieces: string[] = [];

  // Time of day. Plain values keep the tight forms; lists/ranges/steps get
  // the field describer.
  if (min === "*" && hour === "*") pieces.push("Every minute");
  else if (isPlainValue(min) && isPlainValue(hour))
    pieces.push(`At ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`);
  else if (isPlainValue(min) && hour === "*") pieces.push(`At minute ${min} of every hour`);
  else if (min === "*" && isPlainValue(hour)) pieces.push(`Every minute of hour ${hour}`);
  else {
    const minPhrase =
      min === "*"
        ? "Every minute"
        : min.includes("/")
          ? (describeCronField(min, "minute") ?? "").replace(/^every/, "Every")
          : `At minute${/[,-]/.test(min) ? "s" : ""} ${describeCronField(min, "minute")}`;
    const hourPhrase =
      hour === "*"
        ? null
        : hour.includes("/")
          ? describeCronField(hour, "hour")
          : `of hour${/[,-]/.test(hour) ? "s" : ""} ${describeCronField(hour, "hour")}`;
    pieces.push(hourPhrase ? `${minPhrase} ${hourPhrase}` : minPhrase);
  }

  if (day !== "*") {
    pieces.push(
      day.includes("/")
        ? `on ${describeCronField(day, "day")} of the month`
        : `on day${/[,-]/.test(day) ? "s" : ""} ${describeCronField(day, "day")} of the month`,
    );
  }
  if (month !== "*") {
    pieces.push(
      month.includes("/")
        ? `${describeCronField(month, "month")}`
        : `in ${describeCronField(month, "month")}`,
    );
  }
  if (weekday !== "*") {
    // Both day fields restricted means OR, not AND — say so, because "on day 15
    // on Mon" reads as an intersection and would badly mislead.
    const joiner = day !== "*" ? "or on" : "on";
    pieces.push(`${joiner} ${describeCronField(weekday, "weekday")}`);
  }

  return pieces.join(" ");
}

/**
 * Match one cron field against a value.
 *
 * Handles the whole `a,b`, `a-b`, `*`, `a-b/step` and `a/step` grammar. The
 * step is counted from the term's own start, which is the part the previous
 * implementation dropped: it reduced every stepped term to `value % step === 0`,
 * so `5/15` fired at 0/15/30/45 instead of 5/20/35/50, and `*` + `/2` on
 * day-of-month picked the even days rather than starting from day 1.
 */
function fieldMatches(field: string, current: number, min: number, max: number): boolean {
  return field.split(",").some((term) => termMatches(term.trim(), current, min, max));
}

function termMatches(term: string, current: number, min: number, max: number): boolean {
  const [rangePart, stepPart] = term.split("/");
  const stepped = stepPart !== undefined;
  const step = stepped ? Number(stepPart) : 1;
  if (!Number.isInteger(step) || step < 1) return false;

  let start: number;
  let end: number;

  if (rangePart === "*" || rangePart === "") {
    start = min;
    end = max;
  } else if (rangePart.includes("-")) {
    const [from, to] = rangePart.split("-").map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    start = from;
    end = to;
  } else {
    const only = Number(rangePart);
    if (!Number.isInteger(only)) return false;
    start = only;
    // A bare value with a step ("5/15") means "from 5 to the end of the field";
    // without one it is that single value.
    end = stepped ? max : only;
  }

  if (current < start || current > end) return false;
  return (current - start) % step === 0;
}

/** Cron accepts both 0 and 7 for Sunday; `Date#getDay` only ever returns 0. */
function weekdayMatches(field: string, day: number): boolean {
  return fieldMatches(field, day, 0, 7) || (day === 0 && fieldMatches(field, 7, 0, 7));
}

function getNextRuns(expression: string, count: number): string[] {
  const parts = expression.split(" ");
  if (parts.length !== 5) return [];

  const runs: string[] = [];
  const now = new Date();
  const check = new Date(now);
  check.setSeconds(0, 0);
  check.setMinutes(check.getMinutes() + 1);

  // POSIX/Vixie rule: when *both* day-of-month and day-of-week are restricted,
  // the job runs when EITHER matches. Only when one of them is `*` do the two
  // combine as an intersection. Treating it as a plain AND meant an expression
  // like `0 9 1 * 1` ("the 1st, and every Monday") listed only the rare dates
  // that are both — often none at all in the window we scan.
  const domRestricted = parts[2] !== "*";
  const dowRestricted = parts[4] !== "*";

  let iterations = 0;
  while (runs.length < count && iterations < 525600) {
    iterations++;
    const m = check.getMinutes();
    const h = check.getHours();
    const d = check.getDate();
    const mo = check.getMonth() + 1;
    const wd = check.getDay();

    const dayOfMonthHit = fieldMatches(parts[2], d, 1, 31);
    const weekdayHit = weekdayMatches(parts[4], wd);
    const dayHit =
      domRestricted && dowRestricted
        ? dayOfMonthHit || weekdayHit
        : dayOfMonthHit && weekdayHit;

    if (
      fieldMatches(parts[0], m, 0, 59) &&
      fieldMatches(parts[1], h, 0, 23) &&
      fieldMatches(parts[3], mo, 1, 12) &&
      dayHit
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

  // `getNextRuns` reads the wall clock and formats with `toLocaleString`, so it
  // cannot run during the build-time prerender that `output: "export"` does —
  // the server HTML would carry the build machine's date and locale and then
  // disagree with the browser on hydration. Gate it on the client instead.
  // (`describeCron` is pure, so the description renders on the server fine.)
  const isClient = useIsClient();
  const nextRuns = useMemo(
    () => (isClient && isValid ? getNextRuns(expression, 5) : []),
    [isClient, expression, isValid],
  );

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
    <>
      {/* ── Canvas: the expression and what it will actually do ─ */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={nextRuns.length > 0 ? 2 : 1}>
          <TextPane label="Cron Expression" lines={1}>
            <input
              type="text"
              value={manualInput || expression}
              onChange={(e) => handleManualChange(e.target.value)}
              placeholder="0 9 * * 1"
              aria-label="Cron expression"
              className={cn(TEXT_PANE_BODY, "min-h-0 py-3.5")}
            />
            <p className="border-t border-border px-3.5 py-3 font-body text-[12.5px] leading-[1.4] text-text-secondary">
              {description}
            </p>
          </TextPane>

          {nextRuns.length > 0 && (
            <TextPane tone="out" label="Next 5 Run Times" lines={nextRuns.length}>
              <div className={cn(TEXT_PANE_BODY, "flex flex-col gap-1.5")}>
                {nextRuns.map((run, i) => (
                  <span key={i} className="text-neutral-300">
                    {run}
                  </span>
                ))}
              </div>
            </TextPane>
          )}
        </TextPanes>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions primaryLabel={copied ? "Copied!" : "Copy"} onPrimary={handleCopy} />
        }
      >
        <ToolAsideSection label="BUILDER">
          {/* Minute alone has 61 choices, so these stay selects rather than chips. */}
          <div className="flex flex-col gap-2">
            {[
              { label: "Minute", value: minute, options: MINUTES, set: (v: string) => { setMinute(v); setManualInput(""); } },
              { label: "Hour", value: hour, options: HOURS, set: (v: string) => { setHour(v); setManualInput(""); } },
              { label: "Day", value: day, options: DAYS, set: (v: string) => { setDay(v); setManualInput(""); } },
              { label: "Month", value: month, options: MONTHS, set: (v: string) => { setMonth(v); setManualInput(""); } },
              { label: "Weekday", value: weekday, options: WEEKDAYS, set: (v: string) => { setWeekday(v); setManualInput(""); } },
            ].map((field) => (
              <div key={field.label} className="flex items-center gap-2">
                <label className="w-16 shrink-0 text-xs text-text-muted">{field.label}</label>
                <select
                  value={field.value}
                  onChange={(e) => field.set(e.target.value)}
                  aria-label={field.label}
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text-primary"
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
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            <code className="font-mono">*</code> means every. Type ranges, lists or steps
            (<code className="font-mono">1-5</code>, <code className="font-mono">1,15</code>,{" "}
            <code className="font-mono">*/5</code>) straight into the expression field.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
