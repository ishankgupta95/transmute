import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CronExpressionGeneratorUI } from "@/components/tools/CronExpressionGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("CronExpressionGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders cron expression input and visual builder selects", () => {
    render(<CronExpressionGeneratorUI />);
    expect(screen.getByText("Cron Expression")).toBeInTheDocument();
    expect(screen.getByText("Minute")).toBeInTheDocument();
    expect(screen.getByText("Hour")).toBeInTheDocument();
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Month")).toBeInTheDocument();
    expect(screen.getByText("Weekday")).toBeInTheDocument();
  });

  it("default expression is 0 9 * * 1", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    expect(input).toHaveValue("0 9 * * 1");
  });

  it("describes default cron as Monday at 09:00", () => {
    render(<CronExpressionGeneratorUI />);
    // describeCron for [0, 9, *, *, 1] -> "At 09:00 on Mon"
    expect(screen.getByText("At 09:00 on Mon")).toBeInTheDocument();
  });

  it("describes every minute expression", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "* * * * *" } });
    expect(screen.getByText("Every minute")).toBeInTheDocument();
  });

  it("describes at minute X of every hour", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "30 * * * *" } });
    expect(
      screen.getByText("At minute 30 of every hour")
    ).toBeInTheDocument();
  });

  it("describes expression with month", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "0 9 * 1 *" } });
    expect(screen.getByText(/in Jan/)).toBeInTheDocument();
  });

  it("describes expression with day of month", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "0 9 15 * *" } });
    expect(screen.getByText(/on day 15/)).toBeInTheDocument();
  });

  it("shows next 5 run times for valid expression", () => {
    render(<CronExpressionGeneratorUI />);
    expect(screen.getByText("Next 5 Run Times")).toBeInTheDocument();
    // Should show 5 run time entries
    const runTimeEntries = document.querySelectorAll(
      ".font-mono.text-sm.text-text-primary"
    );
    // Filter to just the run time entries (not the cron input)
    expect(runTimeEntries.length).toBeGreaterThanOrEqual(5);
  });

  it("shows invalid expression for malformed input", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "invalid" } });
    expect(screen.getByText("Invalid expression")).toBeInTheDocument();
  });

  it("copies expression to clipboard", () => {
    render(<CronExpressionGeneratorUI />);
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("0 9 * * 1");
  });

  it("shows Copied! after clicking copy", () => {
    render(<CronExpressionGeneratorUI />);
    fireEvent.click(screen.getByText("Copy"));
    expect(screen.getByText("Copied!")).toBeInTheDocument();
  });

  it("visual builder selects update expression", () => {
    render(<CronExpressionGeneratorUI />);
    const selects = screen.getAllByRole("combobox");
    // selects: Minute, Hour, Day, Month, Weekday
    // Change minute to 30
    fireEvent.change(selects[0], { target: { value: "30" } });
    const input = screen.getByPlaceholderText("0 9 * * 1");
    expect(input).toHaveValue("30 9 * * 1");
  });

  it("manual input syncs to visual builder selects", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "15 12 * * 5" } });
    const selects = screen.getAllByRole("combobox");
    expect(selects[0]).toHaveValue("15");
    expect(selects[1]).toHaveValue("12");
    expect(selects[4]).toHaveValue("5");
  });

  it("describes every minute of a specific hour", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "* 14 * * *" } });
    expect(
      screen.getByText("Every minute of hour 14")
    ).toBeInTheDocument();
  });

  it("no next runs shown for invalid expression", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "bad" } });
    expect(screen.queryByText("Next 5 Run Times")).not.toBeInTheDocument();
  });
});
