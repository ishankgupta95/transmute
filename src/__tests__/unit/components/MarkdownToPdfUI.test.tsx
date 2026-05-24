import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/tools/markdown-to-pdf", () => ({
  renderMarkdown: vi.fn(async (md: string) => {
    if (!md.trim()) return "";
    if (md.includes("# Hello")) return "<h1>Hello</h1>";
    if (md.includes("**bold**")) return "<p><strong>bold</strong></p>";
    return `<p>${md}</p>`;
  }),
}));

vi.mock("@/lib/tools/markdown-pdf-print-css", () => ({
  buildPrintHtml: vi.fn(({ bodyHtml }: { bodyHtml: string }) =>
    `<!doctype html><html><body>${bodyHtml}</body></html>`,
  ),
}));

vi.mock("../../../components/tools/markdown-pdf/PrintFrame", () => ({
  PrintFrame: ({ onDone }: { onDone: () => void }) => {
    // Auto-complete the print cycle for tests.
    setTimeout(onDone, 0);
    return <div data-testid="print-frame-stub" />;
  },
}));

import { MarkdownToPdfUI } from "@/components/tools/MarkdownToPdfUI";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MarkdownToPdfUI", () => {
  it("renders the export button disabled when no markdown is present", () => {
    render(<MarkdownToPdfUI />);
    const btn = screen.getByRole("button", { name: /Export to PDF/i });
    expect(btn).toBeDisabled();
  });

  it("enables export once markdown is typed", () => {
    render(<MarkdownToPdfUI />);
    const ta = screen.getByLabelText("Markdown source") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "# Hello" } });
    const btn = screen.getByRole("button", { name: /Export to PDF/i });
    expect(btn).not.toBeDisabled();
  });

  it("renders a debounced live preview as the user types", async () => {
    render(<MarkdownToPdfUI />);
    const ta = screen.getByLabelText("Markdown source");
    fireEvent.change(ta, { target: { value: "# Hello" } });
    const preview = screen.getByTestId("markdown-pdf-preview");
    await waitFor(
      () => expect(preview.innerHTML).toContain("<h1>Hello</h1>"),
      { timeout: 2000 },
    );
  });

  it("preserves markdown state when toggling between paste and upload tabs", async () => {
    render(<MarkdownToPdfUI />);
    const ta = screen.getByLabelText("Markdown source") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "**bold**" } });
    expect(ta.value).toBe("**bold**");

    fireEvent.click(screen.getByRole("tab", { name: /Upload/i }));
    // After switch, the editable textarea is the same content.
    const editable = screen.getByLabelText(/Uploaded Markdown content/i) as HTMLTextAreaElement;
    expect(editable.value).toBe("**bold**");

    fireEvent.click(screen.getByRole("tab", { name: /Paste markdown/i }));
    const pasteAgain = screen.getByLabelText("Markdown source") as HTMLTextAreaElement;
    expect(pasteAgain.value).toBe("**bold**");
  });

  it("toggles theme and font controls update the live preview", async () => {
    const { renderMarkdown } = (await import("@/lib/tools/markdown-to-pdf")) as unknown as {
      renderMarkdown: ReturnType<typeof vi.fn>;
    };
    render(<MarkdownToPdfUI />);
    const ta = screen.getByLabelText("Markdown source");
    fireEvent.change(ta, { target: { value: "**bold**" } });
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    fireEvent.click(screen.getByRole("button", { name: "Sans" }));

    await waitFor(
      () => {
        const calls = renderMarkdown.mock.calls;
        expect(
          calls.some(([, opts]) => opts?.theme === "dark" && opts?.font === "sans"),
        ).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it("triggers the print frame when Export is clicked", async () => {
    render(<MarkdownToPdfUI />);
    const ta = screen.getByLabelText("Markdown source");
    fireEvent.change(ta, { target: { value: "# Hello" } });
    fireEvent.click(screen.getByRole("button", { name: /Export to PDF/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("print-frame-stub")).toBeInTheDocument(),
    );
  });
});
