import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegexTesterUI } from "@/components/tools/RegexTesterUI";

describe("RegexTesterUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders pattern input, flag buttons, and test string textarea", () => {
    render(<RegexTesterUI />);
    expect(screen.getByText("Regex Pattern")).toBeInTheDocument();
    expect(screen.getByText("Test String")).toBeInTheDocument();
    // Flag buttons
    ["g", "i", "m", "s", "u"].forEach((f) => {
      expect(screen.getByText(f)).toBeInTheDocument();
    });
  });

  it("matches a simple pattern", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, { target: { value: "hello" } });
    fireEvent.change(testInput, {
      target: { value: "say hello world hello" },
    });

    expect(screen.getByText("Matches (2)")).toBeInTheDocument();
  });

  it("matches with global flag finding multiple matches", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, { target: { value: "\\d+" } });
    fireEvent.change(testInput, {
      target: { value: "abc 123 def 456 ghi 789" },
    });

    expect(screen.getByText("Matches (3)")).toBeInTheDocument();
  });

  it("flag toggle works - disabling g flag finds only first match", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, { target: { value: "\\d+" } });
    fireEvent.change(testInput, {
      target: { value: "abc 123 def 456" },
    });

    // Disable global flag
    fireEvent.click(screen.getByText("g"));

    expect(screen.getByText("Matches (1)")).toBeInTheDocument();
  });

  it("case-insensitive flag works", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, { target: { value: "hello" } });
    fireEvent.change(testInput, {
      target: { value: "Hello HELLO hello" },
    });

    // With just g flag, only "hello" matches (1 match)
    expect(screen.getByText("Matches (1)")).toBeInTheDocument();

    // Enable i flag
    fireEvent.click(screen.getByText("i"));

    // Now all three match
    expect(screen.getByText("Matches (3)")).toBeInTheDocument();
  });

  it("extracts capture groups", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, {
      target: { value: "(\\w+)@(\\w+)" },
    });
    fireEvent.change(testInput, {
      target: { value: "user@example" },
    });

    expect(screen.getByText("Capture Groups")).toBeInTheDocument();
    expect(screen.getByText(/Group 1:/)).toBeInTheDocument();
    expect(screen.getByText(/Group 2:/)).toBeInTheDocument();
  });

  it("shows error for invalid regex", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, { target: { value: "[invalid" } });
    fireEvent.change(testInput, { target: { value: "test" } });

    // Should show error message
    const errorDiv = document.querySelector(".text-error");
    expect(errorDiv).not.toBeNull();
  });

  it("escapes HTML in output (no XSS)", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, { target: { value: "test" } });
    fireEvent.change(testInput, {
      target: { value: "<script>alert('xss')</script> test" },
    });

    const highlighted = screen.getByTestId("regex-highlight");
    // The raw HTML should contain escaped script tags, not actual script elements
    expect(highlighted.innerHTML).toContain("&lt;script&gt;");
    expect(highlighted.innerHTML).not.toContain("<script>");
  });

  it("does not show matches section when no pattern entered", () => {
    render(<RegexTesterUI />);
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );
    fireEvent.change(testInput, { target: { value: "some text" } });
    expect(screen.queryByText(/Matches/)).not.toBeInTheDocument();
  });

  it("does not show matches section when no test string entered", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    fireEvent.change(patternInput, { target: { value: "test" } });
    expect(screen.queryByText(/Matches/)).not.toBeInTheDocument();
  });

  it("handles zero-length matches without infinite loop", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    // Pattern that can match empty string
    fireEvent.change(patternInput, { target: { value: "a?" } });
    fireEvent.change(testInput, { target: { value: "abc" } });

    // Should not hang; should render matches
    const matchesLabel = screen.getByText(/Matches \(\d+\)/);
    expect(matchesLabel).toBeInTheDocument();
  });

  it("highlighted output wraps matches in mark tags", () => {
    render(<RegexTesterUI />);
    const patternInput = screen.getByPlaceholderText(
      /\[A-Za-z\]\+@/
    );
    const testInput = screen.getByPlaceholderText(
      "Enter text to test against..."
    );

    fireEvent.change(patternInput, { target: { value: "world" } });
    fireEvent.change(testInput, { target: { value: "hello world" } });

    const highlighted = screen.getByTestId("regex-highlight");
    expect(highlighted.innerHTML).toContain("<mark");
    expect(highlighted.innerHTML).toContain("world");
  });
});
