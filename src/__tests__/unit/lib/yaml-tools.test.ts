import { describe, expect, it } from "vitest";
import {
  analyseNumberLiteral,
  describeJsonFailure,
  describeYamlFailure,
  findNonStringKeys,
  formatYaml,
  jsonToYaml,
  scanJsonLiterals,
  scanTree,
  scanYamlSource,
  swapExtension,
  yamlToJson,
} from "@/lib/tools/yaml-tools";

/* ── YAML → JSON ──────────────────────────────────────────────────────────── */

describe("yamlToJson", () => {
  it("converts a single document and unwraps it", () => {
    const out = yamlToJson("a: 1\nb: two\n");
    expect(out.documents).toBe(1);
    expect(JSON.parse(out.json)).toEqual({ a: 1, b: "two" });
    expect(out.json).toContain("\n  ");
  });

  it("honours the indent", () => {
    expect(yamlToJson("a:\n  b: 1\n", 4).json).toBe('{\n    "a": {\n        "b": 1\n    }\n}');
    expect(yamlToJson("a:\n  b: 1\n", 2).json).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
  });

  it("reads a multi-document stream that yaml.load alone would throw on", () => {
    const out = yamlToJson("---\na: 1\n---\nb: 2\n");
    expect(out.documents).toBe(2);
    expect(JSON.parse(out.json)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("treats a leading --- as one document, not two", () => {
    expect(yamlToJson("---\na: 1\n").documents).toBe(1);
  });

  it("returns nothing for empty input", () => {
    const out = yamlToJson("   \n");
    expect(out.documents).toBe(0);
    expect(out.json).toBe("");
  });

  it("counts dates and writes them as ISO strings with a time", () => {
    const out = yamlToJson("released: 2026-01-01\n");
    expect(out.dates).toBe(1);
    expect(JSON.parse(out.json)).toEqual({ released: "2026-01-01T00:00:00.000Z" });
  });

  it("counts an alias expansion, which makes the JSON bigger than the YAML", () => {
    const source = "a: &base\n  k: 1\nb: *base\n";
    const out = yamlToJson(source);
    expect(out.aliasExpansions).toBe(1);
    expect(JSON.parse(out.json)).toEqual({ a: { k: 1 }, b: { k: 1 } });
    expect(out.json.length).toBeGreaterThan(source.length);
  });

  it("names a cyclic anchor instead of letting JSON.stringify throw", () => {
    const out = yamlToJson("a: &x\n  self: *x\n");
    expect(out.cycle).toBe("a.self");
    expect(out.json).toBe("");
  });

  it("names the document a cycle is in when there is more than one", () => {
    const out = yamlToJson("a: 1\n---\nb: &x\n  self: *x\n");
    expect(out.cycle).toBe("document 2 · b.self");
  });

  it("adds up dates across documents", () => {
    expect(yamlToJson("a: 2026-01-01\n---\nb: 2026-02-02\n").dates).toBe(2);
  });

  it("reports non-string keys with what they become", () => {
    const out = yamlToJson("1: a\ntrue: b\nplain: c\n");
    expect(out.nonStringKeys.map((k) => [k.source, k.kind, k.becomes])).toEqual([
      ["1", "number", "1"],
      ["true", "boolean", "true"],
    ]);
    expect(Object.keys(JSON.parse(out.json))).toEqual(["1", "true", "plain"]);
  });

  it("throws the parser's own error on broken YAML", () => {
    expect(() => yamlToJson("a: [1, 2\nb: 3\n")).toThrow();
  });
});

/* ── Non-string keys ──────────────────────────────────────────────────────── */

describe("findNonStringKeys", () => {
  it("finds nothing in an ordinary mapping", () => {
    expect(findNonStringKeys("name: test\nnested:\n  inner: 1\n")).toEqual([]);
  });

  it("does not mistake a non-string VALUE for a key", () => {
    expect(findNonStringKeys("count: 7\nflag: true\n")).toEqual([]);
  });

  it("catches a date key and reports the locale string it becomes", () => {
    const [key] = findNonStringKeys("2026-01-01: shipped\n");
    expect(key.kind).toBe("date");
    expect(key.source).toBe("2026-01-01");
    expect(key.becomes).toBe(String(new Date("2026-01-01")));
    expect(key.becomes).not.toBe("2026-01-01");
  });

  it("catches an explicit complex key written over two lines", () => {
    const found = findNonStringKeys("? [a, b]\n: c\n");
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("sequence");
    expect(found[0].becomes).toBe("a,b");
  });

  it("catches a key inside a flow mapping", () => {
    const found = findNonStringKeys("flow: {7: q, w: 8}\n");
    expect(found.map((k) => k.source)).toEqual(["7"]);
  });

  it("catches a null key", () => {
    expect(findNonStringKeys("null: z\n")[0].kind).toBe("null");
  });

  it("reports the line each key sits on", () => {
    const found = findNonStringKeys("ok: 1\nalso: 2\n3: three\n");
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3);
  });

  it("returns [] rather than throwing when the document does not parse", () => {
    expect(findNonStringKeys("a: [1, 2\nb: 3\n")).toEqual([]);
  });
});

/* ── scanTree ─────────────────────────────────────────────────────────────── */

describe("scanTree", () => {
  it("counts each extra reference to a shared node once", () => {
    const shared = { k: 1 };
    expect(scanTree({ a: shared, b: shared, c: shared }).aliasExpansions).toBe(2);
  });

  /*
    Two different questions, two different numbers. JSON writes the block out
    twice more (2 expansions); yaml.dump gives it ONE `&ref_0` (1 node). The
    formatter's sentence says "N nodes are referenced more than once", so it
    needs the node count, not the reference count.
  */
  it("separates re-anchored NODES from expanded REFERENCES", () => {
    const shared = { k: 1 };
    const scan = scanTree({ a: shared, b: shared, c: shared });
    expect(scan.aliasExpansions).toBe(2);
    expect(scan.reAnchored).toBe(1);
  });

  it("finds a cycle by path and does not loop forever", () => {
    const root: Record<string, unknown> = { a: {} };
    (root.a as Record<string, unknown>).self = root.a;
    expect(scanTree(root).cycle).toBe("a.self");
  });

  /*
    The cycle branch used to return before counting anything, so a file whose
    output visibly carries `&ref_0` reported zero re-anchored nodes. It is not
    an EXPANSION though — the JSON direction refuses the file outright rather
    than writing anything out twice.
  */
  it("counts a cyclic node as re-anchored, but never as expanded", () => {
    const root: Record<string, unknown> = { a: {} };
    (root.a as Record<string, unknown>).self = root.a;
    const scan = scanTree(root);
    expect(scan.reAnchored).toBe(1);
    expect(scan.aliasExpansions).toBe(0);
  });

  /*
    yaml.dump gates the `&ref_N` anchor on `[object Object]` / `[object Array]`,
    so a shared Date is written out twice with no anchor at all. Counting it as
    re-anchored would promise an anchor that never appears.
  */
  it("does not promise an anchor for a shared Date, because dump writes it twice", () => {
    const when = new Date(0);
    const scan = scanTree({ a: when, b: when });
    expect(scan.reAnchored).toBe(0);
    expect(scan.dates).toBe(2);
  });

  it("counts dates at any depth", () => {
    expect(scanTree({ a: [new Date(0), { b: new Date(1) }], c: 1 }).dates).toBe(2);
  });
});

/* ── Anchors the parsed VALUE cannot show ─────────────────────────────────── */

/*
 * An anchor on a scalar leaves no trace in the parsed value — two references
 * to `&tag "1.24"` are just two equal strings afterwards — so identity walking
 * finds nothing, and js-yaml writes no anchor back either. The anchor is gone
 * from the file and the count read zero, which is the exact silent loss these
 * pages exist to name. Found off the parse instead.
 */
describe("scanYamlSource — anchors on scalars", () => {
  const COMPOSE = [
    'x-tag: &tag "1.24.0-alpine"',
    "services:",
    "  cache:",
    "    labels:",
    "      version: *tag",
    "",
  ].join("\n");

  it("counts an alias to a scalar that the value walk cannot see", () => {
    expect(scanYamlSource(COMPOSE).expandedAliases).toBe(1);
    // Proof the anchor really is gone from the output, not just renamed.
    const out = formatYaml(COMPOSE);
    expect(out.yaml).not.toContain("&");
    expect(out.yaml).not.toContain("*");
    expect(out.expandedAliases).toBe(1);
    expect(out.anchoredNodes).toBe(0);
  });

  it("counts it as an expansion in the JSON direction too", () => {
    expect(yamlToJson(COMPOSE).aliasExpansions).toBe(1);
  });

  it("counts one per reference, across documents", () => {
    expect(scanYamlSource('t: &t "v"\na: *t\nb: *t\n').expandedAliases).toBe(2);
    expect(scanYamlSource('t: &t "v"\na: *t\n---\nu: &u 1\nb: *u\n').expandedAliases).toBe(2);
  });

  it("counts an alias to a timestamp, which dump also refuses to anchor", () => {
    const out = formatYaml("d: &d 2026-01-01\ne: *d\n");
    expect(out.expandedAliases).toBe(1);
    expect(out.anchoredNodes).toBe(0);
    expect(out.yaml).not.toContain("&ref_0");
  });

  it("does not double-count an alias to a mapping, which scanTree already has", () => {
    expect(scanYamlSource("a: &base\n  k: 1\nb: *base\n").expandedAliases).toBe(0);
    expect(scanYamlSource("a: &s [1, 2]\nb: *s\n").expandedAliases).toBe(0);
  });

  it("does not mistake a star inside a scalar for an alias", () => {
    expect(scanYamlSource('a: "a*b"\nb: \'*c\'\nc: x*y\n').expandedAliases).toBe(0);
    expect(scanYamlSource("a: |\n  *t\n  literal\n").expandedAliases).toBe(0);
  });

  it("finds an alias behind a comment, in a flow collection, and as a key", () => {
    expect(scanYamlSource('t: &t "v"\na:\n  # note\n  *t\n').expandedAliases).toBe(1);
    expect(scanYamlSource('t: &t "v"\nm: {x: *t, y: 2}\n').expandedAliases).toBe(1);
    expect(scanYamlSource('t: &t "v"\n? *t\n: v\n').expandedAliases).toBe(1);
  });

  it("counts nothing when the document does not parse", () => {
    expect(scanYamlSource("a: [1, 2\nb: 3\n")).toEqual({
      nonStringKeys: [],
      expandedAliases: 0,
    });
  });
});

/* ── JSON → YAML ──────────────────────────────────────────────────────────── */

describe("jsonToYaml", () => {
  it("writes YAML for ordinary JSON", () => {
    expect(jsonToYaml('{"a": 1, "b": "two"}').yaml).toBe("a: 1\nb: two\n");
  });

  it("honours indent, sortKeys and lineWidth", () => {
    expect(jsonToYaml('{"a": {"b": 1}}', { indent: 4 }).yaml).toBe("a:\n    b: 1\n");
    expect(jsonToYaml('{"b": 1, "a": 2}', { sortKeys: true }).yaml).toBe("a: 2\nb: 1\n");
    const long = JSON.stringify({ s: "x".repeat(120) });
    expect(jsonToYaml(long, { lineWidth: -1 }).yaml).toBe(`s: ${"x".repeat(120)}\n`);
    expect(jsonToYaml(long, { lineWidth: 80 }).yaml).toContain("\n");
  });

  it("reports an id a double cannot hold, naming the digits the FILE ends up with", () => {
    const out = jsonToYaml('{"id": 12345678901234567890}');
    expect(out.changedNumbers).toEqual([
      { literal: "12345678901234567890", becomes: "12345678901234567000", line: 1 },
    ]);
    // And the damage is real, not theoretical.
    expect(out.yaml).toBe("id: 12345678901234567000\n");
  });

  /*
    The number reported as what a literal "becomes" has to be findable in the
    output. It used to be `BigInt(n).toString()` — the double's exact
    mathematical value, 12345678901234567168 — which appears nowhere: not in
    the source the user wrote, not in the file they download. Both directions
    of that mismatch are locked down here.
  */
  it("reports a `becomes` that appears verbatim in the YAML it wrote", () => {
    for (const source of [
      '{"id": 12345678901234567890}',
      '{"z": -0}',
      '{"a": 1.0, "b": 1e2, "c": 1.50}',
      '{"id": 9007199254740993.0, "lat": 0.1234567890123456789}',
      '{"tiny": 1e-7, "huge": 1e21}',
    ]) {
      const out = jsonToYaml(source);
      /*
        Every value the YAML actually carries, read straight back off the
        output. Matching on the whole scalar rather than `toContain` matters:
        the old reported substitution for `-0` was "0", which is a substring of
        the `-0.0` js-yaml really writes and would slip through.
      */
      const emitted = out.yaml
        .trimEnd()
        .split("\n")
        .map((row) => row.slice(row.indexOf(": ") + 2));
      for (const change of [...out.changedNumbers, ...out.rewrittenNumbers]) {
        expect(emitted, `${source} → ${change.literal}`).toContain(change.becomes);
      }
    }
  });

  it("reports 1.0 and 1e2 as spelling changes, not value changes", () => {
    const out = jsonToYaml('{"a": 1.0, "b": 1e2, "c": 1.50}');
    expect(out.changedNumbers).toEqual([]);
    expect(out.rewrittenNumbers.map((n) => [n.literal, n.becomes])).toEqual([
      ["1.0", "1"],
      ["1e2", "100"],
      ["1.50", "1.5"],
    ]);
    expect(out.yaml).toBe("a: 1\nb: 100\nc: 1.5\n");
  });

  /*
    The P1. A literal that carries more precision than a double used to fall
    through the integer-only exactness test (`/^-?\d+$/`) and be filed as a
    harmless respelling, under a sentence promising "the value is the same one
    a program would read". Both of these lose digits; both must be graded as
    value changes so the "quote them in the source" warning fires.
  */
  it("calls a decimal-shaped literal that loses digits a VALUE change", () => {
    const out = jsonToYaml('{"id": 9007199254740993.0, "lat": 0.1234567890123456789}');
    expect(out.rewrittenNumbers).toEqual([]);
    expect(out.changedNumbers.map((n) => [n.literal, n.becomes])).toEqual([
      ["9007199254740993.0", "9007199254740992"],
      ["0.1234567890123456789", "0.12345678901234568"],
    ]);
    expect(out.yaml).toBe("id: 9007199254740992\nlat: 0.12345678901234568\n");
  });

  it("says nothing about a number that survives untouched", () => {
    const out = jsonToYaml('{"a": 1, "b": -2.5, "c": 9007199254740991, "d": 0.1}');
    expect(out.changedNumbers).toEqual([]);
    expect(out.rewrittenNumbers).toEqual([]);
  });

  it("reports a duplicate key that JSON.parse silently collapses", () => {
    const out = jsonToYaml('{\n  "a": 1,\n  "a": 2\n}');
    expect(out.duplicateKeys).toEqual([{ key: "a", line: 3 }]);
    expect(out.yaml).toBe("a: 2\n");
  });

  it("throws the parser's own error on broken JSON", () => {
    expect(() => jsonToYaml('{"a": 1,}')).toThrow();
  });
});

describe("scanJsonLiterals", () => {
  it("ignores digits and braces inside string literals", () => {
    const out = scanJsonLiterals('{"note": "1.0 and {\\"a\\": 1, \\"a\\": 2}"}');
    expect(out.rewrittenNumbers).toEqual([]);
    expect(out.duplicateKeys).toEqual([]);
  });

  it("does not call a repeated key in DIFFERENT objects a duplicate", () => {
    expect(scanJsonLiterals('[{"a": 1}, {"a": 2}]').duplicateKeys).toEqual([]);
  });

  it("does not mistake a repeated string VALUE for a key", () => {
    expect(scanJsonLiterals('{"a": "x", "b": "x"}').duplicateKeys).toEqual([]);
  });

  it("counts lines across a multi-line document", () => {
    const out = scanJsonLiterals('{\n  "a": 1,\n  "b": {\n    "c": 1.0\n  }\n}');
    expect(out.rewrittenNumbers).toEqual([{ literal: "1.0", becomes: "1", line: 4 }]);
  });

  it("does not crash on malformed input", () => {
    expect(() => scanJsonLiterals('{"a": ')).not.toThrow();
    expect(() => scanJsonLiterals('{"a": "unterminated')).not.toThrow();
  });
});

describe("analyseNumberLiteral", () => {
  it("passes an exact literal through", () => {
    expect(analyseNumberLiteral("42")).toBeNull();
    expect(analyseNumberLiteral("-2.5")).toBeNull();
  });

  /*
    0.1 is NOT exactly representable as a double, and the file still says 0.1.
    The question this function answers is "does the output still say the number
    I wrote", not "is this literal a dyadic rational" — flagging every decimal
    fraction would bury the two cases that actually lose digits.
  */
  it("says nothing about a decimal fraction the file still spells the same way", () => {
    expect(analyseNumberLiteral("0.1")).toBeNull();
    expect(analyseNumberLiteral("3.14159265358979")).toBeNull();
  });

  it("calls an unsafe integer a value change", () => {
    expect(analyseNumberLiteral("9007199254740993")).toEqual({
      kind: "value",
      becomes: "9007199254740992",
    });
  });

  /*
    The P1 at the unit level. A decimal point does not make a literal safe:
    every one of these loses digits, and every one used to be graded "notation"
    because the exactness test only ran on `/^-?\d+$/`.
  */
  it("calls a literal that loses digits a value change, decimal point or not", () => {
    expect(analyseNumberLiteral("9007199254740993.0")).toEqual({
      kind: "value",
      becomes: "9007199254740992",
    });
    expect(analyseNumberLiteral("12345678901234567890.0")).toEqual({
      kind: "value",
      becomes: "12345678901234567000",
    });
    expect(analyseNumberLiteral("0.1234567890123456789")).toEqual({
      kind: "value",
      becomes: "0.12345678901234568",
    });
    expect(analyseNumberLiteral("1.00000000000000000001")).toEqual({
      kind: "value",
      becomes: "1",
    });
  });

  it("calls an overflow an infinity and an underflow a zero", () => {
    expect(analyseNumberLiteral("1e999")).toEqual({ kind: "value", becomes: ".inf" });
    expect(analyseNumberLiteral("-1e999")).toEqual({ kind: "value", becomes: "-.inf" });
    expect(analyseNumberLiteral("1e-999")).toEqual({ kind: "value", becomes: "0" });
  });

  it("calls a re-spelling a notation change", () => {
    expect(analyseNumberLiteral("1.0")).toEqual({ kind: "notation", becomes: "1" });
    expect(analyseNumberLiteral("1e2")).toEqual({ kind: "notation", becomes: "100" });
    expect(analyseNumberLiteral("1.50")).toEqual({ kind: "notation", becomes: "1.5" });
  });

  /*
    `becomes` is what js-yaml WRITES, not what String() prints. js-yaml spells
    negative zero `-0.0` and 1e-7 `1.e-7`; String() says `0` and `1e-7`. The
    old code printed String()'s answer, so a reader checking `-0 → 0` against
    their own file found neither string in it.
  */
  it("takes `becomes` from the YAML writer, not from String()", () => {
    expect(analyseNumberLiteral("-0")).toEqual({ kind: "notation", becomes: "-0.0" });
    expect(analyseNumberLiteral("1e-7")).toEqual({ kind: "notation", becomes: "1.e-7" });
    expect(analyseNumberLiteral("1e21")).toEqual({ kind: "notation", becomes: "1e+21" });
  });
});

/* ── YAML → YAML ──────────────────────────────────────────────────────────── */

describe("formatYaml", () => {
  it("re-indents a document", () => {
    expect(formatYaml("a:\n      b: 1\n", { indent: 2 }).yaml).toBe("a:\n  b: 1\n");
    expect(formatYaml("a:\n  b: 1\n", { indent: 4 }).yaml).toBe("a:\n    b: 1\n");
  });

  it("sorts keys only when asked", () => {
    expect(formatYaml("b: 1\na: 2\n").yaml).toBe("b: 1\na: 2\n");
    expect(formatYaml("b: 1\na: 2\n", { sortKeys: true }).yaml).toBe("a: 2\nb: 1\n");
  });

  it("keeps every document and rejoins them with ---", () => {
    const out = formatYaml("a: 1\n---\nb: 2\n");
    expect(out.documents).toBe(2);
    expect(out.yaml).toBe("a: 1\n---\nb: 2\n");
  });

  it("wraps at the requested line width and not at all for -1", () => {
    const long = `s: ${"word ".repeat(40).trim()}\n`;
    expect(formatYaml(long, { lineWidth: -1 }).yaml.trimEnd().split("\n")).toHaveLength(1);
    expect(formatYaml(long, { lineWidth: 80 }).yaml.split("\n").length).toBeGreaterThan(2);
  });

  it("reports the non-string keys it is about to quote", () => {
    const out = formatYaml("1: a\n");
    expect(out.nonStringKeys.map((k) => k.kind)).toEqual(["number"]);
    expect(out.yaml).toBe("'1': a\n");
  });

  it("counts nodes it will re-anchor, because the anchor NAME is not kept", () => {
    const out = formatYaml("a: &base\n  k: 1\nb: *base\n");
    expect(out.anchoredNodes).toBe(1);
    expect(out.yaml).toContain("&ref_0");
    expect(out.yaml).not.toContain("&base");
  });

  it("round-trips a cycle that JSON cannot express, and says so", () => {
    const out = formatYaml("a: &x\n  self: *x\n");
    expect(out.cycle).toBe("a.self");
    expect(out.yaml).toContain("*ref_0");
  });

  /*
    A cycle renames the author's `&x` to `&ref_0` just like any other shared
    node, so the Re-anchored row and the anchor-name warning both have to fire.
    They used to read zero on output that visibly carries `&ref_0`.
  */
  it("counts a re-anchored cycle, so the rename is not reported as zero", () => {
    const out = formatYaml("a: &x\n  self: *x\n");
    expect(out.yaml).toContain("&ref_0");
    expect(out.yaml).not.toContain("&x");
    expect(out.anchoredNodes).toBe(1);
  });

  /*
    Whatever the formatter reports as re-anchored must be findable in the
    output, and whatever it reports as expanded must NOT be.
  */
  it("keeps the re-anchor count and the output's own anchors in step", () => {
    for (const source of [
      "a: &base\n  k: 1\nb: *base\n",
      "a: &x\n  self: *x\n",
      'x-tag: &tag "1.24"\nv: *tag\n',
      "a: &s [1, 2]\nb: *s\n",
      "d: &d 2026-01-01\ne: *d\n",
      "plain: 1\n",
    ]) {
      const out = formatYaml(source);
      const emitted = (out.yaml.match(/&ref_\d+/g) ?? []).length;
      expect(emitted, source).toBe(out.anchoredNodes);
      if (out.expandedAliases > 0) expect(out.yaml, source).not.toContain("&ref_");
    }
  });

  it("throws the parser's own error on broken YAML", () => {
    expect(() => formatYaml("a: [1, 2\nb: 3\n")).toThrow();
  });
});

/* ── Error reporting ──────────────────────────────────────────────────────── */

describe("describeYamlFailure", () => {
  it("gives 1-based line and column plus the parser's snippet", () => {
    let failure;
    try {
      formatYaml("a: [1, 2\nb: 3\n");
    } catch (err) {
      failure = describeYamlFailure(err);
    }
    expect(failure?.at).toEqual({ line: 2, column: 1 });
    expect(failure?.message).toBe("missed comma between flow collection entries");
    expect(failure?.snippet).toContain("b: 3");
  });

  it("reports a duplicate YAML key rather than collapsing it", () => {
    let failure;
    try {
      formatYaml("a: 1\na: 2\n");
    } catch (err) {
      failure = describeYamlFailure(err);
    }
    expect(failure?.message).toBe("duplicated mapping key");
  });

  it("survives a non-YAMLException", () => {
    expect(describeYamlFailure(new Error("boom"))).toEqual({
      message: "boom",
      at: null,
      snippet: null,
    });
  });
});

describe("describeJsonFailure", () => {
  it("takes line and column straight from the engine when offered", () => {
    const source = '{\n "a": 1\n "b": 2\n}';
    let failure;
    try {
      JSON.parse(source);
    } catch (err) {
      failure = describeJsonFailure(err, source);
    }
    expect(failure?.at).toEqual({ line: 3, column: 2 });
  });

  it("derives line and column from a bare position", () => {
    const source = '{\n"a" 1\n}';
    const failure = describeJsonFailure(
      new Error("Unexpected number in JSON at position 6"),
      source,
    );
    expect(failure.at).toEqual({ line: 2, column: 5 });
  });

  it("returns no location when the engine gives none", () => {
    const failure = describeJsonFailure(new Error("JSON Parse error: Expected '}'"), "{");
    expect(failure.at).toBeNull();
    expect(failure.message).toBe("JSON Parse error: Expected '}'");
  });
});

describe("swapExtension", () => {
  it("replaces the extension", () => {
    expect(swapExtension("config.yaml", "json")).toBe("config.json");
    expect(swapExtension("data.json", "yaml")).toBe("data.yaml");
  });

  it("appends when there is no extension", () => {
    expect(swapExtension("Makefile", "yaml")).toBe("Makefile.yaml");
  });

  it("leaves a dotfile's name alone", () => {
    expect(swapExtension(".eslintrc", "json")).toBe(".eslintrc.json");
  });

  it("falls back for an empty name", () => {
    expect(swapExtension("  ", "json")).toBe("output.json");
  });
});
