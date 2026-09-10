import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { YamlFormatterUI } from "@/components/tools/YamlFormatterUI";

/*
 * `yaml-tools.test.ts` proves the engine derives the right numbers. This file
 * proves those numbers reach the screen — a loss counted in a result object and
 * never rendered is the same to the reader as a loss nobody counted.
 */

/** Switch to the Paste arm and type, which is the file arm without a File. */
function paste(label: string, text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Paste" }));
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

describe("YamlFormatterUI", () => {
  it("renders a drop zone before anything has been given to it", () => {
    const { container } = render(<YamlFormatterUI />);
    expect(container.textContent).toContain("Drop a YAML file");
  });

  it("re-indents, and reports the file as valid", () => {
    render(<YamlFormatterUI />);
    paste("Paste your YAML", "a:\n      b: 1\n");
    expect(screen.getByLabelText("Formatted YAML").textContent).toBe("a:\n  b: 1\n");
  });

  it("reports the parse error with its line and column", () => {
    render(<YamlFormatterUI />);
    paste("Paste your YAML", "a: [1, 2\nb: 3\n");
    expect(screen.getByRole("alert").textContent).toContain("not valid YAML");
    expect(screen.getByRole("alert").textContent).toContain("line 2, column 1");
  });

  it("warns that a key it is about to quote was not a string", () => {
    render(<YamlFormatterUI />);
    paste("Paste your YAML", "1: a\n");
    expect(screen.getByLabelText("Formatted YAML").textContent).toBe("'1': a\n");
    expect(screen.getByRole("status").textContent).toContain("not a string");
  });

  it("warns that re-anchoring loses the anchor's name", () => {
    render(<YamlFormatterUI />);
    paste("Paste your YAML", "a: &base\n  k: 1\nb: *base\n");
    expect(screen.getByLabelText("Formatted YAML").textContent).toContain("&ref_0");
    expect(screen.getByRole("status").textContent).toContain("anchor NAME");
  });

  /*
    A cyclic anchor is renamed to &ref_0 like any other shared node, so the
    Re-anchored row and the anchor-name warning both have to say so. The row
    used to read 0 on output that visibly carries &ref_0, and the warning that
    would have mentioned the rename never rendered at all.
  */
  it("counts a cyclic anchor as re-anchored and says the name changed", () => {
    const { container } = render(<YamlFormatterUI />);
    paste("Paste your YAML", "a: &x\n  self: *x\n");
    expect(screen.getByLabelText("Formatted YAML").textContent).toContain("&ref_0");
    expect(container.textContent).toContain("Re-anchored1");
    expect(screen.getByRole("status").textContent).toContain("anchor NAME");
    expect(screen.getByRole("status").textContent).toContain("points back at a parent");
  });

  /*
    An anchor on a plain value is not re-anchored — it is flattened, and both
    &tag and *tag leave the file. That used to happen in silence: the walk over
    the parsed value cannot see a shared string, so nothing was counted and no
    warning fired on a run where the anchor was lost.
  */
  it("warns that an anchor on a plain value disappears entirely", () => {
    render(<YamlFormatterUI />);
    paste("Paste your YAML", 'x-tag: &tag "1.24.0-alpine"\nversion: *tag\n');
    const output = screen.getByLabelText("Formatted YAML").textContent ?? "";
    expect(output).toContain("1.24.0-alpine");
    expect(output).not.toContain("&");
    expect(output).not.toContain("*");
    const warning = screen.getByRole("status").textContent ?? "";
    expect(warning).toContain("1 alias (*name) points at a plain value");
    expect(warning).toContain("gone from the output");
  });

  it("says nothing about anchors for a file that has none", () => {
    render(<YamlFormatterUI />);
    paste("Paste your YAML", "a: 1\nb: 2\n");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sorts keys only once the box is ticked, and says it is an edit", () => {
    render(<YamlFormatterUI />);
    paste("Paste your YAML", "b: 1\na: 2\n");
    expect(screen.getByLabelText("Formatted YAML").textContent).toBe("b: 1\na: 2\n");
    fireEvent.click(screen.getByLabelText("Sort keys alphabetically"));
    expect(screen.getByLabelText("Formatted YAML").textContent).toBe("a: 2\nb: 1\n");
    expect(screen.getByRole("status").textContent).toContain("sorted alphabetically");
  });
});
