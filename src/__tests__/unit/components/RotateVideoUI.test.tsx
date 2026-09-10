import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RemuxResult } from "@/lib/tools/video-remux";
import type { MediaProbe } from "@/lib/tools/video-probe";

/*
  rotate-video is one argv and one control, so the things worth pinning are the
  three the user can be lied to about:

    1. the control offers exactly the three quarter-turns the engine accepts,
       and the angle that RUNS is the angle on screen;
    2. changing the angle after a run drops the finished download, so Download
       can never hand back a rotation the rail no longer describes;
    3. "not one pixel was touched" is read off `RemuxResult.streamCopied` —
       the whole product here is that the frames are never decoded, and that
       claim must come from the run rather than from the intent.

  Copy strings are duplicated rather than imported, so the test notices the
  constant changing.
*/

const COPIED_RESULT_NOTE =
  "NOT ONE PIXEL WAS TOUCHED — THE ROTATION FLAG WAS REWRITTEN AND THE VIDEO AND AUDIO WERE COPIED ACROSS BIT FOR BIT.";
const TRANSCODED_RESULT_NOTE =
  "THIS RUN DID NOT COPY THE STREAMS ACROSS UNTOUCHED — THE PICTURE IN THE DOWNLOAD IS A NEW ENCODE, NOT YOUR ORIGINAL.";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const probeMedia = vi.fn();
const rotateVideo = vi.fn();

// RotateVideoUI probes on drop and stays blocked until the probe resolves, so
// this mock is load-bearing: without it the real ffprobe runs under jsdom and
// every control below stays disabled.
vi.mock("@/lib/tools/video-probe", () => ({
  probeMedia: (...args: unknown[]) => probeMedia(...args),
}));

vi.mock("@/lib/tools/video-remux", () => ({
  rotateVideo: (...args: unknown[]) => rotateVideo(...args),
  planRemux: vi.fn(),
  remuxVideo: vi.fn(),
  muteVideo: vi.fn(),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { RotateVideoUI } from "@/components/tools/RotateVideoUI";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "portrait.mp4", { type: "video/mp4" });
}

function rotateResult(streamCopied: boolean): RemuxResult {
  return {
    blob: new Blob([new Uint8Array(48)], { type: "video/mp4" }),
    fileName: "portrait-rotated.mp4",
    streamCopied,
    probe: {
      container: "mov,mp4,m4a,3gp,3g2,mj2",
      durationSeconds: 10,
      sizeBytes: 3,
      video: { codec: "h264", width: 1280, height: 720, frameRate: 30, rotationDegreesClockwise: 0 },
      audio: { codec: "aac", channels: 2 },
    },
  };
}

const PROBE: MediaProbe = {
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  durationSeconds: 10,
  sizeBytes: 3,
  video: { codec: "h264", width: 1280, height: 720, frameRate: 30, rotationDegreesClockwise: 0 },
  audio: { codec: "aac", channels: 2 },
};

async function loadFile() {
  probeMedia.mockResolvedValue(PROBE);
  render(<RotateVideoUI acceptFormats=".mp4,.webm,.mov,.avi,.mkv" sizeCapMB={1536} />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() => expect(probeMedia).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("RotateVideoUI — the angle on screen is the angle that runs", () => {
  it("offers exactly the three quarter-turns, starting at 90°", async () => {
    await loadFile();

    expect(screen.getByRole("button", { name: "90° right" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "180°" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "90° left" })).toHaveAttribute("aria-pressed", "false");
    // A fourth chip would be an angle the engine's `RotationDegrees` refuses.
    expect(screen.getByRole("group", { name: "Rotation" }).querySelectorAll("button")).toHaveLength(
      3,
    );
  });

  it("sends the chosen angle to the engine", async () => {
    rotateVideo.mockResolvedValue(rotateResult(true));
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "90° left" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    await waitFor(() => expect(rotateVideo).toHaveBeenCalledTimes(1));
    expect(rotateVideo.mock.calls[0][1]).toBe(270);
  });

  it("drops the finished download when the angle changes under it", async () => {
    rotateVideo.mockResolvedValue(rotateResult(true));
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    expect(
      await screen.findByRole("button", { name: "Download portrait-rotated.mp4" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "180°" }));

    // The rail now says 180°; the file behind Download was built at 90°.
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });
});

describe("RotateVideoUI — the lossless claim comes off the result", () => {
  it("says no pixel was touched when the engine reports a stream copy", async () => {
    rotateVideo.mockResolvedValue(rotateResult(true));
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    expect(await screen.findByText(COPIED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(TRANSCODED_RESULT_NOTE)).toBeNull();
  });

  it("never says it on a run the engine did not stream-copy", async () => {
    rotateVideo.mockResolvedValue(rotateResult(false));
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    expect(await screen.findByText(TRANSCODED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });
});

describe("RotateVideoUI — a superseded run binds nothing", () => {
  it("drops a run that was cancelled while FFmpeg still held it", async () => {
    const run = deferred<RemuxResult>();
    rotateVideo.mockReturnValueOnce(run.promise);
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    await waitFor(() => expect(rotateVideo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    run.resolve(rotateResult(true));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });
});
