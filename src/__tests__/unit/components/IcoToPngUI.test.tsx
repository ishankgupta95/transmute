import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
  THE COPY GATE for ico-to-png.

  The differentiator over a one-line canvas convert is that this tool reads the
  icon directory itself, so it can offer EVERY size instead of whichever one
  the browser's decoder happens to prefer. Two claims ride on that, and both
  are per-entry rather than per-file:

    - a PNG entry is copied out as a byte slice, so it is genuinely lossless;
    - a BMP entry is decoded and written out again, so it is not.

  Both are read off `IcoEntry.lossless`, which the parser sets, and the
  fixtures below are real containers — a mixed PNG+BMP .ico built to the
  layout in the ICO spec, with the BMP entry carrying the doubled `biHeight`
  that makes a naive parser produce a double-height image.

  `parseIco` and `extractIcoEntry` are NOT mocked: the byte-level truth is the
  thing under test, and mocking it would leave the badges asserting themselves.
*/

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <>
      <button onClick={() => onFiles([makeFile(mixedIco(), "favicon.ico")])}>drop mixed</button>
      <button onClick={() => onFiles([makeFile(pngOnlyIco(), "made-here.ico")])}>
        drop png-only
      </button>
      <button onClick={() => onFiles([makeFile(sameSizeIco(), "two-depths.ico")])}>
        drop same-size
      </button>
      <button onClick={() => onFiles([makeFile(overclaimedIco(), "phantom.ico")])}>
        drop overclaimed
      </button>
      <button onClick={() => onFiles([makeFile(oneBmpAmongPngsIco(), "mostly-png.ico")])}>
        drop one-bmp
      </button>
      <button onClick={() => onFiles([makeFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "not.ico")])}>
        drop junk
      </button>
    </>
  ),
}));

import { IcoToPngUI } from "@/components/tools/IcoToPngUI";

// ── fixtures: real containers, built byte by byte ─────────────────

/** A PNG whose signature and IHDR are real; nothing decodes it here. */
function pngEntry(size: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  new DataView(out.buffer).setUint32(8, 13); // IHDR length
  out.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(out.buffer).setUint32(16, size);
  new DataView(out.buffer).setUint32(20, size);
  return out;
}

/**
 * A BMP entry: BITMAPINFOHEADER plus room for the pixels. `biHeight` is
 * DOUBLE the picture height — the XOR image and the AND mask stacked — which
 * is the trap the parser has to know about and this fixture exists to prove.
 */
function bmpEntry(size: number, bitCount = 32): Uint8Array {
  // DIB rows are padded to a 4-byte boundary, and a depth of 8 or less carries
  // a full palette between the header and the pixels — both of which the
  // parser has to count when it checks the payload holds the picture.
  const rowBytes = Math.ceil((size * bitCount) / 32) * 4;
  const paletteBytes = bitCount <= 8 ? (1 << bitCount) * 4 : 0;
  const maskRow = Math.ceil(size / 32) * 4;
  const out = new Uint8Array(40 + paletteBytes + rowBytes * size + maskRow * size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 40, true); // biSize
  view.setInt32(4, size, true); // biWidth
  view.setInt32(8, size * 2, true); // biHeight — doubled
  view.setUint16(12, 1, true); // biPlanes
  view.setUint16(14, bitCount, true); // biBitCount
  return out;
}

interface IcoOptions {
  /** 1 = icon, 2 = cursor. */
  type?: number;
  /** The bit depth each directory row declares; 32 where unstated. */
  bpps?: number[];
  /** The image count the ICONDIR states, when it is a lie. */
  count?: number;
}

