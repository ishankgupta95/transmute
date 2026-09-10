/**
 * Subtitle reading, re-timing and writing — SubRip (SRT), WebVTT and ASS/SSA.
 *
 * Pure functions over strings and bytes. No DOM, no WASM, no dependency: the
 * three formats are line-oriented text, and everything interesting about them
 * is a parsing decision rather than a codec. That is also why this file is the
 * whole engine — `SubtitleConverterUI` holds state and copy, nothing else.
 *
 * ── The model, and what it deliberately throws away ─────────────────────────
 *
 * A cue here is `{ start, end, text }`: two millisecond offsets and plain text
 * that may carry `<i>`, `<b>` and `<u>`, because all three formats can express
 * those and nothing else survives the trip between all three.
 *
 * ASS/SSA is NOT that model. It is a styling language: named styles, per-cue
 * override blocks (`{\pos(320,400)}`, `{\c&HFF0000&}`, `{\k50}` karaoke),
 * layers, margins, rotation, and vector drawing commands. Reading an ASS file
 * into `{start,end,text}` discards every one of those, permanently. This file
 * does that on purpose — the alternative is a half-fidelity ASS renderer — and
 * `ParseReport` counts what went so the UI can say so out loud instead of
 * presenting a stripped file as a conversion. `convertSubtitles` never claims
 * ASS round-trips.
 *
 * ── Time ────────────────────────────────────────────────────────────────────
 *
 * Everything is milliseconds internally. SRT and WebVTT store milliseconds, so
 * those are lossless. ASS stores CENTIseconds, so writing ASS rounds — outward
 * (start down, end up), which keeps `end > start` strictly true for every cue
 * that had it and never shortens a cue by up to 10 ms without saying so.
 *
 * ── Encoding ────────────────────────────────────────────────────────────────
 *
 * `decodeSubtitleBytes` is the reason this module takes bytes at all. SRT in
 * the wild is very often a legacy single-byte codepage, and decoding those
 * bytes as UTF-8 with the default (non-fatal) decoder yields U+FFFD where the
 * accents were: a file that looks converted and is quietly ruined. See that
 * function for the detection order and what it refuses to guess at.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export type SubtitleFormat = "srt" | "vtt" | "ass";

export interface SubtitleCue {
  /** Milliseconds from the start of the media. Never negative in output. */
  start: number;
  end: number;
  /**
   * Plain text; `\n` between lines. May carry `<i>`, `<b>`, `<u>`.
   *
   * Those three spellings MEAN markup here, which is why a literal angle
   * bracket the author escaped stays escaped: `&lt;i&gt;` in this string is
   * the characters `<i>` as words, not an italic tag. See `decodeEntities`
   * for why that distinction cannot be made any later than the parse.
   *
   * A blank line is legal in this string — ASS can hold one — but SubRip and
   * WebVTT read a blank line as the end of a cue, so `writeSrt` and `writeVtt`
   * remove them and `ConvertResult.blankLineCues` counts the cues affected.
   */
  text: string;
}

/** What a parse had to drop or normalise, so the UI can disclose it. */
export interface ParseReport {
  /**
   * 1-based positions of source blocks (SRT/VTT) or lines (ASS) that carried
   * no readable timing. Counted, never silently swallowed.
   */
  malformed: number[];
  /** Cues whose markup did not survive: font tags, VTT classes, voice spans. */
  styled: number;
  /** ASS/SSA: the style names the source used, in first-seen order. */
  styles: string[];
  /** ASS/SSA: `Dialogue` lines that were vector drawings rather than text. */
  drawings: number;
  /**
   * WebVTT: cues carrying position/line/align/region settings.
   *
   * They go for EVERY target, WebVTT included — `writeVtt` writes a cue as a
   * number, a timing line and text, and nothing else — so this is counted
   * whatever the file is being converted to.
   */
  positioned: number;
  /**
   * WebVTT: `STYLE` and `REGION` blocks dropped. Both carry how cues are
   * drawn, so losing them changes the file on screen. `NOTE` comments are not
   * counted here: they are the author talking to themselves, not rendering.
   */
  vttBlocks: number;
}

/** What re-timing did to the cue list. Every field is a number the UI prints. */
export interface TimingReport {
  /** Cues that were out of chronological order in the SOURCE. */
  reordered: number;
  /** Cues that start before the previous cue ends. Reported, never "fixed". */
  overlaps: number;
  /** Cues pulled forward to 00:00:00 because the shift took their start below it. */
  clampedToZero: number;
  /** Cues dropped because the shift moved them entirely before 00:00:00. */
  droppedBeforeZero: number;
  /** Cues dropped because their end was at or before their start. */
  droppedInvalid: number;
}

export interface ParsedSubtitles {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  report: ParseReport;
}

const emptyParseReport = (): ParseReport => ({
  malformed: [],
  styled: 0,
  styles: [],
  drawings: 0,
  positioned: 0,
  vttBlocks: 0,
});

const emptyTimingReport = (): TimingReport => ({
  reordered: 0,
  overlaps: 0,
  clampedToZero: 0,
  droppedBeforeZero: 0,
  droppedInvalid: 0,
});

/* ── Timestamps ───────────────────────────────────────────────────────────── */

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Read one timestamp in any of the three formats' spellings.
 *
 * Accepts `HH:MM:SS,mmm` (SRT), `HH:MM:SS.mmm` and `MM:SS.mmm` (WebVTT, whose
 * hours are optional) and `H:MM:SS.cc` (ASS, hundredths). The fraction is read
 * positionally — `.5` is 500 ms, `.50` is 500 ms, `.500` is 500 ms — which is
 * what makes one function enough for all three. More than three digits are
 * truncated rather than rounded, because nothing downstream has sub-ms
 * resolution and a file with microseconds is already out of spec.
 *
 * Returns `null` for anything it cannot read, so callers count a malformed cue
 * instead of inventing a time for it.
 */
