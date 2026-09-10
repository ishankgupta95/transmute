import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

/*
  `unit/lib/line-tools.test.ts` proves the transform. This file proves the
  wiring: that a byte-order mark is reported on screen rather than silently
  relocated, that the pane headers agree with the counts printed inches above
  them, that a truncated pane says it is truncated, and that a paste-mode
  download is not named after the file that was dropped before it.

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

import { SortDedupeLinesUI } from "@/components/tools/SortDedupeLinesUI";

function makeFile(text: string, name: string): File {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type: "" });
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(buffer) });
  return file;
}

async function dropFile(text: string, name = "hosts.txt") {
  (globalThis as { __nextFile?: File }).__nextFile = makeFile(text, name);
  render(<SortDedupeLinesUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByLabelText("Source lines");
}

const warnings = () =>
  screen
    .queryAllByRole("status")
    .map((el) => el.textContent ?? "")
    .join(" | ");

/** The mono header strip of the pane whose body carries this aria-label. */
const paneHeader = (bodyLabel: string) =>
  screen.getByLabelText(bodyLabel).parentElement?.firstElementChild?.textContent ?? "";

const output = () => screen.getByLabelText("Sorted lines").textContent ?? "";

describe("SortDedupeLinesUI and the byte-order mark", () => {
  it("keeps the mark at the head of the result and says it found one", async () => {
    await dropFile("\uFEFFzebra\napple\nmango\n", "names.csv");
    expect(output()).toBe("\uFEFFapple\nmango\nzebra\n");
    expect(output().lastIndexOf("\uFEFF")).toBe(0);
    expect(warnings()).toContain("byte-order mark");
    expect(screen.getByText("Kept at the front")).toBeTruthy();
  });

  it("removes it on request", async () => {
    await dropFile("\uFEFFzebra\napple\n", "names.csv");
    fireEvent.click(screen.getByLabelText("Remove the UTF-8 byte-order mark"));
    expect(output()).toBe("apple\nzebra\n");
    expect(warnings()).toContain("it has been removed");
  });

  it("still counts a marked line as a duplicate of its unmarked twin", async () => {
    await dropFile("\uFEFFapi\napi\n");
    expect(output()).toBe("\uFEFFapi\n");
    expect(warnings()).toContain("1 duplicate line removed");
  });
});

describe("SortDedupeLinesUI pane headers", () => {
  it("counts CRLF lines the way the stat strip does, with no phantom last line", async () => {
    await dropFile("a\r\nb\r\nc\r\n");
    // The strip and the canvas header both derive 3 → 3 from splitLines; a
    // split("\n") count would say 4 in both panes.
    expect(paneHeader("Source lines")).toContain("3 LINES");
    expect(paneHeader("Sorted lines")).toContain("3 LINES");
  });

  it("counts a CR-only file, which a split on newlines reports as one line", async () => {
    await dropFile("a\rb\rc\r");
    expect(paneHeader("Source lines")).toContain("3 LINES");
    expect(paneHeader("Sorted lines")).toContain("3 LINES");
  });
});

describe("SortDedupeLinesUI truncation notice", () => {
  it("says how much of the result the pane is showing, and never cuts mid-line", async () => {
    const lines = Array.from({ length: 5_000 }, (_, i) => `host-${i}.example.com`);
    await dropFile(lines.join("\n") + "\n");

    const shown = output();
    // Cut at a break, so the last visible entry is a whole hostname rather than
    // the `host-2642.exam` a hard 40,000-character slice leaves behind.
    expect(shown.endsWith("\n")).toBe(true);
    expect(shown.length).toBeLessThan(40_000);

    const footnote = screen.getByText(/SHOWS THE FIRST/);
    expect(footnote.textContent).toContain(shown.length.toLocaleString());
    expect(footnote.textContent).toContain("108,890");
    expect(footnote.textContent).toContain("COPY AND DOWNLOAD CARRY ALL OF IT");
  });

  it("says nothing when the whole result fits", async () => {
    await dropFile("b\na\n");
    expect(screen.queryByText(/SHOWS THE FIRST/)).toBeNull();
  });
});

describe("SortDedupeLinesUI download name", () => {
  it("uses the dropped file's name in file mode", async () => {
    await dropFile("b\na\n", "hosts.txt");
    expect(screen.getByLabelText("Download hosts.sorted.txt")).toBeTruthy();
  });

  it("does not name pasted text after the file that was dropped before it", async () => {
    await dropFile("b\na\n", "hosts.txt");
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("Paste your lines"), {
      target: { value: "two\none\n" },
    });
    expect(screen.getByLabelText("Download lines.sorted.txt")).toBeTruthy();
    expect(screen.queryByLabelText("Download hosts.sorted.txt")).toBeNull();
  });
});
