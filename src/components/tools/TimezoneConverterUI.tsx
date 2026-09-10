"use client";

import { useCallback, useMemo, useState } from "react";

import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
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
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  filterZones,
  formatOffset,
  isValidZone,
  isoDate,
  isoTime,
  listTimeZones,
  localZone,
  parseUnixTimestamp,
  readZone,
  readZones,
  resolveWallClock,
  unixSeconds,
  zoneCity,
  type WallClock,
} from "@/lib/tools/timezones";

/** The one field box the redesign doc specifies — same shape as the subtitle tool's. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The columns a fresh page opens with: this device, UTC, and the three zones
 * most scheduling actually crosses. Filtered through `isValidZone` because an
 * older engine may not know all of them, and deduplicated because the local
 * zone is very often already one of them.
 */
function defaultZones(): string[] {
  const wanted = [
    localZone(),
    "UTC",
    "America/New_York",
    "Europe/London",
    "Asia/Kolkata",
  ];
  return Array.from(new Set(wanted)).filter(isValidZone);
}

/** "2026-09-05" + "14:30" → a wall clock, or null if either field is unusable. */
function readFields(dateText: string, timeText: string): WallClock | null {
  const d = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = timeText.match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !t) return null;
  const wall = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: Number(t[1]),
    minute: Number(t[2]),
    second: 0,
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;
  return wall;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "8 March 2026" — for a sentence, where an ISO date reads as a serial number. */
function prose(wall: WallClock): string {
  return `${wall.day} ${MONTHS[wall.month - 1]} ${wall.year}`;
}

