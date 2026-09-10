/**
 * YAML → JSON, JSON → YAML, and YAML re-formatting, over js-yaml 4.
 *
 * Pure functions over strings. No DOM, no WASM — the three pages that use this
 * hold state and copy, nothing else.
 *
 * ── Why this file is mostly loss-reporting ──────────────────────────────────
 *
 * YAML and JSON are not the same data model, and every honest converter has to
 * say where the two disagree. Six disagreements matter enough to be counted
 * rather than hand-waved:
 *
 * 1. **Documents.** A YAML stream can hold several documents separated by
 *    `---`. `yaml.load` THROWS on the second one ("expected a single document
 *    in the stream"), so everything here goes through `loadAll` and reports how
 *    many came back. JSON has no document separator, so more than one document
 *    can only be written out as a JSON array.
 *
 * 2. **Keys.** YAML keys are values: `1: a`, `true: b`, `2026-01-01: c` and
 *    `? [a, b] : d` are all legal. JSON keys are strings only, and js-yaml
 *    resolves the collision by calling `String()` on the key — silently. A
 *    date key is the worst of them: `String(new Date(...))` is a LOCALE- and
 *    TIMEZONE-dependent sentence, so `2026-01-01: c` becomes a key like
 *    `"Thu Jan 01 2026 05:30:00 GMT+0530 (India Standard Time)"`. That is not
 *    something to let through quietly, so `findNonStringKeys` finds them in the
 *    SOURCE — see that function for how, since the parsed object has already
 *    lost the evidence.
 *
 * 3. **Anchors and aliases.** `&a` / `*a` are one node referenced twice.
 *    `JSON.stringify` has no way to say that, so it writes the node out again:
 *    the JSON is bigger than the YAML by exactly the aliased subtrees. And a
 *    CYCLIC anchor (`a: &x {self: *x}`) makes `JSON.stringify` throw
 *    "Converting circular structure to JSON". `scanTree` finds both by walking
 *    the parsed value, so the cycle is reported by name instead of surfacing as
 *    a TypeError.
 *
 *    Walking the value only finds anchors on MAPPINGS and SEQUENCES, because
 *    those are the only nodes with a JS identity to share. An anchor on a plain
 *    scalar (`x-tag: &tag "1.24"` … `version: *tag`) parses to two equal
 *    strings and leaves no trace in the value at all — and `yaml.dump` only
 *    re-emits an anchor for a shared mapping or sequence, so that anchor is
 *    gone from the output entirely. `scanYamlSource` counts those off the
 *    PARSE, the same listener ride-along `findNonStringKeys` uses, so a lost
 *    anchor is reported rather than silently flattened.
 *
 * 4. **Timestamps.** js-yaml's default schema turns `2026-01-01` into a JS
 *    `Date`, and `JSON.stringify` then writes it as `"2026-01-01T00:00:00.000Z"`
 *    — a string, with a time on it that the source never gave. Counted.
 *
 * 5. **The JSON → YAML direction cannot be lossless, and this is the important
 *    one.** `yaml.dump` takes a JS VALUE, so that direction must run
 *    `JSON.parse` first, which is the exact round trip `lib/tools/json-format.ts`
 *    exists to avoid: `12345678901234567890` comes back as
 *    `12345678901234567000`, `1.0` becomes `1`, `1e2` becomes `100`, and a key
 *    written twice loses its first value with no error. There is no way around
 *    it here — `dump` cannot be handed raw text — so `scanJsonLiterals` reads
 *    the raw JSON and reports every literal the parse will change, before the
 *    user downloads anything.
 *
 * 6. **Comments.** Neither `JSON.stringify` nor `yaml.dump` can emit one, and
 *    js-yaml discards them at parse time without recording where they were.
 *    They are gone from every output here, including YAML → YAML. That one is
 *    stated in the copy rather than counted: there is nothing left to count.
 */

import { dump, loadAll, YAMLException, type State } from "js-yaml";

/* ── Shared shapes ────────────────────────────────────────────────────────── */

/** The two indents the pages offer. Anything else is a config file nobody has. */
export type Indent = 2 | 4;

/** Line width for `yaml.dump`. `-1` is js-yaml's own "never wrap". */
export type LineWidth = 80 | 120 | -1;

