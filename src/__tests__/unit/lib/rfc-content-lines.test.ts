import { describe, expect, it } from "vitest";

import {
  csvCell,
  parseBlocks,
  parseContentLine,
  splitStructured,
  unescapeValue,
  unfoldLines,
} from "@/lib/tools/rfc-content-lines";
import { icsToCsv, vcardToCsv } from "@/lib/tools/contacts-calendar-csv";

/*
  vCard and iCalendar parsing.

  This is all pure string work, so unlike the media tools it can be tested
  exhaustively here — no canvas, no wasm, no blind spot. The cases below are
  the ones that corrupt data SILENTLY rather than failing: folding, quoted
  colons, escaped separators, and the spreadsheet formula hazard.
*/

describe("unfolding, the rule that silently truncates when missed", () => {
  it("joins a continuation line and CONSUMES the whitespace marker", () => {
    /*
      75-octet folding is routine in real exports; a parser that splits on
      newlines alone loses the tail of every long field and invents a row.

      ⚠ The marker character is REMOVED, not turned into a space. RFC 5545
      §3.1 unfolds by "removing the CRLF and the linear white-space character
      that immediately follows" — so `hello` + ` world` is `helloworld`, and a
      parser that inserts a space corrupts every word split across a fold.
      These two expectations originally said otherwise and the implementation
      was right; they are the reason this comment exists.
    */
    expect(unfoldLines("NOTE:hello\n world")).toEqual(["NOTE:helloworld"]);
    expect(unfoldLines("NOTE:hello\n\tworld")).toEqual(["NOTE:helloworld"]);
  });

  it("keeps a SECOND space, because only the first is the marker", () => {
    // The pair to the case above: one space is the fold marker and is eaten;
    // anything after it is content. This is how a real space survives a fold.
    expect(unfoldLines("NOTE:a\n  b")).toEqual(["NOTE:a b"]);
  });

  it("handles CRLF, bare LF and bare CR alike", () => {
    expect(unfoldLines("A:1\r\nB:2")).toEqual(["A:1", "B:2"]);
    expect(unfoldLines("A:1\rB:2")).toEqual(["A:1", "B:2"]);
  });

  it("folds across three lines, not just two", () => {
    expect(unfoldLines("NOTE:one\n two\n three")).toEqual(["NOTE:onetwothree"]);
  });
});

describe("content lines", () => {
  it("splits on the first UNQUOTED colon", () => {
    /*
      The case that separates a working parser from one that mangles exactly
      the files that matter: a quoted parameter may contain a colon.
    */
    const line = parseContentLine('ATTENDEE;CN="Smith, J:r":mailto:a@b.com')!;
    expect(line.name).toBe("ATTENDEE");
    expect(line.params.CN).toBe("Smith, J:r");
    expect(line.value).toBe("mailto:a@b.com");
  });

  it("drops Apple's `item1.` group prefix so columns line up", () => {
    expect(parseContentLine("item1.EMAIL;TYPE=WORK:a@b.com")!.name).toBe("EMAIL");
  });

  it("keeps a bare vCard 2.1 parameter as TYPE rather than discarding it", () => {
    expect(parseContentLine("TEL;HOME:555")!.params.TYPE).toBe("HOME");
  });

  it("returns null for a line with no colon at all", () => {
    expect(parseContentLine("GARBAGE")).toBeNull();
  });
});

describe("escaping", () => {
  it("unescapes newline, comma, semicolon and backslash", () => {
    expect(unescapeValue("a\\nb")).toBe("a\nb");
    expect(unescapeValue("a\\,b")).toBe("a,b");
    expect(unescapeValue("a\\;b")).toBe("a;b");
    expect(unescapeValue("a\\\\b")).toBe("a\\b");
  });

  it("does not turn an escaped backslash followed by n into a newline", () => {
    // `\\n` is a literal backslash then the letter n. Unescaping the
    // backslash last would produce a newline and lose a character.
    expect(unescapeValue("a\\\\nb")).toBe("a\\nb");
  });

  it("splits a structured value on unescaped separators only", () => {
    expect(splitStructured("Smith;John;;Dr.;")).toEqual(["Smith", "John", "", "Dr.", ""]);
    expect(splitStructured("a\\;b;c")).toEqual(["a;b", "c"]);
  });
});

describe("blocks", () => {
  it("keeps a nested VALARM out of its VEVENT's own lines", () => {
    // Otherwise a reminder's SUMMARY lands in the event's Summary column.
    const [cal] = parseBlocks(
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Real\nBEGIN:VALARM\nSUMMARY:Reminder\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR",
    );
    const event = cal.blocks[0];
    expect(event.kind).toBe("VEVENT");
    expect(event.lines.map((l) => l.value)).toEqual(["Real"]);
    expect(event.blocks[0].kind).toBe("VALARM");
  });

  it("returns what it has when the file is truncated mid-block", () => {
    // Truncated exports are common; half a contact list beats an error.
    const blocks = parseBlocks("BEGIN:VCARD\nFN:Ada\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines[0].value).toBe("Ada");
  });
});

describe("CSV output", () => {
  it("defuses a cell that a spreadsheet would run as a formula", () => {
    /*
      Not paranoia: a cell starting `=`, `+`, `-` or `@` is EXECUTED by Excel,
      Numbers and Sheets, and contact exports carry arbitrary text. The single
      quote is the standard defusal and no spreadsheet displays it.
    */
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+44 7700 900000")).toBe("'+44 7700 900000");
    expect(csvCell("@handle")).toBe("'@handle");
    expect(csvCell("-5")).toBe("'-5");
    // …and an ordinary value is left alone.
    expect(csvCell("Ada")).toBe("Ada");
  });

  it("quotes and doubles quotes per RFC 4180", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
  });
});

