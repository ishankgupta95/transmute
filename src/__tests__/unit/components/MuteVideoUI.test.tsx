import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MediaProbe } from "@/lib/tools/video-probe";
import type { RemuxResult } from "@/lib/tools/video-remux";

/*
  `-an -c copy` on a file that has no audio track SUCCEEDS. It writes a
  near-identical file and exits 0, and a tool that ran it blind would report
  "audio removed" for work that never happened. The pre-flight is what stops
  that, so it is the first thing pinned here.

  The second is the same rule the whole cluster runs on: the claim that the
  picture came through untouched is read off `RemuxResult.streamCopied` and
  nothing else.

  Copy strings are duplicated rather than imported — a test that reads the
  constant it checks cannot notice the constant changing.
*/

const NO_AUDIO_MESSAGE =
  "This video has no audio track, so there is nothing here to remove. Muting it would hand you back a copy of the file you already have.";
const COPIED_RESULT_NOTE =
  "THE AUDIO TRACK IS GONE AND THE PICTURE WAS NOT RE-ENCODED — THE VIDEO WAS COPIED ACROSS BIT FOR BIT.";
const TRANSCODED_RESULT_NOTE =
  "THE AUDIO TRACK IS GONE, BUT THIS RUN DID NOT COPY THE VIDEO ACROSS UNTOUCHED — THE PICTURE IN THE DOWNLOAD IS A NEW ENCODE.";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const probeMedia = vi.fn();
const muteVideo = vi.fn();

vi.mock("@/lib/tools/video-probe", () => ({
  probeMedia: (...args: unknown[]) => probeMedia(...args),
}));

vi.mock("@/lib/tools/video-remux", () => ({
  muteVideo: (...args: unknown[]) => muteVideo(...args),
  planRemux: vi.fn(),
  remuxVideo: vi.fn(),
  rotateVideo: vi.fn(),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { MuteVideoUI } from "@/components/tools/MuteVideoUI";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "holiday.mp4", { type: "video/mp4" });
}

const WITH_AUDIO: MediaProbe = {
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  durationSeconds: 12,
  sizeBytes: 3,
  video: { codec: "h264", width: 1280, height: 720, frameRate: 30, rotationDegreesClockwise: 0 },
  audio: { codec: "aac", channels: 2 },
};

const SILENT: MediaProbe = { ...WITH_AUDIO, audio: null };

function muteResult(streamCopied: boolean): RemuxResult {
  return {
    blob: new Blob([new Uint8Array(48)], { type: "video/mp4" }),
    fileName: "holiday-muted.mp4",
    streamCopied,
    probe: WITH_AUDIO,
  };
}

async function dropAndProbe(probe: MediaProbe) {
  probeMedia.mockResolvedValue(probe);
  render(<MuteVideoUI acceptFormats=".mp4,.webm,.mov,.avi,.mkv" sizeCapMB={1536} />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() => expect(probeMedia).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("MuteVideoUI — a file with nothing to mute is told so", () => {
  it("refuses a video that carries no audio track at all", async () => {
    await dropAndProbe(SILENT);

    expect(await screen.findByText(NO_AUDIO_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove audio" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove audio" }));
    expect(muteVideo).not.toHaveBeenCalled();
  });

  it("runs on a video that does carry one", async () => {
    await dropAndProbe(WITH_AUDIO);
    muteVideo.mockResolvedValue(muteResult(true));

    const primary = await screen.findByRole("button", { name: "Remove audio" });
    expect(primary).toBeEnabled();
    expect(screen.queryByText(NO_AUDIO_MESSAGE)).toBeNull();
    fireEvent.click(primary);

    await waitFor(() => expect(muteVideo).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("button", { name: "Download holiday-muted.mp4" }),
    ).toBeInTheDocument();
  });

  it("keeps the primary shut until the pre-flight has landed", () => {
    probeMedia.mockReturnValue(deferred<MediaProbe>().promise);
    render(<MuteVideoUI acceptFormats=".mp4" sizeCapMB={1536} />);

    fireEvent.click(screen.getByText("drop"));

    expect(screen.getByRole("button", { name: "Remove audio" })).toBeDisabled();
    expect(muteVideo).not.toHaveBeenCalled();
  });
});

describe("MuteVideoUI — the untouched-picture claim comes off the result", () => {
  it("says the video was copied across when the engine reports a stream copy", async () => {
    await dropAndProbe(WITH_AUDIO);
    muteVideo.mockResolvedValue(muteResult(true));

    fireEvent.click(await screen.findByRole("button", { name: "Remove audio" }));

    expect(await screen.findByText(COPIED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(TRANSCODED_RESULT_NOTE)).toBeNull();
  });

  it("never says it on a run the engine did not stream-copy", async () => {
    await dropAndProbe(WITH_AUDIO);
    muteVideo.mockResolvedValue(muteResult(false));

    fireEvent.click(await screen.findByRole("button", { name: "Remove audio" }));

    expect(await screen.findByText(TRANSCODED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });
});

describe("MuteVideoUI — a superseded run binds nothing", () => {
  it("drops a run that was cancelled while FFmpeg still held it", async () => {
    await dropAndProbe(WITH_AUDIO);
    const run = deferred<RemuxResult>();
    muteVideo.mockReturnValueOnce(run.promise);

    fireEvent.click(await screen.findByRole("button", { name: "Remove audio" }));
    await waitFor(() => expect(muteVideo).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    run.resolve(muteResult(true));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove audio" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });
});
