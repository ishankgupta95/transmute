import { describe, expect, it } from "vitest";
import {
  convertSubtitles,
  decodeSubtitleBytes,
  detectSubtitleFormat,
  formatAssTime,
  formatDuration,
  formatSrtTime,
  formatVttTime,
  parseAss,
  parseOffset,
  parseSrt,
  parseTimestamp,
  parseVtt,
  retimeCues,
  retimeScale,
  SubtitleError,
  subtitleFileName,
  writeAss,
  writeSrt,
  writeVtt,
  type SubtitleCue,
} from "@/lib/tools/subtitles";

/*
  subtitles.ts is pure functions over strings and bytes, so unlike most of this
  repo's engines it can be tested for real under jsdom — there is no canvas, no
  WASM and no worker between the test and the code that ships. These tests are
  therefore the actual gate on this tool, not a proxy for one.

  Every fixture below is hand-written to a real spelling seen in the wild: the
  period-instead-of-comma SRT, the WebVTT with cue settings and a `<v>` voice
  span, the SSA v4 `Marked` Format line, the ASS drawing cue.
*/

const cue = (start: number, end: number, text: string): SubtitleCue => ({ start, end, text });

/** Latin-1 / Windows-1252 bytes: every code point below 0x100 is its own byte. */
const latin1 = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16(text: string, endian: "le" | "be", bom: boolean): Uint8Array {
  const out: number[] = [];
  if (bom) out.push(...(endian === "le" ? [0xff, 0xfe] : [0xfe, 0xff]));
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (endian === "le") out.push(code & 0xff, code >> 8);
    else out.push(code >> 8, code & 0xff);
  }
  return new Uint8Array(out);
}

const SRT_TWO_CUES = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "First line",
  "second line",
  "",
  "2",
  "00:00:05,500 --> 00:00:08,250",
  "Third",
  "",
].join("\n");

describe("parseTimestamp — one reader for three spellings", () => {
  it("reads SubRip's comma and WebVTT's period identically", () => {
    expect(parseTimestamp("01:02:03,456")).toBe(3723456);
    expect(parseTimestamp("01:02:03.456")).toBe(3723456);
  });

  it("reads WebVTT's optional hours", () => {
    expect(parseTimestamp("02:03.456")).toBe(123456);
  });

  it("reads ASS centiseconds positionally, not as milliseconds", () => {
    // `0:00:01.50` is one and a HALF seconds in ASS. Reading `50` as 50 ms is
    // the classic ASS-import bug and puts every cue 450 ms early.
    expect(parseTimestamp("0:00:01.50")).toBe(1500);
    expect(parseTimestamp("0:00:01.5")).toBe(1500);
    expect(parseTimestamp("0:00:01.500")).toBe(1500);
  });

  it("truncates beyond millisecond resolution", () => {
    expect(parseTimestamp("00:00:01.500999")).toBe(1500);
  });

  it("refuses nonsense rather than inventing a time", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("banana")).toBeNull();
    expect(parseTimestamp("00:61:00,000")).toBeNull();
    expect(parseTimestamp("00:00:99,000")).toBeNull();
  });
});

describe("time writers", () => {
  it("writes SubRip with a comma and WebVTT with a period", () => {
    expect(formatSrtTime(3723456)).toBe("01:02:03,456");
    expect(formatVttTime(3723456)).toBe("01:02:03.456");
  });

  it("writes WebVTT hours even under an hour, so one file never mixes forms", () => {
    expect(formatVttTime(1500)).toBe("00:00:01.500");
  });

  it("rounds ASS times OUTWARD so a short cue cannot collapse", () => {
    // 1000–1004 ms is 4 ms long. Round-to-nearest gives 1.00 → 1.00: a
    // zero-length cue, which `retimeCues` would then have to drop. Floor the
    // start and ceil the end and the cue survives as 1.00 → 1.01.
    expect(formatAssTime(1004, "down")).toBe("0:00:01.00");
    expect(formatAssTime(1004, "up")).toBe("0:00:01.01");
    expect(formatAssTime(1000, "down")).toBe("0:00:01.00");
    expect(formatAssTime(3723456, "down")).toBe("1:02:03.45");
    expect(formatAssTime(3723456, "up")).toBe("1:02:03.46");
  });

  it("never writes a negative time", () => {
    expect(formatSrtTime(-500)).toBe("00:00:00,000");
    expect(formatAssTime(-500, "down")).toBe("0:00:00.00");
  });
});

describe("parseOffset — the shift field", () => {
  it("treats an untouched field as no shift", () => {
    expect(parseOffset("")).toBe(0);
    expect(parseOffset("   ")).toBe(0);
  });

  it("reads a bare number as seconds", () => {
    expect(parseOffset("2.5")).toBe(2500);
    expect(parseOffset("+2.5")).toBe(2500);
    expect(parseOffset("-1.2")).toBe(-1200);
    expect(parseOffset("2,5")).toBe(2500);
  });

  it("reads explicit units", () => {
    expect(parseOffset("2.5s")).toBe(2500);
    expect(parseOffset("-1200ms")).toBe(-1200);
    expect(parseOffset("3 seconds")).toBe(3000);
  });

  it("reads a timecode", () => {
    expect(parseOffset("-00:00:01,200")).toBe(-1200);
    expect(parseOffset("00:01:30")).toBe(90000);
  });

  it("returns null rather than guessing", () => {
    expect(parseOffset("soon")).toBeNull();
    expect(parseOffset("-")).toBeNull();
    expect(parseOffset("2.5.5")).toBeNull();
  });
});