export function parseTimestamp(raw: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.,](\d+))?\s*$/.exec(raw);
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  if (minutes > 59 || seconds > 59) return null;
  let millis = 0;
  if (m[4]) {
    const digits = m[4].slice(0, 3).padEnd(3, "0");
    millis = Number(digits);
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** `HH:MM:SS,mmm` — SubRip's comma decimal separator, and at least two hour digits. */
export function formatSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const millis = t % 1000;
  const totalSeconds = (t - millis) / 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/**
 * `HH:MM:SS.mmm` — WebVTT's period, and hours always written.
 *
 * The spec allows `MM:SS.mmm`, but a file that mixes the two forms trips
 * several players' parsers, so this always emits the long one.
 */
export function formatVttTime(ms: number): string {
  return formatSrtTime(ms).replace(",", ".");
}

/**
 * `H:MM:SS.cc` — ASS's hundredths of a second.
 *
 * `round` is the whole point: ASS has 10 ms of resolution and the cue list has
 * 1 ms, so a naive round-to-nearest can collapse a 4 ms cue to zero length.
 * Rounding a start DOWN and an end UP keeps every `end > start` strictly true
 * and never makes a cue shorter than it was. The cost is up to 10 ms of extra
 * lead-in and lead-out per cue, which the UI states.
 */
export function formatAssTime(ms: number, round: "down" | "up"): string {
  const clamped = Math.max(0, ms);
  const cs = round === "down" ? Math.floor(clamped / 10) : Math.ceil(clamped / 10);
  const hundredths = cs % 100;
  const totalSeconds = (cs - hundredths) / 100;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
}

/**
 * Read the offset field: `2.5`, `+2.5s`, `-1200ms`, `-00:00:01,200`.
 *
 * Empty means zero — an untouched field is not an error. Anything unreadable
 * is `null` so the UI can refuse to run rather than shift by a number it
 * guessed. A bare number is SECONDS, which is how every "my subtitles are 2
 * seconds late" complaint is phrased.
 */
export function parseOffset(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const signed = /^([+-]?)\s*(.*)$/.exec(trimmed);
  if (!signed) return null;
  const sign = signed[1] === "-" ? -1 : 1;
  const rest = signed[2].trim();
  if (!rest) return null;

  if (rest.includes(":")) {
    const ms = parseTimestamp(rest);
    return ms === null ? null : sign * ms;
  }

  const num = /^(\d+(?:[.,]\d+)?)\s*(ms|msec|s|sec|secs|second|seconds)?$/i.exec(rest);
  if (!num) return null;
  const value = Number(num[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const unit = (num[2] ?? "s").toLowerCase();
  return Math.round(sign * value * (unit.startsWith("ms") ? 1 : 1000));
}

/* ── Frame rates ──────────────────────────────────────────────────────────── */

/**
 * The rates a subtitle file actually gets re-timed between.
 *
 * The NTSC pair are exact fractions, not their two-decimal names: 24000/1001
 * is 23.976023976…, and using the rounded 23.976 instead drifts by ~3.6 ms
 * over a two-hour film. Small, but free to get right.
 */
export const FRAME_RATES = [
  { id: "23.976", label: "23.976", note: "NTSC film", fps: 24000 / 1001 },
  { id: "24", label: "24", note: "Cinema", fps: 24 },
  { id: "25", label: "25", note: "PAL", fps: 25 },
  { id: "29.97", label: "29.97", note: "NTSC video", fps: 30000 / 1001 },
  { id: "30", label: "30", note: "30 fps", fps: 30 },
] as const;

export type FrameRateId = (typeof FRAME_RATES)[number]["id"];

export function frameRate(id: FrameRateId): number {
  const found = FRAME_RATES.find((r) => r.id === id);
  return found ? found.fps : 25;
}

/**
 * The factor cue times are multiplied by when a file authored for `sourceFps`
 * is played back at `targetFps`.
 *
 * A 24 fps film transferred to PAL is sped up to 25 fps: the same frame now
 * arrives 24/25 of the way through the old running time, so every cue time is
 * multiplied by source/target = 0.96. Getting this ratio the wrong way up is
 * the classic bug — it doubles the drift instead of removing it — so it lives
 * in one named function with one test.
 */
export function retimeScale(sourceFps: number, targetFps: number): number {
  if (!(sourceFps > 0) || !(targetFps > 0)) return 1;
  return sourceFps / targetFps;
}

/* ── Inline markup ────────────────────────────────────────────────────────── */

/**
 * A tag, strictly: `<` or `</` followed by a LETTER. The strictness matters —
 * subtitle text says "a < b" and "5 < 10 > 3" often enough that a lenient
 * `<[^>]*>` silently ate real words. A space after `<` is not a tag.
 */
const TAG = /<\/?[a-zA-Z][^>]*>/g;
/** WebVTT's karaoke timestamp tags, e.g. `<00:00:12.500>`. */
const VTT_TIMESTAMP_TAG = /<\d[^>]*>/g;
/** The three we keep, canonicalised on the way through. */
const KEPT_TAGS = new Set(["i", "b", "u"]);

/**
 * Strip everything but `<i>`, `<b>` and `<u>`; report whether anything went.
 *
 * `<font color="#ffff00">` (SRT), `<c.yellow>` and `<v Roger>` (WebVTT) all
 * carry information the plain-text model cannot hold. Dropping the TAG and
 * keeping the words it wrapped is the only lossless-for-the-words option; the
 * count comes back so the UI can say how many cues were affected.
 */
function stripMarkup(raw: string): { text: string; stripped: boolean } {
  let stripped = false;
  const text = raw.replace(TAG, (match) => {
    const name = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(match)?.[1]?.toLowerCase() ?? "";
    if (KEPT_TAGS.has(name)) return match.startsWith("</") ? `</${name}>` : `<${name}>`;
    stripped = true;
    return "";
  });
  return { text, stripped };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
  lrm: "\u200e",
  rlm: "\u200f",
  quot: '"',
  apos: "'",
};

/**
 * An escaped kept tag: the characters `<i>` written as text rather than as
 * markup. This is the one sequence `decodeEntities` refuses to decode, and the
 * one sequence `escapeVttText` writes back out untouched.
 */
const ESCAPED_KEPT_TAG = /&lt;\/?[iub]&gt;/g;

/** Everything `decodeEntities` does except decide what to leave alone. */
function decodeEntityRun(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * WebVTT cue text is escaped like HTML, so `&amp;` in the file means one
 * ampersand on screen. Decoded AFTER tags are stripped, never before: decoding
 * first would turn a literal `&lt;i&gt;` — text, not markup — into a tag.
 *
 * Stripping first is only half of that. `&lt;i&gt;` survives the stripper, but
 * decoding it produces the exact three characters the cue model reserves for
 * markup, so the writers then emit a real `<i>` and a player italicises a word
 * whose point was the tag around it. The word survives; the two tags the
 * caption was ABOUT do not, and nothing downstream can tell them from markup
 * afterwards. So the escaped form is left alone here, and it is the model's
 * spelling for an angle bracket that is text: `escapeVttText` writes it
 * straight back out, and `plainToAssText` turns it into the real characters,
 * because ASS has no entities and no `<i>`.
 */
function decodeEntities(text: string): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(ESCAPED_KEPT_TAG)) {
    const at = match.index ?? 0;
    out += decodeEntityRun(text.slice(last, at)) + match[0];
    last = at + match[0].length;
  }
  return out + decodeEntityRun(text.slice(last));
}

/** The inverse, for writing WebVTT: escape text, leave the three kept tags alone. */
function escapeVttText(text: string): string {
  // Both spellings pass through: `<i>` because it is markup, `&lt;i&gt;`
  // because it is already the correct escaping of text that is not.
  const keep = /<\/?[iub]>|&lt;\/?[iub]&gt;/g;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let out = "";
  let last = 0;
  for (const match of text.matchAll(keep)) {
    const at = match.index ?? 0;
    out += esc(text.slice(last, at)) + match[0];
    last = at + match[0].length;
  }
  return out + esc(text.slice(last));
}

/* ── Normalisation ────────────────────────────────────────────────────────── */

/** Strip a stray BOM character and fold CRLF / CR to LF. Nothing else. */
function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/**
 * Blank-line-separated blocks, with their 1-based position kept for reporting.
 *
 * The number counts BLOCKS, not chunks: a file that opens with a blank line
 * produces an empty leading chunk, and counting that one would send a user
 * looking for "block 3" to the second cue in their editor. The index is
 * therefore taken as each block is kept, not as each chunk is seen.
 */
function blocks(text: string): { lines: string[]; index: number }[] {
  const out: { lines: string[]; index: number }[] = [];
  let index = 0;
  for (const chunk of text.split(/\n[ \t]*\n+/)) {
    const lines = chunk.split("\n");
    if (lines.every((l) => l.trim() === "")) continue;
    out.push({ lines, index: ++index });
  }
  return out;
}

/** The cue-timing line: `00:00:01,000 --> 00:00:04,000 <settings>`. */
const ARROW = /^\s*([0-9:.,]+)\s*-->\s*([0-9:.,]+)\s*(.*)$/;

/* ── Format detection ─────────────────────────────────────────────────────── */

/**
 * A cue-timing LINE: a timestamp at the start of a line, then the arrow.
 *
 * Not the substring `-->`, which appears in cue text often enough to matter,
 * and which an ASS event line can carry inside its own Text field.
 */
const TIMING_LINE = /^[ \t]*[0-9:.,]+[ \t]*-->/m;

/**
 * Which of the three this text is, or `null`.
 *
 * Order is load-bearing. WEBVTT is tested first, because a WebVTT file also
 * has cue timings. The timing LINE comes next, ahead of the ASS signals: both
 * of those signals are multiline and so match cue TEXT anywhere in the file,
 * which read a perfectly good SubRip transcript whose dialogue said
 * "Dialogue: he never listens." as ASS — and `parseAss` then found no events
 * and the conversion failed outright. No ASS file has a line that BEGINS with
 * a timestamp and an arrow; every event line begins `Dialogue:` or `Comment:`.
 * So the sharp test goes first and the loose ones last.
 */
export function detectSubtitleFormat(text: string): SubtitleFormat | null {
  const head = normalizeText(text).trimStart();
  if (/^WEBVTT(\s|$)/.test(head)) return "vtt";
  if (TIMING_LINE.test(head)) return "srt";
  if (/^\[(script info|v4\+? styles|events)\]/im.test(head) || /^\s*Dialogue:/m.test(head)) {
    return "ass";
  }
  return null;
}

/* ── SubRip ───────────────────────────────────────────────────────────────── */

/**
 * Parse SubRip.
 *
 * Blocks are split on blank lines, which is how every SRT writer emits them.
 * The arrow line is FOUND rather than assumed to be line 2: files with no
 * sequence numbers, or with a stray blank line before the number, are common
 * enough that hardcoding the offset loses whole cues. Sequence numbers in the
 * source are read and thrown away — the writer renumbers from 1, because a
 * file with duplicate or missing numbers is one of the two things that make a
 * player refuse an otherwise fine SRT.
 *
 * Timings spelled with a period instead of a comma are accepted; plenty of
 * tools emit them, and every player reads them.
 */
export function parseSrt(source: string): ParsedSubtitles {
  const report = emptyParseReport();
  const cues: SubtitleCue[] = [];

  for (const block of blocks(normalizeText(source))) {
    const arrowAt = block.lines.findIndex((line) => ARROW.test(line));
    if (arrowAt === -1) {
      report.malformed.push(block.index);
      continue;
    }
    const match = ARROW.exec(block.lines[arrowAt]);
    const start = match ? parseTimestamp(match[1]) : null;
    const end = match ? parseTimestamp(match[2]) : null;
    if (start === null || end === null) {
      report.malformed.push(block.index);
      continue;
    }
    const body = block.lines.slice(arrowAt + 1).join("\n").replace(/\s+$/, "");
    if (!body.trim()) {
      report.malformed.push(block.index);
      continue;
    }
    const { text, stripped } = stripMarkup(body);
    if (stripped) report.styled++;
    cues.push({ start, end, text });
  }

  return { format: "srt", cues, report };
}

/**
 * Cue text with its blank lines taken out, for the two formats that cannot
 * hold one.
 *
 * A blank line is the block SEPARATOR in SubRip and WebVTT, so a blank line
 * inside cue text ends the cue: the words after it are orphaned into a block
 * with no timing, and every block after that one is read against the wrong
 * cue. ASS has no such rule — `\N` at the start of a Text field, or `\N\N`
 * inside it, is an ordinary way to nudge or space a line — so `assTextToPlain`
 * legitimately produces text these two writers must not write verbatim.
 *
 * Removing the line is a loss, not a repair, so `convertSubtitles` counts the
 * cues it happened to and the UI says so. Writing it instead produced a broken
 * file reported as a lossless success, which is worse in every direction.
 */
function withoutBlankLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n");
}

export function writeSrt(cues: SubtitleCue[]): string {
  if (cues.length === 0) return "";
  return (
    cues
      .map(
        (cue, i) =>
          `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${withoutBlankLines(cue.text)}`,
      )
      .join("\n\n") + "\n"
  );
}

/* ── WebVTT ───────────────────────────────────────────────────────────────── */

/** Blocks the WebVTT spec defines as not-a-cue. */
const VTT_NON_CUE = /^(NOTE|STYLE|REGION)(\s|$)/;

/**
 * Parse WebVTT.
 *
 * The header block, `NOTE` comments, `STYLE` blocks and `REGION` definitions
 * are skipped rather than counted as malformed — they are valid content that
 * simply is not a cue. `STYLE` and `REGION` are still counted, because both
 * decide how cues are DRAWN and a file that loses them looks different on
 * screen; `NOTE` is not, being a comment.
 *
 * Cue settings (`line:0 position:50% align:start`) are counted and dropped:
 * SRT has nowhere to put them, `writeVtt` does not write them back either, and
 * inventing a place is worse than saying they went.
 */
export function parseVtt(source: string): ParsedSubtitles {
  const report = emptyParseReport();
  const cues: SubtitleCue[] = [];
  const text = normalizeText(source);

  for (const block of blocks(text)) {
    const first = block.lines[0]?.trim() ?? "";
    const arrowAt = block.lines.findIndex((line) => ARROW.test(line));
    if (arrowAt === -1) {
      // The file signature and the spec's three non-cue blocks are valid
      // content, not damage — skipped without being counted as malformed.
      if (/^WEBVTT(\s|$)/.test(first)) continue;
      if (VTT_NON_CUE.test(first)) {
        // STYLE and REGION are rendering data — a file that loses them looks
        // different on screen — so they are counted on the way past. NOTE is
        // the author commenting to themselves, and nothing renders it.
        if (!/^NOTE(\s|$)/.test(first)) report.vttBlocks++;
        continue;
      }
      report.malformed.push(block.index);
      continue;
    }
    const match = ARROW.exec(block.lines[arrowAt]);
    const start = match ? parseTimestamp(match[1]) : null;
    const end = match ? parseTimestamp(match[2]) : null;
    if (start === null || end === null) {
      report.malformed.push(block.index);
      continue;
    }
    if ((match?.[3] ?? "").trim()) report.positioned++;

    const body = block.lines.slice(arrowAt + 1).join("\n").replace(/\s+$/, "");
    if (!body.trim()) {
      report.malformed.push(block.index);
      continue;
    }
    const withoutTimestamps = body.replace(VTT_TIMESTAMP_TAG, "");
    const stripTimestamps = withoutTimestamps !== body;
    const { text: tagless, stripped } = stripMarkup(withoutTimestamps);
    if (stripped || stripTimestamps) report.styled++;
    cues.push({ start, end, text: decodeEntities(tagless) });
  }

  return { format: "vtt", cues, report };
}

export function writeVtt(cues: SubtitleCue[]): string {
  if (cues.length === 0) return "WEBVTT\n";
  const body = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${escapeVttText(withoutBlankLines(cue.text))}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/* ── ASS / SSA ────────────────────────────────────────────────────────────── */

/**
 * The canonical `[Events]` field order, used when a file has no `Format:` line.
 *
 * SSA v4 writes `Marked` where ASS v4+ writes `Layer`; both have ten fields
 * with `Text` last, which is why reading the `Format:` line handles the two
 * dialects with no special case.
 */
const ASS_EVENT_FIELDS = [
  "layer",
  "start",
  "end",
  "style",
  "name",
  "marginl",
  "marginr",
  "marginv",
  "effect",
  "text",
];

/** Split on commas, but stop after `count - 1` — the last field keeps its commas. */
function splitFields(line: string, count: number): string[] {
  const out: string[] = [];
  let rest = line;
  for (let i = 0; i < count - 1; i++) {
    const at = rest.indexOf(",");
    if (at === -1) {
      out.push(rest);
      return out;
    }
    out.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  out.push(rest);
  return out;
}

/**
 * `\p1` and up switch ASS into vector-drawing mode: the "text" that follows is
 * a path (`m 0 0 l 100 0 100 100`), not words. Those cues are dropped rather
 * than emitted as a line of coordinates, and counted so the UI can say so.
 * `\pos(...)` is not this — the digit after `p` is what distinguishes them.
 *
 * Tested against the contents of an override BLOCK, never against the whole
 * Text field: drawing mode is an override like any other, and a cue reading
 * "Type \p1 to enable paragraph mode" is words. Sweeping the raw field dropped
 * that cue and told its author their subtitle had been a vector drawing.
 */
const ASS_DRAWING = /\\p[1-9]/;

/**
 * ASS dialogue text to plain text.
 *
 * `{...}` override blocks go entirely: that is the styling, the positioning,
 * the colours and the karaoke timings, and none of it has a home in SRT or
 * WebVTT. `\N` is a hard line break, `\n` a soft one — both become a newline,
 * because SRT and WebVTT have only the one kind. `\h` is a non-breaking space.
 *
 * ONE pass, rather than a strip followed by a sweep of replaces: `\\N` is a
 * literal backslash and then the letter N, and a `/\\N/g` replace run over the
 * already-stripped string cannot tell it from the line break `\N`.
 */
function assTextToPlain(raw: string): {
  text: string;
  hadOverrides: boolean;
  drawing: boolean;
} {
  let hadOverrides = false;
  let drawing = false;
  let stripped = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      /*
        `\{`, `\}` and `\\` are literal characters — the escapes
        `plainToAssText` writes. Reading them back here is what keeps a cue
        saying "{laughs}" or "C:\Netflix" intact through SRT to ASS and back,
        instead of losing the first to a phantom override block and the second
        to a line break. A regex sweep of `/\{[^}]*\}/` cannot see the
        difference.
      */
      if (next === "{" || next === "}" || next === "\\") {
        stripped += next;
        i++;
        continue;
      }
      if (next === "N" || next === "n") {
        stripped += "\n";
        i++;
        continue;
      }
      if (next === "h") {
        stripped += "\u00a0";
        i++;
        continue;
      }
      // A backslash before anything else is drawn as itself by libass and by
      // VSFilter, so it is a character rather than a broken escape.
      stripped += ch;
      continue;
    }
    if (ch === "{") {
      const close = raw.indexOf("}", i + 1);
      // An unmatched `{` is drawn literally by both libass and VSFilter, so it
      // is text rather than a broken override.
      if (close === -1) {
        stripped += ch;
        continue;
      }
      hadOverrides = true;
      if (ASS_DRAWING.test(raw.slice(i + 1, close))) drawing = true;
      i = close;
      continue;
    }
    stripped += ch;
  }
  return { text: stripped, hadOverrides, drawing };
}

/** The inverse: our three tags become override toggles, braces get escaped. */
function plainToAssText(text: string): string {
  return text
    // Escape first, so the toggles added below are not escaped in turn. An
    // unescaped `{` in cue text would open an override block and swallow
    // everything up to the next `}` — text that vanishes on screen. `\{` is
    // what libass and VSFilter both read back as a literal brace.
    //
    // The BACKSLASH goes first of all, because it is the escape character that
    // makes every other escape here work. Written through untouched, the `\N`
    // in "C:\Netflix" is a hard LINE BREAK in an ASS Text field: the path
    // arrives on screen split in two with the N eaten, and reading the file
    // back gives a real newline where the author typed a path. Escaping it
    // after the braces would instead double-escape the `\{` this same chain
    // just wrote.
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/<i>/g, "{\\i1}")
    .replace(/<\/i>/g, "{\\i0}")
    .replace(/<b>/g, "{\\b1}")
    .replace(/<\/b>/g, "{\\b0}")
    .replace(/<u>/g, "{\\u1}")
    .replace(/<\/u>/g, "{\\u0}")
    // ASS has no entities, so `&lt;i&gt;` would sit on screen as itself. The
    // characters it stands for are safe in this format — ASS marks up with
    // `{}`, not with angle brackets — so this is the one writer that can spell
    // them out. After the toggles above, never before, or a literal would be
    // turned into the markup it was escaped to avoid becoming.
    .replace(/&lt;(\/?[iub])&gt;/g, "<$1>")
    .replace(/\n/g, "\\N");
}