function buildIco(parts: Uint8Array[], { type = 1, bpps, count }: IcoOptions = {}): Uint8Array {
  const headerBytes = 6 + 16 * parts.length;
  const total = headerBytes + parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, type, true); // 1 = icon, 2 = cursor
  view.setUint16(4, count ?? parts.length, true);
  let offset = headerBytes;
  parts.forEach((part, i) => {
    const at = 6 + i * 16;
    // Deliberately left at 0 in the directory so the parser has to read the
    // real size out of the payload — which is what it promises to do.
    out[at] = 0;
    out[at + 1] = 0;
    view.setUint16(at + 4, 1, true); // planes
    view.setUint16(at + 6, bpps?.[i] ?? 32, true); // bpp
    view.setUint32(at + 8, part.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

/** 16×16 stored as a bitmap, 32×32 stored as a PNG — in one file. */
function mixedIco(): Uint8Array {
  return buildIco([bmpEntry(16), pngEntry(32)]);
}

/** What this site's own png-to-ico writes: every entry a PNG. */
function pngOnlyIco(): Uint8Array {
  return buildIco([pngEntry(16), pngEntry(32), pngEntry(48)]);
}

/**
 * The classic Windows shape: the SAME pixel size twice, at two colour depths.
 * Size alone cannot name these two apart, and naming both `icon-32x32.png`
 * hands over two downloads whose second overwrites the first on disk.
 */
function sameSizeIco(): Uint8Array {
  return buildIco([bmpEntry(32, 4), bmpEntry(32, 32)], { bpps: [4, 32] });
}

/**
 * A directory that states four images over a file holding one. `parseIco`
 * keeps the readable entry and counts the other three, and this page is the
 * only place the user is ever told they were dropped.
 */
function overclaimedIco(): Uint8Array {
  return buildIco([bmpEntry(16)], { count: 4 });
}

/**
 * Three PNG entries and one bitmap, with the bitmap third of four — the
 * reviewer's arrangement. The PNG entries are byte slices that cannot fail;
 * only the bitmap runs a decode, so it is the only entry a failing browser can
 * take down, and it must not take the other three with it.
 */
function oneBmpAmongPngsIco(): Uint8Array {
  return buildIco([pngEntry(16), pngEntry(32), bmpEntry(48), pngEntry(64)]);
}

function makeFile(bytes: Uint8Array, name: string): File {
  const file = new File([bytes as BlobPart], name, { type: "image/x-icon" });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(bytes.buffer.slice(0)),
  });
  return file;
}

async function drop(which: "mixed" | "png-only" | "same-size" | "overclaimed" | "one-bmp" | "junk") {
  render(<IcoToPngUI acceptFormats=".ico" />);
  fireEvent.click(screen.getByText(`drop ${which}`));
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:ico");
  URL.revokeObjectURL = vi.fn();
  // jsdom has no 2D context; the BMP arm draws into one.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback) {
    cb(new Blob([new Uint8Array(120)], { type: "image/png" }));
  };
  // The BMP arm hands its rebuilt one-entry .ico to an <img>, which jsdom
  // never loads. Only the decode is faked — the bytes reaching it are real.
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    set() {
      setTimeout(() => this.onload?.(new Event("load")));
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IcoToPngUI — it reads the directory rather than trusting one decode", () => {
  it("lists every image in the file, at the size the payload declares", async () => {
    await drop("mixed");

    // The directory bytes for both entries say 0×0. These sizes can only have
    // come from the PNG's IHDR and the BMP's own header.
    expect(await screen.findByText("16×16")).toBeInTheDocument();
    expect(screen.getByText("32×32")).toBeInTheDocument();
  });

  it("halves the doubled biHeight a BMP entry carries", async () => {
    await drop("mixed");

    // biHeight is 32 in the fixture. A parser that trusted it would render a
    // 16×32 tile with garbage in the bottom half.
    expect(await screen.findByText("16×16")).toBeInTheDocument();
    expect(screen.queryByText("16×32")).toBeNull();
  });

  it("badges each entry by how it is stored, not by the file's extension", async () => {
    await drop("mixed");

    expect(await screen.findByText("PNG · BYTE SLICE")).toBeInTheDocument();
    expect(screen.getByText("BMP · RE-ENCODED")).toBeInTheDocument();
  });

  it("puts a sentence on screen when the bytes are not an icon at all", async () => {
    await drop("junk");

    expect(await screen.findByRole("alert")).toHaveTextContent(/not an icon file/i);
  });
});

