import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JsonFormatterUI } from "@/components/tools/JsonFormatterUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("JsonFormatterUI", () => {
  it("formats valid JSON with 2-space indentation", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    fireEvent.change(input, {
      target: { value: '{"name":"John","age":30}' },
    });
    const output = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes('"name": "John"') === true,
    );
    expect(output).toBeInTheDocument();
    // Verify 2-space indentation
    expect(output.textContent).toContain("  ");
  });

  it("minifies valid JSON", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    // First enter some JSON in format mode
    fireEvent.change(input, {
      target: { value: '{ "name": "John",  "age": 30 }' },
    });
    // Switch to minify mode
    fireEvent.click(screen.getByText("Minify"));
    // The output should be minified (no extra spaces)
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes('{"name":"John","age":30}') === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("shows error for invalid JSON", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    fireEvent.change(input, { target: { value: "{invalid json}" } });
    expect(screen.getByText(/Expected property name/i)).toBeInTheDocument();
  });

  it("produces no output for empty input", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("produces no output for whitespace-only input", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("mode toggle re-processes existing input", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    fireEvent.change(input, { target: { value: '{"a":1}' } });
    // In format mode, output should be indented
    expect(screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent?.includes("  ") === true)).toBeInTheDocument();

    // Switch to minify
    fireEvent.click(screen.getByText("Minify"));
    const pre = screen.getByText(
      (_, el) => el?.tagName === "PRE" && el.textContent === '{"a":1}',
    );
    expect(pre).toBeInTheDocument();

    // Switch back to format
    fireEvent.click(screen.getByText("Format"));
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "PRE" && el.textContent?.includes('"a": 1') === true,
      ),
    ).toBeInTheDocument();
  });

  it("copies output to clipboard", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    fireEvent.change(input, { target: { value: '{"a":1}' } });
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it("formats arrays correctly", () => {
    render(<JsonFormatterUI />);
    const input = screen.getByPlaceholderText(/name.*John/);
    fireEvent.change(input, { target: { value: "[1,2,3]" } });
    const pre = screen.getByText(
      (_, el) => el?.tagName === "PRE" && el.textContent?.includes("[\n") === true,
    );
    expect(pre).toBeInTheDocument();
  });
});
