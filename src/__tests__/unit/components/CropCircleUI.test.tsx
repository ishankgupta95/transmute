import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ProcessedResult } from "@/hooks/useFileProcessor";
import type { ImageEditJobOptions } from "@/lib/workers/image-protocol";

/*
  Two claims this surface makes, and one it must never make.

  MUST: the circle the user positions is the circle the engine is asked for.
  The ring is drawn from `circleRect` and the region is sent from `circleRect`,
  so a test that only checked the ring would pass while the output came out
  somewhere else entirely. Every geometry assertion below therefore reads the
  ON-SCREEN number and the ARGUMENT to the engine together.

  MUST: the two standing sentences — why there is no JPG chip, and why the
  saved file is still a square. Both answer a question a user would otherwise
  ask after the download, when it is too late to have been useful.

  MUST NOT: offer JPG. A JPEG cannot carry an alpha channel, so a circle
  written as one is a circle painted on a white square. The chip list is
  asserted exactly, not with a `queryByText` that would keep passing if a
  fourth chip appeared beside it.
*/

const editImage = vi.fn();

vi.mock("@/lib/workers/image-client", () => ({
  editImage: (...args: unknown[]) => editImage(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

/*
  jsdom decodes nothing, so `useImageDimensions` returns null for every file
  and the whole geometry — the ring, the readouts, the region — would never be
  computed. The hook is replaced by a value the test controls, which is also
  the only way to state "this picture is 1200 × 800" as a premise rather than
  as something the environment happened to produce.
*/
let dimensions: { w: number; h: number } | null = { w: 1200, h: 800 };
vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dimensions,
}));

import { CropCircleUI, circleRect } from "@/components/tools/CropCircleUI";

function makeFile(name = "portrait.jpg"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

function processed(fileName: string, newSize = 4096): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(newSize)], { type: "image/png" }),
    fileName,
    originalSize: 3,
    newSize,
  };
}

/** The options bag the component handed the engine on its last run. */
function lastJob(): ImageEditJobOptions {
  return editImage.mock.calls[editImage.mock.calls.length - 1][1] as ImageEditJobOptions;
}

/** The circular region of that job — narrowed, so a wrong verb fails loudly. */
function lastRegion() {
  const edit = lastJob().edit;
  if (edit.kind !== "crop-circle") throw new Error(`expected crop-circle, got ${edit.kind}`);
  return edit.region;
}

/*
  jsdom implements neither Object-URL method, and this surface allocates one
  for the source preview and one for the result. They are ADDED to the real
  `URL` rather than stubbed over it: replacing the global outright takes
  `new URL()` with it, which next/link constructs on every render.
*/
const objectUrls = { created: [] as string[], revoked: [] as string[] };
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    const url = `blob:circle-${objectUrls.created.length}-${blob.size}`;
    objectUrls.created.push(url);
    return url;
  },
  revokeObjectURL: (url: string) => objectUrls.revoked.push(url),
});

function drop() {
  render(<CropCircleUI acceptFormats=".jpg,.png,.webp" />);
  fireEvent.click(screen.getByText("drop"));
}

const slider = (name: string) => screen.getByRole("slider", { name }) as HTMLInputElement;
const setSlider = (name: string, value: number) =>
  fireEvent.change(slider(name), { target: { value: String(value) } });

beforeEach(() => {
  // `mockReset`, not `mockClear`: a `…Once` value left queued by a failing
  // test would otherwise be handed to the next one.
  editImage.mockReset();
  editImage.mockResolvedValue(processed("portrait-circle.png"));
  dimensions = { w: 1200, h: 800 };
  objectUrls.created = [];
  objectUrls.revoked = [];
});

describe("circleRect — the geometry both the ring and the region are drawn from", () => {
  it("measures the diameter against the shorter edge", () => {
    // 100% of a 1200 × 800 picture is 800, not 1200: the largest circle that
    // fits, which is what "the whole picture" can mean for a circle.
    expect(circleRect(1200, 800, 100, 50, 50)).toEqual({ x: 200, y: 0, size: 800 });
    expect(circleRect(800, 1200, 100, 50, 50)).toEqual({ x: 0, y: 200, size: 800 });
  });

  it("moves the circle over the SLACK, so it can never sit outside the picture", () => {
    // 50% of 800 is 400, leaving 800 px of horizontal slack and 400 of
    // vertical. Position 0 and 100 are the two edges, and neither overhangs.
    expect(circleRect(1200, 800, 50, 0, 0)).toEqual({ x: 0, y: 0, size: 400 });
    expect(circleRect(1200, 800, 50, 100, 100)).toEqual({ x: 800, y: 400, size: 400 });
    expect(circleRect(1200, 800, 50, 50, 50)).toEqual({ x: 400, y: 200, size: 400 });
  });

  it("keeps the circle inside the frame at every position and every diameter", () => {
    // The property the two cases above are examples of. A rect that runs past
    // an edge is the failure this tool would show as a clipped crescent.
    for (const [w, h] of [
      [1200, 800],
      [800, 1200],
      [1000, 1000],
      [37, 91],
    ]) {
      for (const d of [10, 33, 50, 67, 100]) {
        for (const p of [0, 25, 50, 75, 100]) {
          const r = circleRect(w, h, d, p, 100 - p);
          expect(r.size).toBeGreaterThan(0);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.size).toBeLessThanOrEqual(w);
          expect(r.y + r.size).toBeLessThanOrEqual(h);
        }
      }
    }
  });
});