describe("retimeScale — the direction of a frame-rate re-time", () => {
  it("multiplies by source/target, not target/source", () => {
    expect(retimeScale(24, 25)).toBeCloseTo(0.96, 10);
    expect(retimeScale(25, 24)).toBeCloseTo(1.0416666, 6);
  });

  it("moves a PAL-timed cue LATER when re-timed to NTSC film", () => {
    // A file cut for 25 fps, played back at 23.976, runs longer: a cue one
    // minute in belongs at ~62.6 s, not ~57.5 s. Inverting the ratio produces
    // exactly that wrong answer, which is why this asserts the sign.
    const { cues } = retimeCues([cue(60000, 62000, "x")], {
      scale: retimeScale(25, 24000 / 1001),
    });
    expect(cues[0].start).toBeGreaterThan(60000);
    expect(cues[0].start).toBe(62563); // 60 s × 25 ÷ (24000/1001) = 62562.5
  });

  it("falls back to 1 rather than producing Infinity or NaN", () => {
    expect(retimeScale(0, 25)).toBe(1);
    expect(retimeScale(25, 0)).toBe(1);
  });
});

describe("parseSrt", () => {
  it("reads cues, keeping multi-line text", () => {
    const { cues, report } = parseSrt(SRT_TWO_CUES);
    expect(cues).toEqual([
      cue(1000, 4000, "First line\nsecond line"),
      cue(5500, 8250, "Third"),
    ]);
    expect(report.malformed).toEqual([]);
  });

  it("survives CRLF and a byte-order mark", () => {
    const source = "﻿" + SRT_TWO_CUES.replace(/\n/g, "\r\n");
    expect(parseSrt(source).cues).toHaveLength(2);
    expect(parseSrt(source).cues[0].text).toBe("First line\nsecond line");
  });

  it("accepts the period-decimal spelling many tools emit", () => {
    const source = "1\n00:00:01.000 --> 00:00:04.000\nHi\n";
    expect(parseSrt(source).cues[0]).toEqual(cue(1000, 4000, "Hi"));
  });

  it("finds the timing line when the sequence number is missing", () => {
    const source = "00:00:01,000 --> 00:00:02,000\nNo number here\n";
    expect(parseSrt(source).cues).toEqual([cue(1000, 2000, "No number here")]);
  });

  it("counts a block with no timing line instead of swallowing it", () => {
    const source = `${SRT_TWO_CUES}\n3\nthis block lost its timings\n`;
    const { cues, report } = parseSrt(source);
    expect(cues).toHaveLength(2);
    expect(report.malformed).toEqual([3]);
  });

  it("keeps <i> and drops <font>, counting the loss", () => {
    const source =
      '1\n00:00:01,000 --> 00:00:02,000\n<font color="#ffff00"><i>Yellow</i></font>\n';
    const { cues, report } = parseSrt(source);
    expect(cues[0].text).toBe("<i>Yellow</i>");
    expect(report.styled).toBe(1);
  });

  it("does not mistake an arithmetic comparison for a tag", () => {
    // `<[^>]*>` ate the words between them. The parser requires a letter
    // straight after `<`, so "a < b > c" is text.
    const source = "1\n00:00:01,000 --> 00:00:02,000\nif a < b > c then\n";
    expect(parseSrt(source).cues[0].text).toBe("if a < b > c then");
  });
});