/**
 * Parse ASS/SSA.
 *
 * Only `Dialogue:` lines become cues. `Comment:` lines are the format's own
 * commented-out dialogue and are not displayed, so they are skipped without
 * being counted as damage. The `Format:` line is honoured, which is what makes
 * SSA v4 (`Marked` first) and ASS v4+ (`Layer` first) both read correctly.
 *
 * Events are the `[Events]` section AND anything before the first section
 * header, because a bare run of `Dialogue:` lines with no header at all is a
 * shape `detectSubtitleFormat` deliberately recognises. Requiring the header
 * here meant the detector pointed a whole class of file at a parser that
 * returned nothing and an error that said "No cues were found in this file."
 * A `Dialogue:` line inside `[Script Info]` is still not an event.
 */
export function parseAss(source: string): ParsedSubtitles {
  const report = emptyParseReport();
  const cues: SubtitleCue[] = [];
  const lines = normalizeText(source).split("\n");

  let section = "";
  let fields = ASS_EVENT_FIELDS;
  const seenStyles = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const header = /^\[(.+)\]$/.exec(trimmed);
    if (header) {
      section = header[1].toLowerCase();
      if (section === "events") fields = ASS_EVENT_FIELDS;
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1);

    const inEvents = section === "events" || section === "";

    if (inEvents && key === "format") {
      const declared = value.split(",").map((f) => f.trim().toLowerCase());
      // Only trust a Format line that actually names the fields we need.
      if (declared.includes("start") && declared.includes("end") && declared.includes("text")) {
        fields = declared;
      }
      continue;
    }

    if (!inEvents || key !== "dialogue") continue;

    const parts = splitFields(value, fields.length);
    const at = (name: string) => {
      const index = fields.indexOf(name);
      return index === -1 ? undefined : parts[index];
    };
    const start = parseTimestamp(at("start") ?? "");
    const end = parseTimestamp(at("end") ?? "");
    const rawText = at("text");
    if (start === null || end === null || rawText === undefined) {
      report.malformed.push(i + 1);
      continue;
    }

    const styleName = (at("style") ?? "").trim();
    if (styleName && !seenStyles.has(styleName)) {
      seenStyles.add(styleName);
      report.styles.push(styleName);
    }

    const { text, hadOverrides, drawing } = assTextToPlain(rawText);
    if (drawing) {
      report.drawings++;
      continue;
    }
    if (hadOverrides) report.styled++;
    if (!text.trim()) {
      // An override-only line (a lone `{\pos(...)}` placeholder, or a karaoke
      // spacer) leaves nothing behind. Not damage, and not a cue either.
      continue;
    }
    cues.push({ start, end, text });
  }

  return { format: "ass", cues, report };
}