describe("IcoToPngUI — the lossless claim is per entry, and comes off the parse", () => {
  it("claims nothing about the whole run when one entry was re-encoded", async () => {
    await drop("mixed");
    fireEvent.click(await screen.findByRole("button", { name: /^Extract 2 PNGs$/ }));

    await waitFor(() =>
      expect(screen.getByText(/1 of 2 icons were stored as bitmaps/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/EVERY ICON CAME OUT AS THE PNG ALREADY INSIDE THE FILE/),
    ).toBeNull();
  });

  it("makes the byte-slice claim when every entry actually earned it", async () => {
    await drop("png-only");
    fireEvent.click(await screen.findByRole("button", { name: /^Extract 3 PNGs$/ }));

    await waitFor(() =>
      expect(
        screen.getByText(/EVERY ICON CAME OUT AS THE PNG ALREADY INSIDE THE FILE/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/were stored as bitmaps/)).toBeNull();
  });
});

describe("IcoToPngUI — the user picks the sizes", () => {
  it("counts the primary off the selection, and drops one when a tile is clicked", async () => {
    await drop("png-only");

    await screen.findByRole("button", { name: /^Extract 3 PNGs$/ });
    fireEvent.click(screen.getByRole("button", { name: /^16 × 16,/ }));
    expect(screen.getByRole("button", { name: /^Extract 2 PNGs$/ })).toBeInTheDocument();
  });

  it("will not run with nothing selected", async () => {
    await drop("png-only");

    await screen.findByRole("button", { name: /^Extract 3 PNGs$/ });
    fireEvent.click(screen.getByText("Deselect all"));
    expect(screen.getByRole("button", { name: /^Extract 0 PNGs$/ })).toBeDisabled();
  });

  it("names each download by the size it came from", async () => {
    await drop("png-only");
    fireEvent.click(await screen.findByRole("button", { name: /^Extract 3 PNGs$/ }));

    expect(
      await screen.findByRole("button", { name: "Download made-here-48x48.png" }),
    ).toBeInTheDocument();
  });

  it("tells two same-size entries apart by depth, so one download cannot overwrite the other", async () => {
    // 32×32 at 4-bit beside 32×32 at 32-bit is the classic Windows favicon
    // shape. Named on size alone both are `two-depths-32x32.png`, and the
    // second one saved replaces the first — silent loss, in the one tool whose
    // whole promise is that it gives you EVERY image in the container.
    await drop("same-size");
    fireEvent.click(await screen.findByRole("button", { name: /^Extract 2 PNGs$/ }));

    expect(
      await screen.findByRole("button", { name: "Download two-depths-32x32-4bit.png" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download two-depths-32x32-32bit.png" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download two-depths-32x32.png" })).toBeNull();
  });
});

describe("IcoToPngUI — a partly broken container is disclosed, not papered over", () => {
  it("says how many images the directory declared and the file does not hold", async () => {
    await drop("overclaimed");

    // The only place the user is ever told three sizes went missing.
    expect(
      await screen.findByText(/3 of the 4 images this file's directory declares cannot be unpacked/),
    ).toBeInTheDocument();
  });

  it("sizes the Directory row off the directory, not off the entries that survived", async () => {
    await drop("overclaimed");

    // 6-byte ICONDIR + 4 × 16-byte rows. Counted off the survivor alone this
    // read "1 ENTRIES, 22 BYTES" — contradicting, in the same view, the
    // warning that says the directory declares MORE than the file holds.
    expect(await screen.findByText("4 ENTRIES (1 READABLE), 70 BYTES")).toBeInTheDocument();
  });

  it("keeps every icon that came out when one entry fails mid-run", async () => {
    // The three PNG entries are byte slices and cannot fail; only the 48×48
    // bitmap runs a decode. Make its canvas export fail — the exact failure
    // the reviewer reproduced in Chrome with a corrupt DIB — and the three
    // finished PNGs must survive it.
    HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback) {
      cb(null);
    };
    await drop("one-bmp");
    fireEvent.click(await screen.findByRole("button", { name: /^Extract 4 PNGs$/ }));

    expect(
      await screen.findByRole("button", { name: "Download mostly-png-16x16.png" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download mostly-png-32x32.png" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download mostly-png-64x64.png" }),
    ).toBeInTheDocument();

    // And the one that did not is named, with the reason the failing call gave.
    expect(screen.getByText(/3 of 4 selected icons came out/)).toBeInTheDocument();
    expect(screen.getByText(/The 48×48 entry could not be extracted — Canvas export failed/),
    ).toBeInTheDocument();
    // Losing one entry is not a failed run, so there is no error banner.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("calls the run failed only when nothing at all came out", async () => {
    HTMLCanvasElement.prototype.toBlob = function toBlob(cb: BlobCallback) {
      cb(null);
    };
    await drop("same-size"); // both entries are bitmaps, so both fail
    fireEvent.click(await screen.findByRole("button", { name: /^Extract 2 PNGs$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /None of the 2 selected icons could be extracted: Canvas export failed/,
    );
  });
});