describe("writeSrt", () => {
  it("renumbers from 1 regardless of the source numbering", () => {
    const source = "7\n00:00:01,000 --> 00:00:02,000\nA\n\n9\n00:00:03,000 --> 00:00:04,000\nB\n";
    const out = writeSrt(parseSrt(source).cues);
    expect(out.split("\n")[0]).toBe("1");
    expect(out).toContain("\n2\n");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("writes nothing at all for no cues", () => {
    expect(writeSrt([])).toBe("");
  });
});

describe("parseVtt", () => {
  const VTT = [
    "WEBVTT - Some title",
    "",
    "NOTE",
    "A comment block that is not a cue.",
    "",
    "STYLE",
    "::cue { color: yellow }",
    "",
    "intro",
    "00:00:01.000 --> 00:00:04.000 line:0 position:50% align:start",
    "<v Roger>Hello &amp; welcome",
    "",
    "00:05.000 --> 00:08.000",
    "<c.yellow>Short form hours</c>",
    "",
  ].join("\n");

  it("skips the signature, NOTE and STYLE blocks without calling them damage", () => {
    const { cues, report } = parseVtt(VTT);
    expect(cues).toHaveLength(2);
    expect(report.malformed).toEqual([]);
  });

  it("reads the optional-hours form", () => {
    expect(parseVtt(VTT).cues[1].start).toBe(5000);
  });

  it("counts cue settings as dropped positioning", () => {
    expect(parseVtt(VTT).report.positioned).toBe(1);
  });

  it("drops voice and class spans but keeps their words", () => {
    expect(parseVtt(VTT).cues[0].text).toBe("Hello & welcome");
    expect(parseVtt(VTT).cues[1].text).toBe("Short form hours");
    expect(parseVtt(VTT).report.styled).toBe(2);
  });

  it("strips karaoke timestamp tags", () => {
    const source = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nOne<00:00:02.000>two\n";
    expect(parseVtt(source).cues[0].text).toBe("Onetwo");
  });

  it("decodes entities only after tags are removed", () => {
    /*
      `&lt;font&gt;` is the TEXT "<font>", not markup. Decoding entities first
      turns it into a tag the stripper then deletes, and the words around it
      lose their subject. Order, not just presence, is what this pins — an
      `&lt;i&gt;` fixture proves nothing, because `<i>` is kept either way.
    */
    const source =
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n&lt;font&gt; is a tag &amp; &lt;v Bob&gt; is one too\n";
    expect(parseVtt(source).cues[0].text).toBe("<font> is a tag & <v Bob> is one too");
  });

  it("still finds a cue glued to the signature line", () => {
    const source = "WEBVTT\n00:00:01.000 --> 00:00:02.000\nGlued\n";
    expect(parseVtt(source).cues).toEqual([cue(1000, 2000, "Glued")]);
  });
});

describe("writeVtt", () => {
  it("writes the signature and escapes text without eating <i>", () => {
    const out = writeVtt([cue(1000, 2000, "<i>a</i> & b < c")]);
    expect(out.startsWith("WEBVTT\n\n")).toBe(true);
    expect(out).toContain("<i>a</i> &amp; b &lt; c");
  });

  it("writes a valid empty file rather than an empty string", () => {
    expect(writeVtt([])).toBe("WEBVTT\n");
  });
});

describe("parseAss", () => {
  const ASS = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize",
    "Style: Default,Arial,40",
    "Style: Sign,Arial,20",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\i1}Hello,{\\i0} world\\Nsecond line",
    "Comment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,translator note",
    "Dialogue: 0,0:00:05.50,0:00:08.25,Sign,,0,0,0,,{\\pos(320,400)}A sign",
    "Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100",
  ].join("\n");

  it("reads Dialogue lines and skips Comment lines", () => {
    const { cues } = parseAss(ASS);
    expect(cues).toHaveLength(2);
    expect(cues.map((c) => c.start)).toEqual([1000, 5500]);
  });

  it("keeps commas inside the text field", () => {
    // Text is the last field, so a naive `split(",")` loses everything after
    // the first comma in the dialogue itself.
    expect(parseAss(ASS).cues[0].text).toBe("Hello, world\nsecond line");
  });

  it("strips every override block and counts the cues that had one", () => {
    const { cues, report } = parseAss(ASS);
    expect(cues[1].text).toBe("A sign");
    expect(cues.some((c) => c.text.includes("{"))).toBe(false);
    expect(report.styled).toBe(2);
  });

  it("drops vector drawing cues instead of emitting path coordinates", () => {
    const { cues, report } = parseAss(ASS);
    expect(report.drawings).toBe(1);
    expect(cues.some((c) => c.text.includes("m 0 0 l"))).toBe(false);
  });

  it("does not mistake \\pos for a drawing", () => {
    expect(parseAss(ASS).cues[1].text).toBe("A sign");
  });

  it("records the style names the file used", () => {
    expect(parseAss(ASS).report.styles).toEqual(["Default", "Sign"]);
  });

  it("honours a reordered or SSA-flavoured Format line", () => {
    const ssa = [
      "[Events]",
      "Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: Marked=0,0:00:02.00,0:00:03.00,Default,,0000,0000,0000,,Old school",
    ].join("\n");
    expect(parseAss(ssa).cues).toEqual([cue(2000, 3000, "Old school")]);
  });

  it("turns \\h into a non-breaking space", () => {
    const source = "[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,a\\hb";
    expect(parseAss(source).cues[0].text).toBe("a b");
  });

  it("counts a Dialogue line whose timings will not parse", () => {
    const source = "[Events]\nDialogue: 0,later,soon,Default,,0,0,0,,text";
    const { cues, report } = parseAss(source);
    expect(cues).toEqual([]);
    expect(report.malformed).toEqual([2]);
  });
});

describe("writeAss", () => {
  it("emits a header whose style and play resolution match", () => {
    const out = writeAss([cue(1000, 2000, "Hi")]);
    expect(out).toContain("[Script Info]");
    expect(out).toContain("PlayResX: 1280");
    expect(out).toContain("Style: Default,Arial,40,");
    expect(out).toContain("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi");
  });

  it("turns our three tags into override toggles and newlines into \\N", () => {
    const out = writeAss([cue(0, 1000, "<i>one</i>\ntwo")]);
    expect(out).toContain(",{\\i1}one{\\i0}\\Ntwo\n");
  });

  it("escapes braces so cue text cannot open an override block", () => {
    // Unescaped, `{laughs}` is read as an override and the word disappears.
    const out = writeAss([cue(0, 1000, "{laughs}")]);
    expect(out).toContain(",\\{laughs\\}\n");
  });
});