/**
 * A minimal, self-consistent ASS v4+ file with one style.
 *
 * `PlayResX/Y` and the style's font size, outline and margins are one matched
 * set — a renderer scales the style by the play resolution, so 40pt against an
 * unset PlayRes is a different size on every player. 1280×720 with a 40pt
 * Arial is the combination Aegisub's own default template uses.
 */
const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

export function writeAss(cues: SubtitleCue[]): string {
  const events = cues
    .map(
      (cue) =>
        `Dialogue: 0,${formatAssTime(cue.start, "down")},${formatAssTime(cue.end, "up")},Default,,0,0,0,,${plainToAssText(cue.text)}`,
    )
    .join("\n");
  return events ? `${ASS_HEADER}${events}\n` : ASS_HEADER;
}

/* ── Parse / write dispatch ───────────────────────────────────────────────── */

export function parseSubtitles(source: string, format: SubtitleFormat): ParsedSubtitles {
  if (format === "vtt") return parseVtt(source);
  if (format === "ass") return parseAss(source);
  return parseSrt(source);
}

export function writeSubtitles(cues: SubtitleCue[], format: SubtitleFormat): string {
  if (format === "vtt") return writeVtt(cues);
  if (format === "ass") return writeAss(cues);
  return writeSrt(cues);
}

