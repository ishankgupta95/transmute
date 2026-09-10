import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BarcodeGeneratorUI } from "@/components/tools/BarcodeGeneratorUI";
import { canvasToBlob, fillBackground, loadImage } from "@/lib/tools/canvas-utils";
import { triggerDownload } from "@/lib/utils/download";

/*
  jsdom has no canvas and no object URLs, so the two ends of the download path
  are stubbed and the wiring between them is what gets asserted: the size the
  PNG is rasterised at, and the name the file is saved under.
*/
vi.mock("@/lib/tools/canvas-utils", () => ({
  loadImage: vi.fn(async () => ({}) as HTMLImageElement),
  canvasToBlob: vi.fn(async () => new Blob(["png-bytes"], { type: "image/png" })),
  fillBackground: vi.fn(),
}));
vi.mock("@/lib/utils/download", () => ({ triggerDownload: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

/*
  ────────────────────────────────────────────────────────────────────────
  What this file is for.

  `barcode.test.ts` proves the DERIVED values are right and that a real
  decoder agrees with them. This file proves the page actually puts them on
  screen — which is a separate question, and the one that went wrong: the page
  printed the 12-digit UPC-A under a heading reading "What a scanner reads
  back" while three copy surfaces told the reader it printed the 13-digit
  EAN-13, and this site's own reader returns the 13-digit form. Nothing in the
  unit suite reads the rendered output, so the mismatch survived a green run.

  No canvas is needed for any of it: everything asserted here is derived as you
  type, or comes out of the DOM-free SVG path.
  ────────────────────────────────────────────────────────────────────────
*/

const typeInto = (value: string) => {
  const field = screen.getByLabelText(/^Text to encode as/);
  fireEvent.change(field, { target: { value } });
};

const pickSymbology = (name: string) => {
  fireEvent.change(screen.getByLabelText("Symbology"), { target: { value: name } });
};

/** The block headed "What a scanner reads back", or null before it appears. */
const scanBlock = () => {
  const heading = screen.queryByText("What a scanner reads back");
  return heading?.closest("div")?.parentElement ?? null;
};

/** The value in one OUTPUT row, by its label. */
const outputRow = (label: string) => {
  const cell = screen.queryByText(label);
  if (!cell?.parentElement) return null;
  return cell.parentElement.textContent?.replace(label, "").trim() ?? null;
};

describe("BarcodeGeneratorUI — what it prints for a UPC", () => {
  it("shows BOTH forms of a UPC-A: the 12 digits under the bars and the 13-digit EAN-13", () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("upca");
    typeInto("01234500005");

    const block = scanBlock();
    expect(block).not.toBeNull();
    // The number printed under the bars, and the one this site's own reader
    // returns for the very same symbol. Showing one alone is wrong for
    // whichever kind of reader the user happens to be holding.
    expect(block!.textContent).toContain("012345000058");
    expect(block!.textContent).toContain("0012345000058");

    expect(outputRow("Scans as")).toBe("012345000058");
    expect(outputRow("As EAN-13")).toBe("0012345000058");
  });

  it("shows both forms for a UPC-E as well, off its UPC-A expansion", () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("upce");
    typeInto("0123456");

    expect(scanBlock()!.textContent).toContain("012345000065");
    expect(scanBlock()!.textContent).toContain("0012345000065");
    expect(outputRow("As EAN-13")).toBe("0012345000065");
  });

  it("adds no second line to an EAN-13, which is already thirteen digits", () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("ean13");
    typeInto("590123412345");

    expect(scanBlock()!.textContent).toContain("5901234123457");
    expect(scanBlock()!.textContent).not.toContain("EAN-13");
    expect(outputRow("Scans as")).toBe("5901234123457");
    expect(screen.queryByText("As EAN-13")).toBeNull();
  });

  it("says nothing about a scanned value while the number is still wrong", () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("upca");
    typeInto("0123");
    expect(scanBlock()).toBeNull();
    expect(outputRow("Scans as")).toBe("—");
  });
});

describe("BarcodeGeneratorUI — the colour check", () => {
  it("refuses a colour pair that grades F instead of reporting READY over it", async () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("ean13");
    typeInto("590123412345");
    fireEvent.change(screen.getByLabelText("Bar colour"), { target: { value: "#eeeeee" } });

    expect(await screen.findByText(/15% symbol contrast/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate Barcode" }));

    // The header must not claim a result, and no image may appear.
    await waitFor(() => expect(screen.getByText("FIX THE ERRORS BELOW")).toBeTruthy());
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PNG" })).toBeNull();
  });

  it("refuses an inverted linear code but allows an inverted matrix one", async () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("ean13");
    typeInto("590123412345");
    fireEvent.change(screen.getByLabelText("Bar colour"), { target: { value: "#ffffff" } });
    fireEvent.change(screen.getByLabelText("Background colour"), { target: { value: "#000000" } });
    expect(await screen.findByText(/lighter than the background/)).toBeTruthy();
    expect(screen.getByText("FIX THE ERRORS BELOW")).toBeTruthy();

    // Same two colours, matrix symbology: a warning, and generation proceeds.
    pickSymbology("qrcode");
    typeInto("HELLO");
    expect(await screen.findByText(/Matrix readers usually cope/)).toBeTruthy();
    expect(screen.getByText("PRESS GENERATE")).toBeTruthy();
  });

  it("draws, and reports READY with the size, once the colours are legible", async () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("ean13");
    typeInto("590123412345");
    fireEvent.click(screen.getByRole("button", { name: "Generate Barcode" }));

    const image = await screen.findByRole("img");
    expect(image.getAttribute("alt")).toBe("EAN-13 barcode encoding 5901234123457");
    const width = Number(image.getAttribute("width"));
    const height = Number(image.getAttribute("height"));
    expect(width).toBeGreaterThan(0);
    // The header's size has to be the size actually drawn, not a guess.
    expect(screen.getByText(`READY · ${width}×${height} PNG · SVG`)).toBeTruthy();
    expect(outputRow("Image")).toBe(`${width} × ${height} px`);
  });
});

