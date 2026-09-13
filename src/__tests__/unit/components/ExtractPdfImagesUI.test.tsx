import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type {
  ExtractedPdfImage,
  PdfExtractImagesResult,
  PdfExtractSkip,
} from "@/lib/tools/pdf-extract-images";

/*
  The surface's job is to be TRUE about a run that is deliberately partial.

  `extractPdfImages` refuses every image it cannot write out as a standalone
  file, and returns a count and a named reason for each refusal. That
  conservatism is only honest if the page shows it — so the assertions below
  are mostly about sentences: what the canvas says when everything came out,
  when some of it did not, when the document had no images at all, and when the
  user's own size filter is what is hiding them.

  The other half is the download matching the screen. `downloadFilesAsZip`
  hands over a bare file when the list has one member, so a one-image run must
  offer a JPEG rather than a button promising a ZIP.
*/

const extractPdfImages = vi.fn();
const downloadFilesAsZip = vi.fn();
const triggerDownload = vi.fn();

vi.mock("@/lib/tools/pdf-extract-images", () => ({
  extractPdfImages: (...args: unknown[]) => extractPdfImages(...args),
}));

vi.mock("@/lib/utils/download", () => ({
  downloadFilesAsZip: (...args: unknown[]) => downloadFilesAsZip(...args),
  triggerDownload: (...args: unknown[]) => triggerDownload(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile("report.pdf")])}>drop</button>
  ),
}));

import { ExtractPdfImagesUI } from "@/components/tools/ExtractPdfImagesUI";

function makeFile(name: string): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(3)),
  });
  return file;
}

function image(
  name: string,
  width: number,
  height: number,
  format: ExtractedPdfImage["format"] = "jpeg",
  length = 4096,
): ExtractedPdfImage {
  return { name, bytes: new Uint8Array(length), format, width, height };
}

function result(
  images: ExtractedPdfImage[],
  skipped: PdfExtractSkip[] = [],
  imagesFound = images.length + skipped.reduce((s, k) => s + k.count, 0),
): PdfExtractImagesResult {
  return { images, imagesFound, skipped };
}

function deferred() {
  let resolve!: (v: PdfExtractImagesResult) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<PdfExtractImagesResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The grid tiles, as their visible text.
 *
 * Read through `figure` rather than by file name: the name is ALSO printed in
 * the rail's OUTPUT readout when a single image is the whole download, so a
 * bare `getByText("image-01.jpg")` matches two nodes and stops distinguishing
 * "it is in the grid" from "it is named as the download".
 */
const tiles = () => screen.queryAllByRole("figure").map((f) => f.textContent ?? "");

async function drop() {
  render(<ExtractPdfImagesUI />);
  fireEvent.click(screen.getByText("drop"));
}

/** Resolves once a successful run has landed on the surface. */
const runFinished = () => screen.findByText(/^Done in/);

/**
 * The canvas's warning banner.
 *
 * `ToolDone` became a live region so that a screen-reader user is told the run
 * finished (WCAG 4.1.3 — success used to be announced nowhere, while failure
 * had a `role="alert"`), so a finished run now carries TWO `role="status"`
 * nodes: the completion notice in the rail footer and this banner in the
 * canvas. Selecting by "the only status on screen" was always incidental;
 * select by which one it is, and assert there is exactly one banner so the
 * helper cannot quietly start matching the wrong node.
 */
function warningBanner(): HTMLElement {
  const banners = screen
    .getAllByRole("status")
    .filter((node) => !/^Done in/.test((node.textContent ?? "").trim()));
  expect(banners).toHaveLength(1);
  return banners[0];
}

/*
  jsdom implements neither Object-URL method, and the canvas allocates one URL
  per painted preview.

  They are ADDED to the real `URL` rather than stubbed over it: replacing the
  global outright takes `new URL()` with it, and next/link constructs one on
  every render — which turns every test in this file into a render error
  reading "URL is not a constructor".

  Installed once, at module scope, and never removed. The revoke this component
  schedules is DEFERRED by a second (see the effect), so a test's cleanup timer
  fires well after that test has finished; tearing the fakes down per test
  leaves those timers landing on whatever the environment provides instead.
*/
const objectUrls = { created: [] as string[], revoked: [] as string[] };
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    const url = `blob:preview-${objectUrls.created.length}-${blob.size}`;
    objectUrls.created.push(url);
    return url;
  },
  revokeObjectURL: (url: string) => objectUrls.revoked.push(url),
});

