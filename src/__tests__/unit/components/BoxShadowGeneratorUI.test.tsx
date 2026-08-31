import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BoxShadowGeneratorUI } from "@/components/tools/BoxShadowGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("BoxShadowGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders shadow controls and CSS output", () => {
    render(<BoxShadowGeneratorUI />);
    expect(screen.getByText("SHADOWS")).toBeInTheDocument();
    expect(screen.getByText("CSS Code")).toBeInTheDocument();
    expect(screen.getByText("+ Add Layer")).toBeInTheDocument();
  });

  it("generates valid box-shadow CSS with default values", () => {
    render(<BoxShadowGeneratorUI />);
    const code = document.querySelector("code");
    const css = code!.textContent!;
    expect(css).toContain("box-shadow:");
    // Default: 0px 4px 16px 0px rgba(0, 0, 0, 0.25)
    expect(css).toContain("0px 4px 16px 0px");
    expect(css).toContain("rgba(0, 0, 0, 0.25)");
  });

  it("handles inset shadow", () => {
    render(<BoxShadowGeneratorUI />);
    const insetCheckbox = screen.getByRole("checkbox");
    fireEvent.click(insetCheckbox);
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("inset ");
  });

  it("adds a shadow layer", () => {
    render(<BoxShadowGeneratorUI />);
    expect(screen.getByText("LAYER 1")).toBeInTheDocument();
    expect(screen.queryByText("LAYER 2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("+ Add Layer"));

    expect(screen.getByText("LAYER 1")).toBeInTheDocument();
    expect(screen.getByText("LAYER 2")).toBeInTheDocument();
  });

  it("multiple shadows are comma-separated in CSS", () => {
    render(<BoxShadowGeneratorUI />);
    fireEvent.click(screen.getByText("+ Add Layer"));
    const code = document.querySelector("code");
    const css = code!.textContent!;
    // Should contain comma separating two shadow values
    const shadowPart = css.replace("box-shadow: ", "").replace(";", "");
    const shadows = shadowPart.split(", ").filter((s) => s.includes("rgba"));
    expect(shadows.length).toBe(2);
  });

  it("removes a shadow layer (only when more than 1)", () => {
    render(<BoxShadowGeneratorUI />);
    fireEvent.click(screen.getByText("+ Add Layer"));
    expect(screen.getByText("LAYER 2")).toBeInTheDocument();

    // Remove buttons appear
    const removeButtons = screen.getAllByText("×");
    fireEvent.click(removeButtons[0]);

    expect(screen.queryByText("LAYER 2")).not.toBeInTheDocument();
  });

  it("does not show remove button for single shadow", () => {
    render(<BoxShadowGeneratorUI />);
    expect(screen.queryByText("×")).not.toBeInTheDocument();
  });

  it("opacity conversion works correctly (0%)", () => {
    render(<BoxShadowGeneratorUI />);
    // Find opacity slider - it's the last range input in the shadow controls
    const sliders = screen.getAllByRole("slider");
    // Opacity slider - find the one labeled "Opacity"
    const opacitySlider = sliders[sliders.length - 1];
    fireEvent.change(opacitySlider, { target: { value: "0" } });
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("rgba(0, 0, 0, 0)");
  });

  it("opacity conversion works correctly (100%)", () => {
    render(<BoxShadowGeneratorUI />);
    const sliders = screen.getAllByRole("slider");
    const opacitySlider = sliders[sliders.length - 1];
    fireEvent.change(opacitySlider, { target: { value: "100" } });
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("rgba(0, 0, 0, 1)");
  });

  it("copies CSS to clipboard", () => {
    render(<BoxShadowGeneratorUI />);
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(arg).toContain("box-shadow:");
  });

  it("shows Copied! after clicking copy", async () => {
    render(<BoxShadowGeneratorUI />);
    fireEvent.click(screen.getByText("Copy"));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("preview box has correct box-shadow style", () => {
    render(<BoxShadowGeneratorUI />);
    // The preview box is the 48x48 div with box-shadow inline style
    const previewBox = document.querySelector('[style*="box-shadow"]');
    expect(previewBox).not.toBeNull();
  });

  it("converts non-black color hex to rgba correctly", () => {
    render(<BoxShadowGeneratorUI />);
    const colorInput = document.querySelector('input[type="color"]');
    fireEvent.change(colorInput!, { target: { value: "#ff0000" } });
    const code = document.querySelector("code");
    expect(code!.textContent).toContain("rgba(255, 0, 0, 0.25)");
  });

  it("second layer has different default y offset", () => {
    render(<BoxShadowGeneratorUI />);
    fireEvent.click(screen.getByText("+ Add Layer"));
    const code = document.querySelector("code");
    // Second layer y offset = (prev.length + 1) * 4 = 8
    expect(code!.textContent).toContain("8px");
  });
});