describe("BarcodeGeneratorUI — the length cap", () => {
  it("names Code 128's 500-character ceiling before Generate is pressed", () => {
    render(<BarcodeGeneratorUI />);
    typeInto("A".repeat(501));
    // Before this the pre-flight knew nothing about the cap, so the refusal
    // arrived after Generate as the engine's "The input data is too long."
    const message = screen.getByText(/stops at 500 characters/);
    expect(message.textContent).toContain("501");
    expect(screen.getByText("FIX THE ERRORS BELOW")).toBeTruthy();
  });

  it("says so under the picker too, rather than promising any length", () => {
    render(<BarcodeGeneratorUI />);
    expect(screen.getByText(/Any printable ASCII, up to 500 characters/)).toBeTruthy();
  });
});

describe("BarcodeGeneratorUI — the files the user actually downloads", () => {
  it("rasterises the PNG at the size shown on screen and names it after the payload", async () => {
    const drawImage = vi.fn();
    const context = { drawImage } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    try {
      render(<BarcodeGeneratorUI />);
      pickSymbology("ean13");
      typeInto("590123412345");
      fireEvent.click(screen.getByRole("button", { name: "Generate Barcode" }));
      const image = await screen.findByRole("img");
      const width = Number(image.getAttribute("width"));
      const height = Number(image.getAttribute("height"));

      fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
      await waitFor(() => expect(triggerDownload).toHaveBeenCalled());

      /*
        A PNG rasterised at anything other than the size the header quotes is
        a barcode drawn at a scale nobody asked for, and the bar widths are
        the whole symbol. The background is painted first because a
        transparent PNG is a barcode with no quiet zone.
      */
      expect(loadImage).toHaveBeenCalledOnce();
      expect(fillBackground).toHaveBeenCalledWith(context, width, height, "#ffffff");
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, width, height);
      const canvas = vi.mocked(canvasToBlob).mock.calls[0][0];
      expect([canvas.width, canvas.height]).toEqual([width, height]);
      expect(vi.mocked(canvasToBlob).mock.calls[0][1]).toBe("image/png");
      expect(vi.mocked(triggerDownload).mock.calls[0][1]).toBe("ean-13-590123412345.png");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("saves the SVG the preview was drawn from, not a second rendering", async () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("ean13");
    typeInto("590123412345");
    fireEvent.click(screen.getByRole("button", { name: "Generate Barcode" }));
    const image = await screen.findByRole("img");

    fireEvent.click(screen.getByRole("button", { name: "Download SVG" }));
    await waitFor(() => expect(triggerDownload).toHaveBeenCalled());
    const [blob, name] = vi.mocked(triggerDownload).mock.calls[0];
    expect(name).toBe("ean-13-590123412345.svg");
    expect(blob.type).toBe("image/svg+xml");
    // One drawing, three destinations: the bytes saved are the bytes shown.
    expect(decodeURIComponent(image.getAttribute("src")!.split(",")[1])).toBe(await blob.text());
  });

  it("offers neither download until the picture matches the settings", async () => {
    render(<BarcodeGeneratorUI />);
    pickSymbology("ean13");
    typeInto("590123412345");
    fireEvent.click(screen.getByRole("button", { name: "Generate Barcode" }));
    await screen.findByRole("img");
    expect(screen.getByRole("button", { name: "Download PNG" })).toBeTruthy();

    // Change one setting and the buttons go, because the file they would save
    // is a file for the previous number.
    typeInto("590123412346");
    expect(screen.queryByRole("button", { name: "Download PNG" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download SVG" })).toBeNull();
    expect(screen.getByText("PRESS GENERATE")).toBeTruthy();
  });
});

describe("BarcodeGeneratorUI — the prose next to the numbers", () => {
  it("describes the two UPC lines the page actually prints", () => {
    render(<BarcodeGeneratorUI />);
    const aside = screen.getByText(/The block on the left is not the text you typed/);
    // The old sentence said a UPC-A "comes back with a leading zero", full
    // stop, while the block showed only the twelve digits. Both halves have to
    // be described, because both are on screen.
    expect(aside.textContent).toMatch(/twelve-digit UPC-A/);
    expect(aside.textContent).toMatch(/thirteen-digit EAN-13/);
    expect(within(aside).queryByText(/comes back with a leading zero as the EAN-13/)).toBeNull();
  });
});
