import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("marked", () => ({
  marked: {
    parse: vi.fn((md: string) => {
      if (md.includes("# Hello")) return "<h1>Hello</h1>\n";
      if (md.includes("**bold**")) return "<p><strong>bold</strong></p>\n";
      return `<p>${md}</p>\n`;
    }),
  },
}));

import { MarkdownToHtmlUI } from "@/components/tools/MarkdownToHtmlUI";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("MarkdownToHtmlUI", () => {
  it("converts markdown to HTML", () => {
    render(<MarkdownToHtmlUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "# Hello" } });
    // In preview mode, rendered HTML should appear
    const preview = screen.getByText("Hello");
    expect(preview.tagName).toBe("H1");
  });

  it("shows preview mode by default with rendered HTML", () => {
    render(<MarkdownToHtmlUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "**bold**" } });
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
  });

  it("shows raw HTML in html view mode", () => {
    render(<MarkdownToHtmlUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "# Hello" } });
    // Switch to HTML view
    fireEvent.click(screen.getByText("HTML"));
    const pre = screen.getByText(
      (_, el) =>
        el?.tagName === "PRE" &&
        el.textContent?.includes("<h1>Hello</h1>") === true,
    );
    expect(pre).toBeInTheDocument();
  });

  it("shows no output for empty input", () => {
    render(<MarkdownToHtmlUI />);
    // Should not show Copy button when input is empty
    expect(screen.queryByText("Copy HTML")).not.toBeInTheDocument();
  });

  it("copies HTML to clipboard", () => {
    render(<MarkdownToHtmlUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "# Hello" } });
    fireEvent.click(screen.getByText("Copy HTML"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("<h1>Hello</h1>\n");
  });

  it("can toggle between preview and HTML modes", () => {
    render(<MarkdownToHtmlUI />);
    const input = screen.getByPlaceholderText(/Hello World/);
    fireEvent.change(input, { target: { value: "# Hello" } });
    // Default is preview - we should see rendered h1
    expect(screen.getByText("Hello").tagName).toBe("H1");
    // Switch to HTML
    fireEvent.click(screen.getByText("HTML"));
    expect(screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent?.includes("<h1>") === true)).toBeInTheDocument();
    // Switch back to preview
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText("Hello").tagName).toBe("H1");
  });
});
