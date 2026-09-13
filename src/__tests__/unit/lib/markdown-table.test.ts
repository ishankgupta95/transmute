import { describe, expect, it } from "vitest";

import {
  markdownToRows,
  parseCsv,
  rowsToCsv,
  rowsToMarkdown,
} from "@/lib/tools/markdown-table";

/*
  CSV ↔ Markdown. Pure string work, so it is tested exhaustively here — the
  cases below are the ones that produce a table with the WRONG NUMBER OF
  COLUMNS, which is the failure that looks like valid output.
*/

describe("parseCsv", () => {
  it("keeps a comma inside a quoted field", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("turns a doubled quote into one literal quote", () => {
    expect(parseCsv('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it("keeps a newline inside a quoted field rather than starting a row", () => {
    expect(parseCsv('"one\ntwo",b')).toEqual([["one\ntwo", "b"]]);
  });

  it("reads a last row that has no trailing newline", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("rowsToMarkdown", () => {
  it("escapes a pipe so the column count survives", () => {
    /*
      THE BUG THIS PREVENTS. An unescaped pipe ends the cell, so one URL with
      a query string turns a 2-column table into a 3-column one — and the
      output is still a valid table, just the wrong one.
    */
    const md = rowsToMarkdown([
      ["url", "note"],
      ["/a?x=1|y=2", "fine"],
    ]);
    const body = md.split("\n")[2];
    expect(body).toContain("\\|");
    // Round-trips back to exactly two cells.
    expect(markdownToRows(md)[1]).toEqual(["/a?x=1|y=2", "fine"]);
  });

  it("turns a newline into <br>, because a table row cannot hold one", () => {
    const md = rowsToMarkdown([["a"], ["one\ntwo"]]);
    expect(md).toContain("one<br>two");
    expect(md.split("\n")).toHaveLength(3);
  });

  it("pads a ragged row so the table stays rectangular", () => {
    const md = rowsToMarkdown([["a", "b", "c"], ["x"]]);
    const cells = markdownToRows(md)[1];
    expect(cells).toHaveLength(3);
  });

  it("writes the alignment row the chosen way", () => {
    expect(rowsToMarkdown([["a"]], { align: "center" }).split("\n")[1]).toMatch(/:-+:/);
    expect(rowsToMarkdown([["a"]], { align: "right" }).split("\n")[1]).toMatch(/-+:/);
  });
});

describe("round trip", () => {
  it("survives CSV → Markdown → CSV with quoting intact", () => {
    const csv = 'name,note\n"Lovelace, Ada","said ""hello"""';
    const back = rowsToCsv(markdownToRows(rowsToMarkdown(parseCsv(csv))));
    expect(parseCsv(back)).toEqual([
      ["name", "note"],
      ["Lovelace, Ada", 'said "hello"'],
    ]);
  });

  it("drops the alignment row rather than reading it as data", () => {
    const rows = markdownToRows("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
