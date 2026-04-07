import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sql-formatter", () => ({
  format: vi.fn((sql: string, opts?: { language?: string; keywordCase?: string; tabWidth?: number }) => {
    if (sql.includes("INVALID_TRIGGER")) throw new Error("Parse error");
    const kw = opts?.keywordCase === "upper" ? "SELECT" : "select";
    return `${kw}\n  *\nFROM\n  users`;
  }),
}));

import { SqlFormatterUI } from "@/components/tools/SqlFormatterUI";
import { format as formatSql } from "sql-formatter";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("SqlFormatterUI", () => {
  it("formats SQL on button click", () => {
    render(<SqlFormatterUI />);
    const input = screen.getByPlaceholderText(/SELECT id/);
    fireEvent.change(input, { target: { value: "SELECT * FROM users" } });
    fireEvent.click(screen.getByText("Format SQL"));
    expect(formatSql).toHaveBeenCalledWith("SELECT * FROM users", expect.objectContaining({
      language: "sql",
      keywordCase: "upper",
      tabWidth: 2,
    }));
    expect(screen.getByText("Formatted SQL")).toBeInTheDocument();
  });

  it("passes selected dialect to formatter", () => {
    render(<SqlFormatterUI />);
    const select = screen.getByDisplayValue("Standard SQL");
    fireEvent.change(select, { target: { value: "postgresql" } });
    const input = screen.getByPlaceholderText(/SELECT id/);
    fireEvent.change(input, { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByText("Format SQL"));
    expect(formatSql).toHaveBeenCalledWith("SELECT 1", expect.objectContaining({
      language: "postgresql",
    }));
  });

  it("respects uppercase toggle", () => {
    render(<SqlFormatterUI />);
    // Uncheck uppercase
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    const input = screen.getByPlaceholderText(/SELECT id/);
    fireEvent.change(input, { target: { value: "select 1" } });
    fireEvent.click(screen.getByText("Format SQL"));
    expect(formatSql).toHaveBeenCalledWith("select 1", expect.objectContaining({
      keywordCase: "preserve",
    }));
  });

  it("shows error when formatting fails", () => {
    render(<SqlFormatterUI />);
    const input = screen.getByPlaceholderText(/SELECT id/);
    fireEvent.change(input, { target: { value: "INVALID_TRIGGER" } });
    fireEvent.click(screen.getByText("Format SQL"));
    expect(screen.getByText("Parse error")).toBeInTheDocument();
  });

  it("does nothing for empty input", () => {
    render(<SqlFormatterUI />);
    fireEvent.click(screen.getByText("Format SQL"));
    expect(formatSql).not.toHaveBeenCalled();
    expect(screen.queryByText("Formatted SQL")).not.toBeInTheDocument();
  });

  it("lists all expected dialects", () => {
    render(<SqlFormatterUI />);
    const select = screen.getByDisplayValue("Standard SQL");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    expect(screen.getByText("SQLite")).toBeInTheDocument();
  });

  it("copies formatted output to clipboard", () => {
    render(<SqlFormatterUI />);
    const input = screen.getByPlaceholderText(/SELECT id/);
    fireEvent.change(input, { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByText("Format SQL"));
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