/* ── Re-timing ────────────────────────────────────────────────────────────── */

export interface RetimeOptions {
  /** Milliseconds added to every cue. Negative moves subtitles earlier. */
  offsetMs?: number;
  /** Multiplier applied BEFORE the offset — see `retimeScale`. */
  scale?: number;
}

/**
 * Scale, shift, validate, sort.
 *
 * ORDER, and it is a real decision: the frame-rate scale is applied first and
 * the offset second. The scale corrects the timeline the file was authored
 * against; the offset is the correction a person makes while watching the
 * result. Applying the offset first would multiply it by the scale, so a
 * "+2.5 s" typed against a 25→23.976 conversion would land at +2.6 s.
 *
 * Nothing invalid is ever written:
 *  - a cue whose end is at or before its start is DROPPED (it is unplayable in
 *    all three formats and WebVTT's parser discards it outright),
 *  - a cue moved entirely before zero is DROPPED,
 *  - a cue straddling zero has its start pulled to zero, keeping the words,
 *  - and every drop and clamp is counted.
 *
 * Overlaps are counted and NOT repaired: overlapping cues are legal and
 * deliberate (two speakers at once), so trimming them would be the tool
 * rewriting the author. Out-of-order cues ARE sorted, because WebVTT requires
 * cues in start order and a player is entitled to stop reading at the first
 * one that goes backwards.
 */
