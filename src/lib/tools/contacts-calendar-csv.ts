import {
  findBlocks,
  parseBlocks,
  splitStructured,
  toCsv,
  unescapeValue,
  type Block,
  type ContentLine,
} from "./rfc-content-lines";

/**
 * `.vcf` → CSV and `.ics` → CSV.
 *
 * Both sit on `rfc-content-lines.ts`, which owns the folding and escaping the
 * two formats share. What lives here is the only thing that genuinely differs:
 * which properties become columns, and how a property that legitimately
 * appears more than once is flattened into a table that has to be rectangular.
 */

export interface TabularResult {
  readonly csv: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Properties present in the file that no column captured. Never hidden. */
  readonly droppedProperties: readonly string[];
  /** Records that parsed but carried nothing recognisable. */
  readonly emptyRecords: number;
}

/**
 * THE FLATTENING PROBLEM, and the choice made about it.
 *
 * A contact may carry four phone numbers and three emails; an event may have
 * twenty attendees. A CSV is rectangular, so something has to give, and there
 * are only two honest options: one column per occurrence (`EMAIL 1`,
 * `EMAIL 2`, …), or one column holding all of them joined.
 *
 * NUMBERED COLUMNS are what this uses, because the alternative destroys the
 * thing people convert contacts FOR — importing them somewhere else. A joined
 * cell `a@x.com; b@y.com` is one string to every importer alive, and the
 * second address is silently lost on re-import. Numbered columns re-import.
 *
 * The count is derived from the file, so a list whose busiest contact has two
 * emails gets two columns, not a fixed ten mostly-empty ones.
 */
function collectValues(lines: readonly ContentLine[], name: string): string[] {
  return lines.filter((l) => l.name === name).map((l) => unescapeValue(l.value).trim());
}

/** `TEL;TYPE=CELL` → "TEL (CELL)", so a column says which number it is. */
function typeLabel(line: ContentLine): string {
  const type = line.params.TYPE;
  if (!type) return "";
  // Multi-valued TYPE is comma-separated inside one parameter.
  return type
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t && t !== "PREF" && t !== "INTERNET" && t !== "VOICE")
    .join("/");
}

/* ── vCard ───────────────────────────────────────────────────────────────── */

/**
 * The columns, in the order a person reads a contact.
 *
 * `N` is deliberately expanded into its five structured components rather than
 * dumped as `Smith;John;;Dr.;` — that semicolon string is what every naive
 * converter emits and no spreadsheet can use.
 */
const VCARD_SINGLE: ReadonlyArray<[property: string, header: string]> = [
  ["FN", "Full name"],
  ["NICKNAME", "Nickname"],
  ["ORG", "Organisation"],
  ["TITLE", "Job title"],
  ["BDAY", "Birthday"],
  ["NOTE", "Note"],
];
const VCARD_REPEATED: ReadonlyArray<[property: string, header: string]> = [
  ["EMAIL", "Email"],
  ["TEL", "Phone"],
  ["URL", "Website"],
  ["ADR", "Address"],
];
/** Present in every file and meaningless in a spreadsheet. */
const VCARD_IGNORED = new Set([
  "BEGIN",
  "END",
  "VERSION",
  "PRODID",
  "UID",
  "REV",
  "N",
  "PHOTO",
  "LOGO",
  "SOUND",
  "KEY",
  "X-ABLABEL",
  "CATEGORIES",
]);

export function vcardToCsv(text: string): TabularResult {
  const cards = findBlocks(parseBlocks(text), "VCARD");
  const dropped = new Set<string>();
  let emptyRecords = 0;

  // How many columns each repeated property needs, across the whole file.
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const [property] of VCARD_REPEATED) {
      counts.set(
        property,
        Math.max(counts.get(property) ?? 0, collectValues(card.lines, property).length),
      );
    }
  }

  const headers: string[] = ["Last name", "First name", "Middle name", "Prefix", "Suffix"];
  for (const [, header] of VCARD_SINGLE) headers.push(header);
  for (const [property, header] of VCARD_REPEATED) {
    const n = counts.get(property) ?? 0;
    for (let i = 0; i < n; i += 1) headers.push(n === 1 ? header : `${header} ${i + 1}`);
  }

  const rows: string[][] = [];
  for (const card of cards) {
    const row: string[] = [];

    // N is `Family;Given;Additional;Prefixes;Suffixes`.
    const n = card.lines.find((l) => l.name === "N");
    const parts = n ? splitStructured(n.value) : [];
    for (let i = 0; i < 5; i += 1) row.push((parts[i] ?? "").trim());

    for (const [property] of VCARD_SINGLE) {
      row.push(collectValues(card.lines, property)[0] ?? "");
    }

    for (const [property] of VCARD_REPEATED) {
      const lines = card.lines.filter((l) => l.name === property);
      const total = counts.get(property) ?? 0;
      for (let i = 0; i < total; i += 1) {
        const line = lines[i];
        if (!line) {
          row.push("");
          continue;
        }
        /*
          ADR is structured too — `;;street;locality;region;code;country` —
          and joining its non-empty parts with ", " is the only form that is
          readable in a cell AND survives a re-import as one address field.
        */
        const value =
          property === "ADR"
            ? splitStructured(line.value)
                .map((p) => p.trim())
                .filter(Boolean)
                .join(", ")
            : unescapeValue(line.value).trim();
        const label = typeLabel(line);
        row.push(label && value ? `${value} (${label})` : value);
      }
    }

    if (row.every((cell) => cell === "")) emptyRecords += 1;
    else rows.push(row);

    for (const line of card.lines) {
      const known =
        VCARD_IGNORED.has(line.name) ||
        VCARD_SINGLE.some(([p]) => p === line.name) ||
        VCARD_REPEATED.some(([p]) => p === line.name);
      if (!known) dropped.add(line.name);
    }
  }

  return {
    csv: toCsv(headers, rows),
    headers,
    rows,
    droppedProperties: [...dropped].sort(),
    emptyRecords,
  };
}