describe("round trips", () => {
  it("SRT → VTT → SRT is byte-identical", () => {
    const once = writeSrt(parseSrt(SRT_TWO_CUES).cues);
    const viaVtt = writeSrt(parseVtt(writeVtt(parseSrt(SRT_TWO_CUES).cues)).cues);
    expect(viaVtt).toBe(once);
  });

  it("SRT → ASS → SRT keeps literal braces and italics", () => {
    const source = "1\n00:00:01,000 --> 00:00:02,000\n<i>She said {ahem}</i>\n";
    const back = parseAss(writeAss(parseSrt(source).cues)).cues;
    expect(back[0].text).toBe("She said {ahem}");
  });

  it("ASS → SRT keeps the words and loses the styling, as documented", () => {
    const source = [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Karaoke,,0,0,0,,{\\k25}Twin{\\k30}kle",
    ].join("\n");
    const out = writeSrt(parseAss(source).cues);
    expect(out).toContain("Twinkle");
    expect(out).not.toContain("\\k");
    expect(out).not.toContain("Karaoke");
  });
});

describe("retimeCues — nothing invalid ever reaches the writer", () => {
  it("shifts every cue by the offset", () => {
    const { cues } = retimeCues([cue(1000, 2000, "a")], { offsetMs: 2500 });
    expect(cues).toEqual([cue(3500, 4500, "a")]);
  });

  it("drops a cue the shift pushed entirely before zero, and counts it", () => {
    const { cues, report } = retimeCues([cue(500, 900, "gone"), cue(5000, 6000, "kept")], {
      offsetMs: -1000,
    });
    expect(cues).toEqual([cue(4000, 5000, "kept")]);
    expect(report.droppedBeforeZero).toBe(1);
  });

  it("clamps a cue straddling zero rather than losing its words", () => {
    const { cues, report } = retimeCues([cue(500, 3000, "half")], { offsetMs: -1000 });
    expect(cues).toEqual([cue(0, 2000, "half")]);
    expect(report.clampedToZero).toBe(1);
    expect(cues[0].start).toBeGreaterThanOrEqual(0);
  });

  it("drops a cue whose end is at or before its start", () => {
    const { cues, report } = retimeCues([cue(4000, 2000, "backwards"), cue(1, 1, "empty")]);
    expect(cues).toEqual([]);
    expect(report.droppedInvalid).toBe(2);
  });

  it("sorts out-of-order cues and says how many there were", () => {
    const { cues, report } = retimeCues([
      cue(5000, 6000, "b"),
      cue(1000, 2000, "a"),
      cue(7000, 8000, "c"),
    ]);
    expect(cues.map((c) => c.text)).toEqual(["a", "b", "c"]);
    expect(report.reordered).toBe(1);
  });

  it("reports overlaps but leaves them alone — two speakers at once is legal", () => {
    const { cues, report } = retimeCues([cue(1000, 5000, "a"), cue(2000, 6000, "b")]);
    expect(cues).toEqual([cue(1000, 5000, "a"), cue(2000, 6000, "b")]);
    expect(report.overlaps).toBe(1);
  });

  it("scales BEFORE it shifts", () => {
    // 10 s at scale 0.5 is 5 s, then +1 s is 6 s. Shifting first would give
    // (10 + 1) * 0.5 = 5.5 s — a 500 ms error that grows with the offset.
    const { cues } = retimeCues([cue(10000, 20000, "x")], { scale: 0.5, offsetMs: 1000 });
    expect(cues[0].start).toBe(6000);
  });
});

describe("convertSubtitles", () => {
  it("detects the source format and writes the target", () => {
    const result = convertSubtitles(SRT_TWO_CUES, { targetFormat: "vtt" });
    expect(result.sourceFormat).toBe("srt");
    expect(result.text.startsWith("WEBVTT")).toBe(true);
    expect(result.cues).toHaveLength(2);
    expect(result.sourceCueCount).toBe(2);
    expect(result.endMs).toBe(8250);
  });

  it("applies the frame-rate re-time and then the offset", () => {
    const result = convertSubtitles(SRT_TWO_CUES, {
      targetFormat: "srt",
      sourceFps: 25,
      targetFps: 24,
      offsetMs: 1000,
    });
    // 1000 ms * 25/24 = 1041.67 → 1042, then +1000.
    expect(result.cues[0].start).toBe(2042);
  });

  it("refuses a file that is not a subtitle file", () => {
    expect(() => convertSubtitles("just some prose\n", { targetFormat: "srt" })).toThrow(
      SubtitleError,
    );
  });

  it("refuses rather than returning an empty 'converted' file", () => {
    // And says why it is empty. Falling through to the shift guard below
    // would blame a time shift the user never typed.
    const empty = "WEBVTT\n\nNOTE nothing here\n";
    expect(() => convertSubtitles(empty, { targetFormat: "srt" })).toThrow(SubtitleError);
    expect(() => convertSubtitles(empty, { targetFormat: "srt" })).toThrow(/No cues were found/);
    const allBad = [
      "[Events]",
      "Dialogue: 0,later,soon,Default,,0,0,0,,text",
      "Dialogue: 0,x,y,Default,,0,0,0,,more",
    ].join("\n");
    expect(() => convertSubtitles(allBad, { targetFormat: "srt" })).toThrow(
      /all 2 blocks in this file were missing a timing line/,
    );
  });

  it("refuses a shift that would erase every cue", () => {
    expect(() =>
      convertSubtitles(SRT_TWO_CUES, { targetFormat: "srt", offsetMs: -60000 }),
    ).toThrow(/before 00:00:00/);
  });

  it("honours a source-format override for a mislabelled file", () => {
    // A `.srt` whose contents are really WebVTT: detection would say vtt, but
    // the user can insist. Here the reverse — forcing srt on a vtt body still
    // reads the cues, because SubRip's parser is the more lenient of the two.
    const result = convertSubtitles("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n", {
      targetFormat: "srt",
      sourceFormat: "srt",
    });
    expect(result.sourceFormat).toBe("srt");
    expect(result.cues[0]).toEqual(cue(1000, 2000, "Hi"));
  });
});

