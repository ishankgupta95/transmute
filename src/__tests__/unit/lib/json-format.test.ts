import { describe, it, expect } from "vitest";
import { formatJson, minifyJson } from "@/lib/tools/json-format";

describe("formatJson", () => {
  it("indents two spaces per level, matching JSON.stringify's shape", () => {
    expect(formatJson('{"a":1,"b":[2,3]}')).toBe(
      JSON.stringify({ a: 1, b: [2, 3] }, null, 2),
    );
  });

  it("keeps a 64-bit integer id byte-for-byte", () => {
    // The whole point: JSON.parse/stringify returns 12345678901234567000.
    const out = formatJson('{"id": 12345678901234567890}');
    expect(out).toContain("12345678901234567890");
    expect(out).not.toContain("12345678901234567000");
  });

  it("does not rewrite number literals", () => {
    const out = formatJson('{"v": 1.0, "e": 1e2, "neg": -0.50}');
    expect(out).toContain('"v": 1.0');
    expect(out).toContain('"e": 1e2');
    expect(out).toContain('"neg": -0.50');
  });

  it("keeps duplicate keys instead of collapsing them", () => {
    const out = formatJson('{"a":1,"a":2}');
    expect(out.match(/"a"/g)).toHaveLength(2);
  });

  it("never touches structural characters inside string literals", () => {
    const out = formatJson('{"s":"a,b:{ } [ ]  x","t":1}');
    expect(out).toContain('"s": "a,b:{ } [ ]  x"');
  });

  it("leaves escaped quotes and backslashes inside strings alone", () => {
    const src = '{"s":"he said \\"hi\\" \\\\ done","n":2}';
    expect(formatJson(src)).toContain('"s": "he said \\"hi\\" \\\\ done"');
    expect(() => JSON.parse(formatJson(src))).not.toThrow();
  });

  it("keeps empty containers on one line", () => {
    expect(formatJson('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}');
  });

  it("round-trips to the same parsed value for ordinary documents", () => {
    const src = '{"name":"John","tags":["a","b"],"ok":true,"n":null}';
    expect(JSON.parse(formatJson(src))).toEqual(JSON.parse(src));
  });
});

describe("minifyJson", () => {
  it("strips every byte of insignificant whitespace", () => {
    expect(minifyJson('{\n  "a":  1,\n  "b": 2\n}')).toBe('{"a":1,"b":2}');
  });

  it("keeps whitespace inside string literals", () => {
    expect(minifyJson('{ "s" : "two  spaces" }')).toBe('{"s":"two  spaces"}');
  });

  it("keeps a 64-bit integer id byte-for-byte", () => {
    expect(minifyJson('{"id": 12345678901234567890}')).toBe(
      '{"id":12345678901234567890}',
    );
  });
});
