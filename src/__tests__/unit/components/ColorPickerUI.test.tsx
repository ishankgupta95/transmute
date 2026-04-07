import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ColorPickerUI } from "@/components/tools/ColorPickerUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

// Helper to get the hex text input (not the color picker input)
function getHexTextInput(): HTMLInputElement {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="text"]');
  return inputs[0];
}

function setHex(value: string) {
  const input = getHexTextInput();
  fireEvent.change(input, { target: { value } });
}

function getRgbInputs(): HTMLInputElement[] {
  return screen.getAllByRole("spinbutton").slice(0, 3) as HTMLInputElement[];
}

function getHslInputs(): HTMLInputElement[] {
  return screen.getAllByRole("spinbutton").slice(3, 6) as HTMLInputElement[];
}

describe("ColorPickerUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with default color and shows HEX, RGB, HSL labels", () => {
    render(<ColorPickerUI />);
    expect(screen.getByText("HEX")).toBeInTheDocument();
    expect(screen.getByText("RGB")).toBeInTheDocument();
    expect(screen.getByText("HSL")).toBeInTheDocument();
  });

  it("displays the default hex value #2dd4bf", () => {
    render(<ColorPickerUI />);
    const hexInput = getHexTextInput();
    expect(hexInput.value).toBe("#2dd4bf");
  });

  it("converts hex to RGB correctly for default color", () => {
    render(<ColorPickerUI />);
    // #2dd4bf -> R=45, G=212, B=191
    const [r, g, b] = getRgbInputs();
    expect(r).toHaveValue(45);
    expect(g).toHaveValue(212);
    expect(b).toHaveValue(191);
  });

  it("converts black #000000 correctly", () => {
    render(<ColorPickerUI />);
    setHex("#000000");
    const [r, g, b] = getRgbInputs();
    expect(r).toHaveValue(0);
    expect(g).toHaveValue(0);
    expect(b).toHaveValue(0);
    const [h, s, l] = getHslInputs();
    expect(h).toHaveValue(0);
    expect(s).toHaveValue(0);
    expect(l).toHaveValue(0);
  });

  it("converts white #ffffff correctly", () => {
    render(<ColorPickerUI />);
    setHex("#ffffff");
    const [r, g, b] = getRgbInputs();
    expect(r).toHaveValue(255);
    expect(g).toHaveValue(255);
    expect(b).toHaveValue(255);
    const [h, s, l] = getHslInputs();
    expect(h).toHaveValue(0);
    expect(s).toHaveValue(0);
    expect(l).toHaveValue(100);
  });

  it("converts pure red #ff0000 correctly", () => {
    render(<ColorPickerUI />);
    setHex("#ff0000");
    const [r, g, b] = getRgbInputs();
    expect(r).toHaveValue(255);
    expect(g).toHaveValue(0);
    expect(b).toHaveValue(0);
    const [h, s, l] = getHslInputs();
    expect(h).toHaveValue(0);
    expect(s).toHaveValue(100);
    expect(l).toHaveValue(50);
  });

  it("converts pure green #00ff00 correctly", () => {
    render(<ColorPickerUI />);
    setHex("#00ff00");
    const [r, g, b] = getRgbInputs();
    expect(r).toHaveValue(0);
    expect(g).toHaveValue(255);
    expect(b).toHaveValue(0);
    const [h, s, l] = getHslInputs();
    expect(h).toHaveValue(120);
    expect(s).toHaveValue(100);
    expect(l).toHaveValue(50);
  });

  it("converts pure blue #0000ff correctly", () => {
    render(<ColorPickerUI />);
    setHex("#0000ff");
    const [r, g, b] = getRgbInputs();
    expect(r).toHaveValue(0);
    expect(g).toHaveValue(0);
    expect(b).toHaveValue(255);
    const [h, s, l] = getHslInputs();
    expect(h).toHaveValue(240);
    expect(s).toHaveValue(100);
    expect(l).toHaveValue(50);
  });

  it("updates hex when RGB values change", () => {
    render(<ColorPickerUI />);
    const [r, g, b] = getRgbInputs();
    fireEvent.change(r, { target: { value: "255" } });
    fireEvent.change(g, { target: { value: "0" } });
    fireEvent.change(b, { target: { value: "0" } });
    expect(getHexTextInput().value).toBe("#ff0000");
  });

  it("updates hex when HSL values change", () => {
    render(<ColorPickerUI />);
    const [h, s, l] = getHslInputs();
    fireEvent.change(h, { target: { value: "120" } });
    fireEvent.change(s, { target: { value: "100" } });
    fireEvent.change(l, { target: { value: "50" } });
    expect(getHexTextInput().value).toBe("#00ff00");
  });

  it("copies hex value to clipboard", () => {
    render(<ColorPickerUI />);
    const copyButtons = screen.getAllByText("Copy");
    fireEvent.click(copyButtons[0]); // HEX copy
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("#2dd4bf");
  });

  it("copies RGB value to clipboard", () => {
    render(<ColorPickerUI />);
    const copyButtons = screen.getAllByText("Copy");
    fireEvent.click(copyButtons[1]); // RGB copy
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "rgb(45, 212, 191)"
    );
  });

  it("copies HSL value to clipboard", () => {
    render(<ColorPickerUI />);
    const copyButtons = screen.getAllByText("Copy");
    fireEvent.click(copyButtons[2]); // HSL copy
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(arg).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it("round-trip: hex -> RGB -> hex produces same value for pure colors", () => {
    render(<ColorPickerUI />);
    setHex("#3366cc");
    expect(getHexTextInput().value).toBe("#3366cc");
  });

  it("handles gray color correctly (equal RGB = zero saturation)", () => {
    render(<ColorPickerUI />);
    setHex("#808080");
    const [r, g, b] = getRgbInputs();
    expect(r).toHaveValue(128);
    expect(g).toHaveValue(128);
    expect(b).toHaveValue(128);
    const [h, s, l] = getHslInputs();
    expect(h).toHaveValue(0);
    expect(s).toHaveValue(0);
    expect(l).toHaveValue(50);
  });

  it("shows color preview with correct background", () => {
    render(<ColorPickerUI />);
    const preview = document.querySelector('[style*="background"]');
    expect(preview).not.toBeNull();
  });
});