export interface YamlDumpOptions {
  indent?: Indent;
  sortKeys?: boolean;
  lineWidth?: LineWidth;
}

/** A parser's own account of where it stopped. Never invented. */
export interface ParseFailure {
  /** The parser's wording, not ours. */
  message: string;
  /** 1-based, or null when the parser did not say. */
  at: { line: number; column: number } | null;
  /** js-yaml prints its own excerpt; JSON.parse does not. */
  snippet: string | null;
}

/* ── Errors ───────────────────────────────────────────────────────────────── */

/**
 * Turn a js-yaml throw into something printable.
 *
 * `YAMLException.mark` carries 0-based `line`/`column` plus a `snippet` with the
 * offending line marked, which is better than anything we could reconstruct.
 */
export function describeYamlFailure(err: unknown): ParseFailure {
  if (err instanceof YAMLException) {
    const mark = err.mark as
      | { line?: number; column?: number; snippet?: string }
      | undefined;
    return {
      message: err.reason || err.message,
      at:
        mark && typeof mark.line === "number" && typeof mark.column === "number"
          ? { line: mark.line + 1, column: mark.column + 1 }
          : null,
      snippet: mark?.snippet ?? null,
    };
  }
  return {
    message: err instanceof Error ? err.message : "This YAML could not be read.",
    at: null,
    snippet: null,
  };
}

/**
 * Turn a `JSON.parse` throw into the same shape.
 *
 * V8 says `… at position 7 (line 1 column 8)`; SpiderMonkey says `… at line 1
 * column 8 of the JSON data`; JavaScriptCore says only `JSON Parse error: …`.
 * Take line/column when the engine offers them, fall back to the byte offset,
 * and return `at: null` when neither is on offer rather than guessing. Same
 * rule `JsonFormatterUI` already follows.
 */
export function describeJsonFailure(err: unknown, source: string): ParseFailure {
  const message =
    err instanceof Error ? err.message : "This JSON could not be read.";

  const lineCol = message.match(/line (\d+) column (\d+)/i);
  if (lineCol) {
    return {
      message,
      at: { line: Number(lineCol[1]), column: Number(lineCol[2]) },
      snippet: null,
    };
  }

  const pos = message.match(/at position (\d+)/i);
  if (!pos) return { message, at: null, snippet: null };
  const offset = Math.min(Number(pos[1]), source.length);
  const before = source.slice(0, offset);
  return {
    message,
    at: {
      line: before.split("\n").length,
      column: offset - before.lastIndexOf("\n"),
    },
    snippet: null,
  };
}

/* ── Non-string keys ──────────────────────────────────────────────────────── */

export type KeyKind = "number" | "boolean" | "null" | "date" | "sequence" | "mapping";

export interface NonStringKey {
  /** Exactly the characters the source used for the key. */
  source: string;
  kind: KeyKind;
  /** The string js-yaml turns it into — what JSON and re-dumped YAML both get. */
  becomes: string;
  /** 1-based line the key sits on. */
  line: number;
}

const isPlainObject = (v: unknown): boolean =>
  Object.prototype.toString.call(v) === "[object Object]";

/**
 * Will `yaml.dump` give this node an `&ref_N` anchor when it meets it twice?
 *
 * Only for a mapping or a sequence. js-yaml's `writeNode` gates the anchor on
 * `[object Object]` / `[object Array]`, so a shared Date or a shared typed
 * array is written out again with no anchor at all — measured, not assumed:
 * `dump({a: d, b: d})` with one Date prints the timestamp twice.
 */
const isAnchorable = (v: unknown): boolean => Array.isArray(v) || isPlainObject(v);

/**
 * js-yaml's own key stringification, copied from `storeMappingPair`: an array
 * key joins on commas with nested objects flattened to `[object Object]`, an
 * object key becomes `[object Object]`, everything else goes through `String`.
 * Reimplemented here so the warning can print the key the output will actually
 * carry rather than a guess at it.
 */
function keyToString(key: unknown): string {
  if (Array.isArray(key)) {
    return key.map((el) => (isPlainObject(el) ? "[object Object]" : el)).toString();
  }
  if (isPlainObject(key)) return "[object Object]";
  return String(key);
}

