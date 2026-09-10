import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DpiFieldReading,
  ImageDpiReading,
  ReadImageDpiResult,
  SetImageDpiResult,
} from "@/lib/tools/image-dpi";

/*
  DPI is the one image number a user cannot verify by looking at the picture,
  and the mistake this page exists to prevent is a tool that INVENTS one. A
  reader handed a PNG with no `pHYs` reports 72 (measured, libvips); printing
  that 72 back would be repeating a guess as if the file had said it, which is
  the exact prohibition `pdf-image-core.ts:41-42` already carries. So the first
  block below pins the three states apart — a declared density, a file that
  declares none, and a file whose numbers carry no unit and are therefore an
  aspect ratio rather than a resolution.

  The second block pins the reporting after a run. `SetImageDpiSuccess.after`
  is READ BACK out of the bytes the engine wrote, so a `pHYs` value that could
  not be stored exactly must surface as what was stored — not as what was
  asked for. And the EXIF-without-resolution case, the one write the engine
  deliberately will not attempt, has to be visible rather than silently
  half-done.

  The engine is mocked because these are the states, not the parsing: the byte
  walk has its own suite over real PNG and JPEG fixtures. What is NOT mocked is
  any of the arithmetic on this page — the print size is the claim the page
  makes, so it is asserted as a literal string.

  Copy strings are duplicated rather than imported: a test that reads the
  constant it checks cannot notice the constant changing.
*/

const WEBP_REFUSAL =
  "WebP has no DPI field — the format does not store one, so there is nothing to change.";

const NONE_DECLARED_NOTE =
  "This file declares no density at all. Nothing is wrong with it — every reader then falls back to its own assumption, which is exactly why the same picture prints at a different size in different apps.";

const ASPECT_ONLY_NOTE =
  "This file carries density numbers with no unit attached — an aspect ratio, not a resolution, which no reader can turn into a print size. Setting a DPI here gives it one.";

const readImageDpi = vi.fn<(bytes: Uint8Array) => ReadImageDpiResult>();
const setImageDpi = vi.fn<(bytes: Uint8Array, dpi: number) => SetImageDpiResult>();

vi.mock("@/lib/tools/image-dpi", () => ({
  MIN_DPI: 1,
  MAX_DPI: 65535,
  readImageDpi: (bytes: Uint8Array) => readImageDpi(bytes),
  setImageDpi: (bytes: Uint8Array, dpi: number) => setImageDpi(bytes, dpi),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([dropped])}>drop</button>
  ),
}));

// jsdom decodes nothing, so the pixel size every print-size claim is built on
// comes from here — which is also what lets a test drive an exact 800 × 600.
vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dims,
}));

import { ChangeImageDpiUI } from "@/components/tools/ChangeImageDpiUI";

let dropped: File = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
let dims: { w: number; h: number } | null = { w: 800, h: 600 };

function field(over: Partial<DpiFieldReading> = {}): DpiFieldReading {
  return { segment: "pHYs", dpiX: 300, dpiY: 300, aspectRatioOnly: false, ...over };
}

function declares(over: Partial<ImageDpiReading> = {}): ReadImageDpiResult {
  return {
    ok: true,
    format: "png",
    fields: [],
    effective: null,
    exifWithoutResolution: false,
    ...over,
  };
}

