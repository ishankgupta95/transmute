import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CssGradientGeneratorUI } from "@/components/tools/CssGradientGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("CssGradientGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders gradient type buttons and color stops", () => {
    render(<CssGradientGeneratorUI />);
    expect(screen.getByText("Linear")).toBeInTheDocument();
    expect(screen.getByText("Radial")).toBeInTheDocument();
    expect(screen.getByText("Conic")).toBeInTheDocument();
    expect(screen.getByText("Color Stops")).toBeInTheDocument();
  });

  it("generates linear-gradient CSS by default", () => {
    render(<CssGradientGeneratorUI />);
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("linear-gradient(");
    expect(code!.textContent).toContain("135deg");
    expect(code!.textContent).toContain("#2dd4bf 0%");
    expect(code!.textContent).toContain("#6366f1 100%");
  });

  it("generates radial-gradient CSS when radial selected", () => {
    render(<CssGradientGeneratorUI />);
    fireEvent.click(screen.getByText("Radial"));
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("radial-gradient(circle,");
  });

  it("generates conic-gradient CSS when conic selected", () => {
    render(<CssGradientGeneratorUI />);
    fireEvent.click(screen.getByText("Conic"));
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("conic-gradient(from");
    expect(code!.textContent).toContain("deg");
  });

  it("hides angle slider for radial gradient", () => {
    render(<CssGradientGeneratorUI />);
    // Linear shows angle
    expect(screen.getByText("Angle:")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Radial"));
    expect(screen.queryByText("Angle:")).not.toBeInTheDocument();
  });

  it("shows angle slider for conic gradient", () => {
    render(<CssGradientGeneratorUI />);
    fireEvent.click(screen.getByText("Conic"));
    expect(screen.getByText("Angle:")).toBeInTheDocument();
  });

  it("adds a color stop", () => {
    render(<CssGradientGeneratorUI />);
    // Initially 2 color stops
    const colorInputs = document.querySelectorAll('input[type="color"]');
    expect(colorInputs).toHaveLength(2);

    fireEvent.click(screen.getByText("+ Add Stop"));

    const colorInputsAfter = document.querySelectorAll('input[type="color"]');
    expect(colorInputsAfter).toHaveLength(3);
  });

  it("removes a color stop (only when more than 2)", () => {
    render(<CssGradientGeneratorUI />);
    // Add a third stop first
    fireEvent.click(screen.getByText("+ Add Stop"));

    // Remove buttons should appear (the x button)
    const removeButtons = screen.getAllByText("×");
    expect(removeButtons.length).toBeGreaterThan(0);
    fireEvent.click(removeButtons[0]);

    const colorInputsAfter = document.querySelectorAll('input[type="color"]');
    expect(colorInputsAfter).toHaveLength(2);
  });

  it("does not show remove buttons when only 2 stops", () => {
    render(<CssGradientGeneratorUI />);
    expect(screen.queryByText("×")).not.toBeInTheDocument();
  });

  it("copies CSS code to clipboard", () => {
    render(<CssGradientGeneratorUI />);
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(arg).toContain("background:");
    expect(arg).toContain("linear-gradient(");
  });

  it("CSS code includes background: prefix and semicolon", () => {
    render(<CssGradientGeneratorUI />);
    const code = document.querySelector("code");
    expect(code!.textContent).toMatch(/^background:.*gradient\(.*\);$/);
  });

  it("updates CSS when stop color changes", () => {
    render(<CssGradientGeneratorUI />);
    const textInputs = document.querySelectorAll('input[type="text"]');
    // First text input for color hex
    fireEvent.change(textInputs[0], { target: { value: "#ff0000" } });
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("#ff0000");
  });

  it("preview div has correct background style", () => {
    render(<CssGradientGeneratorUI />);
    const preview = document.querySelector('[style*="background"]');
    expect(preview).not.toBeNull();
  });

  it("new stop is added with default values", () => {
    render(<CssGradientGeneratorUI />);
    fireEvent.click(screen.getByText("+ Add Stop"));
    const code = document.querySelector("code");
    // New stop has color #ffffff at position 50%
    expect(code!.textContent).toContain("#ffffff 50%");
  });
});