function keyKind(value: unknown): KeyKind | null {
  if (typeof value === "string") return null;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null) return "null";
  if (value instanceof Date) return "date";
  if (Array.isArray(value)) return "sequence";
  if (typeof value === "object") return "mapping";
  return null;
}

/**
 * Is the node that ended at `end` a mapping KEY?
 *
 * Skip whitespace forward; a key is followed by `:` and then a space, a line
 * break, the end of input, or a flow terminator. The `:` may be on the NEXT
 * line, which is what an explicit key looks like:
 *
 *     ? [a, b]
 *     : c
 *
 * A `:` that starts a line can only be that marker — every other colon in YAML
 * follows the key it belongs to — so skipping line breaks here cannot turn a
 * value into a key. The space after the colon is required: in a flow mapping
 * `{a:b}` is the single plain scalar `a:b`, not a pair.
 */
function isKeyPosition(text: string, end: number): boolean {
  let i = end;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== ":") return false;
  const next = text[i + 1];
  return (
    next === undefined ||
    next === " " ||
    next === "\t" ||
    next === "\n" ||
    next === "\r" ||
    next === "," ||
    next === "}"
  );
}

/** First non-whitespace character of `text[from…to)`, or `""` if there is none. */
function firstChar(text: string, from: number, to: number): string {
  let i = from;
  while (i < to && /\s/.test(text[i])) i++;
  return i < to ? text[i] : "";
}

export interface SourceScan {
  nonStringKeys: NonStringKey[];
  /**
   * Aliases pointing at a node `yaml.dump` will NOT anchor — a scalar, a
   * timestamp. The value is written out again at every reference and both
   * `&name` and `*name` vanish from the output, in either direction.
   *
   * These cannot be found by walking the parsed value: two references to one
   * anchored string are just two equal strings afterwards. Counted here off the
   * parse instead.
   */
  expandedAliases: number;
}

const EMPTY_SOURCE_SCAN: SourceScan = { nonStringKeys: [], expandedAliases: 0 };

/**
 * One listener pass over the SOURCE, for the two things the parsed value cannot
 * tell us.
 *
 * Both have to read the source, because by the time `loadAll` returns the
 * evidence is gone: js-yaml has already called `String()` on every key, so
 * `1: a` and `"1": a` are the same object afterwards (js-yaml even rejects a
 * file containing both as a duplicate key), and an alias to a scalar has
 * dissolved into a second copy of the scalar. The only place either
 * distinction survives is the parse itself, so this rides along on js-yaml's
 * `listener` option: `open` pushes a node's start offset, `close` pops it and
 * hands back the resolved value. A node whose span is followed by `: ` was a
 * key; a node whose span STARTS with `*` was an alias, since `*` is a YAML
 * indicator and no plain scalar may begin with one.
 *
 * Returns zeroes when the document does not parse — the caller reports the
 * parse error, and a half-read file has nothing worth counting.
 */
export function scanYamlSource(text: string): SourceScan {
  const starts: number[] = [];
  /*
    js-yaml fires `close` twice for a node it composes twice (an explicit key
    is the case that does it), with the same end offset both times. Dedupe on
    that offset so a `? [a, b]` key is not reported as two.
  */
  const closed = new Set<number>();
  const nonStringKeys: NonStringKey[] = [];
  let expandedAliases = 0;

  const listener = (event: "open" | "close", state: State) => {
    if (event === "open") {
      starts.push(state.position);
      return;
    }
    const start = starts.pop() ?? state.position;
    const end = state.position;
    if (closed.has(end)) return;
    closed.add(end);

    /*
      An alias whose target IS anchorable is already counted by `scanTree` off
      the value, by identity. Counting it here as well would double it.
    */
    if (firstChar(text, start, end) === "*" && !isAnchorable(state.result)) {
      expandedAliases++;
    }

    if (!isKeyPosition(text, end)) return;
    const kind = keyKind(state.result);
    if (!kind) return;
    nonStringKeys.push({
      source: text.slice(start, end).trim(),
      kind,
      becomes: keyToString(state.result),
      line: state.line + 1,
    });
  };

  try {
    loadAll(text, null, { listener });
  } catch {
    return EMPTY_SOURCE_SCAN;
  }
  return { nonStringKeys, expandedAliases };
}

/**
 * Every mapping key in the source that is not a string. See `scanYamlSource`
 * for how, and why it cannot be read off the parsed value.
 */
