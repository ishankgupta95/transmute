import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LoremIpsumGeneratorUI } from "@/components/tools/LoremIpsumGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("LoremIpsumGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders unit buttons and generate button", () => {
    render(<LoremIpsumGeneratorUI />);
    expect(screen.getByText("Paragraphs")).toBeInTheDocument();
    expect(screen.getByText("Sentences")).toBeInTheDocument();
    expect(screen.getByText("Words")).toBeInTheDocument();
    expect(screen.getByText("Generate")).toBeInTheDocument();
  });

  it("generates correct number of words", () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.click(screen.getByText("Words"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("Generate"));
    expect(screen.getByText("Output")).toBeInTheDocument();
    const outputDiv = document.querySelector(".whitespace-pre-wrap");
    const text = outputDiv!.textContent!;
    // Words output ends with a period, so split by space
    const words = text.replace(/\.$/, "").split(" ");
    expect(words).toHaveLength(10);
  });

  it("words output is exactly N words — no bolted-on sentence punctuation", () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.click(screen.getByText("Words"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByText("Generate"));
    const text = document.querySelector(".whitespace-pre-wrap")!.textContent!;
    expect(text).toMatch(/^Lorem /);
    expect(text.split(/\s+/)).toHaveLength(5);
    expect(text).not.toMatch(/\.$/);
  });

  it("generates correct number of sentences", () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.click(screen.getByText("Sentences"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByText("Generate"));
    const text = document.querySelector(".whitespace-pre-wrap")!.textContent!;
    // Sentences end with period followed by space (except last)
    // Count by splitting on ". " and adding 1 for incomplete trailing
    const sentenceEndings = text.match(/\./g);
    expect(sentenceEndings).toHaveLength(3);
  });

  it("generates correct number of paragraphs separated by double newlines", () => {
    render(<LoremIpsumGeneratorUI />);
    // Default is paragraphs
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByText("Generate"));
    const text = document.querySelector(".whitespace-pre-wrap")!.textContent!;
    // Paragraphs are separated by \n\n
    const paragraphs = text.split("\n\n");
    expect(paragraphs).toHaveLength(4);
  });

  it("each paragraph contains multiple sentences", () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByText("Generate"));
    const text = document.querySelector(".whitespace-pre-wrap")!.textContent!;
    const paragraphs = text.split("\n\n");
    paragraphs.forEach((p) => {
      const sentences = p.match(/\./g);
      // Each paragraph has 4 + (i % 3) sentences, so at least 4
      expect(sentences!.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("copies output to clipboard", () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("shows Copied! after clicking copy", async () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    fireEvent.click(screen.getByText("Copy"));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("does not show output before generation", () => {
    render(<LoremIpsumGeneratorUI />);
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("single word output is the bare word", () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.click(screen.getByText("Words"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("Generate"));
    const text = document.querySelector(".whitespace-pre-wrap")!.textContent!;
    expect(text).toBe("Lorem");
  });

  it("single sentence output works correctly", () => {
    render(<LoremIpsumGeneratorUI />);
    fireEvent.click(screen.getByText("Sentences"));
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("Generate"));
    const text = document.querySelector(".whitespace-pre-wrap")!.textContent!;
    expect(text).toBe(
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
    );
  });
});