beforeEach(() => {
  // `mockReset`, not `mockClear`: a test that queues a `…Once` value and then
  // fails leaves that value in the queue for the NEXT test, which then runs
  // against a document it never set up.
  extractPdfImages.mockReset();
  downloadFilesAsZip.mockReset();
  triggerDownload.mockReset();
  objectUrls.created = [];
  objectUrls.revoked = [];
});

describe("ExtractPdfImagesUI — the canvas says what actually came out", () => {
  it("runs on the drop and shows each image at its stored size", async () => {
    /*
      The resolution is the whole point of the readout: an extracted image
      arrives at the size it is STORED at, which for a picture scaled down on
      the page is smaller than it looks. Printing it beside the file name is
      what turns "why is this small?" into an answer.
    */
    extractPdfImages.mockResolvedValue(
      result([image("image-01.jpg", 1200, 800), image("image-02.png", 64, 64, "png")]),
    );
    await drop();
    await runFinished();

    expect(tiles()).toEqual([
      expect.stringContaining("image-01.jpg"),
      expect.stringContaining("image-02.png"),
    ]);
    expect(tiles()[0]).toContain("1200 × 800");
    expect(tiles()[1]).toContain("64 × 64");
    // The badge names the format each file actually came out as.
    expect(tiles()[0]).toContain("JPG");
    expect(tiles()[1]).toContain("PNG");
  });

  it("says nothing was left behind when nothing was", async () => {
    extractPdfImages.mockResolvedValue(result([image("image-01.jpg", 800, 600)]));
    await drop();
    await runFinished();

    expect(
      screen.getByText("THE ONE IMAGE IN THIS PDF CAME OUT — NOTHING WAS LEFT BEHIND"),
    ).toBeInTheDocument();
  });

  it("names every skip, with the count and the detail the engine found", async () => {
    /*
      THE DISCLOSURE. Without it the header reads "2 IMAGES" over a document
      that holds nine, and the tool looks like it worked. Each phrase has to
      agree with its count, and the engine's own detail (the filter name, the
      colour space) is printed verbatim rather than paraphrased into something
      vaguer.
    */
    extractPdfImages.mockResolvedValue(
      result(
        [image("image-01.jpg", 900, 600), image("image-02.jpg", 900, 600)],
        [
          { reason: "mask", count: 1 },
          { reason: "filter", count: 4, detail: "JPXDecode, CCITTFaxDecode" },
          { reason: "colour-space", count: 2, detail: "DeviceCMYK" },
        ],
      ),
    );
    await drop();
    await runFinished();

    expect(
      screen.getByText(
        "7 OF 9 IMAGES WERE LEFT IN THE DOCUMENT — 1 IS A TRANSPARENCY MASK, OR CARRIES ONE, 4 ARE NEITHER JPEGS NOR RAW PIXEL BITMAPS (JPXDECODE, CCITTFAXDECODE), 2 ARE IN COLOUR SPACES THIS TOOL WILL NOT GUESS AT (DEVICECMYK)",
      ),
    ).toBeInTheDocument();
  });

  it("always says the output is the stored image, not a picture of the page", async () => {
    /*
      The standing claim. It is on screen before and after a run precisely
      because the misunderstanding this tool invites — "extract images from
      PDF" read as "turn the pages into images" — has to be met before the
      download, not after it.
    */
    extractPdfImages.mockResolvedValue(result([image("image-01.jpg", 900, 600)]));
    await drop();
    await runFinished();

    expect(
      screen.getByText(
        "IMAGES COME OUT AT THE RESOLUTION THEY ARE STORED AT, WHICH IS OFTEN SMALLER THAN THEY LOOK ON THE PAGE — THIS IS NOT A SCREENSHOT OF THE PAGE",
      ),
    ).toBeInTheDocument();
  });

  it("sends a document with no images to the tool that renders pages", async () => {
    // A text-and-vector PDF is not a failure of this tool, it is a different
    // question — and the answer to that question is a different page.
    extractPdfImages.mockResolvedValue(result([]));
    await drop();
    await runFinished();

    expect(
      screen.getByText(
        "THIS PDF STORES NO IMAGES AT ALL — THERE IS NOTHING IN IT FOR THIS TOOL TO LIFT OUT",
      ),
    ).toBeInTheDocument();
    expect(warningBanner()).toHaveTextContent(
      /does not store any[\s\S]*it does not photograph the page/,
    );
    for (const link of screen.getAllByRole("link", { name: "PDF to JPG" })) {
      expect(link).toHaveAttribute("href", "/pdf-to-jpg");
    }
    // Nothing to download, and re-running would produce the same nothing.
    expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument();
  });

  it("does not blame the document when every image was skipped", async () => {
    extractPdfImages.mockResolvedValue(result([], [{ reason: "mask", count: 3 }]));
    await drop();
    await runFinished();

    expect(warningBanner()).toHaveTextContent(
      "None of this PDF's 3 images could be written out as a standalone file.",
    );
  });

  it("says a bitmap over its OWN ceiling is the tool's limit, not a broken file", async () => {
    /*
      `too-large` is the one skip reason that describes this tool rather than
      the document: the classifier reads the declared /Width × /Height, decides
      the PNG builder cannot hold that many samples, and never opens the
      stream. Under `undecodable`'s sentence — "DID NOT HOLD THE IMAGE ITS
      DICTIONARY DESCRIBES" — the owner of an intact 12000 × 12000 scan was
      told their file was damaged and went off to repair it.
    */
    extractPdfImages.mockResolvedValue(
      result([], [{ reason: "too-large", count: 1, detail: "12000 × 12000" }]),
    );
    await drop();
    await runFinished();

    expect(
      screen.getByText(
        "1 OF 1 IMAGE WAS LEFT IN THE DOCUMENT — 1 IS TOO BIG FOR THIS TOOL TO REBUILD IN THE TAB — THE FILE IS FINE (12000 × 12000)",
      ),
    ).toBeInTheDocument();
  });

  it("withholds the 'no image file could represent it' clause when the tool is what refused", async () => {
    /*
      The compounding half of the same defect. That clause is a claim about
      the DOCUMENT — every case is a picture no JPEG or PNG could carry — and
      it is false of a picture a PNG carries perfectly that this tool simply
      declined to build. So it is spent only when every skip really was a
      shape of the file.
    */
    extractPdfImages.mockResolvedValue(
      result([], [{ reason: "too-large", count: 1, detail: "12000 × 12000" }]),
    );
    await drop();
    await runFinished();

    const banner = warningBanner();
    expect(banner).toHaveTextContent(
      "None of this PDF's 1 image could be written out as a standalone file.",
    );
    expect(banner).not.toHaveTextContent(/could not represent the way the page does/);
  });

  it("still makes that claim when every skip really was a shape of the file", async () => {
    extractPdfImages.mockResolvedValue(
      result([], [{ reason: "colour-space", count: 2, detail: "DeviceCMYK" }]),
    );
    await drop();
    await runFinished();

    expect(warningBanner()).toHaveTextContent(
      /could not represent the way the page does/,
    );
  });
});

