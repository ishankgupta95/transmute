import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MediaProbe } from "@/lib/tools/video-probe";
import type { SplitVideoResult, VideoSegment } from "@/lib/tools/video-split";

/*
  ─────────────────────────────────────────────────────────────────────────────
  What this file guards
  ─────────────────────────────────────────────────────────────────────────────
  Three defects that all lived on the SURFACE of split-video rather than in its
  engine, which is why `video-split.test.ts` could be green while every one of
  them shipped:

    1. THE CLOCK LIED AT EVERY MINUTE BOUNDARY. `formatSeconds` decomposed the
       raw value into minutes and only THEN rounded the seconds field, so a
       probed 119.96 s printed "1:60.0" and a probed 69.96 s printed "1:010.0".
       `actualSeconds` is a raw ffprobe decimal and the page's own FAQ tells
       people the ACTUAL column is the one to trust, so it may not render a
       clock value no clock permits.

    2. THE "EVERY N SEC" HINT DESCRIBED A DIFFERENT PLANNER. It promised the
       leftover "rides along on the last part rather than becoming a fragment
       of its own"; `interiorCuts` emits it as its own shorter final part and
       folds it in only when it is under MIN_SEGMENT_SECONDS. The engine is
       deliberate — its own test pins it — so the sentence was the wrong half.
       The assertion below is not "the string equals X": it is that the hint
       agrees with the part table rendered beside it.

    3. A FILE WITH NO DECLARED DURATION WAS A SILENT DEAD END. A WebM written
       by MediaRecorder — what this site's own recorders produce — probes fine
       with the `duration` key absent, so `durationSeconds` is null. The page
       showed LENGTH "—", PARTS "—", a dead button and NOT ONE MESSAGE, because
       every message channel on the surface is gated on something that is false
       in that state.

  The engine is mocked; nothing here claims FFmpeg cuts anything. The pure
  planner is the REAL one (`importOriginal`), so the plan the page draws is the
  plan the engine would run.
*/

const probeMedia = vi.fn();
const splitVideo = vi.fn();

// video-split imports `inputExtensionFor` from here, so the mock has to carry
// it as well as the probe the component calls on drop.
vi.mock("@/lib/tools/video-probe", () => ({
  probeMedia: (...args: unknown[]) => probeMedia(...args),
  inputExtensionFor: () => ".mp4",
}));

// Keeps the real planner (planSegments/parseCutTimes/the two constants) and
// stubs only the run — the plan on screen has to be the engine's own.
vi.mock("@/lib/tools/video-split", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/video-split")>();
  return { ...actual, splitVideo: (...args: unknown[]) => splitVideo(...args) };
});

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  runFFmpegTask: vi.fn(),
  validateFFmpegInput: vi.fn(),
  mountInputFile: vi.fn(),
  unmountInputFile: vi.fn(),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { SplitVideoUI } from "@/components/tools/SplitVideoUI";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "holiday.mp4", { type: "video/mp4" });
}

/** A probe that succeeded, parameterised by the one field these tests move. */
function probeOf(durationSeconds: number | null): MediaProbe {
  return {
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    durationSeconds,
    sizeBytes: 3,
    video: { codec: "h264", width: 320, height: 240, frameRate: 24, rotationDegreesClockwise: 0 },
    audio: { codec: "aac", channels: 2 },
  };
}

function segment(index: number, start: number, end: number, actualSeconds: number): VideoSegment {
  return {
    index,
    requestedStart: start,
    requestedEnd: end,
    actualSeconds,
    blob: new Blob([new Uint8Array(8)], { type: "video/mp4" }),
    fileName: `holiday-part-0${index + 1}.mp4`,
  };
}

function splitResult(segments: VideoSegment[], sourceSeconds: number): SplitVideoResult {
  return {
    blob: new Blob([new Uint8Array(16)], { type: "application/zip" }),
    fileName: "holiday-parts.zip",
    originalSize: 3,
    newSize: 16,
    segments,
    sourceSeconds,
    keyframeDrift: false,
  };
}

/** Drop a file and wait for the probe to land. */
async function dropWith(probe: MediaProbe) {
  probeMedia.mockResolvedValue(probe);
  render(<SplitVideoUI />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() => expect(screen.queryByText("READING…")).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has neither; `useObjectUrl` allocates one for the <video> preview.
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:split");
    URL.revokeObjectURL = vi.fn();
  }
});