export function findNonStringKeys(text: string): NonStringKey[] {
  return scanYamlSource(text).nonStringKeys;
}

/* ── Walking the parsed value ─────────────────────────────────────────────── */

export interface TreeScan {
  /** Values that came back as JS `Date`s — YAML timestamps. */
  dates: number;
  /**
   * EXTRA references to a node already fully visited. In the source that is an
   * alias (`*name`) pointing at an anchor (`&name`); in JSON it is a second
   * copy, which is why the JSON is bigger. A CYCLIC reference is not one of
   * these: JSON refuses that file outright, so nothing is expanded.
   */
  aliasExpansions: number;
  /**
   * DISTINCT nodes `yaml.dump` will write with an `&ref_N` anchor: every
   * mapping or sequence reached more than once, cycles included. Counting
   * nodes rather than references is what the formatter's sentence claims —
   * three references to one shared block are one anchor, not two.
   */
  reAnchored: number;
  /** Dotted path of the first cycle found, or null. `JSON.stringify` throws on one. */
  cycle: string | null;
}

/**
 * Count what the shape of the parsed value implies, without touching the text.
 *
 * A node already on the current path is a cycle; a node seen before but not on
 * the path is an alias that will be written out twice. Both are properties of
 * the value js-yaml built, so both are facts about this run rather than
 * general warnings — and both make `dump` emit an anchor, which is why the
 * cycle branch counts toward `reAnchored` on its way out.
 */
export function scanTree(root: unknown): TreeScan {
  const seen = new Set<object>();
  const onPath = new Set<object>();
  const anchored = new Set<object>();
  let dates = 0;
  let aliasExpansions = 0;
  let cycle: string | null = null;

  const walk = (node: unknown, path: string[]): void => {
    if (node instanceof Date) {
      dates++;
      return;
    }
    if (node === null || typeof node !== "object") return;
    const obj = node as object;

    if (onPath.has(obj)) {
      if (cycle === null) cycle = path.join(".") || "(root)";
      /*
        `dump` writes the loop back as `&ref_0` / `*ref_0`, renaming whatever
        the author called it — so this node IS re-anchored and the formatter
        has to say so. It is NOT an expansion: the JSON direction refuses a
        cyclic file rather than writing anything out twice.
      */
      if (isAnchorable(obj)) anchored.add(obj);
      return;
    }
    if (seen.has(obj)) {
      aliasExpansions++;
      if (isAnchorable(obj)) anchored.add(obj);
      return;
    }
    seen.add(obj);
    onPath.add(obj);
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walk(v, [...path, String(i)]));
    } else {
      for (const [k, v] of Object.entries(obj)) walk(v, [...path, k]);
    }
    onPath.delete(obj);
  };

  walk(root, []);
  return { dates, aliasExpansions, reAnchored: anchored.size, cycle };
}

/**
 * `scanTree` over each document separately, which is also the correct reading:
 * a YAML anchor does not survive a `---`, so two documents sharing a node is
 * not something a source file can express. Scanning them as one array would
 * also put a useless `0.` in front of every reported path.
 */
function scanDocuments(docs: unknown[]): TreeScan {
  let dates = 0;
  let aliasExpansions = 0;
  let reAnchored = 0;
  let cycle: string | null = null;

  docs.forEach((doc, index) => {
    const scan = scanTree(doc);
    dates += scan.dates;
    aliasExpansions += scan.aliasExpansions;
    reAnchored += scan.reAnchored;
    if (cycle === null && scan.cycle !== null) {
      cycle = docs.length > 1 ? `document ${index + 1} · ${scan.cycle}` : scan.cycle;
    }
  });

  return { dates, aliasExpansions, reAnchored, cycle };
}

/* ── YAML → JSON ──────────────────────────────────────────────────────────── */

export interface YamlToJsonResult {
  /** Empty when there was nothing to convert, or when a cycle blocks it. */
  json: string;
  /** How many documents the stream held. More than one becomes a JSON array. */
  documents: number;
  nonStringKeys: NonStringKey[];
  dates: number;
  /**
   * Every `*name` that gets written out as a second copy — anchors on mappings
   * and sequences (found in the value) plus anchors on scalars and timestamps
   * (found in the source). JSON has no way to reference a node, so all of them
   * expand.
   */
  aliasExpansions: number;
  cycle: string | null;
}