export function retimeCues(
  cues: SubtitleCue[],
  options: RetimeOptions = {},
): { cues: SubtitleCue[]; report: TimingReport } {
  const report = emptyTimingReport();
  const scale = options.scale ?? 1;
  const offset = options.offsetMs ?? 0;
  const out: SubtitleCue[] = [];

  for (const cue of cues) {
    const start = Math.round(cue.start * scale) + offset;
    const end = Math.round(cue.end * scale) + offset;
    if (end <= start) {
      report.droppedInvalid++;
      continue;
    }
    if (end <= 0) {
      report.droppedBeforeZero++;
      continue;
    }
    if (start < 0) {
      report.clampedToZero++;
      out.push({ start: 0, end, text: cue.text });
      continue;
    }
    out.push({ start, end, text: cue.text });
  }

  // Counted against the source order, before the sort repairs it. A uniform
  // scale and offset cannot reorder anything, so this only ever reports what
  // the input file already had.
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].start) report.reordered++;
  }

  const sorted = out
    .map((cue, i) => ({ cue, i }))
    .sort((a, b) => a.cue.start - b.cue.start || a.cue.end - b.cue.end || a.i - b.i)
    .map((entry) => entry.cue);

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) report.overlaps++;
  }

  return { cues: sorted, report };
}

