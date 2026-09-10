import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

/*
  `unit/lib/line-tools.test.ts` proves convertLineEndings. This file covers the
  two readouts the engine cannot: that a pane cut at the preview cap says so —
  it arrives sooner here than anywhere else, because with the ␍␊ marks on every
  CRLF becomes three characters — and that a paste-mode download is not named
  after the file dropped before it.

  DropZone is replaced with a button — jsdom has no drag-and-drop and no
  File.arrayBuffer of its own.
*/

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button
      onClick={() => onFiles([(globalThis as { __nextFile?: File }).__nextFile as File])}
    >
      drop
    </button>
  ),
}));

import { CrlfLfUI } from "@/components/tools/CrlfLfUI";

function makeFile(text: string, name: string): File {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type: "" });
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(buffer) });
  return file;
}

async function dropFile(text: string, name = "report.log") {
  (globalThis as { __nextFile?: File }).__nextFile = makeFile(text, name);
  render(<CrlfLfUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByLabelText("Source text");
}

const output = () => screen.getByLabelText("Converted text").textContent ?? "";

describe("CrlfLfUI truncation notice", () => {
  it("says how much of each pane it is showing, and counts the marks it drew", async () => {
    // 4,000 CRLF-terminated lines. Every figure below is derived from this one
    // string rather than asserted, because each of the four is a different
    // number: one CRLF is two characters in the file, three in a marked pane.
    const source = Array.from({ length: 4_000 }, (_, i) => `line ${i}`).join("\r\n") + "\r\n";
    const lfOutput = source.length - 4_000; // one character per CRLF collapsed
    const markedSource = source.length + 4_000; // "\r\n" drawn as "␍␊\n"
    const markedOutput = lfOutput + 4_000; // "\n" drawn as "␊\n"
    expect(lfOutput).toBeLessThan(40_000);
    expect(markedOutput).toBeGreaterThan(40_000);

    await dropFile(source);

    const shown = output();
    expect(shown.length).toBeLessThan(40_000);
    // Cut at a break, so the pane does not stop in the middle of a token.
    expect(shown.endsWith("\n")).toBe(true);

    const shownSource = screen.getByLabelText("Source text").textContent ?? "";
    const marked = screen.getByText(/SHOWS THE FIRST/).textContent ?? "";
    expect(marked).toContain(`SOURCE SHOWS THE FIRST ${shownSource.length.toLocaleString()} OF ${markedSource.toLocaleString()} CHARACTERS (␍␊ MARKS INCLUDED)`);
    expect(marked).toContain(`OUTPUT SHOWS THE FIRST ${shown.length.toLocaleString()} OF ${markedOutput.toLocaleString()} CHARACTERS (␍␊ MARKS INCLUDED)`);
    expect(marked).toContain("COPY AND DOWNLOAD CARRY ALL OF IT");

    // Turning the marks off makes the LF output fit, so its notice goes away
    // rather than repeating a stale total.
    fireEvent.click(screen.getByLabelText("Show ␍ and ␊ in the panes"));
    const plain = screen.getByText(/SHOWS THE FIRST/).textContent ?? "";
    expect(plain).not.toContain("MARKS INCLUDED");
    expect(plain).toContain(`OF ${source.length.toLocaleString()} CHARACTERS`);
    expect(plain).not.toContain("OUTPUT SHOWS THE FIRST");
    expect((screen.getByLabelText("Converted text").textContent ?? "").length).toBe(lfOutput);
  });

  it("says nothing when the whole result fits", async () => {
    await dropFile("a\r\nb\r\n");
    expect(screen.queryByText(/SHOWS THE FIRST/)).toBeNull();
  });
});

describe("CrlfLfUI download name", () => {
  it("uses the dropped file's name in file mode", async () => {
    await dropFile("a\r\nb\r\n", "report.log");
    expect(screen.getByLabelText("Download report.lf.log")).toBeTruthy();
  });

  it("does not name pasted text after the file that was dropped before it", async () => {
    await dropFile("a\r\nb\r\n", "report.log");
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("Paste your text"), {
      target: { value: "one\ntwo\n" },
    });
    expect(screen.getByLabelText("Download text.lf.txt")).toBeTruthy();
    expect(screen.queryByLabelText("Download report.lf.log")).toBeNull();
  });
});