/**
 * Read a YAML stream and write JSON. Throws `YAMLException` on bad YAML — the
 * caller runs it through `describeYamlFailure`.
 */
export function yamlToJson(text: string, indent: Indent = 2): YamlToJsonResult {
  const docs = loadAll(text) as unknown[];
  const source = scanYamlSource(text);
  const nonStringKeys = source.nonStringKeys;
  const scan = scanDocuments(docs);

  /*
    One document unwraps; several become an array, because JSON has no `---`.
    A cycle is not converted at all: `JSON.stringify` would throw, and an empty
    pane with the cycle's path named beats a TypeError in the console.
  */
  let json = "";
  if (docs.length > 0 && scan.cycle === null) {
    json = JSON.stringify(docs.length === 1 ? docs[0] : docs, null, indent) ?? "";
  }

  return {
    json,
    documents: docs.length,
    nonStringKeys,
    dates: scan.dates,
    aliasExpansions: scan.aliasExpansions + source.expandedAliases,
    cycle: scan.cycle,
  };
}

/* ── JSON → YAML ──────────────────────────────────────────────────────────── */

export interface NumberRewrite {
  /** The digits the source wrote. */
  literal: string;
  /**
   * The characters the YAML file will carry in this literal's place — taken
   * from `yaml.dump` itself, not from `String()`.
   *
   * Those two disagree, and the disagreement used to be printed: the double
   * behind `-0` prints as `0` but js-yaml writes `-0.0`, and the double behind
   * `12345678901234567890` prints EXACTLY as `12345678901234567168` while the
   * file says `12345678901234567000`. A reader checking the reported
   * substitution against their own output has to find it there.
   */
  becomes: string;
  /** 1-based line. */
  line: number;
}

export interface DuplicateKey {
  key: string;
  /** 1-based line of the SECOND occurrence — the one that wins. */
  line: number;
}

export interface JsonScan {
  /**
   * Literals whose VALUE a double cannot hold: an id past 2^53, a decimal with
   * more significant digits than a double carries, a number so large it parses
   * to Infinity or so small it parses to zero. The file comes out saying a
   * different number from the one that went in.
   *
   * Named for the case that bites hardest, not the only case: `0.1234567890123456789`
   * is not an integer and still loses three digits.
   */
  changedNumbers: NumberRewrite[];
  /**
   * Literals whose value survives but whose spelling does not — `1.0` → `1`,
   * `1e2` → `100`, `1.50` → `1.5`, `1e-7` → `1.e-7`. Harmless to a program,
   * visible in a diff. Membership here is PROVEN, by comparing the literal and
   * the emitted text as exact decimals; it is not assumed from the shape of
   * the literal.
   */
  rewrittenNumbers: NumberRewrite[];
  /** Keys written twice in one object. `JSON.parse` keeps the last, silently. */
  duplicateKeys: DuplicateKey[];
}

/** Index just past the closing quote of the string literal starting at `i`. */
function endOfString(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    j++;
    if (text[j - 1] === '"') break;
  }
  return j;
}

/**
 * The exact value a decimal literal denotes, as `digits × 10^exponent` with
 * trailing zeroes stripped, so every spelling of one value normalises to one
 * pair: `1`, `1.0`, `1.00` and `1e0` all become `{ digits: 1n, exponent: 0 }`.
 * `null` when the text is not a plain decimal number — `.inf` and `.nan` land
 * there, and so does anything malformed.
 *
 * Zeroes are stripped off the STRING rather than by dividing the BigInt: a
 * pasted literal can carry a hundred thousand of them, and a hundred thousand
 * BigInt divisions is a hang.
 */
function decimalValue(literal: string): { digits: bigint; exponent: number } | null {
  const parts = /^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!parts) return null;
  const [, sign, whole, fraction = "", exponentText] = parts;

  const significand = `${whole}${fraction}`;
  let exponent = (exponentText ? Number(exponentText) : 0) - fraction.length;
  let end = significand.length;
  while (end > 1 && significand[end - 1] === "0") {
    end--;
    exponent++;
  }
  const digits = significand.slice(0, end).replace(/^0+(?=\d)/, "");
  // `BigInt(0)` rather than `0n`: tsconfig targets ES2017, which has no BigInt
  // literal syntax. The constructor call is what the rest of this file uses.
  if (digits === "0") return { digits: BigInt(0), exponent: 0 };
  return { digits: BigInt(`${sign}${digits}`), exponent };
}

