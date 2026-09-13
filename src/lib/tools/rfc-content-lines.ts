/**
 * The shape vCard and iCalendar share, in one place.
 *
 * `.vcf` (vCard, RFC 6350) and `.ics` (iCalendar, RFC 5545) look like different
 * formats and are the same one underneath: a stream of CONTENT LINES, each
 * `NAME;PARAM=value;PARAM=value:VALUE`, grouped by `BEGIN:X` / `END:X`, with
 * one folding rule and one escaping rule between them. Writing that twice would
 * mean two chances to get the folding wrong, and folding is the part that
 * silently corrupts data rather than failing.
 *
 * LEAF MODULE — zero imports, runtime or type. Same contract as
 * `pdf-stamp-core.ts`: it owns the parsing, the tools own their columns, so
 * the two cannot drift.
 */

/** One parsed content line. `params` keys are upper-cased; values are not. */
export interface ContentLine {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
  readonly value: string;
}

/** A `BEGIN:X … END:X` block, with any nested blocks kept separate. */
export interface Block {
  readonly kind: string;
  readonly lines: readonly ContentLine[];
  readonly blocks: readonly Block[];
}

/**
 * UNFOLDING, and why it comes first.
 *
 * Both specs cap a line at 75 octets and continue it by starting the next with
 * a single space or tab, which is NOT part of the value. Apple and Google both
 * emit folded lines routinely — a long NOTE or a base64 photo is always
 * folded — so a parser that splits on newlines and stops there does not fail,
 * it silently truncates every long field and inserts junk rows. That is the
 * worst failure this file can have, which is why it is the first thing done
 * and the first thing tested.
 *
 * ⚠ The continuation character is CONSUMED, not preserved. A folded line
 * "NOTE:hello\r\n  world" is `hello world` with ONE space — the space that
 * begins the continuation is the marker, and any further spaces are content.
 */
export function unfoldLines(text: string): string[] {
  // Normalise line endings first: CRLF is what the specs say, LF is what many
  // exporters actually write, and CR alone still turns up from old Mac tools.
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.trim().length > 0);
}

/**
 * Split a content line into name, params and value.
 *
 * ⚠ THE COLON IS NOT SIMPLY THE FIRST COLON. A parameter value may be quoted
 * and may contain one — `ATTENDEE;CN="Smith, J:r":mailto:a@b` is legal — so
 * the split has to respect quoting. Splitting on `indexOf(":")` works on
 * almost every file and mangles exactly the ones that matter.
 */
export function parseContentLine(line: string): ContentLine | null {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  // Same quoting rule again for the parameter separator.
  const parts: string[] = [];
  let current = "";
  inQuotes = false;
  for (const ch of head) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ";" && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);

  // A grouped property is `item1.EMAIL` — Apple emits these constantly. The
  // group is not the name and dropping it is what makes columns line up.
  const name = (parts.shift() ?? "").replace(/^[^.]*\./, "").trim().toUpperCase();
  if (!name) return null;

  const params: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    // A bare parameter with no `=` is legacy vCard 2.1 (`TEL;HOME:…`). It is
    // still meaningful, so it is kept as TYPE rather than thrown away.
    if (eq < 0) {
      if (part.trim()) params.TYPE = unquote(part.trim());
      continue;
    }
    params[part.slice(0, eq).trim().toUpperCase()] = unquote(part.slice(eq + 1).trim());
  }
  return { name, params, value };
}

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s;
}

/**
 * Undo the value escaping both specs use: `\n` `\N` (newline), `\,` `\;` and
 * `\\`. Order matters — unescaping the backslash first would turn `\\n` (a
 * literal backslash followed by n) into a newline.
 */
export function unescapeValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const next = value[i + 1];
    if (next === "n" || next === "N") out += "\n";
    else if (next === "," || next === ";" || next === "\\") out += next;
    else if (next === undefined) out += "\\";
    else out += next;
    i += 1;
  }
  return out;
}

/**
 * Split a structured value on unescaped separators — `N:Last;First;;Dr.;` and
 * `ADR:;;12 High St;Town;;SW1;UK`. An escaped separator is content.
 */
export function splitStructured(value: string, separator: ";" | "," = ";"): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "\\") {
      current += value[i] + (value[i + 1] ?? "");
      i += 1;
    } else if (value[i] === separator) {
      parts.push(current);
      current = "";
    } else {
      current += value[i];
    }
  }
  parts.push(current);
  return parts.map(unescapeValue);
}

/**
 * Parse a whole file into top-level blocks.
 *
 * Nesting is real and must be kept: a VEVENT contains a VALARM, and folding an
 * alarm's own SUMMARY into the event's would put the reminder text in the
 * event's column. Unbalanced END lines are ignored rather than thrown on —
 * exporters truncate files, and half a contact list is worth more than an
 * error message.
 */
export function parseBlocks(text: string): Block[] {
  type Mutable = { kind: string; lines: ContentLine[]; blocks: Block[] };
  const roots: Block[] = [];
  const stack: Mutable[] = [];

  for (const raw of unfoldLines(text)) {
    const line = parseContentLine(raw);
    if (!line) continue;

    if (line.name === "BEGIN") {
      stack.push({ kind: line.value.trim().toUpperCase(), lines: [], blocks: [] });
      continue;
    }
    if (line.name === "END") {
      const done = stack.pop();
      if (!done) continue;
      if (stack.length > 0) stack[stack.length - 1].blocks.push(done);
      else roots.push(done);
      continue;
    }
    if (stack.length > 0) stack[stack.length - 1].lines.push(line);
  }

  // A file that ended mid-block still yields what it had. Truncated exports
  // are common and the alternative is handing back nothing.
  while (stack.length > 0) {
    const done = stack.pop()!;
    if (stack.length > 0) stack[stack.length - 1].blocks.push(done);
    else roots.push(done);
  }
  return roots;
}

/** Every block of one kind, at any depth. */
export function findBlocks(blocks: readonly Block[], kind: string): Block[] {
  const want = kind.toUpperCase();
  const out: Block[] = [];
  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      if (block.kind === want) out.push(block);
      walk(block.blocks);
    }
  };
  walk(blocks);
  return out;
}

/**
 * CSV escaping, RFC 4180.
 *
 * ⚠ The leading-character guard is not paranoia. A cell beginning `=`, `+`,
 * `-` or `@` is executed as a FORMULA when the file is opened in Excel,
 * Numbers or Sheets, and contact and calendar exports are full of attacker- or
 * accident-supplied text. Prefixing a single quote is the standard defusal and
 * costs a character no spreadsheet displays.
 */
export function csvCell(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // CRLF per RFC 4180 — Excel on Windows still cares, and nothing else minds.
  return lines.join("\r\n");
}