describe("detectSubtitleFormat", () => {
  it("prefers WEBVTT over the arrow, which both formats have", () => {
    expect(detectSubtitleFormat("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nx\n")).toBe("vtt");
  });

  it("recognises ASS by its sections and by a bare Dialogue line", () => {
    expect(detectSubtitleFormat("[Script Info]\nTitle: x\n")).toBe("ass");
    expect(detectSubtitleFormat("Dialogue: 0,0:00:01.00,0:00:02.00,D,,0,0,0,,hi")).toBe("ass");
  });

  it("falls back to SubRip on the arrow", () => {
    expect(detectSubtitleFormat(SRT_TWO_CUES)).toBe("srt");
  });

  it("returns null for anything else", () => {
    expect(detectSubtitleFormat("hello world")).toBeNull();
  });
});

describe("decodeSubtitleBytes — the mojibake gate", () => {
  const CAFE_SRT = "1\n00:00:01,000 --> 00:00:02,000\nUn café crème\n";

  it("reports a strict UTF-8 decode as UTF-8", () => {
    const result = decodeSubtitleBytes(utf8(CAFE_SRT));
    expect(result.basis).toBe("utf-8");
    expect(result.text).toBe(CAFE_SRT);
  });

  it("marks pure ASCII, where every candidate encoding agrees", () => {
    expect(decodeSubtitleBytes(utf8("1\n00:00:01,000 --> 00:00:02,000\nplain\n")).ascii).toBe(
      true,
    );
    expect(decodeSubtitleBytes(utf8(CAFE_SRT)).ascii).toBe(false);
  });

  it("does NOT hand back U+FFFD for a Windows-1252 file", () => {
    // The whole point. The default decoder is non-fatal: it would return
    // "Un caf� cr�me" and report success, and the download would
    // carry black diamonds where the accents were.
    const result = decodeSubtitleBytes(latin1(CAFE_SRT));
    expect(result.text).not.toContain("�");
    expect(result.text).toBe(CAFE_SRT);
    expect(result.encoding).toBe("windows-1252");
    expect(result.basis).toBe("guess");
  });

  it("believes a UTF-8 byte-order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(CAFE_SRT)]);
    const result = decodeSubtitleBytes(bytes);
    expect(result.basis).toBe("bom");
    expect(result.encoding).toBe("utf-8");
    expect(result.text.replace(/^﻿/, "")).toBe(CAFE_SRT);
  });

  it("believes a UTF-16 byte-order mark, both ways round", () => {
    expect(decodeSubtitleBytes(utf16(CAFE_SRT, "le", true)).encoding).toBe("utf-16le");
    expect(decodeSubtitleBytes(utf16(CAFE_SRT, "be", true)).encoding).toBe("utf-16be");
    expect(decodeSubtitleBytes(utf16(CAFE_SRT, "be", true)).text.replace(/^﻿/, "")).toBe(
      CAFE_SRT,
    );
  });

  it("catches BOM-less UTF-16 before the UTF-8 test can accept it", () => {
    /*
      NUL is a valid UTF-8 byte, so `TextDecoder("utf-8", { fatal: true })`
      accepts BOM-less UTF-16LE happily and returns text with a NUL between
      every letter — which parses as nothing and looks like an empty file.
      Sniffing NUL parity FIRST is what stops that.
    */
    const result = decodeSubtitleBytes(utf16(CAFE_SRT, "le", false));
    expect(result.encoding).toBe("utf-16le");
    expect(result.text).toBe(CAFE_SRT);
    expect(result.text).not.toContain(" ");
    expect(parseSrt(result.text).cues).toHaveLength(1);
  });

  it("catches BOM-less UTF-16BE too", () => {
    const result = decodeSubtitleBytes(utf16(CAFE_SRT, "be", false));
    expect(result.encoding).toBe("utf-16be");
    expect(result.text).toBe(CAFE_SRT);
  });

  it("obeys a forced label over everything it would have guessed", () => {
    const result = decodeSubtitleBytes(latin1(CAFE_SRT), "windows-1251");
    expect(result.basis).toBe("forced");
    expect(result.encoding).toBe("windows-1251");
    // Windows-1251 reads 0xE9 as Cyrillic и — wrong for this file, and
    // exactly what the user asked for.
    expect(result.text).toContain("й");
  });
});

/*
  ── The shapes that only turn up in real files ─────────────────────────────

  Everything above this line is a well-formed fixture. Every bug these tests
  were added for survived that: an ASS cue with an empty line in it, a Windows
  path in an SRT, a caption ABOUT the `<i>` tag, a transcript whose dialogue
  begins "Dialogue:". None of them are malformed input — they are ordinary
  files that happened to say something the writer or the detector read as
  syntax.
*/

/** `[Events]` plus a Format line, so a fixture only has to list its Dialogue. */
const assFile = (...events: string[]) =>
  [
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
  ].join("\n");

