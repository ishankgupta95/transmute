import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
  THE COPY GATE for compress-png.

  This is the one page in the image batch whose honesty is load-bearing in two
  directions at once, so every assertion below pins a sentence to a field of
  the run rather than to a string a writer chose:

    - the saving is the measured byte delta (31.5% here, because that is what
      oxipng level 2 did to this repo's own 1200×630 og-image.png: 171,221 B
      → 117,326 B);
    - "already optimal" renders from `identical`, which the engine sets when
      it hands the input straight back — never inferred from a zero delta;
    - the pixel-format rewrite renders from `colourBefore`/`colourAfter`
      (RGBA/8 → Gray/1 is a real measured case on sample-qr.png);
    - the lossless claim is qualified exactly when the alpha rewrite is on,
      because that switch touches fully-transparent pixels;
    - levels 5 and 6 are not offered, because they return byte-identical
      output to level 4 at 1.9× and 2.3× the time.

  `supportsPngOptimiser` is deliberately NOT mocked: the real predicate runs
  against stubbed globals, so the pre-flight refusal is tested and not just
  the branch that renders it — including the browser it must NOT refuse, one
  with a worker and wasm but no canvas in it.
*/

const optimisePng = vi.fn();

/** Mutable so a case can pretend the decode landed on a specific size. */
const dimensions: { value: { w: number; h: number } | null } = { value: null };

vi.mock("@/lib/workers/image-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workers/image-client")>();
  return { ...actual, optimisePng: (...args: unknown[]) => optimisePng(...args) };
});

vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dimensions.value,
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({
    onFiles,
    practicalLimitNote,
  }: {
    onFiles: (files: File[]) => void;
    practicalLimitNote?: string;
  }) => (
    <button data-note={practicalLimitNote ?? ""} onClick={() => onFiles([makePng()])}>
      drop
    </button>
  ),
}));

import { CompressPngUI } from "@/components/tools/CompressPngUI";

/** The measured Chromium screenshot, as a File without allocating 171 KB. */
const SOURCE_BYTES = 171_221;

