import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { minifyJson } from "@/lib/tools/json-format";

/*
  The minifier itself is covered in unit/lib. This file covers the readouts:
  that the pane and strip line counts are the file's real lines rather than a
  count of newline characters, that a pane cut at the preview cap says so, and
  that a paste-mode download is not named after the file dropped before it.

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

import { JsonMinifyUI } from "@/components/tools/JsonMinifyUI";

function makeFile(text: string, name: string): File {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type: "" });
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(buffer) });
  return file;
}

async function dropFile(text: string, name = "invoice-2026.json") {
  (globalThis as { __nextFile?: File }).__nextFile = makeFile(text, name);
  render(<JsonMinifyUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByLabelText("Source JSON");
}

/** The mono header strip of the pane whose body carries this aria-label. */
const paneHeader = (bodyLabel: string) =>
  screen.getByLabelText(bodyLabel).parentElement?.firstElementChild?.textContent ?? "";

describe("JsonMinifyUI line counts", () => {
  it("does not count a phantom line after the trailing newline", async () => {
    await dropFile('{\n  "a": 1\n}\n');
    // Three lines of JSON, terminated by a break. A split on "\n" says four.
    expect(paneHeader("Source JSON")).toContain("3 LINES");
    expect(paneHeader("Minified JSON")).toContain("1 LINES");
  });

  it("counts CRLF breaks, and the CRLF that terminates the file is not a line", async () => {
    await dropFile('{\r\n  "a": 1\r\n}\r\n');
    expect(paneHeader("Source JSON")).toContain("3 LINES");
  });

  it("counts a CR-only file, which a split on newlines reports as one line", async () => {
    await dropFile('{\r  "a": 1\r}');
    expect(paneHeader("Source JSON")).toContain("3 LINES");
  });
});

describe("JsonMinifyUI truncation notice", () => {
  it("says how much of the minified output the pane is showing", async () => {
    const source = JSON.stringify(
      Array.from({ length: 4_000 }, (_, i) => `value-${i}`),
      null,
      2,
    );
    const full = minifyJson(source);
    expect(full.length).toBeGreaterThan(40_000);

    await dropFile(source, "big.json");
    const shown = screen.getByLabelText("Minified JSON").textContent ?? "";
    expect(shown.length).toBe(40_000);

    const footnote = screen.getByText(/SHOWS THE FIRST/);
    expect(footnote.textContent).toContain("MINIFIED SHOWS THE FIRST 40,000 OF");
    expect(footnote.textContent).toContain(full.length.toLocaleString());
    expect(footnote.textContent).toContain("COPY AND DOWNLOAD CARRY ALL OF IT");
  });

  it("says nothing when the whole result fits", async () => {
    await dropFile('{"a":1}');
    expect(screen.queryByText(/SHOWS THE FIRST/)).toBeNull();
  });
});

describe("JsonMinifyUI download name", () => {
  it("uses the dropped file's name in file mode", async () => {
    await dropFile('{\n  "a": 1\n}\n', "invoice-2026.json");
    expect(screen.getByLabelText("Download invoice-2026.min.json")).toBeTruthy();
  });

  it("does not name pasted JSON after the file that was dropped before it", async () => {
    await dropFile('{\n  "a": 1\n}\n', "invoice-2026.json");
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("Paste your JSON"), {
      target: { value: '{"a": 1, "b": 2}' },
    });
    expect(screen.getByLabelText("Download data.min.json")).toBeTruthy();
    expect(screen.queryByLabelText("Download invoice-2026.min.json")).toBeNull();
  });
});