describe("a blank line inside cue text — SubRip and WebVTT end a cue there", () => {
  /*
    `\N` at the start of a Text field, and `\N\N` inside one, are ordinary ASS
    idioms for nudging a line down or spacing two apart. Interpolated straight
    into an SRT they write a blank line immediately after the timing line,
    which is the BLOCK SEPARATOR: the cue ends there, its words become a block
    with no timing, and every block after it is read against the wrong cue.
    The output looked like a success and reported "2 of 2 cues".
  */
  const LEADING = assFile(
    "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,\\NPushed down one line",
    "Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,Next cue",
  );

  it("does not write a blank line into an SRT, and the file still reads back whole", () => {
    const result = convertSubtitles(LEADING, { targetFormat: "srt" });
    expect(result.text).not.toContain("00:00:01,000 --> 00:00:04,000\n\n");
    expect(result.text).toContain("00:00:01,000 --> 00:00:04,000\nPushed down one line");

    // The real proof: read the output back. Before the fix this returned ONE
    // cue and reported blocks 1 and 2 as malformed.
    const back = parseSrt(result.text);
    expect(back.cues).toHaveLength(2);
    expect(back.report.malformed).toEqual([]);
    expect(back.cues[0]).toEqual(cue(1000, 4000, "Pushed down one line"));
  });

  it("does not orphan the words after a \\N\\N in a WebVTT", () => {
    const source = assFile("Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Top\\N\\NBottom");
    const result = convertSubtitles(source, { targetFormat: "vtt" });
    const back = parseVtt(result.text);
    expect(back.cues).toHaveLength(1);
    expect(back.report.malformed).toEqual([]);
    expect(back.cues[0].text).toBe("Top\nBottom");
  });

  it("counts the cues it took a line out of, so the loss is not silent", () => {
    expect(convertSubtitles(LEADING, { targetFormat: "srt" }).blankLineCues).toBe(1);
    expect(convertSubtitles(LEADING, { targetFormat: "vtt" }).blankLineCues).toBe(1);
    // Nothing was lost, so nothing is claimed: this file's other cue is
    // ordinary, and an all-ordinary file reports zero.
    expect(convertSubtitles(SRT_TWO_CUES, { targetFormat: "srt" }).blankLineCues).toBe(0);
  });

  it("keeps the blank line when the target is ASS, which can hold one", () => {
    const result = convertSubtitles(LEADING, { targetFormat: "ass" });
    expect(result.blankLineCues).toBe(0);
    expect(result.text).toContain(",\\NPushed down one line\n");
    expect(parseAss(result.text).cues[0].text).toBe("\nPushed down one line");
  });
});

describe("WebVTT positioning and blocks — counted for every target", () => {
  const VTT_POSITIONED = [
    "WEBVTT",
    "",
    "NOTE this comment is not rendering data",
    "",
    "STYLE",
    "::cue(.yellow) { color: yellow }",
    "",
    "REGION",
    "id:speaker width:40%",
    "",
    "intro",
    "00:00:01.000 --> 00:00:04.000 region:speaker align:start line:0 position:10%",
    "Welcome to the show.",
    "",
    "chorus",
    "00:00:05.000 --> 00:00:08.000 align:end",
    "Second cue.",
    "",
  ].join("\n");

  it("still counts positioning when the target is WebVTT itself", () => {
    /*
      `writeVtt` emits `N`, a timing line and text — no cue settings. So a
      WebVTT target keeps NONE of this, and the count has to survive the trip
      for the UI to be able to say so. The UI used to suppress the note for
      exactly this target.
    */
    const result = convertSubtitles(VTT_POSITIONED, { targetFormat: "vtt" });
    expect(result.parse.positioned).toBe(2);
    expect(result.text).not.toContain("region:");
    expect(result.text).not.toContain("align:");
  });

  it("counts the STYLE and REGION blocks it drops, and not the NOTE", () => {
    // NOTE is the author talking to themselves. STYLE and REGION decide how
    // the cues are drawn, so losing them changes the file on screen.
    expect(parseVtt(VTT_POSITIONED).report.vttBlocks).toBe(2);
    expect(parseVtt("WEBVTT\n\nNOTE just a comment\n\n00:00:01.000 --> 00:00:02.000\nHi\n")
      .report.vttBlocks).toBe(0);
  });
});

