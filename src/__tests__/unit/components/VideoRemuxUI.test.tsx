import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MediaProbe } from "@/lib/tools/video-probe";
import type { RemuxPlan, RemuxResult } from "@/lib/tools/video-remux";

/*
  The HEVC branch is what this tool IS.

  `-c copy` of an H.265 .mov into .mp4 succeeds and produces a valid MP4 whose
  video is still H.265 — i.e. a file that still will not play wherever the user
  was trying to put it, reported as a success. These tests pin the three
  properties that stop that:

    1. the probe's verdict, not the container, decides which path is offered;
    2. a re-encode never starts without an explicit choice;
    3. "nothing was re-encoded" is read off `RemuxResult.streamCopied` and
       never off the plan, so it can never describe a run that re-encoded.

  The copy strings are duplicated here rather than imported: a test that reads
  the constant it is checking cannot notice the constant changing, and the e2e
  suite locates these same sentences.
*/

/** Rendered from the PLAN, before a run. Future tense. */
const COPY_PLAN_NOTE =
  "NOTHING WILL BE RE-ENCODED — THE VIDEO AND AUDIO ARE COPIED ACROSS BIT FOR BIT, WHICH TAKES MILLISECONDS.";
/** Rendered from `RemuxResult.streamCopied === true`, after a run. Past tense. */
const COPIED_RESULT_NOTE =
  "NOTHING WAS RE-ENCODED — THE VIDEO AND AUDIO WERE COPIED ACROSS BIT FOR BIT.";
/** Rendered from `RemuxResult.streamCopied === false`. */
const TRANSCODED_RESULT_NOTE =
  "THIS RUN RE-ENCODED THE VIDEO TO H.264 — THE PICTURE IN THE DOWNLOAD IS A NEW ENCODE, NOT YOUR ORIGINAL.";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const probeMedia = vi.fn();
const planRemux = vi.fn();
const remuxVideo = vi.fn();

vi.mock("@/lib/tools/video-probe", () => ({
  probeMedia: (...args: unknown[]) => probeMedia(...args),
}));

vi.mock("@/lib/tools/video-remux", () => ({
  planRemux: (...args: unknown[]) => planRemux(...args),
  remuxVideo: (...args: unknown[]) => remuxVideo(...args),
  muteVideo: vi.fn(),
  rotateVideo: vi.fn(),
}));

// Two buttons so a test can swap the loaded file for a different one — the
// real zone only renders while no file is loaded, which is exactly when a
// swap happens.
vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <>
      <button onClick={() => onFiles([makeFile("first.mov")])}>drop first</button>
      <button onClick={() => onFiles([makeFile("second.mov")])}>drop second</button>
    </>
  ),
}));

import { VideoRemuxUI } from "@/components/tools/VideoRemuxUI";

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "video/quicktime" });
}

const H264_PROBE: MediaProbe = {
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  durationSeconds: 10,
  sizeBytes: 3,
  video: { codec: "h264", width: 1280, height: 720, frameRate: 30, rotationDegreesClockwise: 0 },
  audio: { codec: "aac", channels: 2 },
};

const HEVC_PROBE: MediaProbe = {
  ...H264_PROBE,
  video: { codec: "hevc", width: 1920, height: 1080, frameRate: 30, rotationDegreesClockwise: 0 },
};

const COPY_PLAN: RemuxPlan = { kind: "copy", reason: "H.264 goes into MP4 as it is." };
const TRANSCODE_PLAN: RemuxPlan = {
  kind: "transcode",
  reason: "MP4 carries H.265, but most players will not decode it.",
  estimateSeconds: 42,
};

function remuxResult(streamCopied: boolean): RemuxResult {
  return {
    blob: new Blob([new Uint8Array(64)], { type: "video/mp4" }),
    fileName: "first.mp4",
    streamCopied,
    probe: streamCopied ? H264_PROBE : HEVC_PROBE,
  };
}

function renderTool() {
  return render(<VideoRemuxUI target="mp4" acceptFormats=".mp4,.mov,.mkv,.avi" sizeCapMB={1536} />);
}

/** Drop a file and wait for the pre-flight to land. */
async function dropAndProbe(probe: MediaProbe) {
  probeMedia.mockResolvedValue(probe);
  renderTool();
  fireEvent.click(screen.getByText("drop first"));
  await waitFor(() => expect(planRemux).toHaveBeenCalled());
}

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
  planRemux.mockImplementation((probe: MediaProbe) =>
    probe.video?.codec === "hevc" ? TRANSCODE_PLAN : COPY_PLAN,
  );
});

