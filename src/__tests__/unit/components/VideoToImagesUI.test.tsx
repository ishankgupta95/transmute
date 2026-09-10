import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  What is pinned here is the DEAD END, not the decode.

  "Extract frames" is disabled until a clip length resolves, which means every
  way a file can fail to open ends with the page's only button greyed out. Until
  this test existed the page said nothing at all in that state: no ErrorMessage,
  no warning, just a broken media element and a dead control. The two ways it
  happens need DIFFERENT sentences, and the wrong one is a new inaccuracy rather
  than a fix — telling someone whose container has no demuxer that we couldn't
  read the clip's LENGTH sends them to fix the wrong thing.

  jsdom never loads media, so the events are dispatched directly. That is the
  whole mechanism: the browser fires `error` on the element, or fires
  `loadedmetadata` with a duration that never resolves.
*/

const mockResolveDuration = vi.fn();

vi.mock("@/lib/tools/video-utils", () => ({
  resolveDuration: (...args: unknown[]) => mockResolveDuration(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([new File([new Uint8Array([1, 2, 3])], "lecture.avi")])}>
      drop
    </button>
  ),
}));

import { VideoToImagesUI } from "@/components/tools/VideoToImagesUI";
import {
  UNPLAYABLE_SOURCE_MESSAGE,
  UNREADABLE_DURATION_MESSAGE,
} from "@/lib/tools/video-frames";

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:video-to-images-test");
  globalThis.URL.revokeObjectURL = vi.fn();
  mockResolveDuration.mockResolvedValue(10);
});

/** Drop a file and hand back the `<video>` the page put on screen. */
async function dropAndFindVideo(): Promise<HTMLVideoElement> {
  fireEvent.click(screen.getByText("drop"));
  const video = await waitFor(() => {
    const el = document.querySelector("video");
    expect(el).not.toBeNull();
    return el as HTMLVideoElement;
  });
  return video;
}

describe("VideoToImagesUI — a file the tab cannot open is never a silent dead end", () => {
  it("names the container as the problem when the element refuses the file", async () => {
    render(<VideoToImagesUI />);
    const video = await dropAndFindVideo();

    // Nothing on screen yet — this is the state that used to be permanent.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.error(video);

    expect(await screen.findByRole("alert")).toHaveTextContent(UNPLAYABLE_SOURCE_MESSAGE);
    expect(screen.getByRole("button", { name: "Extract frames" })).toBeDisabled();
  });

  it("blames the LENGTH, not the container, when metadata arrives without a duration", async () => {
    // A file the browser opened fine and then could not measure. Sending this
    // user to re-container the clip would be the wrong instruction.
    mockResolveDuration.mockResolvedValue(Number.POSITIVE_INFINITY);
    render(<VideoToImagesUI />);
    const video = await dropAndFindVideo();

    fireEvent.loadedMetadata(video);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(UNREADABLE_DURATION_MESSAGE);
    expect(alert).not.toHaveTextContent(UNPLAYABLE_SOURCE_MESSAGE);
  });

  it("says nothing once a real duration lands, and enables the run", async () => {
    render(<VideoToImagesUI />);
    const video = await dropAndFindVideo();

    fireEvent.loadedMetadata(video);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Extract frames" })).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("VideoToImagesUI — the ceiling panel", () => {
  it("does not tell the reader that a long run costs memory rather than time", async () => {
    render(<VideoToImagesUI />);
    const video = await dropAndFindVideo();
    fireEvent.loadedMetadata(video);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Extract frames" })).toBeEnabled(),
    );

    const surface = document.body.textContent ?? "";
    /*
      MEASURED, and the reason this assertion exists: the walk plays the clip at
      roughly real speed up to the last planned moment, so four frames out of a
      45-minute lecture cost tens of minutes while a capped 300-frame run over
      the same clip costs five. The panel used to say the opposite in one
      sentence — "a very long run is what runs the tab out of memory rather than
      what finishes slowly".
    */
    expect(surface).not.toContain("rather than what finishes slowly");
    expect(surface).toContain("Time is the other cost");
    expect(surface).toContain("about as long as playing that stretch of video");
  });
});