export function TimezoneConverterUI() {
  // `Intl.supportedValuesOf` is called once per mount, not per render: on this
  // machine it returns 418 strings and the picker re-filters them on every
  // keystroke as it is.
  const [{ zones: allZones, source: zoneListSource }] = useState(listTimeZones);

  const [zones, setZones] = useState<string[]>(defaultZones);
  const [sourceZone, setSourceZone] = useState<string>(() => defaultZones()[0]);

  const now = useMemo(() => new Date(), []);
  const [dateText, setDateText] = useState(() => isoDate(readZone(sourceZone, now).wall));
  const [timeText, setTimeText] = useState(() => isoTime(readZone(sourceZone, now).wall));

  const [zoneQuery, setZoneQuery] = useState("");
  const [pending, setPending] = useState("");

  const [tsUnit, setTsUnit] = useState<"s" | "ms">("s");
  /*
    Draft vs canonical, the same split TimestampConverterUI uses: while the
    field is being typed into it shows exactly what was typed, and only a
    parseable value is written back into the date and time fields. Without
    this, "17" parses as 17 seconds past the epoch after two keystrokes and
    rewrites the whole form mid-word.
  */
  const [tsDraft, setTsDraft] = useState<string | null>(null);

  const { copied, copy } = useCopied();

  const wall = useMemo(() => readFields(dateText, timeText), [dateText, timeText]);
  const resolution = useMemo(
    () => (wall ? resolveWallClock(sourceZone, wall) : null),
    [wall, sourceZone],
  );
  const instant = resolution?.instant ?? null;

  const rows = useMemo(
    () => (instant ? readZones(zones, instant, sourceZone) : []),
    [zones, instant, sourceZone],
  );

  const crossingDate = rows.filter((r) => r.dayShift !== 0).length;

  const candidates = useMemo(
    () => filterZones(allZones, zoneQuery).filter((z) => !zones.includes(z)),
    [allZones, zoneQuery, zones],
  );

  const handleAdd = useCallback(() => {
    const zone = pending || candidates[0];
    if (!zone || zones.includes(zone) || !isValidZone(zone)) return;
    setZones((prev) => [...prev, zone]);
    setPending("");
    setZoneQuery("");
  }, [pending, candidates, zones]);

  const handleRemove = useCallback(
    (zone: string) => {
      setZones((prev) => {
        const next = prev.filter((z) => z !== zone);
        // The anchor cannot be a zone that is no longer on the board.
        if (zone === sourceZone && next.length > 0) setSourceZone(next[0]);
        return next;
      });
    },
    [sourceZone],
  );

  const handleNow = useCallback(() => {
    const current = new Date();
    const here = readZone(sourceZone, current);
    setDateText(isoDate(here.wall));
    setTimeText(isoTime(here.wall));
    setTsDraft(null);
  }, [sourceZone]);

  const handleReset = useCallback(() => {
    const fresh = defaultZones();
    setZones(fresh);
    setSourceZone(fresh[0]);
    setZoneQuery("");
    setPending("");
    setTsDraft(null);
  }, []);

  const handleTimestamp = useCallback(
    (text: string) => {
      setTsDraft(text);
      const parsed = parseUnixTimestamp(text, tsUnit);
      if (!parsed) return;
      const here = readZone(sourceZone, parsed);
      setDateText(isoDate(here.wall));
      setTimeText(isoTime(here.wall));
    },
    [tsUnit, sourceZone],
  );

  const tsValue =
    tsDraft ??
    (instant ? String(tsUnit === "s" ? unixSeconds(instant) : instant.getTime()) : "");
  const tsInvalid = tsDraft !== null && tsDraft !== "" && parseUnixTimestamp(tsDraft, tsUnit) === null;

  /** The whole board as plain text, in the order it is drawn. */
  const summary = useMemo(() => {
    if (!instant || rows.length === 0) return "";
    const head = `${dateText} ${timeText} ${sourceZone}`;
    const body = rows.map(
      (r) =>
        `${r.zone}  ${r.date} ${r.time}  ${r.offsetLabel}${r.abbreviation ? ` ${r.abbreviation}` : ""}${
          r.dayShift === 0 ? "" : `  (${r.dayShift > 0 ? "+" : ""}${r.dayShift} day)`
        }`,
    );
    return [head, ...body, `UTC instant: ${instant.toISOString()}`].join("\n");
  }, [instant, rows, dateText, timeText, sourceZone]);

  const handleCopy = useCallback(() => {
    void copy(summary);
  }, [copy, summary]);

  return (
    <>
      {/* ── Canvas: one instant, read by every zone on the board ─────── */}
      <div className={CANVAS_COLUMN}>
        {!wall && (
          <ErrorMessage message="That date and time could not be read. Use the date and time pickers, or type them as 2026-09-05 and 14:30." />
        )}

        {resolution?.kind === "gap" && wall && (
          <WarningMessage
            message={`There is no ${isoTime(wall)} on ${prose(wall)} in ${sourceZone}. The clock jumps forward by ${resolution.gapMinutes} minutes that day when daylight saving starts, so that reading never happens. Everything below is computed from ${isoTime(resolution.landsOn)}, which is what the instant ${resolution.gapMinutes} minutes later actually reads as — the same instant a calendar invite for the missing time would end up at.`}
          />
        )}
        {resolution?.kind === "ambiguous" && wall && (
          <WarningMessage
            message={`${isoTime(wall)} on ${prose(wall)} happens twice in ${sourceZone} — once at UTC${formatOffset(resolution.offsets[0])} and again ${resolution.repeatMinutes} minutes later at UTC${formatOffset(resolution.offsets[1])}, when the clock goes back. The board below uses the first of the two, ${resolution.instants[0].toISOString()}. The second is ${resolution.instants[1].toISOString()}. Nothing about the wall clock you typed distinguishes them, which is why this is shown rather than picked quietly.`}
          />
        )}

        <TextPanes columns={1}>
          <TextPane
            label={`${zones.length} ${zones.length === 1 ? "zone" : "zones"}, one instant`}
            action={
              summary ? (
                <button
                  onClick={handleCopy}
                  aria-label={copied ? "Copied the board" : "Copy the board"}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              ) : undefined
            }
          >
            <div className="flex flex-col">
              {/* The anchor row: the wall clock you are planning from. */}
              <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-text-primary/3 px-3.5 py-3">
                <label
                  htmlFor="tz-date"
                  className="font-body text-[11.5px] leading-none text-text-muted"
                >
                  When
                </label>
                <input
                  id="tz-date"
                  type="date"
                  value={dateText}
                  onChange={(e) => {
                    setDateText(e.target.value);
                    setTsDraft(null);
                  }}
                  aria-label="Date"
                  className={cn(FIELD_CLASS, "w-[150px]")}
                />
                <input
                  id="tz-time"
                  type="time"
                  value={timeText}
                  onChange={(e) => {
                    setTimeText(e.target.value);
                    setTsDraft(null);
                  }}
                  aria-label="Time"
                  className={cn(FIELD_CLASS, "w-[110px]")}
                />
                <label
                  htmlFor="tz-source"
                  className="font-body text-[11.5px] leading-none text-text-muted"
                >
                  in
                </label>
                <select
                  id="tz-source"
                  value={sourceZone}
                  onChange={(e) => setSourceZone(e.target.value)}
                  aria-label="Plan from this zone"
                  className={cn(FIELD_CLASS, "min-w-0 max-w-full flex-1")}
                >
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>

              {rows.map((row) => (
                <div
                  key={row.zone}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-3.5 py-[11px] last:border-b-0"
                >
                  <span className="flex min-w-[9rem] flex-col gap-0.5">
                    <span className="truncate font-body text-[12.5px] leading-none text-neutral-200">
                      {zoneCity(row.zone)}
                      {row.zone === sourceZone ? " ·" : ""}
                      {row.zone === sourceZone ? (
                        <span className="text-accent-300"> anchor</span>
                      ) : null}
                    </span>
                    {/* The full IANA identifier, which is the only unambiguous
                        name on the row — city names repeat and abbreviations
                        are shared between countries. */}
                    <span className="truncate font-mono text-[9.5px] leading-none text-text-muted">
                      {row.zone}
                    </span>
                  </span>

                  <span className="font-mono text-[16px] leading-none font-medium text-accent-300">
                    {row.time}
                  </span>

                  <span className="font-mono text-[10.5px] leading-none text-text-muted">
                    {row.weekday.slice(0, 3)} {row.date}
                  </span>

                  {row.dayShift !== 0 && (
                    <span className="rounded-[5px] border border-warning/40 px-1.5 py-0.5 font-mono text-[9.5px] leading-none text-warning">
                      {row.dayShift > 0 ? "+" : ""}
                      {row.dayShift} DAY
                    </span>
                  )}

                  <span className="ml-auto font-mono text-[10.5px] leading-none whitespace-nowrap text-text-muted">
                    UTC{row.offsetLabel}
                    {row.abbreviation ? ` · ${row.abbreviation}` : ""}
                  </span>

                  {zones.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemove(row.zone)}
                      aria-label={`Remove ${row.zone}`}
                      className="flex-none cursor-pointer font-mono text-[11px] leading-none text-text-muted transition-colors hover:text-error"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </TextPane>
        </TextPanes>

        <CanvasFootnote>
          {crossingDate > 0
            ? `${crossingDate} OF ${rows.length} ZONES ${crossingDate === 1 ? "IS" : "ARE"} ON A DIFFERENT CALENDAR DATE`
            : "EVERY ZONE ON THE BOARD IS ON THE SAME CALENDAR DATE"}
          {instant ? ` · ${instant.toISOString()}` : ""}
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel="Now"
            onPrimary={handleNow}
            onReset={handleReset}
            resetLabel="RESET ZONES"
          />
        }
      >
        <ToolControlGroup>
          <ToolControl label="ADD A ZONE">
            <input
              type="text"
              value={zoneQuery}
              onChange={(e) => {
                setZoneQuery(e.target.value);
                setPending("");
              }}
              placeholder="Filter — tokyo, america/new"
              aria-label="Filter zones"
              className={cn(FIELD_CLASS, "w-full")}
            />
            <div className="flex items-center gap-2">
              <select
                value={pending || candidates[0] || ""}
                onChange={(e) => setPending(e.target.value)}
                aria-label="Zone to add"
                disabled={candidates.length === 0}
                className={cn(FIELD_CLASS, "min-w-0 flex-1 disabled:opacity-45")}
              >
                {candidates.length === 0 ? (
                  <option value="">No zone matches</option>
                ) : (
                  candidates.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={candidates.length === 0}
                className="h-[30px] flex-none cursor-pointer rounded-[7px] border border-accent bg-accent/8 px-3 font-mono text-[11px] leading-none text-accent transition-colors hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                ADD
              </button>
            </div>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {zoneListSource === "intl"
                ? `${allZones.length} zones, read from this browser's own IANA database.`
                : `${allZones.length} common zones from a built-in list — this browser does not expose its full zone list, so the picker is not every zone it knows.`}
            </span>
          </ToolControl>

          <ToolControl label="UNIX TIMESTAMP">
            <ToolChoice
              label="Timestamp unit"
              value={tsUnit}
              onChange={setTsUnit}
              options={[
                { value: "s" as const, label: "Seconds" },
                { value: "ms" as const, label: "Milliseconds" },
              ]}
            />
            <input
              type="text"
              value={tsValue}
              onChange={(e) => handleTimestamp(e.target.value)}
              onBlur={() => setTsDraft(null)}
              placeholder={tsUnit === "s" ? "1700000000" : "1700000000000"}
              aria-label="Unix timestamp"
              aria-invalid={tsInvalid || undefined}
              className={cn(FIELD_CLASS, "w-full", tsInvalid && "border-error")}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Reads both ways: the field follows the board, and typing a number
              into it moves the board. The unit is a choice rather than a guess —
              the same digits mean November 2023 read as seconds and January 1970
              read as milliseconds. ISO 8601 and the four-field version of this
              live on the Timestamp Converter page.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["This device", localZone()],
              ["UTC instant", instant ? instant.toISOString().replace(".000Z", "Z") : "—"],
              ["Unix seconds", instant ? String(unixSeconds(instant)) : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="HOW THE OFFSETS ARE READ">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every offset and abbreviation on the board is asked of{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">Intl.DateTimeFormat</code>{" "}
            for the exact instant shown — never added or subtracted from a stored
            number. An offset belongs to a moment, not to a zone: New York is
            UTC-05:00 in January and UTC-04:00 in July, and the southern
            hemisphere runs the other way round. Where a zone has no customary
            letter abbreviation the browser gives a{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">GMT+5:30</code> form, and
            that is shown as-is rather than dressed up.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing here is uploaded, and no clock is fetched: the instant comes
            from this device, and the zone rules come from the browser&rsquo;s own
            copy of the IANA database. If that copy is out of date, so is this
            page.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