/**
 * Do these two literals denote the SAME number? `false` when either is not a
 * plain decimal, which is the safe answer: an unreadable literal is never
 * waved through as a harmless respelling.
 */
function sameNumber(a: string, b: string): boolean {
  const left = decimalValue(a);
  const right = decimalValue(b);
  if (left === null || right === null) return false;
  return left.digits === right.digits && left.exponent === right.exponent;
}

/** Exactly the characters `yaml.dump` writes for this number, and nothing else. */
function writtenNumber(n: number): string {
  return dump(n).trim();
}

/**
 * What the round trip through `JSON.parse` and `yaml.dump` does to one number
 * literal, or null when it comes out unchanged.
 *
 * ── Why this compares TEXT to TEXT ─────────────────────────────────────────
 *
 * The question a reader has is "does the file still say my number?", and the
 * only honest way to answer it is to compare what they wrote against what will
 * be written — as exact decimals, digit for digit. So `becomes` is taken from
 * `dump` itself, and the value test runs against that same string.
 *
 * The previous version tested exactness only on integer-shaped literals
 * (`/^-?\d+$/`) and filed EVERYTHING else under "spelled differently", whose
 * on-screen sentence promises "the value is the same one a program would
 * read". That promise was false for any literal carrying more precision than a
 * double: `9007199254740993.0` (an integer wearing a decimal point) and
 * `0.1234567890123456789` both lost digits and both were graded harmless, with
 * the "if those digits matter, quote them" warning suppressed. Comparing
 * decimals catches those, and still passes `1.0` → `1` and `1e2` → `100`,
 * which really are the same number.
 *
 * Note it deliberately does NOT ask whether the literal is exactly
 * representable as a double: `0.1` is not, yet the file still says `0.1`, and
 * flagging every decimal fraction would bury the two cases that matter.
 */
export function analyseNumberLiteral(
  literal: string,
): { kind: "value" | "notation"; becomes: string } | null {
  // `Number` handles the overflow and underflow cases on its own; `dump` then
  // spells the result the way the file will (`.inf`, `-.inf`, `.nan`), so
  // there is no second copy of js-yaml's vocabulary to drift out of date.
  const becomes = writtenNumber(Number(literal));
  if (becomes === literal) return null;
  return { kind: sameNumber(literal, becomes) ? "notation" : "value", becomes };
}

/**
 * Read raw JSON text and report everything `JSON.parse` is about to change.
 *
 * This is the whole reason `json-to-yaml` is honest: `yaml.dump` takes a value,
 * so the parse is unavoidable, and the parse is lossy. Scanning the text first
 * means the loss is named — with the literal, the line, and what it becomes —
 * instead of being discovered later in a diff.
 *
 * Structural only: it tracks string literals so nothing inside one is mistaken
 * for a number or a key, and it never validates. Invalid JSON is the caller's
 * problem; this just will not crash on it.
 */
export function scanJsonLiterals(text: string): JsonScan {
  const changedNumbers: NumberRewrite[] = [];
  const rewrittenNumbers: NumberRewrite[] = [];
  const duplicateKeys: DuplicateKey[] = [];

  interface Frame {
    object: boolean;
    keys: Set<string>;
    expectKey: boolean;
  }
  const stack: Frame[] = [];
  let line = 1;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }

    if (ch === '"') {
      const end = endOfString(text, i);
      const raw = text.slice(i, end);
      const top = stack[stack.length - 1];
      if (top && top.object && top.expectKey) {
        let key = raw;
        try {
          key = JSON.parse(raw) as string;
        } catch {
          /* Unterminated or malformed: use the raw slice, still comparable. */
        }
        if (top.keys.has(key)) duplicateKeys.push({ key, line });
        else top.keys.add(key);
        top.expectKey = false;
      }
      // A JSON string cannot contain a raw newline, but an unterminated one
      // will have swallowed some; keep the line counter honest either way.
      for (const c of raw) if (c === "\n") line++;
      i = end;
      continue;
    }

    if (ch === "{") {
      stack.push({ object: true, keys: new Set(), expectKey: true });
      i++;
      continue;
    }
    if (ch === "[") {
      stack.push({ object: false, keys: new Set(), expectKey: false });
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      i++;
      continue;
    }
    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top && top.object) top.expectKey = true;
      i++;
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let j = i;
      if (text[j] === "-") j++;
      while (j < text.length && /[0-9eE+\-.]/.test(text[j])) j++;
      const literal = text.slice(i, j);
      const change = analyseNumberLiteral(literal);
      if (change?.kind === "value") changedNumbers.push({ literal, becomes: change.becomes, line });
      else if (change) rewrittenNumbers.push({ literal, becomes: change.becomes, line });
      i = j;
      continue;
    }

    i++;
  }

  return { changedNumbers, rewrittenNumbers, duplicateKeys };
}

