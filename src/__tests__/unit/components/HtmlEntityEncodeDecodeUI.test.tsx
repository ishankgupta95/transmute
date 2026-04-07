import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HtmlEntityEncodeDecodeUI } from "@/components/tools/HtmlEntityEncodeDecodeUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("HtmlEntityEncodeDecodeUI", () => {
  it("encodes all 5 special characters (&, <, >, \", ')", () => {
    render(<HtmlEntityEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/<p>Hello/);
    fireEvent.change(input, {
      target: { value: `& < > " '` },
    });
    const output = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    expect(output.value).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("encodes ampersand in mixed text", () => {
    render(<HtmlEntityEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/<p>Hello/);
    fireEvent.change(input, {
      target: { value: '<p>Hello & "World"</p>' },
    });
    const output = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    expect(output.value).toBe(
      "&lt;p&gt;Hello &amp; &quot;World&quot;&lt;/p&gt;",
    );
  });

  it("decodes HTML entities", () => {
    render(<HtmlEntityEncodeDecodeUI />);
    fireEvent.click(screen.getByText("Decode"));
    const input = screen.getByPlaceholderText(/&lt;p&gt;/);
    fireEvent.change(input, {
      target: { value: "&lt;p&gt;Hello &amp; &quot;World&quot;&lt;/p&gt;" },
    });
    const output = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    expect(output.value).toBe('<p>Hello & "World"</p>');
  });

  it("round-trip: encode then decode produces original text", () => {
    const original = '<script>alert("xss")</script>';
    render(<HtmlEntityEncodeDecodeUI />);
    // Encode
    const input = screen.getByPlaceholderText(/<p>Hello/);
    fireEvent.change(input, { target: { value: original } });
    const encodedOutput = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    const encoded = encodedOutput.value;

    // Switch to decode and feed the encoded value
    fireEvent.click(screen.getByText("Decode"));
    const decodeInput = screen.getByPlaceholderText(/&lt;p&gt;/);
    fireEvent.change(decodeInput, { target: { value: encoded } });
    const decodedOutput = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    expect(decodedOutput.value).toBe(original);
  });

  it("produces no output for empty input", () => {
    render(<HtmlEntityEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/<p>Hello/);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("Output")).not.toBeInTheDocument();
  });

  it("mode toggle re-processes existing input", () => {
    render(<HtmlEntityEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/<p>Hello/);
    fireEvent.change(input, { target: { value: "&" } });
    // In encode mode: & -> &amp;
    let output = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    expect(output.value).toBe("&amp;");

    // Switch to decode: & decoded is just &
    fireEvent.click(screen.getByText("Decode"));
    output = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    expect(output.value).toBe("&");
  });

  it("copies output to clipboard", () => {
    render(<HtmlEntityEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/<p>Hello/);
    fireEvent.change(input, { target: { value: "<div>" } });
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it("handles text with no special chars (passthrough)", () => {
    render(<HtmlEntityEncodeDecodeUI />);
    const input = screen.getByPlaceholderText(/<p>Hello/);
    fireEvent.change(input, { target: { value: "Hello World" } });
    const output = screen.getAllByRole("textbox").filter(
      (el) => (el as HTMLTextAreaElement).readOnly,
    )[0] as HTMLTextAreaElement;
    expect(output.value).toBe("Hello World");
  });
});
