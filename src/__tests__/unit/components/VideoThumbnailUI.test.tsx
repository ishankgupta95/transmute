import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  Same dead end as /video-to-images, same reasoning: "Capture frame" is disabled
  until a clip length resolves, so a file this tab cannot open leaves the page's
  only control greyed out. The page has to SAY which of the two things went
  wrong, because they have different remedies — a container with no demuxer is
  fixed by re-containering, and a clip whose length never resolved is not the
  same complaint.
*/

const mockResolveDuration = vi.fn();

vi.mock("@/lib/tools/video-utils", () => ({
  resolveDuration: (...args: unknown[]) => mockResolveDuration(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([new File([new Uint8Array([1, 2, 3])], "holiday.avi")])}>
      drop
    </button>
  ),
}));

import { VideoThumbnailUI } from "@/components/tools/VideoThumbnailUI";
import {
  UNPLAYABLE_SOURCE_MESSAGE,
  UNREADABLE_DURATION_MESSAGE,
} from "@/lib/tools/video-frames";

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:video-thumbnail-test");
  globalThis.URL.revokeObjectURL = vi.fn();
  mockResolveDuration.mockResolvedValue(10);
});

async function dropAndFindVideo(): Promise<HTMLVideoElement> {
  fireEvent.click(screen.getByText("drop"));
  return waitFor(() => {
    const el = document.querySelector("video");
    expect(el).not.toBeNull();
    return el as HTMLVideoElement;
  });
}

describe("VideoThumbnailUI — a file the tab cannot open is never a silent dead end", () => {
  it("names the container as the problem when the element refuses the file", async () => {
    render(<VideoThumbnailUI />);
    const video = await dropAndFindVideo();

    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.error(video);

    expect(await screen.findByRole("alert")).toHaveTextContent(UNPLAYABLE_SOURCE_MESSAGE);
    expect(screen.getByRole("button", { name: "Capture frame" })).toBeDisabled();
  });

  it("blames the LENGTH, not the container, when metadata arrives without a duration", async () => {
    mockResolveDuration.mockResolvedValue(0);
    render(<VideoThumbnailUI />);
    const video = await dropAndFindVideo();

    fireEvent.loadedMetadata(video);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(UNREADABLE_DURATION_MESSAGE);
    expect(alert).not.toHaveTextContent(UNPLAYABLE_SOURCE_MESSAGE);
  });

  it("says nothing once a real duration lands, and enables the capture", async () => {
    render(<VideoThumbnailUI />);
    const video = await dropAndFindVideo();

    fireEvent.loadedMetadata(video);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Capture frame" })).toBeEnabled(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