describe("CropCircleUI — the output has to be able to hold transparency", () => {
  it("offers PNG and WEBP and nothing else", () => {
    drop();
    const group = screen.getByRole("group", { name: "Output format" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["PNG", "WEBP"]);
  });

  it("says why JPG is missing rather than leaving the gap to be noticed", () => {
    drop();
    expect(
      screen.getByText(
        "NO JPG HERE — JPEG HAS NO ALPHA CHANNEL, SO A CIRCLE SAVED AS JPEG IS A CIRCLE ON A WHITE SQUARE",
      ),
    ).toBeInTheDocument();
  });

  it("says the saved file is still a rectangle", () => {
    /*
      The question this answers arrives AFTER the download: the user drops the
      PNG on a coloured background, sees a square, and concludes the tool did
      not work. Every raster format is a rectangle; the corners are empty, not
      missing.
    */
    drop();
    expect(
      screen.getByText(
        "THE FILE IS STILL A SQUARE — THE CORNERS ARE TRANSPARENT, NOT ABSENT, BECAUSE EVERY IMAGE FORMAT IS A RECTANGLE",
      ),
    ).toBeInTheDocument();
  });
});

describe("CropCircleUI — the circle on screen is the circle that is cut", () => {
  it("defaults to the largest circle the picture can hold, and says so in pixels", async () => {
    drop();

    // 1200 × 800 → an 800 px circle, offset 200 px from the left.
    expect(slider("Diameter")).toHaveValue("100");
    expect(screen.getByText("800 px")).toBeInTheDocument();
    expect(screen.getByText("200 px from the left")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Crop circle/ }));
    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(lastRegion()).toEqual({ x: 200, y: 0, width: 800, height: 800 });
  });

  it("sends the region the readouts are showing after the sliders move", async () => {
    drop();
    setSlider("Diameter", 50);
    setSlider("Horizontal", 25);
    setSlider("Vertical", 75);

    // 50% of the 800 px short edge = 400. Slack is 800 across, 400 down.
    expect(screen.getByText("400 px")).toBeInTheDocument();
    expect(screen.getByText("200 px from the left")).toBeInTheDocument();
    expect(screen.getByText("300 px from the top")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Crop circle/ }));
    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(lastRegion()).toEqual({ x: 200, y: 300, width: 400, height: 400 });
  });

  it("turns off a position control that cannot move anything", () => {
    /*
      A square picture at 100% has no slack on either axis. A slider that
      still slid would move a readout that cannot change — so both are
      disabled and the hint says which way out there is.
    */
    dimensions = { w: 900, h: 900 };
    drop();

    expect(slider("Horizontal")).toBeDisabled();
    expect(slider("Vertical")).toBeDisabled();
    expect(
      screen.getByText(/The circle already spans the shorter edge/),
    ).toBeInTheDocument();

    setSlider("Diameter", 60);
    expect(slider("Horizontal")).toBeEnabled();
    expect(slider("Vertical")).toBeEnabled();
  });

  it("asks for the largest inscribed circle when the pixel size could not be read", async () => {
    // A file the browser will not decode has no dimensions to position
    // against. `null` is the engine's own word for "the biggest one that
    // fits" — inventing numbers here would be worse than saying nothing.
    dimensions = null;
    drop();

    expect(screen.queryByRole("slider", { name: "Horizontal" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crop circle/ }));
    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(lastRegion()).toBeNull();
  });
});

describe("CropCircleUI — the download follows the settings", () => {
  it("offers the file the engine actually named", async () => {
    editImage.mockResolvedValue(processed("portrait-circle.webp", 2048));
    drop();
    fireEvent.click(screen.getByRole("button", { name: /Crop circle/ }));

    expect(
      await screen.findByRole("button", { name: "Download portrait-circle.webp" }),
    ).toBeInTheDocument();
  });

  it("drops a stale result the moment a control changes", async () => {
    /*
      The repo's standing invariant: a blob produced under one set of options
      must never sit under another. Changing the diameter puts the run button
      back, so the file that saves is always the file the settings describe.
    */
    drop();
    fireEvent.click(screen.getByRole("button", { name: /Crop circle/ }));
    await screen.findByRole("button", { name: "Download portrait-circle.png" });

    setSlider("Diameter", 40);

    expect(screen.queryByRole("button", { name: /^Download / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Crop circle/ })).toBeInTheDocument();
  });

  it("puts the engine's own message on screen when a run fails", async () => {
    editImage.mockRejectedValueOnce(new Error("This browser cannot encode WebP"));
    drop();
    fireEvent.click(screen.getByRole("button", { name: /Crop circle/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This browser cannot encode WebP");
  });
});