describe("vcardToCsv", () => {
  const CARD = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:Lovelace;Ada;Byron;Ms.;",
    "FN:Ada Lovelace",
    "ORG:Analytical Engines",
    "EMAIL;TYPE=WORK:ada@work.example",
    "EMAIL;TYPE=HOME:ada@home.example",
    "TEL;TYPE=CELL:+44 7700 900000",
    "ADR;TYPE=HOME:;;12 High St;London;;SW1A 1AA;UK",
    "END:VCARD",
  ].join("\r\n");

  it("expands N into five columns rather than dumping the semicolon string", () => {
    const { headers, rows } = vcardToCsv(CARD);
    expect(headers.slice(0, 5)).toEqual([
      "Last name",
      "First name",
      "Middle name",
      "Prefix",
      "Suffix",
    ]);
    expect(rows[0].slice(0, 5)).toEqual(["Lovelace", "Ada", "Byron", "Ms.", ""]);
  });

  it("gives each repeated property its own numbered column", () => {
    // The whole reason not to join with "; ": a joined cell is ONE string to
    // every importer, and the second address is lost on re-import.
    const { headers } = vcardToCsv(CARD);
    expect(headers).toContain("Email 1");
    expect(headers).toContain("Email 2");
    // One phone in the file means one column, not a fixed ten.
    expect(headers).toContain("Phone");
    expect(headers).not.toContain("Phone 2");
  });

  it("labels a repeated value with its type", () => {
    const { headers, rows } = vcardToCsv(CARD);
    expect(rows[0][headers.indexOf("Email 1")]).toBe("ada@work.example (WORK)");
  });

  it("renders a structured address as one readable cell", () => {
    const { headers, rows } = vcardToCsv(CARD);
    expect(rows[0][headers.indexOf("Address")]).toBe("12 High St, London, SW1A 1AA, UK (HOME)");
  });

  it("reports properties it dropped instead of hiding them", () => {
    const { droppedProperties } = vcardToCsv(
      "BEGIN:VCARD\r\nFN:X\r\nX-SOCIALPROFILE:someone\r\nEND:VCARD",
    );
    expect(droppedProperties).toContain("X-SOCIALPROFILE");
  });

  it("survives a folded line inside a real card", () => {
    const folded = "BEGIN:VCARD\r\nFN:Ada\r\nNOTE:the first part \r\n and the rest\r\nEND:VCARD";
    const { headers, rows } = vcardToCsv(folded);
    expect(rows[0][headers.indexOf("Note")]).toBe("the first part and the rest");
  });
});

describe("icsToCsv", () => {
  const CAL = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:1@example",
    "SUMMARY:Weekly sync",
    "DTSTART;TZID=Europe/London:20260910T140000",
    "DTEND;TZID=Europe/London:20260910T150000",
    "LOCATION:Room 2",
    "RRULE:FREQ=WEEKLY;COUNT=10",
    "ORGANIZER;CN=Ada:mailto:ada@example",
    "ATTENDEE;CN=Grace:mailto:grace@example",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("keeps the wall-clock time and puts the zone in its own column", () => {
    /*
      The decision this pins: NOT converting time zones. Rewriting into one
      zone means guessing which the reader wants and moving appointments by
      hours when the guess is wrong. A visible column beats an invisible
      wrong time.
    */
    const { headers, rows } = icsToCsv(CAL);
    expect(rows[0][headers.indexOf("Starts")]).toBe("2026-09-10 14:00:00");
    expect(rows[0][headers.indexOf("Start zone")]).toBe("Europe/London");
  });

  it("marks UTC and floating times as what they are", () => {
    const utc = icsToCsv("BEGIN:VEVENT\r\nDTSTART:20260910T140000Z\r\nEND:VEVENT");
    expect(utc.rows[0][utc.headers.indexOf("Start zone")]).toBe("UTC");
    const floating = icsToCsv("BEGIN:VEVENT\r\nDTSTART:20260910T140000\r\nEND:VEVENT");
    expect(floating.rows[0][floating.headers.indexOf("Start zone")]).toBe("floating");
  });

  it("recognises an all-day event", () => {
    const allDay = icsToCsv("BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260910\r\nEND:VEVENT");
    expect(allDay.rows[0][allDay.headers.indexOf("All day")]).toBe("yes");
    expect(allDay.rows[0][allDay.headers.indexOf("Starts")]).toBe("2026-09-10");
  });

  it("keeps the recurrence RULE and does NOT expand it into occurrences", () => {
    // Expanding would turn one row into hundreds and require resolving COUNT,
    // UNTIL, EXDATE and the calendar's zone — each a chance to invent an
    // appointment that does not exist.
    const { headers, rows } = icsToCsv(CAL);
    expect(rows).toHaveLength(1);
    expect(rows[0][headers.indexOf("Repeats")]).toBe("FREQ=WEEKLY;COUNT=10");
  });

  it("prefers a display name over a mailto: URI", () => {
    const { headers, rows } = icsToCsv(CAL);
    expect(rows[0][headers.indexOf("Organiser")]).toBe("Ada");
    expect(rows[0][headers.indexOf("Attendee")]).toBe("Grace");
  });

  it("does not take an alarm's summary for the event's", () => {
    const withAlarm = CAL.replace(
      "END:VEVENT",
      "BEGIN:VALARM\r\nSUMMARY:Reminder\r\nEND:VALARM\r\nEND:VEVENT",
    );
    const { headers, rows } = icsToCsv(withAlarm);
    expect(rows[0][headers.indexOf("Summary")]).toBe("Weekly sync");
  });
});
