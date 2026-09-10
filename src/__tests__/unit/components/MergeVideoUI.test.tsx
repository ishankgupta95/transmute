import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MergeInputInfo } from "@/lib/tools/video-merge";

/*
  ─────────────────────────────────────────────────────────────────────────────
  What this file guards
  ─────────────────────────────────────────────────────────────────────────────
  The one refusal on this page that used to arrive AFTER the click.

  The drop zone prints "MAX 1.5 GB" and enforces it PER FILE. The engine's
  ceiling is the same number applied to the TOTAL across the queue, because a
  join writes the parts and the whole into the same virtual filesystem at once.
  On a tool that needs at least two files, the per-file reading is never the one
  that decides a run — so a queue of two 900 MB clips passed the zone, probed
  cleanly, showed READY and an enabled "Join 2 clips", and was refused only once
  the user pressed it.

  Every other refusal here is a pre-flight: the mismatch table exists precisely
  so a set that cannot be joined is named while the queue is being built. These
  tests pin the size refusal to that same principle, and pin it to the ENGINE'S
  OWN SENTENCE — `describeSizeRefusal` is imported by both, so the page and the
  throw cannot drift into two different numbers.

  The engine is mocked; nothing here claims FFmpeg joins anything. The pure
  comparison and the pure size check are the REAL ones (`importOriginal`).
*/

const checkMergeCompatibility = vi.fn();
const mergeVideos = vi.fn();

// video-merge reads STREAM_COPY_MAX_INPUT_BYTES from here, so the mock has to
// carry the real ceiling — the whole point of these tests is the threshold.
vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  runFFmpegTask: vi.fn(),
  validateFFmpegInput: vi.fn(),
  mountInputFile: vi.fn(),
  unmountInputFile: vi.fn(),
  fileToUint8Array: vi.fn(),
  STREAM_COPY_MAX_INPUT_BYTES: 1536 * 1024 * 1024,
}));

// Keeps the real `compareMergeInputs`, `describeSizeRefusal` and
// `MERGE_TOTAL_MAX_BYTES`; stubs only the two functions that touch FFmpeg.
vi.mock("@/lib/tools/video-merge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/video-merge")>();
  return {
    ...actual,
    checkMergeCompatibility: (...args: unknown[]) => checkMergeCompatibility(...args),
    mergeVideos: (...args: unknown[]) => mergeVideos(...args),
  };
});

let dropped: File[] = [];

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles(dropped)}>drop</button>
  ),
}));

import { MergeVideoUI } from "@/components/tools/MergeVideoUI";

const MB = 1024 * 1024;

function clip(name: string, sizeBytes: number): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

/** Everything about a clip that the page compares, all clips identical. */
function infoFor(fileName: string): MergeInputInfo {
  return {
    fileName,
    durationSeconds: 60,
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    timeBase: "1/57600",
    videoCodec: "h264",
    width: 1920,
    height: 1080,
    pixFmt: "yuv420p",
    frameRate: "24/1",
    audioCodec: "aac",
    sampleRate: 44100,
    channels: 2,
  };
}

/** Drop a queue and wait until every clip has been probed. */
async function dropQueue(files: File[]) {
  dropped = files;
  render(<MergeVideoUI />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() =>
    expect(checkMergeCompatibility).toHaveBeenCalledTimes(files.length),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dropped = [];
  checkMergeCompatibility.mockImplementation(async (files: File[]) => ({
    infos: files.map((f) => infoFor(f.name)),
    mismatches: [],
  }));
});

describe("MergeVideoUI — the size ceiling is the queue's, and it is enforced before the click", () => {
  it("blocks a queue whose clips are each legal and whose total is not", async () => {
    // Two ordinary clips: 4K phone footage runs roughly 400 MB a minute, so
    // this is a pair of ~2-minute videos, both far under the zone's 1.5 GB
    // badge and together over the ceiling that actually decides the run.
    await dropQueue([clip("a.mp4", 900 * MB), clip("b.mp4", 900 * MB)]);

    const join = await screen.findByRole("button", { name: /Join 2 clips/i });
    expect(join).toBeDisabled();

    // And the reason is on screen while the queue can still be edited — not
    // discovered by pressing a button that looked ready.
    expect(screen.getByText(/1536 MB in total, not per clip/i)).toBeTruthy();
    expect(screen.getByText(/1800 MB/)).toBeTruthy();
    expect(mergeVideos).not.toHaveBeenCalled();
  });

  it("says the total is what the ceiling measures, before anything is dropped", async () => {
    render(<MergeVideoUI />);
    // The zone's badge prints "MAX 1.5 GB" with no unit of aggregation. On a
    // tool that needs two files, the page owes the user the aggregation.
    expect(
      screen.getByText(/1\.5 GB is the total for the whole queue, not each clip/i),
    ).toBeTruthy();
  });

  it("leaves an ordinary queue runnable, so the gate is not blanket", async () => {
    await dropQueue([clip("a.mp4", 200 * MB), clip("b.mp4", 200 * MB)]);

    const join = await screen.findByRole("button", { name: /Join 2 clips/i });
    await waitFor(() => expect(join).toBeEnabled());
    expect(screen.queryByText(/in total, not per clip/i)).toBeNull();
  });
});