describe("split-video — the clock never prints a value a clock cannot hold", () => {
  /*
    Both windows are 50 ms wide and sit at the top of every minute, so an
    arbitrary probed duration lands in one about once in 600. The ACTUAL column
    renders one per part, which is where it was going to be seen.
  */
  it.each([
    [119.96, "2:00.0", "1:60.0"],
    [69.96, "1:10.0", "1:010.0"],
    [3599.99, "60:00.0", "59:60.0"],
  ])(
    "renders a source length of %s s as %s, never %s",
    async (seconds, expected, brokenBefore) => {
      await dropWith(probeOf(seconds));

      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByText(brokenBefore)).not.toBeInTheDocument();
    },
  );

  it("keeps the sub-minute readings the conversion suite pins", async () => {
    // `clip-assembly.spec.ts` waits on "2.09 s" and reads "1.00 s" out of the
    // ASKED column, so the branch below a minute must not move.
    await dropWith(probeOf(2.09));
    expect(screen.getByText("2.09 s")).toBeInTheDocument();
  });

  it("prints the MEASURED length of a part, rounded as a clock and not as a carry", async () => {
    // 179.97 s off ffprobe is the ACTUAL column — the one the FAQ tells people
    // to trust. It used to render "2:60.0". The ASKED column beside it stays
    // "2:59.0", so the assertion cannot be satisfied by the wrong column.
    await dropWith(probeOf(600));
    splitVideo.mockResolvedValue(
      splitResult([segment(0, 0, 179, 179.97), segment(1, 179, 600, 421)], 600),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cut into 3 parts" }));

    await waitFor(() => expect(screen.getByText("3:00.0")).toBeInTheDocument());
    expect(screen.getByText("2:59.0")).toBeInTheDocument();
    expect(screen.queryByText("2:60.0")).not.toBeInTheDocument();
  });
});

describe("split-video — the Every N sec hint describes the planner it has", () => {
  async function everyNSec(sourceSeconds: number) {
    await dropWith(probeOf(sourceSeconds));
    fireEvent.click(screen.getByRole("button", { name: "Every N sec" }));
  }

  it("agrees with the part table beside it: 65 s at 30 s is three parts, the last one short", async () => {
    await everyNSec(65);

    // What the planner really does, drawn on the page before any click.
    expect(screen.getByRole("button", { name: "Cut into 3 parts" })).toBeInTheDocument();
    expect(screen.getByText("1:00.0 → 1:05.0")).toBeInTheDocument();

    const hint = screen.getByText(/^Cuts every/);
    // The old sentence promised the opposite of the row above.
    expect(hint.textContent).not.toMatch(/rides along/i);
    expect(hint.textContent).toMatch(/final, shorter part of its own/i);
    // …and it still names the one case that IS folded in, with the number.
    expect(hint.textContent).toMatch(/0\.05 s/);
  });

  it("does not claim a merge for a source that divides exactly either", async () => {
    await everyNSec(90);

    expect(screen.getByRole("button", { name: "Cut into 3 parts" })).toBeInTheDocument();
    expect(screen.getByText(/^Cuts every/).textContent).not.toMatch(/rides along/i);
  });
});

describe("split-video — a file that declares no length says why", () => {
  it("refuses a duration-less recording in words instead of a dead button", async () => {
    // Measured: a MediaRecorder WebM probes with `format_name` and a video
    // stream present and the `duration` key simply absent.
    await dropWith(probeOf(null));

    const messages = screen.getAllByRole("status");
    expect(messages.length, "the page has to say something").toBeGreaterThan(0);
    const said = messages.map((m) => m.textContent ?? "").join(" ");
    expect(said).toMatch(/does not carry how long it is/i);
    // And it points at the tool that fixes it rather than stopping at "no".
    expect(said).toMatch(/Video to MP4/);

    expect(screen.getByRole("button", { name: "Split" })).toBeDisabled();
  });

  it("stays silent while the probe is still running", async () => {
    // The refusal is a fact about a probe that CAME BACK without a length. A
    // pending probe must not render it — `sourceSeconds` is null there too.
    let settle!: (p: MediaProbe) => void;
    probeMedia.mockReturnValue(
      new Promise<MediaProbe>((resolve) => {
        settle = resolve;
      }),
    );
    render(<SplitVideoUI />);
    fireEvent.click(screen.getByText("drop"));

    expect(screen.getByText("READING…")).toBeInTheDocument();
    expect(screen.queryAllByRole("status")).toHaveLength(0);

    settle(probeOf(10));
    await waitFor(() => expect(screen.queryByText("READING…")).not.toBeInTheDocument());
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });
});