describe("ExtractPdfImagesUI — the download matches the screen", () => {
  it("hands over the single image directly rather than promising a ZIP", async () => {
    /*
      `downloadFilesAsZip` saves a one-member list as the bare file. A button
      reading "Download 1 image (ZIP)" would therefore be a promise the
      download breaks — the exact trap ExtractPdfPagesUI documents.
    */
    extractPdfImages.mockResolvedValue(result([image("image-01.jpg", 900, 600)]));
    await drop();
    await runFinished();

    // Nowhere on the surface — not the button, and not the rail's DOWNLOAD
    // readout, which would otherwise name a ZIP the download never produces.
    expect(screen.queryByText(/zip/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download image-01.jpg" }));

    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), "image-01.jpg");
    expect(downloadFilesAsZip).not.toHaveBeenCalled();
  });

  it("zips several images under a name derived from the PDF", async () => {
    extractPdfImages.mockResolvedValue(
      result([
        image("image-01.jpg", 900, 600),
        image("image-02.jpg", 900, 600),
        image("image-03.png", 900, 600, "png"),
      ]),
    );
    await drop();
    await runFinished();

    fireEvent.click(screen.getByRole("button", { name: "Download 3 images (ZIP)" }));

    expect(downloadFilesAsZip).toHaveBeenCalledTimes(1);
    const [files, name] = downloadFilesAsZip.mock.calls[0];
    expect((files as { name: string }[]).map((f) => f.name)).toEqual([
      "image-01.jpg",
      "image-02.jpg",
      "image-03.png",
    ]);
    expect(name).toBe("report-images.zip");
  });

  it("gives each file the MIME type its format actually is", async () => {
    // A PNG saved as image/jpeg opens in some viewers and not others, and the
    // ZIP entry would be mislabelled for every one of them.
    extractPdfImages.mockResolvedValue(
      result([image("image-01.jpg", 900, 600), image("image-02.png", 900, 600, "png")]),
    );
    await drop();
    await runFinished();

    fireEvent.click(screen.getByRole("button", { name: "Download 2 images (ZIP)" }));

    const [files] = downloadFilesAsZip.mock.calls[0];
    expect((files as { blob: Blob }[]).map((f) => f.blob.type)).toEqual([
      "image/jpeg",
      "image/png",
    ]);
  });
});

