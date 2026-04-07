import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CsvToJsonUI } from "@/components/tools/CsvToJsonUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("CsvToJsonUI", () => {
  it("parses simple CSV to JSON", () => {
    render(<CsvToJsonUI />);
    const input = screen.getByPlaceholderText(/name,age,city/);
    fireEvent.change(input, {
      target: { value: "name,age\nAlice,30\nBob,25" },
    });
    fireEvent.click(screen.getByText("Convert to JSON"));
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes('"name": "Alice"') === true &&
        el.textContent?.includes('"age": "30"') === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("handles quoted fields with commas", () => {
    render(<CsvToJsonUI />);
    const input = screen.getByPlaceholderText(/name,age,city/);
    fireEvent.change(input, {
      target: { value: 'name,address\nAlice,"123 Main St, Apt 4"' },
    });
    fireEvent.click(screen.getByText("Convert to JSON"));
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes("123 Main St, Apt 4") === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("handles escaped quotes (double-quotes)", () => {
    render(<CsvToJsonUI />);
    const input = screen.getByPlaceholderText(/name,age,city/);
    const csv = 'name,quote\nAlice,"She said ""hi"""';
    fireEvent.change(input, { target: { value: csv } });
    fireEvent.click(screen.getByText("Convert to JSON"));
    const pre = screen.getByText(
      (_, el) => el?.tagName === "PRE" && !!el.textContent,
    );
    const parsed = JSON.parse(pre.textContent!);
    expect(parsed[0].quote).toBe('She said "hi"');
  });

  it("skips empty rows", () => {
    render(<CsvToJsonUI />);
    const input = screen.getByPlaceholderText(/name,age,city/);
    fireEvent.change(input, {
      target: { value: "name\nAlice\n\nBob" },
    });
    fireEvent.click(screen.getByText("Convert to JSON"));
    const pre = screen.getByText(
      (_, el) => el?.tagName === "PRE" && !!el.textContent,
    );
    const parsed = JSON.parse(pre.textContent!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Alice");
    expect(parsed[1].name).toBe("Bob");
  });

  it("shows error when CSV has only header (no data rows)", () => {
    render(<CsvToJsonUI />);
    const input = screen.getByPlaceholderText(/name,age,city/);
    fireEvent.change(input, { target: { value: "name,age" } });
    fireEvent.click(screen.getByText("Convert to JSON"));
    expect(
      screen.getByText(/must have a header row and at least one data row/),
    ).toBeInTheDocument();
  });

  it("does nothing for empty input", () => {
    render(<CsvToJsonUI />);
    fireEvent.click(screen.getByText("Convert to JSON"));
    expect(screen.queryByText("JSON Output")).not.toBeInTheDocument();
  });

  it("handles missing values as empty strings", () => {
    render(<CsvToJsonUI />);
    const input = screen.getByPlaceholderText(/name,age,city/);
    fireEvent.change(input, {
      target: { value: "a,b,c\n1" },
    });
    fireEvent.click(screen.getByText("Convert to JSON"));
    const pre = screen.getByText(
      (_, el) => el?.tagName === "PRE" && !!el.textContent,
    );
    const parsed = JSON.parse(pre.textContent!);
    expect(parsed[0].b).toBe("");
    expect(parsed[0].c).toBe("");
  });
});