export interface JsonToYamlResult extends JsonScan {
  yaml: string;
}

/**
 * Read JSON and write YAML. Throws whatever `JSON.parse` throws — the caller
 * runs it through `describeJsonFailure`.
 */
export function jsonToYaml(
  text: string,
  options: YamlDumpOptions = {},
): JsonToYamlResult {
  const value = JSON.parse(text) as unknown;
  const scan = scanJsonLiterals(text);
  return { ...scan, yaml: dumpValue(value, options) };
}

/* ── YAML → YAML ──────────────────────────────────────────────────────────── */

export interface YamlFormatResult {
  yaml: string;
  documents: number;
  nonStringKeys: NonStringKey[];
  /**
   * DISTINCT mappings and sequences reached more than once, cycles included.
   * `dump` re-emits these as `&ref_0` / `*ref_0`, so the structure survives —
   * the anchor's NAME does not.
   */
  anchoredNodes: number;
  /**
   * Aliases whose target is a scalar or a timestamp. `dump` anchors only
   * mappings and sequences, so for these the sharing does NOT survive: the
   * value is written out again and `&name` / `*name` disappear from the file.
   */
  expandedAliases: number;
  /** A cycle is fine here: `dump` writes it as an anchor. `JSON` cannot. */
  cycle: string | null;
  dates: number;
}

function dumpValue(value: unknown, options: YamlDumpOptions): string {
  return dump(value, {
    indent: options.indent ?? 2,
    sortKeys: options.sortKeys ?? false,
    lineWidth: options.lineWidth ?? 80,
  });
}

/**
 * Re-emit a YAML stream through js-yaml's own writer.
 *
 * This is a parse and a re-write, not a text tidy: what comes out is what
 * js-yaml would print for the value it read. Comments, blank lines, quoting
 * style, anchor names and key order (with SORT KEYS on) are all decided by the
 * writer, not carried over. Everything the caller needs to say so is returned
 * alongside.
 */
export function formatYaml(
  text: string,
  options: YamlDumpOptions = {},
): YamlFormatResult {
  const docs = loadAll(text) as unknown[];
  const source = scanYamlSource(text);
  const scan = scanDocuments(docs);

  // js-yaml has no `dumpAll`; a multi-document stream is documents joined by
  // the `---` marker, which is exactly what it parses back.
  const yamlOut = docs.map((doc) => dumpValue(doc, options)).join("---\n");

  return {
    yaml: yamlOut,
    documents: docs.length,
    nonStringKeys: source.nonStringKeys,
    anchoredNodes: scan.reAnchored,
    expandedAliases: source.expandedAliases,
    cycle: scan.cycle,
    dates: scan.dates,
  };
}

/* ── Small shared bits the pages need ─────────────────────────────────────── */

export const YAML_ACCEPT = ".yaml,.yml";
export const JSON_ACCEPT = ".json";

/** `config.yaml` → `config.json`. Keeps a name that has no extension at all. */
export function swapExtension(name: string, extension: "json" | "yaml" | "yml"): string {
  const trimmed = name.trim() || "output";
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem}.${extension}`;
}

/** Human label for a key kind, for the warning sentence. */
export const KEY_KIND_LABEL: Record<KeyKind, string> = {
  number: "a number",
  boolean: "a boolean",
  null: "null",
  date: "a date",
  sequence: "a sequence",
  mapping: "a mapping",
};