describe("ExtractPdfImagesUI — the size filter hides, and says it hid", () => {
  const mixed = () =>
    result([
      image("image-01.jpg", 1200, 800),
      image("image-02.png", 16, 16, "png"),
      image("image-03.png", 8, 40, "png"),
    ]);

  it("shows everything by default, so nothing is hidden without being asked", async () => {
    extractPdfImages.mockResolvedValue(mixed());
    await drop();
    await runFinished();

    expect(tiles()).toHaveLength(3);
    expect(screen.queryByText(/HIDDEN BY THE SIZE FILTER/)).not.toBeInTheDocument();
  });

  it("counts what it hides, and drops it from the download too", async () => {
    /*
      The filter is the USER's choice, so it gets its own sentence rather than
      being folded into the engine's skip list — which would blame the document
      for something this page did. And it has to govern the canvas and the
      download together: a grid of three under a button that saves one is two
      different answers on one screen.
    */
    extractPdfImages.mockResolvedValue(mixed());
    await drop();
    await runFinished();

    fireEvent.click(screen.getByRole("button", { name: "64 px +" }));

    expect(tiles()).toEqual([expect.stringContaining("image-01.jpg")]);
    expect(
      screen.getByText(
        "2 MORE IMAGES ARE SMALLER THAN 64 PX AND ARE HIDDEN BY THE SIZE FILTER — CHOOSE ALL TO INCLUDE THEM",
      ),
    ).toBeInTheDocument();

    // One image left, so the download is that image — not a ZIP of three,
    // and the rail's readout has to name the same thing the button hands over.
    expect(screen.queryByText(/zip/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download image-01.jpg" }));
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), "image-01.jpg");
    expect(downloadFilesAsZip).not.toHaveBeenCalled();
  });

  it("measures the longest side, not the width", async () => {
    // A 40 × 300 banner is not a small image, and filtering on width alone
    // would throw it away.
    extractPdfImages.mockResolvedValue(
      result([image("image-01.png", 40, 300, "png"), image("image-02.png", 40, 40, "png")]),
    );
    await drop();
    await runFinished();

    fireEvent.click(screen.getByRole("button", { name: "64 px +" }));

    expect(tiles()).toEqual([expect.stringContaining("image-01.png")]);
  });

  it("counts only what the filter hid, not what the engine skipped", async () => {
    /*
      Seven CMYK images are not SMALL, they are unextractable — and the
      disclosure above already accounts for them. Folding them into the filter's
      sentence would be a false statement about seven of the nine.
    */
    extractPdfImages.mockResolvedValue(
      result([image("image-01.png", 20, 20, "png")], [{ reason: "colour-space", count: 7 }]),
    );
    await drop();
    await runFinished();

    fireEvent.click(screen.getByRole("button", { name: "256 px +" }));

    expect(warningBanner()).toHaveTextContent(
      "The one image that came out is smaller than 256 px, so the size filter is hiding it.",
    );
    expect(screen.queryByText(/8 images/)).not.toBeInTheDocument();
  });

  it("explains the empty grid when the filter is what emptied it", async () => {
    extractPdfImages.mockResolvedValue(
      result([image("image-01.png", 20, 20, "png"), image("image-02.png", 30, 30, "png")]),
    );
    await drop();
    await runFinished();

    fireEvent.click(screen.getByRole("button", { name: "256 px +" }));

    expect(warningBanner()).toHaveTextContent(
      "All 2 images that came out are smaller than 256 px, so the size filter is hiding them.",
    );
    // …and it must NOT claim the engine could not extract them, because it did.
    expect(screen.queryByText(/could not be written out/)).not.toBeInTheDocument();
    // Nor say it twice: "2 MORE IMAGES ARE HIDDEN" over an empty grid is both
    // redundant with the sentence above and wrong about the word "more".
    expect(screen.queryByText(/HIDDEN BY THE SIZE FILTER/)).not.toBeInTheDocument();
  });
});

