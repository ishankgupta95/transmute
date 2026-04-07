import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WordCounterUI } from "@/components/tools/WordCounterUI";

function typeText(text: string) {
  render(<WordCounterUI />);
  const textarea = screen.getByPlaceholderText(/start typing or paste/i);
  fireEvent.change(textarea, { target: { value: text } });
}

function getStatValue(label: string): string {
  const labelEl = screen.getByText(label);
  // The value is in a sibling <p> element before the label
  const container = labelEl.closest("div");
  const value = container?.querySelector("p.text-2xl");
  return value?.textContent ?? "";
}

describe("WordCounterUI", () => {
  describe("empty text", () => {
    it("returns all zeros for empty input", () => {
      typeText("");
      expect(getStatValue("Characters")).toBe("0");
      expect(getStatValue("Characters (no spaces)")).toBe("0");
      expect(getStatValue("Words")).toBe("0");
      expect(getStatValue("Sentences")).toBe("0");
      expect(getStatValue("Paragraphs")).toBe("0");
      expect(getStatValue("Reading Time")).toBe("< 1 min");
    });
  });

  describe("character counting", () => {
    it("counts total characters including spaces", () => {
      typeText("hello world");
      expect(getStatValue("Characters")).toBe("11");
    });

    it("counts characters without spaces", () => {
      typeText("hello world");
      expect(getStatValue("Characters (no spaces)")).toBe("10");
    });

    it("counts characters with multiple spaces", () => {
      typeText("a  b  c");
      expect(getStatValue("Characters")).toBe("7");
      expect(getStatValue("Characters (no spaces)")).toBe("3");
    });

    it("counts newlines and tabs as spaces (characters no spaces)", () => {
      typeText("a\tb\nc");
      expect(getStatValue("Characters")).toBe("5");
      expect(getStatValue("Characters (no spaces)")).toBe("3");
    });
  });

  describe("word counting", () => {
    it("counts words in a simple sentence", () => {
      typeText("hello world");
      expect(getStatValue("Words")).toBe("2");
    });

    it("handles single word", () => {
      typeText("hello");
      expect(getStatValue("Words")).toBe("1");
    });

    it("handles multiple spaces between words", () => {
      typeText("hello   world   test");
      expect(getStatValue("Words")).toBe("3");
    });

    it("handles leading and trailing spaces", () => {
      typeText("  hello world  ");
      expect(getStatValue("Words")).toBe("2");
    });

    it("counts zero words for whitespace-only input", () => {
      typeText("   ");
      expect(getStatValue("Words")).toBe("0");
    });
  });

  describe("sentence counting", () => {
    it("counts sentences with periods", () => {
      typeText("Hello world. How are you. Fine.");
      expect(getStatValue("Sentences")).toBe("3");
    });

    it("counts sentences with question marks and exclamation marks", () => {
      typeText("Hello! How are you? Fine.");
      expect(getStatValue("Sentences")).toBe("3");
    });

    it("counts one sentence for text with no punctuation but has words", () => {
      typeText("hello world");
      expect(getStatValue("Sentences")).toBe("1");
    });

    it("counts zero sentences for empty text", () => {
      typeText("");
      expect(getStatValue("Sentences")).toBe("0");
    });
  });

  describe("paragraph counting", () => {
    it("counts single paragraph", () => {
      typeText("This is one paragraph.");
      expect(getStatValue("Paragraphs")).toBe("1");
    });

    it("counts multiple paragraphs separated by blank lines", () => {
      typeText("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
      expect(getStatValue("Paragraphs")).toBe("3");
    });

    it("counts one paragraph for text with single newlines (no blank line)", () => {
      typeText("Line one.\nLine two.\nLine three.");
      expect(getStatValue("Paragraphs")).toBe("1");
    });

    it("counts zero paragraphs for empty text", () => {
      typeText("");
      expect(getStatValue("Paragraphs")).toBe("0");
    });
  });

  describe("reading time", () => {
    it("shows 1 min for very short text (ceil of 1/225)", () => {
      typeText("hello");
      // Math.ceil(1/225) = 1, so it shows "1 min"
      expect(getStatValue("Reading Time")).toBe("1 min");
    });

    it("shows 1 min for text up to 225 words", () => {
      const words = Array(225).fill("word").join(" ");
      typeText(words);
      expect(getStatValue("Reading Time")).toBe("1 min");
    });

    it("shows 2 min for text around 226-450 words", () => {
      const words = Array(226).fill("word").join(" ");
      typeText(words);
      expect(getStatValue("Reading Time")).toBe("2 min");
    });
  });

  describe("edge cases", () => {
    it("handles text with only punctuation", () => {
      typeText("...");
      expect(getStatValue("Words")).toBe("1");
      expect(getStatValue("Characters")).toBe("3");
    });

    it("handles text with mixed whitespace types", () => {
      typeText("a\t\nb");
      expect(getStatValue("Words")).toBe("2");
      expect(getStatValue("Characters (no spaces)")).toBe("2");
    });
  });
});