/* ── iCalendar ───────────────────────────────────────────────────────────── */

/**
 * Turn an iCalendar date-time into something a spreadsheet will accept.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT DO: convert time zones. A DTSTART may be
 * UTC (`20260910T140000Z`), floating (no zone at all), or carry `TZID=`
 * naming a zone whose rules live in a VTIMEZONE block further up the file.
 * Rewriting all three into one zone means guessing which the reader wants and
 * silently moving appointments by hours when the guess is wrong. So the local
 * wall-clock reading is emitted as written, and the zone is kept in its own
 * column where the reader can see it. A visible extra column beats an
 * invisible wrong time.
 */
function formatDateTime(line: ContentLine): { value: string; zone: string } {
  const raw = line.value.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(raw);
  if (!match) return { value: raw, zone: line.params.TZID ?? "" };

  const [, y, mo, d, h, mi, s, z] = match;
  const date = `${y}-${mo}-${d}`;
  const time = h ? ` ${h}:${mi}:${s}` : "";
  const zone = z ? "UTC" : (line.params.TZID ?? (h ? "floating" : ""));
  return { value: `${date}${time}`, zone };
}

const ICS_IGNORED = new Set([
  "BEGIN",
  "END",
  "DTSTAMP",
  "CREATED",
  "LAST-MODIFIED",
  "SEQUENCE",
  "TRANSP",
  "CLASS",
  "PRIORITY",
  "X-MICROSOFT-CDO-BUSYSTATUS",
]);

export function icsToCsv(text: string): TabularResult {
  const events = findBlocks(parseBlocks(text), "VEVENT");
  const dropped = new Set<string>();
  let emptyRecords = 0;

  const attendeeCount = events.reduce(
    (max, e) => Math.max(max, e.lines.filter((l) => l.name === "ATTENDEE").length),
    0,
  );

  const headers = [
    "Summary",
    "Starts",
    "Start zone",
    "Ends",
    "End zone",
    "All day",
    "Location",
    "Description",
    "Status",
    "Organiser",
    "Repeats",
    "UID",
  ];
  for (let i = 0; i < attendeeCount; i += 1) {
    headers.push(attendeeCount === 1 ? "Attendee" : `Attendee ${i + 1}`);
  }

  const rows: string[][] = [];
  for (const event of events) {
    const at = (name: string) => event.lines.find((l) => l.name === name);
    const start = at("DTSTART");
    const end = at("DTEND") ?? at("DUE");
    const startAt = start ? formatDateTime(start) : { value: "", zone: "" };
    const endAt = end ? formatDateTime(end) : { value: "", zone: "" };

    // `VALUE=DATE` with no time component is the all-day marker.
    const allDay = start?.params.VALUE === "DATE" || /^\d{8}$/.test(start?.value.trim() ?? "");

    const row = [
      unescapeValue(at("SUMMARY")?.value ?? "").trim(),
      startAt.value,
      startAt.zone,
      endAt.value,
      endAt.zone,
      allDay ? "yes" : "",
      unescapeValue(at("LOCATION")?.value ?? "").trim(),
      unescapeValue(at("DESCRIPTION")?.value ?? "").trim(),
      (at("STATUS")?.value ?? "").trim(),
      // `mailto:` is noise in a spreadsheet; the display name is the useful part.
      (at("ORGANIZER")?.params.CN ?? (at("ORGANIZER")?.value ?? "").replace(/^mailto:/i, "")).trim(),
      /*
        The recurrence RULE, verbatim, and NOT its expansion. Expanding it
        would turn one row into hundreds and require resolving COUNT, UNTIL,
        EXDATE and the calendar's own time zone — every one of which is a
        chance to invent appointments that do not exist. One row per event as
        the file stores it is what the file actually says.
      */
      (at("RRULE")?.value ?? "").trim(),
      (at("UID")?.value ?? "").trim(),
    ];

    const attendees = event.lines.filter((l) => l.name === "ATTENDEE");
    for (let i = 0; i < attendeeCount; i += 1) {
      const a = attendees[i];
      row.push(a ? (a.params.CN ?? a.value.replace(/^mailto:/i, "")).trim() : "");
    }

    if (row.every((cell) => cell === "")) emptyRecords += 1;
    else rows.push(row);

    for (const line of event.lines) {
      const known =
        ICS_IGNORED.has(line.name) ||
        [
          "SUMMARY",
          "DTSTART",
          "DTEND",
          "DUE",
          "LOCATION",
          "DESCRIPTION",
          "STATUS",
          "ORGANIZER",
          "RRULE",
          "UID",
          "ATTENDEE",
        ].includes(line.name);
      if (!known) dropped.add(line.name);
    }
  }

  return {
    csv: toCsv(headers, rows),
    headers,
    rows,
    droppedProperties: [...dropped].sort(),
    emptyRecords,
  };
}

/** How many recurring events are in the file — the UI says so, because one row is not one occurrence. */
export function countRecurring(text: string): number {
  return findBlocks(parseBlocks(text), "VEVENT").filter((e: Block) =>
    e.lines.some((l) => l.name === "RRULE"),
  ).length;
}
