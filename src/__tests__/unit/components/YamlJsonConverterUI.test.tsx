import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { YamlJsonConverterUI } from "@/components/tools/YamlJsonConverterUI";

/*
 * `yaml-tools.test.ts` proves the engine derives the right numbers. This file
 * proves those numbers reach the screen, which is the half that actually makes
 * the copy honest: a loss counted in a result object and never rendered is the
 * same to the reader as a loss nobody counted. It also catches the failure the
 * `ToolClient` switch cannot — a UI that throws on mount renders a blank tool
 * surface and still compiles.
 */

/** Switch to the Paste arm and type, which is the file arm without a File. */
function paste(label: string, text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Paste" }));
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

describe("YamlJsonConverterUI", () => {
  it("renders a drop zone before anything has been given to it", () => {
    const { container } = render(<YamlJsonConverterUI />);
    expect(container.textContent).toContain("Drop a YAML file");
  });

  it("converts pasted YAML and offers a download", () => {
    render(<YamlJsonConverterUI />);
    paste("Paste your YAML", "a: 1\n");
    expect(screen.getByLabelText("Converted output").textContent).toContain('"a": 1');
    expect(screen.getByRole("button", { name: /^Download / })).toBeInTheDocument();
  });

  it("says on screen how many documents a multi-document stream held", () => {
    render(<YamlJsonConverterUI />);
    paste("Paste your YAML", "a: 1\n---\nb: 2\n");
    expect(screen.getByRole("status").textContent).toContain("2 YAML documents");
  });

  it("names every non-string key and what it becomes", () => {
    render(<YamlJsonConverterUI />);
    paste("Paste your YAML", "1: a\n");
    expect(screen.getByRole("status").textContent).toContain("1 mapping key");
    expect(screen.getByRole("status").textContent).toContain('→ "1"');
  });

  it("refuses a cyclic anchor with the path, not a stack trace", () => {
    render(<YamlJsonConverterUI />);
    paste("Paste your YAML", "a: &x\n  self: *x\n");
    expect(screen.getByRole("alert").textContent).toContain("a.self");
    expect(screen.queryByLabelText("Converted output")).toBeNull();
  });

  it("swaps direction and reports the precision the JSON parse costs", () => {
    render(<YamlJsonConverterUI />);
    fireEvent.click(screen.getByRole("button", { name: "JSON → YAML" }));
    paste("Paste your JSON", '{"id": 12345678901234567890}');
    expect(screen.getByLabelText("Converted output").textContent).toContain(
      "12345678901234567000",
    );
    expect(screen.getByRole("status").textContent).toContain("changed VALUE");
  });

  /*
    The number named in the warning has to be the number in the pane. The
    warning used to print the double's exact mathematical value —
    12345678901234567168 — which appears in neither the input nor the output,
    so a reader checking the substitution found it nowhere.
  */
  it("names a replacement that is actually in the output pane", () => {
    render(<YamlJsonConverterUI />);
    fireEvent.click(screen.getByRole("button", { name: "JSON → YAML" }));
    paste("Paste your JSON", '{"id": 12345678901234567890}');
    const output = screen.getByLabelText("Converted output").textContent ?? "";
    expect(screen.getByRole("status").textContent).toContain("→ 12345678901234567000");
    expect(screen.getByRole("status").textContent).not.toContain("12345678901234567168");
    expect(output).toContain("12345678901234567000");
  });

  /*
    The P1, on screen. A literal with a decimal point that loses digits must
    reach the reader as a CHANGED VALUE with the "quote them in the source"
    advice, not as a respelling under "the value is the same".
  */
  it("warns that a decimal literal losing digits changed value, not spelling", () => {
    render(<YamlJsonConverterUI />);
    fireEvent.click(screen.getByRole("button", { name: "JSON → YAML" }));
    paste("Paste your JSON", '{"id": 9007199254740993.0, "lat": 0.1234567890123456789}');
    const warning = screen.getByRole("status").textContent ?? "";
    expect(warning).toContain("2 numbers in this file changed VALUE");
    expect(warning).toContain("9007199254740993.0 → 9007199254740992");
    expect(warning).toContain("0.1234567890123456789 → 0.12345678901234568");
    expect(warning).toContain("quote them in the source");
    expect(warning).not.toContain("spelled differently");
  });

  it("counts those two under Numbers changed, not Numbers respelled", () => {
    const { container } = render(<YamlJsonConverterUI />);
    fireEvent.click(screen.getByRole("button", { name: "JSON → YAML" }));
    paste("Paste your JSON", '{"id": 9007199254740993.0, "lat": 0.1234567890123456789}');
    const rail = container.textContent ?? "";
    expect(rail).toContain("Numbers changed2");
    expect(rail).toContain("Numbers respelled0");
  });

  /*
    An anchor on a plain scalar is expanded exactly like an anchor on a
    mapping, and the reader is told so. It used to count zero, so no warning
    fired at all on a run where the anchor was flattened away.
  */
  it("counts an alias to a scalar, which the parsed value cannot show", () => {
    const { container } = render(<YamlJsonConverterUI />);
    paste("Paste your YAML", 'x-tag: &tag "1.24.0-alpine"\nversion: *tag\n');
    expect(screen.getByRole("status").textContent).toContain("1 alias (*name) was expanded");
    expect(container.textContent).toContain("Aliases expanded1");
  });

  it("reports a duplicate JSON key that the parse silently drops", () => {
    render(<YamlJsonConverterUI />);
    fireEvent.click(screen.getByRole("button", { name: "JSON → YAML" }));
    paste("Paste your JSON", '{"a": 1, "a": 2}');
    expect(screen.getByRole("status").textContent).toContain("written more than once");
  });

  it("shows the parser's own error instead of an empty pane", () => {
    render(<YamlJsonConverterUI />);
    paste("Paste your YAML", "a: [1, 2\nb: 3\n");
    expect(screen.getByRole("alert").textContent).toContain("missed comma");
    expect(screen.getByRole("alert").textContent).toContain("line 2");
  });
});