describe("VideoRemuxUI — the probe decides which path is on offer", () => {
  it("offers a plain conversion, and no decision, when the stream copies straight across", async () => {
    await dropAndProbe(H264_PROBE);

    expect(await screen.findByText(COPY_PLAN_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Convert" })).toBeEnabled();
    // Nothing to decide: the re-encode choice must not exist on this path.
    expect(screen.queryByRole("button", { name: "Re-encode to H.264" })).toBeNull();
  });

  it("names the codec it found and refuses to start on a file that needs a re-encode", async () => {
    await dropAndProbe(HEVC_PROBE);

    expect(await screen.findByText(/This recording is H\.265 \(HEVC\)/)).toBeInTheDocument();
    // "no re-encode" must never be claimed over a file that needs one.
    expect(screen.queryByText(COPY_PLAN_NOTE)).toBeNull();
    expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
  });

  it("starts no transcode until the user picks it by name", async () => {
    await dropAndProbe(HEVC_PROBE);
    await screen.findByRole("button", { name: "Re-encode to H.264" });

    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    // A disabled primary is not enough on its own — the engine must be untouched.
    expect(remuxVideo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Re-encode to H.264" }));
    remuxVideo.mockResolvedValue(remuxResult(false));
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => expect(remuxVideo).toHaveBeenCalledTimes(1));
    expect(remuxVideo.mock.calls[0][1]).toBe("mp4");
    expect(remuxVideo.mock.calls[0][2]).toEqual({ allowTranscode: true });
  });

  it("sends allowTranscode false on the copy path, so an incompatible stream throws instead of copying", async () => {
    await dropAndProbe(H264_PROBE);
    remuxVideo.mockResolvedValue(remuxResult(true));

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));

    await waitFor(() => expect(remuxVideo).toHaveBeenCalledTimes(1));
    expect(remuxVideo.mock.calls[0][2]).toEqual({ allowTranscode: false });
  });
});

describe("VideoRemuxUI — the no-re-encode claim comes off the result", () => {
  it("says nothing was re-encoded when the engine reports a stream copy", async () => {
    await dropAndProbe(H264_PROBE);
    remuxVideo.mockResolvedValue(remuxResult(true));

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));

    expect(await screen.findByText(COPIED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(TRANSCODED_RESULT_NOTE)).toBeNull();
  });

  it("never says it on a run that re-encoded", async () => {
    await dropAndProbe(HEVC_PROBE);
    fireEvent.click(await screen.findByRole("button", { name: "Re-encode to H.264" }));
    remuxVideo.mockResolvedValue(remuxResult(false));

    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    expect(await screen.findByText(TRANSCODED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
    expect(screen.queryByText(COPY_PLAN_NOTE)).toBeNull();
  });

  it("believes the result over the plan when the two disagree", async () => {
    // The plan said this would copy. The engine says it did not. The sentence
    // on screen has to describe the RUN — this is the case that a
    // plan-derived claim gets wrong.
    await dropAndProbe(H264_PROBE);
    remuxVideo.mockResolvedValue(remuxResult(false));

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));

    expect(await screen.findByText(TRANSCODED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });
});

describe("VideoRemuxUI — a superseded run binds nothing", () => {
  it("drops a run that was cancelled while FFmpeg still held it", async () => {
    await dropAndProbe(H264_PROBE);
    const run = deferred<RemuxResult>();
    remuxVideo.mockReturnValueOnce(run.promise);

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));
    await waitFor(() => expect(remuxVideo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    run.resolve(remuxResult(true));

    // The primary is back, which only happens once the run has been dropped.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Convert" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });

  it("drops a pre-flight that lands after the file was swapped", async () => {
    /*
      Key the probe off the FILE, not off call order. `probeMedia` is reached
      through a dynamic import(), so both drops' handlers resolve on microtasks
      and there is no guarantee the first handler calls probeMedia before the
      second does — a mockReturnValueOnce chain would hand the new file the
      abandoned file's verdict all by itself and test the mock, not the fence.
    */
    const first = deferred<MediaProbe>();
    const second = deferred<MediaProbe>();
    probeMedia.mockImplementation((file: File) =>
      file.name === "first.mov" ? first.promise : second.promise,
    );
    renderTool();

    fireEvent.click(screen.getByText("drop first"));
    // Let the first pre-flight actually START before swapping. Firing all three
    // clicks in one synchronous tick races the component's own dynamic
    // import() of the probe module, which no user can do — the swap would land
    // before the first handler has resumed at all, and the test would be
    // measuring vitest's module resolution rather than the fence.
    await waitFor(() => expect(probeMedia).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "CHANGE FILE" }));
    fireEvent.click(screen.getByText("drop second"));

    /*
      Order matters, and it is the whole test. The NEW file's probe lands
      first; the ABANDONED file's slow H.265 probe lands after it. Without the
      run-token fence that late verdict overwrites the correct one and the page
      offers to re-encode a file that never needed it. Resolving them the other
      way round passes with or without the fence, because the new verdict
      simply lands last.
    */
    second.resolve(H264_PROBE);
    await waitFor(() => expect(planRemux).toHaveBeenCalled());
    first.resolve(HEVC_PROBE);

    expect(await screen.findByText(COPY_PLAN_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/This recording is H\.265 \(HEVC\)/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-encode to H.264" })).toBeNull();
  });

  it("keeps the primary shut while the pre-flight is still reading the file", () => {
    probeMedia.mockReturnValue(deferred<MediaProbe>().promise);
    renderTool();

    fireEvent.click(screen.getByText("drop first"));

    expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
    expect(remuxVideo).not.toHaveBeenCalled();
  });

  it("keeps the primary shut when the file could not be read at all", async () => {
    probeMedia.mockRejectedValue(new Error("This file is not a video."));
    renderTool();

    fireEvent.click(screen.getByText("drop first"));

    expect(await screen.findByRole("alert")).toHaveTextContent("This file is not a video.");
    expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();
    expect(planRemux).not.toHaveBeenCalled();
  });
});
