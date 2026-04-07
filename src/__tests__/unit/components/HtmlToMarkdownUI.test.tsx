import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTurndown } = vi.hoisted(() => {
  const mockTurndown = vi.fn((html: string) => {
    if (html.includes("FAIL_TRIGGER")) throw new Error("Conversion failed");
    if (html.includes("<h1>")) return "# Hello";
    if (html.includes("<strong>")) return "**bold**";
    if (html.includes("<pre><code>")) return "```\ncode\n```";
    return "converted markdown";
  });
  return { mockTurndown };
});

vi.mock("turndown", () => {
  function MockTurndownService() {
    return { turndown: mockTurndown };
  }
  return { default: MockTurndownService };
});

import { HtmlToMarkdownUI } from "@/components/tools/HtmlToMarkdownUI";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("HtmlToMarkdownUI", () => {
  it("converts HTML to markdown", () => {
    render(<HtmlToMarkdownUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "<p>Hello</p>" } });
    fireEvent.click(screen.getByText("Convert to Markdown"));
    expect(screen.getByText("converted markdown")).toBeInTheDocument();
  });

  it("handles heading conversion", () => {
    render(<HtmlToMarkdownUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "<h1>Hello</h1>" } });
    fireEvent.click(screen.getByText("Convert to Markdown"));
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "PRE" && el.textContent?.includes("# Hello") === true,
      ),
    ).toBeInTheDocument();
  });

  it("handles code blocks", () => {
    render(<HtmlToMarkdownUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, {
      target: { value: "<pre><code>const x = 1;</code></pre>" },
    });
    fireEvent.click(screen.getByText("Convert to Markdown"));
    expect(
      screen.getByText(
        (_, el) =>
          el?.tagName === "PRE" && el.textContent?.includes("```") === true,
      ),
    ).toBeInTheDocument();
  });

  it("shows error on conversion failure", () => {
    render(<HtmlToMarkdownUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "FAIL_TRIGGER" } });
    fireEvent.click(screen.getByText("Convert to Markdown"));
    expect(screen.getByText("Conversion failed")).toBeInTheDocument();
  });

  it("does nothing for empty input", () => {
    render(<HtmlToMarkdownUI />);
    fireEvent.click(screen.getByText("Convert to Markdown"));
    expect(screen.queryByText("Markdown Output")).not.toBeInTheDocument();
  });

  it("copies output to clipboard", () => {
    render(<HtmlToMarkdownUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "<p>text</p>" } });
    fireEvent.click(screen.getByText("Convert to Markdown"));
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
