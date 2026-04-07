import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JsonToCsvUI } from "@/components/tools/JsonToCsvUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("JsonToCsvUI", () => {
  it("converts simple JSON array to CSV", () => {
    render(<JsonToCsvUI />);
    const input = screen.getByPlaceholderText(/Alice/);
    fireEvent.change(input, {
      target: {
        value: '[{"name":"Alice","age":30},{"name":"Bob","age":25}]',
      },
    });
    fireEvent.click(screen.getByText("Convert to CSV"));
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes("name,age") === true &&
        el.textContent?.includes("Alice,30") === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("collects unique keys across all objects", () => {
    render(<JsonToCsvUI />);
    const input = screen.getByPlaceholderText(/Alice/);
    fireEvent.change(input, {
      target: {
        value: '[{"a":1},{"b":2}]',
      },
    });
    fireEvent.click(screen.getByText("Convert to CSV"));
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes("a,b") === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("escapes commas and quotes in values", () => {
    render(<JsonToCsvUI />);
    const input = screen.getByPlaceholderText(/Alice/);
    fireEvent.change(input, {
      target: {
        value: '[{"name":"O\'Brien, Jr.","note":"He said \\"hi\\""}]',
      },
    });
    fireEvent.click(screen.getByText("Convert to CSV"));
    // Value with comma should be quoted, inner quotes doubled
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes('"O\'Brien, Jr."') === true &&
        el.textContent?.includes('""hi""') === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("shows error on non-array input", () => {
    render(<JsonToCsvUI />);
    const input = screen.getByPlaceholderText(/Alice/);
    fireEvent.change(input, {
      target: { value: '{"name":"Alice"}' },
    });
    fireEvent.click(screen.getByText("Convert to CSV"));
    expect(screen.getByText(/must be a non-empty JSON array/)).toBeInTheDocument();
  });

  it("shows error on empty array", () => {
    render(<JsonToCsvUI />);
    const input = screen.getByPlaceholderText(/Alice/);
    fireEvent.change(input, { target: { value: "[]" } });
    fireEvent.click(screen.getByText("Convert to CSV"));
    expect(screen.getByText(/must be a non-empty JSON array/)).toBeInTheDocument();
  });

  it("shows error on non-object array elements", () => {
    render(<JsonToCsvUI />);
    const input = screen.getByPlaceholderText(/Alice/);
    fireEvent.change(input, { target: { value: "[1,2,3]" } });
    fireEvent.click(screen.getByText("Convert to CSV"));
    expect(screen.getByText(/Each array element must be an object/)).toBeInTheDocument();
  });

  it("handles null/undefined values as empty strings", () => {
    render(<JsonToCsvUI />);
    const input = screen.getByPlaceholderText(/Alice/);
    fireEvent.change(input, {
      target: { value: '[{"a":null},{"a":"ok"}]' },
    });
    fireEvent.click(screen.getByText("Convert to CSV"));
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes("a\n\nok") === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("does nothing for empty input", () => {
    render(<JsonToCsvUI />);
    fireEvent.click(screen.getByText("Convert to CSV"));
    expect(screen.queryByText("CSV Output")).not.toBeInTheDocument();
  });
});
