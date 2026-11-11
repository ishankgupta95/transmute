import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the diff library before importing the component
const mockDiffWords = vi.fn();
const mockDiffLines = vi.fn();

vi.mock("diff", () => ({
  diffWords: (...args: unknown[]) => mockDiffWords(...args),
  diffLines: (...args: unknown[]) => mockDiffLines(...args),
}));

import { TextDiffUI } from "@/components/tools/TextDiffUI";

beforeEach(() => {
  mockDiffWords.mockReset();
  mockDiffLines.mockReset();
  // Default: return empty array
  mockDiffWords.mockReturnValue([]);
  mockDiffLines.mockReturnValue([]);
});

function getOriginalTextarea() {
  return screen.getByPlaceholderText(/paste original text/i);
}

function getModifiedTextarea() {
  return screen.getByPlaceholderText(/paste modified text/i);
}

describe("TextDiffUI", () => {
  it("renders both text areas and mode buttons", () => {
    render(<TextDiffUI />);
    expect(getOriginalTextarea()).toBeInTheDocument();
    expect(getModifiedTextarea()).toBeInTheDocument();
    expect(screen.getByText("By word")).toBeInTheDocument();
    expect(screen.getByText("By line")).toBeInTheDocument();
    expect(screen.getByText("Swap")).toBeInTheDocument();
  });

  it("uses diffWords in by-word mode (default)", () => {
    mockDiffWords.mockReturnValue([
      { value: "hello ", added: false, removed: false },
      { value: "world", added: false, removed: true },
      { value: "there", added: true, removed: false },
    ]);

    render(<TextDiffUI />);
    const original = getOriginalTextarea();
    const modified = getModifiedTextarea();

    fireEvent.change(original, { target: { value: "hello world" } });
    fireEvent.change(modified, { target: { value: "hello there" } });

    expect(mockDiffWords).toHaveBeenCalledWith("hello world", "hello there");
    expect(mockDiffLines).not.toHaveBeenCalled();
  });

  it("uses diffLines in by-line mode", () => {
    mockDiffLines.mockReturnValue([
      { value: "line one\n", added: false, removed: false },
      { value: "line two\n", added: false, removed: true },
      { value: "line three\n", added: true, removed: false },
    ]);

    render(<TextDiffUI />);
    fireEvent.click(screen.getByText("By line"));

    const original = getOriginalTextarea();
    const modified = getModifiedTextarea();

    fireEvent.change(original, { target: { value: "line one\nline two\n" } });
    fireEvent.change(modified, { target: { value: "line one\nline three\n" } });

    // `ignoreNewlineAtEof` is load-bearing: without it an unchanged last line
    // with no trailing newline diffs as removed + re-added (see TextDiffUI).
    expect(mockDiffLines).toHaveBeenCalledWith(
      "line one\nline two\n",
      "line one\nline three\n",
      { ignoreNewlineAtEof: true },
    );
  });

  it("shows diff output with added, removed, and unchanged parts", () => {
    mockDiffWords.mockReturnValue([
      { value: "hello ", added: false, removed: false },
      { value: "world", removed: true, added: false },
      { value: "there", added: true, removed: false },
    ]);

    render(<TextDiffUI />);
    fireEvent.change(getOriginalTextarea(), { target: { value: "hello world" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "hello there" } });

    // Diff section should have content rendered
    expect(screen.getByText("Diff")).toBeInTheDocument();
    // Verify the diff container has the expected span elements
    // The diff parts sit in the pane body, a sibling of the pane's header row.
    const diffContainer = screen
      .getByText("Diff")
      .closest("div")!
      .parentElement!.querySelector("div:last-child")!;
    const spans = diffContainer.querySelectorAll("span");
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toBe("hello ");
    expect(spans[1].textContent).toBe("world");
    expect(spans[2].textContent).toBe("there");
    // Check styling: removed has line-through, added has success color
    expect(spans[1].className).toContain("line-through");
    expect(spans[2].className).toContain("success");
  });

  it("does not show diff section when both inputs are empty", () => {
    render(<TextDiffUI />);
    expect(screen.queryByText("Diff")).not.toBeInTheDocument();
  });

  it("shows no diff parts for identical texts", () => {
    mockDiffWords.mockReturnValue([
      { value: "same text", added: false, removed: false },
    ]);

    render(<TextDiffUI />);
    fireEvent.change(getOriginalTextarea(), { target: { value: "same text" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "same text" } });

    // Should show diff area but no added/removed spans
    expect(screen.getByText("Diff")).toBeInTheDocument();
    // "same text" appears in textareas and the diff span
    expect(screen.getAllByText("same text").length).toBeGreaterThanOrEqual(1);
  });

  it("swap button exchanges original and modified text", () => {
    mockDiffWords.mockReturnValue([]);

    render(<TextDiffUI />);
    const original = getOriginalTextarea();
    const modified = getModifiedTextarea();

    fireEvent.change(original, { target: { value: "text A" } });
    fireEvent.change(modified, { target: { value: "text B" } });

    fireEvent.click(screen.getByText("Swap"));

    expect(original).toHaveValue("text B");
    expect(modified).toHaveValue("text A");
  });

  it("switches from by-word to by-line mode and re-computes diff", () => {
    mockDiffWords.mockReturnValue([
      { value: "abc", added: false, removed: false },
    ]);
    mockDiffLines.mockReturnValue([
      { value: "abc\n", added: false, removed: false },
    ]);

    render(<TextDiffUI />);
    fireEvent.change(getOriginalTextarea(), { target: { value: "abc" } });
    fireEvent.change(getModifiedTextarea(), { target: { value: "abc" } });

    // Initially by-word mode uses diffWords
    expect(mockDiffWords).toHaveBeenCalled();

    // Switch to by-line
    fireEvent.click(screen.getByText("By line"));

    expect(mockDiffLines).toHaveBeenCalledWith("abc", "abc", { ignoreNewlineAtEof: true });
  });
});
