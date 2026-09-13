/**
 * CSV ↔ Markdown tables, both directions, as pure string work.
 *
 * LEAF MODULE — zero imports. The CSV half deliberately does NOT reuse
 * `rfc-content-lines.ts`'s `csvCell`: that one defuses spreadsheet formulas by
 * prefixing a quote, which is right when a spreadsheet will open the file and
 * wrong when the destination is a Markdown document where `'=1+1` would simply
 * be a typo.
 */

/** Parse CSV to rows, honouring RFC 4180 quoting. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  // Normalise line endings first so a CRLF file does not leave \r in a cell.
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  // A file not ending in a newline still has a last row.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type Alignment = "left" | "center" | "right";

/**
 * ⚠ A PIPE INSIDE A CELL ENDS THE CELL unless it is escaped. This is the one
 * way a Markdown table silently comes out with the wrong number of columns,
 * and it happens to any CSV carrying a URL with a query string or a piece of
 * prose using a vertical bar. A newline is worse: Markdown tables cannot hold
 * one at all, so it becomes `<br>`, which is what every renderer expects.
 */
function markdownCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

export function rowsToMarkdown(
  rows: readonly (readonly string[])[],
  options: { align?: Alignment; pad?: boolean } = {},
): string {
  if (rows.length === 0) return "";
  const { align = "left", pad = true } = options;

  // Every row padded to the widest, so a ragged CSV still yields a valid table.
  const columns = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => {
    const cells = r.map(markdownCell);
    while (cells.length < columns) cells.push("");
    return cells;
  });

  /*
    Column widths are for HUMANS reading the source — every renderer ignores
    them. Off by default would make the output unreadable in a diff; on by
    default costs bytes nobody sees. On, with a switch.
  */
  const widths = Array.from({ length: columns }, (_, c) =>
    pad ? Math.max(3, ...grid.map((r) => r[c].length)) : 0,
  );
  const fit = (text: string, c: number) => (pad ? text.padEnd(widths[c]) : text);

  const divider = (c: number) => {
    const bar = "-".repeat(Math.max(3, widths[c] || 3));
    if (align === "center") return `:${bar.slice(2)}:`;
    if (align === "right") return `${bar.slice(1)}:`;
    return bar;
  };

  const line = (cells: string[]) => `| ${cells.map(fit).join(" | ")} |`;
  const [header, ...body] = grid;
  return [
    line(header),
    `| ${widths.map((_, c) => divider(c)).join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}

/** Read a Markdown table back into rows. */
export function markdownToRows(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));

  const rows: string[][] = [];
  for (const line of lines) {
    // The alignment row is structure, not data.
    if (/^\|[\s:|-]+\|$/.test(line) && /-/.test(line)) continue;
    const inner = line.replace(/^\|/, "").replace(/\|$/, "");
    const cells: string[] = [];
    let cell = "";
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i] === "\\" && (inner[i + 1] === "|" || inner[i + 1] === "\\")) {
        cell += inner[i + 1];
        i += 1;
      } else if (inner[i] === "|") {
        cells.push(cell.trim());
        cell = "";
      } else cell += inner[i];
    }
    cells.push(cell.trim());
    rows.push(cells.map((c) => c.replace(/<br\s*\/?>/gi, "\n")));
  }
  return rows;
}

/** RFC 4180 for the CSV direction — no formula defusal; see the header. */
export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\r\n");
}
