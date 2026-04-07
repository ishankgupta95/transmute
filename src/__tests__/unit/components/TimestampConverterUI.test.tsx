import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TimestampConverterUI } from "@/components/tools/TimestampConverterUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("TimestampConverterUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Now button and all input fields", () => {
    render(<TimestampConverterUI />);
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Unix (seconds)")).toBeInTheDocument();
    expect(screen.getByText("Unix (milliseconds)")).toBeInTheDocument();
    expect(screen.getByText("ISO 8601")).toBeInTheDocument();
    expect(screen.getByText("Human-readable")).toBeInTheDocument();
  });

  it("Now button fills all fields with current time", () => {
    const before = Math.floor(Date.now() / 1000);
    render(<TimestampConverterUI />);
    fireEvent.click(screen.getByText("Now"));

    const inputs = screen.getAllByRole("textbox");
    // Unix seconds
    const unixSec = Number(inputs[0].getAttribute("value") || (inputs[0] as HTMLInputElement).value);
    const after = Math.floor(Date.now() / 1000);
    expect(unixSec).toBeGreaterThanOrEqual(before);
    expect(unixSec).toBeLessThanOrEqual(after);

    // Unix ms
    const unixMs = (inputs[1] as HTMLInputElement).value;
    expect(Number(unixMs)).toBeGreaterThan(0);

    // ISO
    const isoVal = (inputs[2] as HTMLInputElement).value;
    expect(isoVal).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Human-readable
    const humanVal = (inputs[3] as HTMLInputElement).value;
    expect(humanVal.length).toBeGreaterThan(0);
  });

  it("converts unix seconds to all formats", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    // Enter a known timestamp: 1700000000 = 2023-11-14T22:13:20.000Z
    fireEvent.change(inputs[0], { target: { value: "1700000000" } });

    const unixMs = (inputs[1] as HTMLInputElement).value;
    expect(unixMs).toBe("1700000000000");

    const iso = (inputs[2] as HTMLInputElement).value;
    expect(iso).toBe("2023-11-14T22:13:20.000Z");

    const human = (inputs[3] as HTMLInputElement).value;
    expect(human.length).toBeGreaterThan(0);
  });

  it("converts unix milliseconds to all formats", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[1], { target: { value: "1700000000000" } });

    const unixSec = (inputs[0] as HTMLInputElement).value;
    expect(unixSec).toBe("1700000000");

    const iso = (inputs[2] as HTMLInputElement).value;
    expect(iso).toBe("2023-11-14T22:13:20.000Z");
  });

  it("converts ISO string to unix timestamps", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[2], {
      target: { value: "2023-11-14T22:13:20.000Z" },
    });

    const unixSec = (inputs[0] as HTMLInputElement).value;
    expect(unixSec).toBe("1700000000");

    const unixMs = (inputs[1] as HTMLInputElement).value;
    expect(unixMs).toBe("1700000000000");
  });

  it("bidirectional sync: changing seconds updates ms and vice versa", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");

    // Set seconds
    fireEvent.change(inputs[0], { target: { value: "1000000000" } });
    expect((inputs[1] as HTMLInputElement).value).toBe("1000000000000");

    // Change ms
    fireEvent.change(inputs[1], { target: { value: "1500000000000" } });
    expect((inputs[0] as HTMLInputElement).value).toBe("1500000000");
  });

  it("copies unix seconds to clipboard", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "1700000000" } });

    const copyButtons = screen.getAllByText("Copy");
    fireEvent.click(copyButtons[0]); // Unix seconds copy
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("1700000000");
  });

  it("copies ISO string to clipboard", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "1700000000" } });

    const copyButtons = screen.getAllByText("Copy");
    fireEvent.click(copyButtons[2]); // ISO copy
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "2023-11-14T22:13:20.000Z"
    );
  });

  it("handles epoch zero correctly", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "0" } });

    expect((inputs[1] as HTMLInputElement).value).toBe("0");
    expect((inputs[2] as HTMLInputElement).value).toBe(
      "1970-01-01T00:00:00.000Z"
    );
  });

  it("does not update when invalid value is entered", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    // Enter a valid value first
    fireEvent.change(inputs[0], { target: { value: "1700000000" } });
    const isoBefore = (inputs[2] as HTMLInputElement).value;

    // Enter empty string - should not crash
    fireEvent.change(inputs[0], { target: { value: "" } });
    // ISO should remain unchanged (empty string check in handler)
    expect((inputs[2] as HTMLInputElement).value).toBe(isoBefore);
  });

  it("human-readable field is read-only", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    expect(inputs[3]).toHaveAttribute("readonly");
  });

  it("handles large future timestamp", () => {
    render(<TimestampConverterUI />);
    const inputs = screen.getAllByRole("textbox");
    // Year 2100 approx
    fireEvent.change(inputs[0], { target: { value: "4102444800" } });
    const iso = (inputs[2] as HTMLInputElement).value;
    expect(iso).toContain("2100");
  });
});