/* ── The one call the UI makes ────────────────────────────────────────────── */

export interface ConvertOptions {
  targetFormat: SubtitleFormat;
  /**
   * Skips detection when set. Callers with better information than the bytes
   * — a container's own track metadata, say — can name the format outright.
   * `SubtitleConverterUI` does not: it relies on `detectSubtitleFormat`, which
   * is why that function tests the sharp signal first.
   */
  sourceFormat?: SubtitleFormat;
  offsetMs?: number;
  sourceFps?: number;
  targetFps?: number;
}

export interface ConvertResult {
  text: string;
  sourceFormat: SubtitleFormat;
  targetFormat: SubtitleFormat;
  cues: SubtitleCue[];
  /** Cues in the source file, before any were dropped. */
  sourceCueCount: number;
  /** End of the last cue after re-timing, in ms. `0` when there are none. */
  endMs: number;
  /**
   * Cues whose text held a blank line the target format cannot carry.
   *
   * A blank line ENDS a cue in SubRip and WebVTT, so `writeSrt` and `writeVtt`
   * remove it — see `withoutBlankLines`. Always 0 for an ASS target, which
   * writes the line as `\N\N` and keeps it.
   */
  blankLineCues: number;
  parse: ParseReport;
  timing: TimingReport;
}

export class SubtitleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubtitleError";
  }
}

/**
 * Detect, parse, re-time, write. Throws `SubtitleError` with a sentence the UI
 * shows verbatim when there is nothing to convert — never returns an empty
 * "successful" file, which is the shape of failure that looks like success.
 */
export function convertSubtitles(source: string, options: ConvertOptions): ConvertResult {
  const sourceFormat = options.sourceFormat ?? detectSubtitleFormat(source);
  if (!sourceFormat) {
    throw new SubtitleError(
      "This does not look like a SubRip, WebVTT or ASS/SSA file: no cue timings and no [Events] section were found.",
    );
  }

  const parsed = parseSubtitles(source, sourceFormat);
  if (parsed.cues.length === 0) {
    throw new SubtitleError(
      parsed.report.malformed.length > 0
        ? `No readable cues: all ${parsed.report.malformed.length} blocks in this file were missing a timing line.`
        : "No cues were found in this file.",
    );
  }

  const scale =
    options.sourceFps && options.targetFps
      ? retimeScale(options.sourceFps, options.targetFps)
      : 1;
  const { cues, report: timing } = retimeCues(parsed.cues, {
    offsetMs: options.offsetMs ?? 0,
    scale,
  });

  if (cues.length === 0) {
    /*
      WHICH sentence is true depends on why the list emptied. `droppedInvalid`
      is a property of the file — an end at or before its own start, which is
      what several broken muxers write — and has nothing to do with the offset.
      Blaming a negative shift there points the user at a field that is empty
      and at an adjustment that cannot help.
    */
    if (timing.droppedBeforeZero === 0) {
      throw new SubtitleError(
        "Every cue in this file ends at or before its own start time, so there is nothing any player could show. That is how the file was written; no time shift will bring the cues back.",
      );
    }
    throw new SubtitleError(
      timing.droppedInvalid > 0
        ? "Nothing is left to write: some cues ended at or before their own start time, and the time shift moved the rest before 00:00:00."
        : "Every cue ended up before 00:00:00. Shift by a smaller negative offset.",
    );
  }

  return {
    text: writeSubtitles(cues, options.targetFormat),
    sourceFormat,
    targetFormat: options.targetFormat,
    cues,
    sourceCueCount: parsed.cues.length,
    endMs: cues.reduce((max, cue) => Math.max(max, cue.end), 0),
    blankLineCues:
      options.targetFormat === "ass"
        ? 0
        : cues.filter((cue) => withoutBlankLines(cue.text) !== cue.text).length,
    parse: parsed.report,
    timing,
  };
}

/* ── Bytes in ─────────────────────────────────────────────────────────────── */

/** The encodings offered as a manual override, plus the automatic fallback. */
export const SUBTITLE_ENCODINGS = [
  { label: "utf-8", name: "UTF-8" },
  { label: "windows-1252", name: "Windows-1252 · Western" },
  { label: "windows-1250", name: "Windows-1250 · Central European" },
  { label: "windows-1251", name: "Windows-1251 · Cyrillic" },
  { label: "windows-1253", name: "Windows-1253 · Greek" },
  { label: "windows-1254", name: "Windows-1254 · Turkish" },
  { label: "windows-1255", name: "Windows-1255 · Hebrew" },
  { label: "windows-1256", name: "Windows-1256 · Arabic" },
  { label: "iso-8859-2", name: "ISO-8859-2 · Latin-2" },
  { label: "shift_jis", name: "Shift_JIS · Japanese" },
  { label: "gb18030", name: "GB18030 · Simplified Chinese" },
  { label: "big5", name: "Big5 · Traditional Chinese" },
  { label: "euc-kr", name: "EUC-KR · Korean" },
  { label: "utf-16le", name: "UTF-16 LE" },
  { label: "utf-16be", name: "UTF-16 BE" },
] as const;

/** What the guesser fell back to when the bytes are not valid UTF-8. */
export const FALLBACK_ENCODING = "windows-1252";

