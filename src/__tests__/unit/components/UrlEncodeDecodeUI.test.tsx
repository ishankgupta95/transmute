import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UrlEncodeDecodeUI } from "@/components/tools/UrlEncodeDecodeUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("UrlEncodeDecodeUI", () => {
  it("encodes special characters", () => {
    render(<UrlEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/Hello World & foo/);
    fireEvent.change(input, { target: { value: "Hello World & foo=bar" } });
    const output = screen.getByDisplayValue("Hello%20World%20%26%20foo%3Dbar");
    expect(output).toBeInTheDocument();
  });

  it("decodes encoded string", () => {
    render(<UrlEncodeDecodeUI />);
    fireEvent.click(screen.getByText("Decode"));
    const input = screen.getByPlaceholderText(/Hello%20World/);
    fireEvent.change(input, { target: { value: "Hello%20World%20%26%20foo%3Dbar" } });
    const output = screen.getByDisplayValue("Hello World & foo=bar");
    expect(output).toBeInTheDocument();
  });

  it("shows error for invalid percent-encoded string in decode mode", () => {
    render(<UrlEncodeDecodeUI />);
    fireEvent.click(screen.getByText("Decode"));
    const input = screen.getByPlaceholderText(/Hello%20World/);
    fireEvent.change(input, { target: { value: "%ZZ" } });
    expect(screen.getByText("Invalid percent-encoded string")).toBeInTheDocument();
  });

  it("produces no output for empty input", () => {
    render(<UrlEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/Hello World & foo/);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("mode toggle re-processes existing input", () => {
    render(<UrlEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/Hello World & foo/);
    fireEvent.change(input, { target: { value: "a&b" } });
    // Encode mode: should show a%26b
    expect(screen.getByDisplayValue("a%26b")).toBeInTheDocument();

    // Switch to decode - "a&b" decoded is still "a&b"
    fireEvent.click(screen.getByText("Decode"));
    // Both input and output are "a&b", verify the readonly output textarea exists
    const textareas = screen.getAllByDisplayValue("a&b");
    const readonlyTextarea = textareas.find(
      (el) => (el as HTMLTextAreaElement).readOnly,
    );
    expect(readonlyTextarea).toBeInTheDocument();
  });

  it("encodes unicode characters", () => {
    render(<UrlEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/Hello World & foo/);
    fireEvent.change(input, { target: { value: "cafe\u0301" } });
    const output = screen.getByDisplayValue("cafe%CC%81");
    expect(output).toBeInTheDocument();
  });

  it("copies output to clipboard", () => {
    render(<UrlEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/Hello World & foo/);
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it("handles whitespace-only input as no-op", () => {
    render(<UrlEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/Hello World & foo/);
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });
});