function makePng(): File {
  const file = new File([new Uint8Array(8)], "og-image.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: SOURCE_BYTES });
  return file;
}

function runResult(over: Record<string, unknown> = {}) {
  return {
    blob: new Blob([new Uint8Array(16)], { type: "image/png" }),
    fileName: "og-image-optimised.png",
    originalSize: SOURCE_BYTES,
    newSize: 117_326,
    identical: false,
    level: 2,
    colourBefore: "RGB/8",
    colourAfter: "RGB/8",
    ...over,
  };
}

/**
 * What a browser with the worker pipeline looks like. Bare jsdom has none.
 *
 * More than this tool needs, deliberately: it is what the OTHER image tools
 * require, and the pre-flight cases below prove compress-png runs on the
 * subset. `WebAssembly` is real in this environment and is left alone.
 */
function stubWorkerPipeline() {
  vi.stubGlobal("Worker", function Worker() {});
  vi.stubGlobal("OffscreenCanvas", function OffscreenCanvas() {});
  vi.stubGlobal("createImageBitmap", () => Promise.resolve());
}

/** Safari 15.0–16.3: module workers and wasm, no OffscreenCanvas. */
function stubWorkerWithoutCanvas() {
  vi.stubGlobal("Worker", function Worker() {});
}

async function drop() {
  render(<CompressPngUI acceptFormats=".png" />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByRole("group", { name: "Optimization level" });
}

async function optimise() {
  fireEvent.click(screen.getByRole("button", { name: "Optimize PNG" }));
  await waitFor(() => expect(optimisePng).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  dimensions.value = null;
  // jsdom implements neither, and both preview hooks allocate one.
  URL.createObjectURL = vi.fn(() => "blob:png");
  URL.revokeObjectURL = vi.fn();
  optimisePng.mockResolvedValue(runResult());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CompressPngUI — the pre-flight, and why there is no fallback", () => {
  it("refuses before any upload when the worker pipeline is missing", () => {
    render(<CompressPngUI acceptFormats=".png" />);

    // The sentence has to name the reason there is no fallback, not just say
    // "unsupported" — a canvas re-encode is the no-op this tool replaces.
    expect(screen.getByRole("alert")).toHaveTextContent(/no compression setting/i);
  });

  it("keeps the drop zone so the page holds its shape on that browser", () => {
    render(<CompressPngUI acceptFormats=".png" />);

    expect(screen.getByText("drop")).toBeInTheDocument();
  });

  it("says nothing when the pipeline is actually there", () => {
    stubWorkerPipeline();
    render(<CompressPngUI acceptFormats=".png" />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("drop")).toBeInTheDocument();
  });

  it("runs on a browser with no OffscreenCanvas, because oxipng never draws", async () => {
    /*
      The optimise-png job returns before `decodeBitmap` and its whole call
      graph is DOM-free, so a canvas API is not a requirement. MEASURED: the
      shipped worker bundle takes 31.5% off og-image.png with OffscreenCanvas
      and createImageBitmap both undefined. Borrowing the pixel pipeline's
      probe refused Safari 15.0–16.3 for a capability the codec does not use.
    */
    stubWorkerWithoutCanvas();
    expect(globalThis.OffscreenCanvas).toBeUndefined();
    expect(globalThis.createImageBitmap).toBeUndefined();

    await drop();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Optimize PNG" })).toBeEnabled();
  });

  it("names the two things it actually needs, and not the canvas", () => {
    render(<CompressPngUI acceptFormats=".png" />);

    const refusal = screen.getByRole("alert");
    expect(refusal).toHaveTextContent(/WebAssembly/);
    expect(refusal).toHaveTextContent(/Web Workers/);
    // The sentence this replaced named OffscreenCanvas, which this job never
    // touches — a false statement about the user's browser.
    expect(refusal).not.toHaveTextContent(/OffscreenCanvas/);
  });
});

describe("CompressPngUI — the levels it offers are the ones that buy bytes", () => {
  it("offers 1 to 4 and neither 5 nor 6", async () => {
    stubWorkerPipeline();
    await drop();

    const group = screen.getByRole("group", { name: "Optimization level" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("opens on level 2 and sends the level the user picked", async () => {
    stubWorkerPipeline();
    await drop();

    const group = screen.getByRole("group", { name: "Optimization level" });
    expect(within(group).getByRole("button", { name: "2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(group).getByRole("button", { name: "4" }));
    await optimise();

    expect(optimisePng.mock.calls[0][1]).toEqual({ level: 4, optimiseAlpha: false });
  });
});

describe("CompressPngUI — every claim comes off the run", () => {
  it("reports the saving it measured rather than a range", async () => {
    stubWorkerPipeline();
    await drop();
    await optimise();

    // 171,221 → 117,326 is the measured level-2 result on og-image.png.
    expect(await screen.findByText("31.5%")).toBeInTheDocument();
  });

  it("reads an already-optimal PNG as an outcome, not as a failure", async () => {
    stubWorkerPipeline();
    optimisePng.mockResolvedValue(
      runResult({
        identical: true,
        newSize: SOURCE_BYTES,
        warnings: ["oxipng returned this file unchanged — it was already optimal."],
      }),
    );
    await drop();
    await optimise();

    // The engine's notice is a status, never an alert.
    expect(await screen.findByText(/already optimal/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // The honest half a percentage range would hide.
    expect(screen.getByText(/0–3% is the whole range available/i)).toBeInTheDocument();
    // And the file is still there to take.
    expect(screen.getByRole("button", { name: /^Download / })).toBeInTheDocument();
    expect(screen.getByText("NONE")).toBeInTheDocument();
  });

  it("names the pixel format oxipng rewrote, and only when it rewrote one", async () => {
    stubWorkerPipeline();
    optimisePng.mockResolvedValue(
      runResult({ colourBefore: "RGBA/8", colourAfter: "Gray/1" }),
    );
    await drop();
    await optimise();

    // Twice on purpose: the notice explains it, the OUTPUT panel records it.
    expect(await screen.findAllByText(/RGBA\/8 → Gray\/1/)).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      /Every pixel still round-trips/,
    );
  });

  it("says nothing about the pixel format when it came out the same", async () => {
    stubWorkerPipeline();
    await drop();
    await optimise();

    await screen.findByText("31.5%");
    expect(screen.queryByText(/Pixel format rewritten/i)).toBeNull();
  });
});

describe("CompressPngUI — a superseded run owns nothing", () => {
  /*
    A run is a multi-SECOND uninterruptible wasm burn with no cancel, and the
    reset link is the one control that stays live through it — so "give up,
    start over with a different PNG" is a sequence a user reaches by hand, not
    a hypothetical. What must never happen is file A's SAVED figure and A's
    bytes landing under file B's preview.
  */
  async function startRunThenSwapFiles() {
    stubWorkerPipeline();
    let finishA: (result: unknown) => void = () => {};
    optimisePng.mockImplementationOnce(
      () => new Promise((resolve) => { finishA = resolve; }),
    );

    render(<CompressPngUI acceptFormats=".png" />);
    fireEvent.click(screen.getByText("drop"));
    await screen.findByRole("group", { name: "Optimization level" });
    fireEvent.click(screen.getByRole("button", { name: "Optimize PNG" }));
    await waitFor(() => expect(optimisePng).toHaveBeenCalled());

    // Out through the reset link and back in with another file, while A burns.
    fireEvent.click(screen.getByRole("button", { name: "CLEAR" }));
    fireEvent.click(screen.getByText("drop"));
    await screen.findByRole("group", { name: "Optimization level" });
    return finishA;
  }

  it("drops the earlier run's result instead of showing it over the new file", async () => {
    const finishA = await startRunThenSwapFiles();

    await act(async () => {
      finishA(runResult());
    });

    // 31.5% is A's measured saving. Nothing of A may reach the panel, and
    // above all its blob must not be behind a Download button labelled for B.
    expect(screen.queryByText("31.5%")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Optimize PNG" })).toBeInTheDocument();
  });

  it("leaves the new file runnable rather than stuck behind the abandoned spinner", async () => {
    // The other half of the token guard: it refuses to let a stale run clear
    // `isProcessing`, so the abandoning action has to clear it instead — or
    // the primary reads "Optimizing…" over file B for the life of the tab.
    const finishA = await startRunThenSwapFiles();

    await act(async () => {
      finishA(runResult());
    });

    const primary = screen.getByRole("button", { name: "Optimize PNG" });
    expect(primary).toBeEnabled();
    expect(screen.queryByText("Re-compressing PNG")).toBeNull();
  });
});

describe("CompressPngUI — the lossless claim is qualified by the one switch that qualifies it", () => {
  it("claims every pixel identical while the alpha rewrite is off", async () => {
    stubWorkerPipeline();
    await drop();

    expect(screen.getByText(/EVERY PIXEL COMES OUT IDENTICAL/)).toBeInTheDocument();
  });

  it("stops claiming it the moment the alpha rewrite is turned on", async () => {
    stubWorkerPipeline();
    await drop();

    fireEvent.click(screen.getByLabelText("Rewrite fully-transparent pixels"));

    expect(screen.queryByText(/EVERY PIXEL COMES OUT IDENTICAL/)).toBeNull();
    expect(
      screen.getByText(/ONLY PIXELS THAT CAN CHANGE ARE THE FULLY TRANSPARENT ONES/),
    ).toBeInTheDocument();
  });

  it("qualifies the ADVANCED drawer with it too, in the same DOM at the same moment", async () => {
    // The footnote retracts the claim and the drawer used to keep asserting
    // it three elements away: "Pixel data UNCHANGED" as a flat engine fact,
    // over the one switch that rewrites pixel values.
    stubWorkerPipeline();
    await drop();

    expect(screen.getByText("UNCHANGED")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Rewrite fully-transparent pixels"));

    expect(screen.queryByText("UNCHANGED")).toBeNull();
    expect(screen.getByText("UNCHANGED WHERE ALPHA > 0")).toBeInTheDocument();
  });

  it("points the DIFF caption at what that view can actually show", async () => {
    /*
      ToolCanvas's DIFF draws both sides on a 2D canvas and compares
      getImageData RGB. Canvas 2D stores premultiplied alpha, so an alpha-0
      pixel reads back (0,0,0,0) whatever its colour was — MEASURED: two PNGs
      differing by 255 in two channels under alpha 0 produce a diff whose
      maximum channel value is 0. That is exactly the pixel this switch
      rewrites, so "anything but black is a pixel whose alpha was zero" sent
      the reader to a check that cannot succeed.
    */
    stubWorkerPipeline();
    await drop();
    fireEvent.click(screen.getByLabelText("Rewrite fully-transparent pixels"));
    await optimise();

    const caption = await screen.findByText(/open DIFF/);
    expect(caption).toHaveTextContent(/black end to end/);
    expect(caption).not.toHaveTextContent(/anything but black/);
  });
});

describe("CompressPngUI — the megapixel ceiling is enforced, so it is stated", () => {
  it("refuses a file past the ceiling and says which number it is", async () => {
    stubWorkerPipeline();
    dimensions.value = { w: 5000, h: 3000 };
    await drop();

    expect(screen.getByRole("alert")).toHaveTextContent(/15\.0 megapixels/);
    expect(screen.getByRole("button", { name: "Optimize PNG" })).toBeDisabled();
  });

  it("lets a file inside the ceiling run", async () => {
    stubWorkerPipeline();
    dimensions.value = { w: 4000, h: 3000 };
    await drop();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Optimize PNG" })).toBeEnabled();
  });
});