describe("escaped tags stay text, and text stays text", () => {
  /*
    A caption teaching HTML: `He typed &lt;i&gt;hello&lt;/i&gt; into the box.`
    Stripping before decoding keeps it out of the stripper's hands, which the
    parser has always done — but nothing re-escaped it on the way out, so the
    writers emitted real markup and a player italicised the word the caption
    was about, tags and all.
  */
  const LESSON =
    "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nHe typed &lt;i&gt;hello&lt;/i&gt; into the box.\n";

  it("writes WebVTT that still shows the tags on screen", () => {
    const out = convertSubtitles(LESSON, { targetFormat: "vtt" }).text;
    expect(out).toContain("He typed &lt;i&gt;hello&lt;/i&gt; into the box.");
    expect(out).not.toContain("<i>");
  });

  it("does not double-escape it on a second pass", () => {
    const once = convertSubtitles(LESSON, { targetFormat: "vtt" }).text;
    const twice = convertSubtitles(once, { targetFormat: "vtt" }).text;
    expect(twice).toBe(once);
  });

  it("keeps it escaped in SubRip, which decodes the same entities", () => {
    const out = convertSubtitles(LESSON, { targetFormat: "srt" }).text;
    expect(out).toContain("He typed &lt;i&gt;hello&lt;/i&gt; into the box.");
    expect(out).not.toContain("<i>");
  });

  it("spells it out in ASS, which has no entities and no <i>", () => {
    // ASS marks up with `{}`, so the angle brackets are safe characters there
    // — and `&lt;` would be drawn as itself, which is the wrong text.
    const out = convertSubtitles(LESSON, { targetFormat: "ass" }).text;
    expect(out).toContain("He typed <i>hello</i> into the box.");
    expect(out).not.toContain("&lt;");
    expect(out).not.toContain("{\\i1}");
  });

  it("still treats a REAL italic tag as markup in all three", () => {
    const italic = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<i>hello</i>\n";
    expect(convertSubtitles(italic, { targetFormat: "vtt" }).text).toContain("<i>hello</i>");
    expect(convertSubtitles(italic, { targetFormat: "srt" }).text).toContain("<i>hello</i>");
    expect(convertSubtitles(italic, { targetFormat: "ass" }).text).toContain("{\\i1}hello{\\i0}");
  });
});

describe("detection reads structure, not words in the dialogue", () => {
  const SRT_ABOUT_A_SCRIPT = [
    "1",
    "00:00:01,000 --> 00:00:04,000",
    "She never answers.",
    "Dialogue: he never listens.",
    "",
    "2",
    "00:00:05,000 --> 00:00:08,000",
    "Fade out.",
    "",
  ].join("\n");

  it("reads an SRT whose text starts a line with 'Dialogue:' as SubRip", () => {
    /*
      Both ASS signals are multiline, so they matched cue TEXT anywhere in the
      file. `parseAss` then found no events and the whole conversion threw
      "No cues were found in this file." — a valid file, refused outright,
      with no source-format control anywhere to argue with.
    */
    expect(detectSubtitleFormat(SRT_ABOUT_A_SCRIPT)).toBe("srt");
    const result = convertSubtitles(SRT_ABOUT_A_SCRIPT, { targetFormat: "vtt" });
    expect(result.sourceFormat).toBe("srt");
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0].text).toBe("She never answers.\nDialogue: he never listens.");
  });

  it("reads an SRT whose text is the line [Events] as SubRip", () => {
    const source = "1\n00:00:01,000 --> 00:00:04,000\n[Events]\nis a section header.\n";
    expect(detectSubtitleFormat(source)).toBe("srt");
    expect(convertSubtitles(source, { targetFormat: "vtt" }).cues).toHaveLength(1);
  });

  it("still calls a real ASS file ASS", () => {
    expect(detectSubtitleFormat("[Script Info]\nTitle: x\n")).toBe("ass");
    expect(
      detectSubtitleFormat(assFile("Dialogue: 0,0:00:01.00,0:00:02.00,D,,0,0,0,,hi")),
    ).toBe("ass");
  });

  it("parses the header-less Dialogue shape the detector claims to recognise", () => {
    // `detectSubtitleFormat` returns "ass" for a bare run of Dialogue lines.
    // Requiring an `[Events]` header to parse them made that a promise the
    // parser could not keep, and the tool answered "No cues were found".
    const bare = [
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,First",
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Second",
    ].join("\n");
    expect(detectSubtitleFormat(bare)).toBe("ass");
    expect(parseAss(bare).cues).toEqual([cue(1000, 2000, "First"), cue(3000, 4000, "Second")]);
    expect(convertSubtitles(bare, { targetFormat: "srt" }).cues).toHaveLength(2);
  });

  it("does not read a Dialogue line inside [Script Info] as an event", () => {
    const source = [
      "[Script Info]",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,not an event",
      "[Events]",
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,the only cue",
    ].join("\n");
    expect(parseAss(source).cues).toEqual([cue(3000, 4000, "the only cue")]);
  });
});

describe("backslashes survive the trip into ASS", () => {
  /*
    In an ASS Text field `\N` and `\n` are line breaks and `\h` is a hard
    space. The writer escaped braces but not the escape character itself, so
    an SRT cue reading `Open C:\Netflix\movie.mkv` was written verbatim and
    every renderer drew `Open C:` then a line break then `etflix\movie.mkv`.
  */
  const PATH_SRT = "1\n00:00:01,000 --> 00:00:04,000\nOpen C:\\Netflix\\movie.mkv\n";

  it("escapes a backslash so it cannot become a line break", () => {
    const out = convertSubtitles(PATH_SRT, { targetFormat: "ass" }).text;
    expect(out).toContain(",,Open C:\\\\Netflix\\\\movie.mkv\n");
  });

  it("round-trips the path exactly, character for character", () => {
    const ass = convertSubtitles(PATH_SRT, { targetFormat: "ass" }).text;
    const back = convertSubtitles(ass, { targetFormat: "srt" });
    expect(back.cues[0].text).toBe("Open C:\\Netflix\\movie.mkv");
    expect(back.cues[0].text).not.toContain("\n");
  });

  it("keeps \\n and \\h out of the renderer's hands too", () => {
    const source = "1\n00:00:01,000 --> 00:00:02,000\na\\next b\\here c\\\\d\n";
    const ass = convertSubtitles(source, { targetFormat: "ass" }).text;
    const back = convertSubtitles(ass, { targetFormat: "srt" });
    expect(back.cues[0].text).toBe("a\\next b\\here c\\\\d");
  });

  it("still reads a genuine \\N, \\n and \\h from a file somebody else wrote", () => {
    const source = assFile("Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,one\\Ntwo\\nthree\\hfour");
    expect(parseAss(source).cues[0].text).toBe("one\ntwo\nthree\u00a0four");
  });

  it("still escapes braces, and a backslash before one does not eat it", () => {
    const source = "1\n00:00:01,000 --> 00:00:02,000\nliteral \\{ and {laughs}\n";
    const ass = convertSubtitles(source, { targetFormat: "ass" }).text;
    expect(convertSubtitles(ass, { targetFormat: "srt" }).cues[0].text).toBe(
      "literal \\{ and {laughs}",
    );
  });
});