describe("ExtractPdfImagesUI — a run that is overtaken must not land", () => {
  /*
    A 200 MB PDF parses for seconds, so there is a real window in which the
    user swaps the file while a run is still in flight. Without the run token,
    the FIRST document's images landed on screen under the SECOND document's
    name, and its ZIP was named after the second file.

    The two runs are sequenced explicitly — wait for run one to reach the
    engine, THEN supersede it — so the mock hands each run the outcome this
    test means it to have, rather than whichever promise the microtask queue
    happened to deliver first.
  */
  async function startRunThenSupersede(first: ReturnType<typeof deferred>) {
    extractPdfImages.mockReturnValueOnce(first.promise);
    extractPdfImages.mockResolvedValueOnce(result([image("image-01.png", 500, 500, "png")]));

    render(<ExtractPdfImagesUI />);
    fireEvent.click(screen.getByText("drop"));
    await waitFor(() => expect(extractPdfImages).toHaveBeenCalledTimes(1));

    // Reset, then drop again — the path a second file takes.
    fireEvent.click(screen.getByText("CHANGE FILE"));
    fireEvent.click(screen.getByText("drop"));
    await runFinished();
    await waitFor(() => expect(extractPdfImages).toHaveBeenCalledTimes(2));
    expect(tiles()).toEqual([expect.stringContaining("image-01.png")]);
  }

  it("drops a superseded result instead of binding it to the new file", async () => {
    const first = deferred();
    await startRunThenSupersede(first);

    first.resolve(result([image("image-99.jpg", 10, 10)]));

    await waitFor(() => {
      expect(tiles()).toEqual([expect.stringContaining("image-01.png")]);
    });
    expect(screen.queryByText(/image-99/)).not.toBeInTheDocument();
  });

  it("keeps a superseded failure off the document the user is now looking at", async () => {
    const first = deferred();
    await startRunThenSupersede(first);

    first.reject(new Error("the abandoned document was password-protected"));

    await waitFor(() => {
      expect(tiles()).toEqual([expect.stringContaining("image-01.png")]);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ExtractPdfImagesUI — failures and limits", () => {
  it("puts the engine's own sentence on screen and offers a retry", async () => {
    // The password / damaged messages are the engine's, verbatim, so a
    // protected PDF says the same thing here as on every other PDF page.
    extractPdfImages.mockRejectedValueOnce(
      new Error("This PDF is password-protected. Run it through Unlock PDF (/unlock-pdf) first."),
    );
    extractPdfImages.mockResolvedValueOnce(result([image("image-01.jpg", 100, 100)]));
    await drop();

    expect(await screen.findByRole("alert")).toHaveTextContent(/password-protected/);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await runFinished();
    expect(tiles()).toEqual([expect.stringContaining("image-01.jpg")]);
  });

  it("caps the grid but never the download, and says which is which", async () => {
    /*
      Painting several hundred previews at once is a layout the main thread
      does not come back from. The cap is fine; a cap the user cannot see is
      not, because the grid would silently look like the whole set.
    */
    const many = Array.from({ length: 60 }, (_, i) =>
      image(`image-${String(i + 1).padStart(2, "0")}.jpg`, 500, 500),
    );
    extractPdfImages.mockResolvedValue(result(many));
    await drop();
    await runFinished();

    expect(tiles()).toHaveLength(48);
    expect(tiles()[47]).toContain("image-48.jpg");
    expect(
      screen.getByText("SHOWING THE FIRST 48 OF 60 IMAGES — THE DOWNLOAD CARRIES ALL OF THEM"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download 60 images (ZIP)" }));
    expect((downloadFilesAsZip.mock.calls[0][0] as unknown[]).length).toBe(60);
  });

  it("revokes every preview URL it allocated", async () => {
    // One Object URL per painted preview; a tool a user runs over ten PDFs in
    // a row would otherwise leak ten grids' worth of blobs.
    extractPdfImages.mockResolvedValue(
      result([image("image-01.jpg", 100, 100), image("image-02.jpg", 100, 100)]),
    );
    await drop();
    await runFinished();

    expect(objectUrls.created).toHaveLength(2);

    /*
      Fake timers only for the teardown: the revoke is deferred by a second,
      for the reason `useObjectUrl` gives — revoking synchronously aborts an
      <img> that is still loading the URL when the list swaps under it.

      ⚠ THE `act(() => {})` IS NOT DECORATION. This block depends on an
      ORDERING that nothing else enforces: the timer must be created AFTER
      `useFakeTimers()` (or it belongs to the real clock and advancing does
      nothing) and BEFORE `advanceTimersByTime` (or there is nothing to
      advance). The timer is created by `useObjectUrl`'s effect CLEANUP, which
      React runs as a passive effect — so the assertion below was relying on
      React having flushed that cleanup inside `fireEvent`, which is a
      scheduling detail rather than a guarantee. The empty `act` flushes
      pending passive effects synchronously and makes the ordering explicit.

      ⚠ HONESTLY: this is not a proven fix for anything. This test failed twice
      in about seven runs on 2026-09-13 and then passed **40 consecutive runs**
      (20 filtered, 20 whole-file) plus every full-suite run after, so the
      original failure was never reproduced and its cause was never confirmed.
      What is fixed is a real ordering dependency found by READING. If it fails
      again, this comment is the first place to look — and do not widen the
      1500, which is not the variable.
    */
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByText("CHANGE FILE"));
      act(() => {});
      act(() => {
        vi.advanceTimersByTime(1500);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(objectUrls.revoked).toEqual(expect.arrayContaining(objectUrls.created));
  });
});
