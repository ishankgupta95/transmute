import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { XmlFormatterUI } from "@/components/tools/XmlFormatterUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("XmlFormatterUI", () => {
  it("formats XML with indentation", () => {
    render(<XmlFormatterUI />);
    const input = screen.getByPlaceholderText(/root/);
    fireEvent.change(input, {
      target: { value: "<root><child>text</child></root>" },
    });
    fireEvent.click(screen.getByText("Format XML"));
    const pre = screen.getByText(
      (_, el) => el?.tagName === "PRE" && !!el.textContent,
    );
    // Should have indentation
    expect(pre.textContent).toContain("  ");
    expect(pre.textContent).toContain("<root>");
    expect(pre.textContent).toContain("<child>");
  });

  it("minifies XML (removes whitespace between tags)", () => {
    render(<XmlFormatterUI />);
    // Switch to minify mode
    fireEvent.click(screen.getByText("Minify"));
    const input = screen.getByPlaceholderText(/root/);
    fireEvent.change(input, {
      target: { value: "<root>\n  <child>text</child>\n</root>" },
    });
    fireEvent.click(screen.getByText("Minify XML"));
    const pre = screen.getByText(
      (_, el) => el?.tagName === "PRE" && !!el.textContent,
    );
    // Minified should not have whitespace between tags
    expect(pre.textContent).not.toContain("\n  ");
  });

  it("shows error for invalid XML", () => {
    render(<XmlFormatterUI />);
    const input = screen.getByPlaceholderText(/root/);
    fireEvent.change(input, { target: { value: "<root><unclosed>" } });
    fireEvent.click(screen.getByText("Format XML"));
    // DOMParser produces parsererror
    expect(
      screen.getByText((_, el) => {
        return el?.className?.includes("text-error") === true && !!el.textContent;
      }),
    ).toBeInTheDocument();
  });

  it("does nothing for empty input", () => {
    render(<XmlFormatterUI />);
    fireEvent.click(screen.getByText("Format XML"));
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("mode toggle changes button text", () => {
    render(<XmlFormatterUI />);
    expect(screen.getByText("Format XML")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Minify"));
    expect(screen.getByText("Minify XML")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Format"));
    expect(screen.getByText("Format XML")).toBeInTheDocument();
  });

  it("copies output to clipboard", () => {
    render(<XmlFormatterUI />);
    const input = screen.getByPlaceholderText(/root/);
    fireEvent.change(input, {
      target: { value: "<root><child/></root>" },
    });
    fireEvent.click(screen.getByText("Format XML"));
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });
});
