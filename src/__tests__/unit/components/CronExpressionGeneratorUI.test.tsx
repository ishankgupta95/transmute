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

  it("describes step minutes as words, not raw '*/5'", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "*/5 * * * *" } });
    expect(screen.getByText("Every 5 minutes")).toBeInTheDocument();
  });

  it("describes weekday ranges and day lists as names", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "0 9 1,15 * 1-5" } });
    expect(
      screen.getByText("At 09:00 on days 1 and 15 of the month or on Mon through Fri"),
    ).toBeInTheDocument();
  });

  it("describes a stepped range with its window", () => {
    render(<CronExpressionGeneratorUI />);
    const input = screen.getByPlaceholderText("0 9 * * 1");
    fireEvent.change(input, { target: { value: "*/10 9-17 * * *" } });
    expect(
      screen.getByText("Every 10 minutes of hours 9 through 17"),
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
    const heading = screen.getByText("Next 5 Run Times");
    // The run times list sits in the pane the heading titles.
    const pane = heading.closest("div")!.parentElement!;
    expect(pane.querySelectorAll("span.text-neutral-300").length).toBe(5);
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

  it("shows Copied! after clicking copy", async () => {
    render(<CronExpressionGeneratorUI />);
    fireEvent.click(screen.getByText("Copy"));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
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

  /**
   * Regressions for the two scheduling bugs: day-of-month AND day-of-week were
   * intersected (POSIX unions them when both are restricted), and every stepped
   * term was reduced to `value % step === 0`, ignoring where the step starts.
   *
   * `getNextRuns` walks forward from the real clock, so these assert on the
   * count of listed runs rather than on fixed dates.
   */
  describe("schedule matching", () => {
    function runTimes(expression: string): string[] {
      render(<CronExpressionGeneratorUI />);
      const input = screen.getByPlaceholderText("0 9 * * 1");
      fireEvent.change(input, { target: { value: expression } });
      const heading = screen.getByText("Next 5 Run Times");
      const pane = heading.closest("div")!.parentElement!;
      return Array.from(pane.querySelectorAll("span.text-neutral-300")).map(
        (el) => el.textContent ?? "",
      );
    }

    it("unions day-of-month and day-of-week when both are restricted", () => {
      // "the 1st of the month, and every Monday". Intersecting these gives the
      // rare date that is both, so the old AND could list nothing at all.
      expect(runTimes("0 9 1 * 1")).toHaveLength(5);
    });

    it("still intersects when only one day field is restricted", () => {
      // Every Monday at 09:00 — five consecutive Mondays, seven days apart.
      const runs = runTimes("0 9 * * 1");
      expect(runs).toHaveLength(5);
      const days = runs.map((r) => new Date(r).getDay());
      expect(new Set(days)).toEqual(new Set([1]));
    });

    it("counts a step from the start of its own term", () => {
      // `5/15` is 5, 20, 35, 50 — not the multiples of 15 the old parser used.
      const minutes = runTimes("5/15 * * * *").map((r) => new Date(r).getMinutes());
      for (const m of minutes) expect([5, 20, 35, 50]).toContain(m);
    });

    it("handles */step from the field minimum", () => {
      const minutes = runTimes("*/20 * * * *").map((r) => new Date(r).getMinutes());
      for (const m of minutes) expect([0, 20, 40]).toContain(m);
    });

    it("handles a stepped range", () => {
      const minutes = runTimes("0-10/2 * * * *").map((r) => new Date(r).getMinutes());
      for (const m of minutes) expect([0, 2, 4, 6, 8, 10]).toContain(m);
    });

    it("accepts 7 as Sunday", () => {
      const runs = runTimes("0 9 * * 7");
      expect(runs).toHaveLength(5);
      for (const r of runs) expect(new Date(r).getDay()).toBe(0);
    });

    it("describes a both-days expression as a union", () => {
      render(<CronExpressionGeneratorUI />);
      const input = screen.getByPlaceholderText("0 9 * * 1");
      fireEvent.change(input, { target: { value: "0 9 15 * 1" } });
      expect(screen.getByText(/on day 15 of the month or on Mon/)).toBeInTheDocument();
    });
  });
});