export interface DecodeResult {
  text: string;
  /** The label actually decoded with. */
  encoding: string;
  /**
   * How that label was chosen. `guess` is the only one the UI treats as
   * uncertain, and it is the only one that can silently produce wrong accents.
   */
  basis: "forced" | "bom" | "utf-8" | "guess";
  /** Every byte below 0x80: all these encodings agree, so nothing can be wrong. */
  ascii: boolean;
}

const startsWith = (bytes: Uint8Array, sig: number[]) =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/**
 * Is this UTF-16 with no BOM? Latin text in UTF-16 is half NUL bytes, and
 * which half says which endianness.
 *
 * This check runs BEFORE the UTF-8 attempt on purpose. NUL is a perfectly
 * valid UTF-8 byte, so `TextDecoder("utf-8", { fatal: true })` accepts
 * BOM-less UTF-16LE without complaint and hands back text with a NUL between
 * every letter — which then parses as nothing and looks like an empty file.
 */
function sniffUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const window = Math.min(bytes.length, 2048);
  if (window < 16) return null;
  let evenNuls = 0;
  let oddNuls = 0;
  for (let i = 0; i < window; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) evenNuls++;
    else oddNuls++;
  }
  const half = window / 2;
  // At least 60% of one parity is NUL and almost none of the other.
  if (oddNuls > half * 0.6 && evenNuls < half * 0.1) return "utf-16le";
  if (evenNuls > half * 0.6 && oddNuls < half * 0.1) return "utf-16be";
  return null;
}

function decodeWith(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // A browser without this legacy codec throws from the constructor. Rare,
    // but a throw here would take down the whole conversion.
    return null;
  }
}

/**
 * Bytes to text, with the encoding it used and how sure it is.
 *
 * Detection order, and each step exists because the one before it is not
 * enough:
 *  1. A forced label from the UI wins outright.
 *  2. A BOM is a statement by the writer — believe it.
 *  3. BOM-less UTF-16, by NUL parity. Must precede the UTF-8 test; see
 *     `sniffUtf16`.
 *  4. A STRICT UTF-8 decode. `fatal: true` is the whole point: the default
 *     decoder replaces every invalid byte with U+FFFD and reports success, so
 *     a Windows-1252 file "converts" into one with a black diamond where each
 *     accent was. Failing here is how we learn the file is not UTF-8.
 *  5. Windows-1252, flagged as a GUESS. It is the commonest legacy codepage
 *     for subtitles by a wide margin and it is a superset of Latin-1 in the
 *     browser's own tables, but a Cyrillic or Greek file is equally valid
 *     non-UTF-8 and will come out wrong. The UI says so and offers the picker;
 *     this function will not pretend to know.
 */
export function decodeSubtitleBytes(bytes: Uint8Array, forced?: string): DecodeResult {
  const ascii = bytes.every((b) => b < 0x80);

  if (forced) {
    const text = decodeWith(bytes, forced);
    if (text !== null) return { text, encoding: forced, basis: "forced", ascii };
  }

  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    const text = decodeWith(bytes, "utf-8");
    if (text !== null) return { text, encoding: "utf-8", basis: "bom", ascii };
  }
  // Order matters: FF FE 00 00 is UTF-32LE, which also starts FF FE. We do not
  // support UTF-32, and treating it as UTF-16 would produce NUL-riddled text,
  // so it falls through to the sniffer and then to the UTF-8 test.
  if (startsWith(bytes, [0xff, 0xfe]) && !startsWith(bytes, [0xff, 0xfe, 0x00, 0x00])) {
    const text = decodeWith(bytes, "utf-16le");
    if (text !== null) return { text, encoding: "utf-16le", basis: "bom", ascii };
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    const text = decodeWith(bytes, "utf-16be");
    if (text !== null) return { text, encoding: "utf-16be", basis: "bom", ascii };
  }

  const sniffed = sniffUtf16(bytes);
  if (sniffed) {
    const text = decodeWith(bytes, sniffed);
    if (text !== null) return { text, encoding: sniffed, basis: "guess", ascii };
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "utf-8", basis: "utf-8", ascii };
  } catch {
    // Not UTF-8. Everything from here is a guess, and is labelled one.
  }

  const fallback = decodeWith(bytes, FALLBACK_ENCODING);
  if (fallback !== null) {
    return { text: fallback, encoding: FALLBACK_ENCODING, basis: "guess", ascii };
  }
  // No legacy codec available at all: decode leniently so the words survive
  // even though the accents will not, and say it was a guess.
  return { text: new TextDecoder().decode(bytes), encoding: "utf-8", basis: "guess", ascii };
}

/* ── Files ────────────────────────────────────────────────────────────────── */

export const SUBTITLE_EXTENSION: Record<SubtitleFormat, string> = {
  srt: "srt",
  vtt: "vtt",
  ass: "ass",
};

export const SUBTITLE_FORMAT_NAME: Record<SubtitleFormat, string> = {
  srt: "SubRip (.srt)",
  vtt: "WebVTT (.vtt)",
  ass: "ASS/SSA (.ass)",
};

/** What the drop zone takes. `.sub` is deliberately absent — see the UI copy. */
export const SUBTITLE_ACCEPT = ".srt,.vtt,.ass,.ssa";

export function subtitleFileName(sourceName: string, format: SubtitleFormat): string {
  const base = sourceName.replace(/\.(srt|vtt|ass|ssa|txt)$/i, "").trim();
  return `${base || "subtitles"}.${SUBTITLE_EXTENSION[format]}`;
}

/** `1:04:02` — the readout for where the last cue ends. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
