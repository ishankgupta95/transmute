import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

/*
  `unit/lib/charset.test.ts` proves the decoder. This file covers the one thing
  it cannot: which SENTENCE the page puts on top of a given decode.

  The banner under test used to be gated on the bytes alone — every byte below
  0x80 — and so it fired for a UTF-16 read as well, asserting that the file was
  plain ASCII, that every encoding on the list agreed, and that the download
  would be byte-for-byte identical. For a UTF-16 read all three are false: the
  pane fills with CJK mojibake and 30 bytes in becomes 45 bytes out.

  DropZone is replaced with a button, the way SubtitleConverterUI's test does
  it — jsdom has no drag-and-drop and no File.arrayBuffer of its own.
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

import { CharsetConverterUI } from "@/components/tools/CharsetConverterUI";

function makeFile(bytes: Uint8Array, name: string): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type: "" });
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(buffer) });
  return file;
}

async function dropFile(bytes: Uint8Array, name = "notes.txt") {
  (globalThis as { __nextFile?: File }).__nextFile = makeFile(bytes, name);
  render(<CharsetConverterUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByLabelText("Decoded text");
}

/** Every disclosure on screen at once — several can render together. */
const warnings = () =>
  screen
    .queryAllByRole("status")
    .concat(screen.queryAllByRole("alert"))
    .map((el) => el.textContent ?? "")
    .join(" | ");

const readAs = (label: string) =>
  fireEvent.change(screen.getByLabelText("Read the file as"), {
    target: { value: label },
  });

const ASCII = new TextEncoder().encode("the quick brown fox jumps over");

/** "hello world abc" as BOM-less UTF-16LE: 30 bytes, every one of them < 0x80. */
const UTF16LE_ASCII_RANGE = (() => {
  const text = "hello world abc";
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) bytes[i * 2] = text.charCodeAt(i);
  return bytes;
})();

describe("CharsetConverterUI ASCII banner", () => {
  it("claims plain ASCII for a single-byte read, which is where the claim is true", async () => {
    await dropFile(ASCII);
    expect(warnings()).toContain("plain ASCII");
    expect(warnings()).toContain("byte-for-byte the same file");
    expect(screen.getByLabelText("Decoded text").textContent).toBe(
      "the quick brown fox jumps over",
    );
  });

  it("keeps the claim when a legacy codepage is forced, because ASCII really does agree", async () => {
    await dropFile(ASCII);
    readAs("shift_jis");
    expect(warnings()).toContain("plain ASCII");
    expect(screen.getByLabelText("Decoded text").textContent).toBe(
      "the quick brown fox jumps over",
    );
  });

  it("withdraws the claim for a forced UTF-16 read and names the mojibake", async () => {
    await dropFile(ASCII);
    readAs("utf-16le");

    // The pane is CJK mojibake and the download is 45 bytes for 30 in, so
    // "plain ASCII" and "byte-for-byte the same file" are both false here.
    expect(screen.getByLabelText("Decoded text").textContent).toBe(
      "桴⁥畱捩⁫牢睯⁮潦⁸番灭⁳癯牥",
    );
    expect(warnings()).not.toContain("plain ASCII");
    expect(warnings()).not.toContain("byte-for-byte");
    expect(warnings()).toContain("two bytes at a time");
  });

  it("does not claim ASCII over a sniffed UTF-16 file whose bytes are all below 0x80", async () => {
    await dropFile(UTF16LE_ASCII_RANGE, "utf16.txt");
    expect(screen.getByLabelText("Decoded text").textContent).toBe("hello world abc");
    expect(warnings()).toContain("UTF-16 with no byte-order mark");
    expect(warnings()).not.toContain("plain ASCII");
    // A guess is not the user's choice, so the mojibake sentence stays away too.
    expect(warnings()).not.toContain("two bytes at a time");
  });
});