async function drop(): Promise<void> {
  render(<ChangeImageDpiUI acceptFormats=".jpg,.jpeg,.png" />);
  fireEvent.click(screen.getByText("drop"));
  // The header read resolves off `File.arrayBuffer()`, one microtask later.
  await waitFor(() => expect(readImageDpi).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  dropped = new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" });
  dims = { w: 800, h: 600 };
  readImageDpi.mockReturnValue(declares());
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("ChangeImageDpiUI — what the file declares, stated three different ways", () => {
  it("turns a declared density into the print size that follows from it", async () => {
    readImageDpi.mockReturnValue(
      declares({ effective: field({ dpiX: 72, dpiY: 72 }), fields: [field({ dpiX: 72, dpiY: 72 })] }),
    );
    await drop();

    // 800/72 and 600/72, then the same in centimetres.
    expect(
      screen.getByText(
        "At the density it declares today it prints 11.11 × 8.33 in · 28.2 × 21.2 cm.",
      ),
    ).toBeInTheDocument();
  });

  it("says a file declares none rather than repeating a reader's guess", async () => {
    readImageDpi.mockReturnValue(declares({ effective: null, fields: [] }));
    await drop();

    expect(screen.getByText("NONE")).toBeInTheDocument();
    expect(screen.getByText("None declared")).toBeInTheDocument();
    expect(screen.getByText(NONE_DECLARED_NOTE)).toBeInTheDocument();
  });

  it("separates numbers with no unit from no numbers at all", async () => {
    readImageDpi.mockReturnValue(
      declares({
        format: "jpeg",
        effective: null,
        fields: [field({ segment: "JFIF", dpiX: null, dpiY: null, aspectRatioOnly: true })],
      }),
    );
    await drop();

    expect(screen.getByText("NO UNIT")).toBeInTheDocument();
    expect(screen.getByText("No unit declared")).toBeInTheDocument();
    expect(screen.getByText(ASPECT_ONLY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(NONE_DECLARED_NOTE)).toBeNull();
  });

  it("shows both axes when a file declares them apart", async () => {
    readImageDpi.mockReturnValue(
      declares({ effective: field({ dpiX: 72, dpiY: 300 }), fields: [field({ dpiX: 72, dpiY: 300 })] }),
    );
    await drop();

    // Both surfaces, so the stat strip and the rail cannot disagree.
    expect(screen.getAllByText("72 × 300")).toHaveLength(2);
  });

  it("divides each axis by its OWN density, not the width's twice over", async () => {
    /*
      The sentence sits directly under a stat cell reading "72 × 300", so
      dividing the height by 72 as well contradicts the page one row up:
      800/72 × 600/300 is 11.11 × 2.00 in, and the single-density form printed
      11.11 × 8.33 — a height 4.17× too large. Non-square densities are legal
      and shipped: a fax JPEG carries JFIF 204 × 98.
    */
    readImageDpi.mockReturnValue(
      declares({ effective: field({ dpiX: 72, dpiY: 300 }), fields: [field({ dpiX: 72, dpiY: 300 })] }),
    );
    await drop();

    expect(
      screen.getByText(
        "At the density it declares today it prints 11.11 × 2.00 in · 28.2 × 5.1 cm.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the square case square", async () => {
    // The tool WRITES one density for both axes, so the after-print is a
    // square measurement — the Y argument must not change the common case.
    readImageDpi.mockReturnValue(
      declares({ effective: field({ dpiX: 150, dpiY: 150 }), fields: [field({ dpiX: 150, dpiY: 150 })] }),
    );
    await drop();

    expect(
      screen.getByText(
        "At the density it declares today it prints 5.33 × 4.00 in · 13.5 × 10.2 cm.",
      ),
    ).toBeInTheDocument();
  });

  it("refuses a WebP by name and leaves nothing to run", async () => {
    readImageDpi.mockReturnValue({ ok: false, reason: "webp", message: WEBP_REFUSAL });
    await drop();

    expect(screen.getByText(WEBP_REFUSAL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set DPI" })).toBeDisabled();
  });
});

describe("ChangeImageDpiUI — what the run actually wrote", () => {
  /** A success whose read-back density is `after`, not the requested `asked`. */
  function wrote(asked: number, after: number): SetImageDpiResult {
    return {
      ok: true,
      bytes: new Uint8Array(64),
      format: "png",
      dpiX: asked,
      dpiY: asked,
      before: { format: "png", fields: [], effective: null, exifWithoutResolution: false },
      after: {
        format: "png",
        fields: [field({ dpiX: after, dpiY: after })],
        effective: field({ dpiX: after, dpiY: after }),
        exifWithoutResolution: false,
      },
      wrote: [{ segment: "pHYs", action: "inserted" }],
      exifWithoutResolution: false,
      sizeDelta: 21,
    };
  }

  it("reports the density that was stored, not the one that was asked for", async () => {
    setImageDpi.mockReturnValue(wrote(300, 299));
    await drop();
    fireEvent.click(screen.getByRole("button", { name: "Set DPI" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Stored as 299 DPI: the header counts whole units per metre, and 300 has no exact form in them.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("299")).not.toHaveLength(0);
  });

  it("lists the fields the run wrote and the bytes that cost", async () => {
    setImageDpi.mockReturnValue(wrote(300, 300));
    await drop();
    fireEvent.click(screen.getByRole("button", { name: "Set DPI" }));

    await waitFor(() => expect(screen.getByText("pHYs")).toBeInTheDocument());
    expect(screen.getByText("Inserted")).toBeInTheDocument();
    expect(screen.getByText("+21")).toBeInTheDocument();
    expect(screen.getByText("Untouched")).toBeInTheDocument();
    // No rounding happened, so nothing may say it did.
    expect(screen.queryByText(/Stored as/)).toBeNull();
  });

  it("says only one field was written when the EXIF carries no resolution tags", async () => {
    readImageDpi.mockReturnValue(
      declares({ format: "jpeg", effective: field({ segment: "JFIF" }), exifWithoutResolution: true }),
    );
    setImageDpi.mockReturnValue({
      ...(wrote(300, 300) as Extract<SetImageDpiResult, { ok: true }>),
      format: "jpeg",
      wrote: [{ segment: "JFIF", action: "updated" }],
      exifWithoutResolution: true,
      sizeDelta: 0,
    });
    await drop();

    expect(
      screen.getByText(/only the JFIF density can be written/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Set DPI" }));
    await waitFor(() => expect(screen.getByText("JFIF")).toBeInTheDocument());
    expect(screen.getByText("No tags to rewrite")).toBeInTheDocument();
    expect(screen.getByText("0 — written in place")).toBeInTheDocument();
  });

  it("drops the download the moment the target DPI moves under it", async () => {
    setImageDpi.mockReturnValue(wrote(300, 300));
    await drop();
    fireEvent.click(screen.getByRole("button", { name: "Set DPI" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download photo-300dpi.png" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "600" }));

    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Set DPI" })).toBeInTheDocument();
  });
});