describe("drawing mode is an override, not a word", () => {
  it("keeps a cue whose WORDS contain \\p1", () => {
    // A typesetting tutorial's caption. Dropping it lost the words AND told
    // the user their subtitle had been a vector drawing.
    const source = assFile(
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Type \\p1 to enable paragraph mode",
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Ordinary cue",
    );
    const { cues, report } = parseAss(source);
    expect(report.drawings).toBe(0);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Type \\p1 to enable paragraph mode");
  });

  it("keeps it even when the cue also carries an override block", () => {
    // The same words with a bold toggle in front. Scanning the whole Text
    // field once a block exists is the same bug wearing a hat.
    const source = assFile(
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}Type \\p1 to enable paragraph mode",
    );
    const { cues, report } = parseAss(source);
    expect(report.drawings).toBe(0);
    expect(cues[0].text).toBe("Type \\p1 to enable paragraph mode");
  });

  it("still drops a real drawing, where \\p1 is inside the override block", () => {
    const source = assFile(
      "Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100",
    );
    const { cues, report } = parseAss(source);
    expect(report.drawings).toBe(1);
    expect(cues).toEqual([]);
  });

  it("still does not mistake \\pos for a drawing", () => {
    const source = assFile("Dialogue: 0,0:00:01.00,0:00:02.00,Sign,,0,0,0,,{\\pos(320,400)}A sign");
    expect(parseAss(source).cues[0].text).toBe("A sign");
    expect(parseAss(source).report.drawings).toBe(0);
  });
});

describe("an empty result says which thing emptied it", () => {
  it("blames the file, not a shift, when every cue is zero-length", () => {
    /*
      `droppedInvalid` is a property of the source — several broken muxers
      write `00:00:01,000 --> 00:00:01,000` — and has nothing to do with the
      offset. The old message told a user with an EMPTY shift field to "shift
      by a smaller negative offset".
    */
    const zeroLength = "1\n00:00:01,000 --> 00:00:01,000\nZero length\n";
    expect(() => convertSubtitles(zeroLength, { targetFormat: "srt" })).toThrow(
      /ends at or before its own start time/,
    );
    expect(() => convertSubtitles(zeroLength, { targetFormat: "srt" })).not.toThrow(
      /smaller negative offset/,
    );
  });

  it("still blames the shift when the shift is what did it", () => {
    expect(() =>
      convertSubtitles(SRT_TWO_CUES, { targetFormat: "srt", offsetMs: -60000 }),
    ).toThrow(/Shift by a smaller negative offset/);
  });

  it("names both when both happened", () => {
    const mixed = [
      "1",
      "00:00:01,000 --> 00:00:01,000",
      "Zero length",
      "",
      "2",
      "00:00:05,000 --> 00:00:06,000",
      "Shifted away",
      "",
    ].join("\n");
    expect(() => convertSubtitles(mixed, { targetFormat: "srt", offsetMs: -60000 })).toThrow(
      /at or before their own start time, and the time shift/,
    );
  });
});

describe("block numbers point at the block the user would count", () => {
  it("does not count the empty chunk a leading blank line makes", () => {
    // The UI prints these verbatim as "(block N)". Off by one, it sends
    // somebody to the wrong cue in their editor.
    const withBlank = "\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n\nJUNK BLOCK\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n";
    const without = withBlank.replace(/^\n\n/, "");
    expect(parseSrt(withBlank).report.malformed).toEqual([2]);
    expect(parseSrt(without).report.malformed).toEqual([2]);
    expect(parseSrt(withBlank).cues).toHaveLength(2);
  });

  it("counts the same way in WebVTT", () => {
    const source = "\n\nWEBVTT\n\nJUNK\n\n00:00:01.000 --> 00:00:02.000\nA\n";
    expect(parseVtt(source).report.malformed).toEqual([2]);
  });
});

describe("file naming and readouts", () => {
  it("swaps the extension and keeps the rest of the name", () => {
    expect(subtitleFileName("Episode 1.en.srt", "vtt")).toBe("Episode 1.en.vtt");
    expect(subtitleFileName("movie.ssa", "srt")).toBe("movie.srt");
    expect(subtitleFileName("noext", "ass")).toBe("noext.ass");
  });

  it("never produces a bare extension", () => {
    expect(subtitleFileName(".srt", "vtt")).toBe("subtitles.vtt");
  });

  it("formats a running time", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_845_000)).toBe("1:04:05");
  });
});
