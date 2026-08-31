import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PasswordGeneratorUI, generatePassword } from "@/components/tools/PasswordGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("generatePassword", () => {
  it("includes every selected character class — not just probably", () => {
    // 8 chars × 4 classes: without the guarantee, misses are common enough
    // that 50 runs would catch a regression with near-certainty.
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({
        length: 8,
        uppercase: true,
        lowercase: true,
        numbers: true,
        symbols: true,
      });
      expect(pw).toHaveLength(8);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("caps guaranteed classes at the password length", () => {
    const pw = generatePassword({
      length: 2,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    });
    expect(pw).toHaveLength(2);
  });
});

describe("PasswordGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all option controls and generate button", () => {
    render(<PasswordGeneratorUI />);
    expect(screen.getByText("Generate")).toBeInTheDocument();
    expect(screen.getByText("Uppercase")).toBeInTheDocument();
    expect(screen.getByText("Lowercase")).toBeInTheDocument();
    expect(screen.getByText("Numbers")).toBeInTheDocument();
    expect(screen.getByText("Symbols")).toBeInTheDocument();
  });

  it("generates a password with default length 16", () => {
    render(<PasswordGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    const code = document.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent!.length).toBe(16);
  });

  it("generates password with only lowercase when other options unchecked", () => {
    render(<PasswordGeneratorUI />);
    const checkboxes = screen.getAllByRole("checkbox");
    // Uncheck uppercase (index 0), numbers (index 2), symbols (index 3)
    fireEvent.click(checkboxes[0]); // uppercase off
    fireEvent.click(checkboxes[2]); // numbers off
    fireEvent.click(checkboxes[3]); // symbols off
    fireEvent.click(screen.getByText("Generate"));
    const pw = document.querySelector("code")!.textContent!;
    expect(pw).toMatch(/^[a-z]+$/);
  });

  it("generates password with only uppercase when other options unchecked", () => {
    render(<PasswordGeneratorUI />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // lowercase off
    fireEvent.click(checkboxes[2]); // numbers off
    fireEvent.click(checkboxes[3]); // symbols off
    fireEvent.click(screen.getByText("Generate"));
    const pw = document.querySelector("code")!.textContent!;
    expect(pw).toMatch(/^[A-Z]+$/);
  });

  it("generates password with only numbers when other options unchecked", () => {
    render(<PasswordGeneratorUI />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]); // uppercase off
    fireEvent.click(checkboxes[1]); // lowercase off
    fireEvent.click(checkboxes[3]); // symbols off
    fireEvent.click(screen.getByText("Generate"));
    const pw = document.querySelector("code")!.textContent!;
    expect(pw).toMatch(/^[0-9]+$/);
  });

  it("generates password with only symbols when other options unchecked", () => {
    render(<PasswordGeneratorUI />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]); // uppercase off
    fireEvent.click(checkboxes[1]); // lowercase off
    fireEvent.click(checkboxes[2]); // numbers off
    fireEvent.click(screen.getByText("Generate"));
    const pw = document.querySelector("code")!.textContent!;
    // Should contain only symbol characters
    expect(pw).toMatch(/^[!@#$%^&*()_+\-=[\]{}|;:,.<>?]+$/);
  });

  it("shows error when all character types unchecked", () => {
    render(<PasswordGeneratorUI />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(checkboxes[3]);
    fireEvent.click(screen.getByText("Generate"));
    expect(
      screen.getByText("Select at least one character type")
    ).toBeInTheDocument();
  });

  it("displays strength meter after generating", () => {
    render(<PasswordGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    expect(screen.getByText("Strength")).toBeInTheDocument();
  });

  it("shows Very Strong for long password with all char types", () => {
    render(<PasswordGeneratorUI />);
    // Default is length 16 with all types enabled -> entropy = 16 * log2(92) ~= 104 -> Very Strong
    fireEvent.click(screen.getByText("Generate"));
    expect(screen.getByText("Very Strong")).toBeInTheDocument();
  });

  it("generates multiple passwords when count is set", () => {
    render(<PasswordGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByText("Generate"));
    const codes = document.querySelectorAll("code");
    expect(codes).toHaveLength(5);
  });

  it("copies password to clipboard on Copy click", () => {
    render(<PasswordGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("all generated passwords are unique", () => {
    render(<PasswordGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "20" }));
    fireEvent.click(screen.getByText("Generate"));
    const codes = document.querySelectorAll("code");
    const passwords = Array.from(codes).map((c) => c.textContent);
    const unique = new Set(passwords);
    expect(unique.size).toBe(20);
  });

  it("strength is Weak for short numeric-only password", () => {
    render(<PasswordGeneratorUI />);
    const checkboxes = screen.getAllByRole("checkbox");
    // Uncheck all except numbers
    fireEvent.click(checkboxes[0]); // uppercase off
    fireEvent.click(checkboxes[1]); // lowercase off
    fireEvent.click(checkboxes[3]); // symbols off
    // Set length to 8 via range input
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "8" } });
    fireEvent.click(screen.getByText("Generate"));
    // entropy = 8 * log2(10) ~= 26.6 -> Weak
    expect(screen.getByText("Weak")).toBeInTheDocument();
  });
});
