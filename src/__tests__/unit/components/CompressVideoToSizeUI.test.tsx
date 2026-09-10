import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { VideoSizeTargetOutcome } from "@/lib/tools/video-compress";

/*
  THE SIZE-TARGET SURFACE of CompressVideoUI (`compress-video-to-size`).

  Its own file rather than a block in CompressVideoUI.test.tsx, because that
  file's whole point is BARE jsdom — no WebCodecs, no mocked DropZone — and the
  module mocks below would erase the surface it is checking.

  What is pinned here is the honesty, not the layout: the ceiling is a seed the
  user can overwrite, the engine is asked for the number on screen, and the
  verdict after a run describes the file that exists rather than the one that
  was requested.
*/

const compressVideo = vi.fn();

vi.mock("@/lib/tools/video-compress", () => ({
  compressVideo: (...args: unknown[]) => compressVideo(...args),
}));

vi.mock("@/lib/tools/media-preview", () => ({
  // Decoration only in this component, and it needs a real <video> to run.
  extractFilmstrip: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import {
  CompressVideoUI,
  encodePipelineProblem,
  sourceCappedText,
  targetOutcomeText,
} from "@/components/tools/CompressVideoUI";

const MB = 1024 * 1024;

function makeFile(): File {
  const file = new File(["v"], "holiday.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: 80 * MB });
  return file;
}

function plan(over: Partial<VideoSizeTargetOutcome> = {}): VideoSizeTargetOutcome {
  return {
    videoBitrate: 788_529,
    audioBitrate: 128_000,
    maxHeight: 480,
    atFloor: false,
    sourceCapped: false,
    targetBytes: 10 * MB,
    met: true,
    ...over,
  };
}

/** What `compressVideo` hands back, sized to whatever the case needs. */
function resultOf(bytes: number, sizeTarget?: VideoSizeTargetOutcome) {
  return {
    blob: new Blob([new Uint8Array(1)], { type: "video/mp4" }),
    fileName: "holiday-compressed.mp4",
    originalSize: 80 * MB,
    newSize: bytes,
    ...(sizeTarget ? { sizeTarget } : {}),
  };
}

/**
 * A browser, as the pre-flight sees one.
 *
 * `stubWebCodecs` below defines the four constructors and nothing else, which
 * is the shape `isWebCodecsEncodeSupported` was happy with and WebKit and
 * Gecko both satisfy. This one answers the questions the probe actually asks:
 * whether AAC is encodable, and whether a video chunk comes back carrying the
 * codec description mp4-muxer needs.
 */
function stubBrowser(opts: {
  aac?: boolean | "throws";
  h264?: boolean;
  decoderConfig?: boolean;
}) {
  const { aac = true, h264 = true, decoderConfig = true } = opts;

  function FakeAudioEncoder() {
    return { configure() {}, encode() {}, flush: async () => {}, close() {}, state: "configured" };
  }
  FakeAudioEncoder.isConfigSupported = async () => {
    if (aac === "throws") throw new TypeError("unrecognized codec");
    return { supported: aac, config: {} };
  };
  vi.stubGlobal("AudioEncoder", FakeAudioEncoder);

  function FakeVideoEncoder(this: unknown, init: VideoEncoderInit) {
    return {
      state: "configured",
      configure() {},
      encode() {
        init.output(
          { type: "key", timestamp: 0 } as unknown as EncodedVideoChunk,
          (decoderConfig
            ? { decoderConfig: { codec: "avc1.42001f" } }
            : {}) as EncodedVideoChunkMetadata,
        );
      },
      flush: async () => {},
      close() {},
    };
  }
  FakeVideoEncoder.isConfigSupported = async (config: VideoEncoderConfig) => ({
    supported: h264,
    config,
  });
  vi.stubGlobal("VideoEncoder", FakeVideoEncoder);

  vi.stubGlobal("VideoFrame", function FakeVideoFrame() {
    return { close() {} };
  });
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    value() {},
    configurable: true,
  });
}

function stubWebCodecs() {
  vi.stubGlobal("VideoEncoder", function VideoEncoder() {});
  vi.stubGlobal("AudioEncoder", function AudioEncoder() {});
  vi.stubGlobal("VideoFrame", function VideoFrame() {});
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    value() {},
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubWebCodecs();
  vi.stubGlobal("URL", {
    ...globalThis.URL,
    createObjectURL: vi.fn().mockReturnValue("blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLVideoElement.prototype as { requestVideoFrameCallback?: unknown })
    .requestVideoFrameCallback;
});

function loadFile(props: Parameters<typeof CompressVideoUI>[0] = {}) {
  render(<CompressVideoUI {...props} />);
  fireEvent.click(screen.getByText("drop"));
}

const mbField = () => screen.getByLabelText("Target file size in MB") as HTMLInputElement;

describe("CompressVideoUI — the size-target rail", () => {
  it("asks for a ceiling in MB, not for one of the three presets", () => {
    loadFile({ mode: "target-size" });

    expect(mbField()).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Target size preset" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Compression preset" })).toBeNull();
  });

  it("leaves the preset page alone", () => {
    // The same component serves both slugs; the preset page must not grow an
    // MB field it never had.
    loadFile();

    expect(screen.queryByLabelText("Target file size in MB")).toBeNull();
    expect(screen.getByRole("group", { name: "Compression preset" })).toBeInTheDocument();
  });

  it("offers the three ceilings people actually run into", () => {
    loadFile({ mode: "target-size" });

    const group = screen.getByRole("group", { name: "Target size preset" });
    expect(group).toHaveTextContent("Email");
    expect(group).toHaveTextContent("25 MB");
    expect(group).toHaveTextContent("WhatsApp");
    expect(group).toHaveTextContent("16 MB");
    expect(group).toHaveTextContent("Discord");
    expect(group).toHaveTextContent("10 MB");
  });

  it("treats a ceiling preset as a SEED the field can overwrite, not a lock", () => {
    /*
      The whole point of the `defaultTargetSizeKb` seam this mirrors. A preset
      that could not be edited afterwards would be three tools, not one field.
    */
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: /Discord/ }));
    expect(mbField().value).toBe("10");

    fireEvent.change(mbField(), { target: { value: "7" } });
    expect(mbField().value).toBe("7");
    expect(screen.getByRole("button", { name: /Discord/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("pre-fills the field from the registry seed", () => {
    loadFile({ mode: "target-size", defaultTargetSizeKb: 16 * 1024 });

    expect(mbField().value).toBe("16");
  });

  it("asks the engine for the number on screen, in KB", async () => {
    compressVideo.mockResolvedValue(resultOf(9 * MB, plan()));
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: /WhatsApp/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));

    await waitFor(() => expect(compressVideo).toHaveBeenCalledTimes(1));
    expect(compressVideo.mock.calls[0][1]).toEqual({ targetSizeKb: 16 * 1024 });
  });

  it("refuses to run on a cleared ceiling instead of encoding at the floor", () => {
    loadFile({ mode: "target-size" });

    fireEvent.change(mbField(), { target: { value: "0" } });

    expect(screen.getByRole("button", { name: "Compress" })).toBeDisabled();
    expect(screen.getByText("SET A TARGET")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    expect(compressVideo).not.toHaveBeenCalled();
  });

  it("drops the finished file when the ceiling changes under it", async () => {
    compressVideo.mockResolvedValue(resultOf(9 * MB, plan()));
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    await screen.findByRole("button", { name: /^Download / });

    fireEvent.click(screen.getByRole("button", { name: /Discord/ }));

    // Otherwise the header reads "≤ 10 MB" over a download built for 25 MB.
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Compress" })).toBeInTheDocument();
  });

  it("still pre-flights WebCodecs on this page", () => {
    // The Wave-0 guard. Without it Safari and Firefox get a raw internal error
    // minutes into an encode that was never going to work.
    vi.unstubAllGlobals();
    render(<CompressVideoUI mode="target-size" />);

    expect(screen.getByRole("alert")).toHaveTextContent(/WebCodecs/);
  });
});

describe("CompressVideoUI — the verdict describes the file that exists", () => {
  it("says it fits, and shows the size it actually reached", async () => {
    compressVideo.mockResolvedValue(resultOf(9_800_000, plan({ met: true })));
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: /Discord/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));

    expect(await screen.findByText(/UNDER THE 10 MB CEILING/)).toBeInTheDocument();
    expect(screen.getByText(/UNDER THE 10 MB CEILING/)).toHaveTextContent(/9\.3 MB/);
  });

  it("NEVER presents an overshoot as a success", async () => {
    /*
      The failure this tool exists to avoid. `met` came back false, so the page
      must say the ceiling was missed and name the size it got — not print
      "done" over a file that is 40% too big.
    */
    compressVideo.mockResolvedValue(resultOf(14 * MB, plan({ met: false })));
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: /Discord/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));

    expect(await screen.findByText(/MISSED THE 10 MB CEILING/)).toBeInTheDocument();
    expect(screen.queryByText(/UNDER THE 10 MB CEILING/)).toBeNull();
    // …and the download is still offered, because the closest file is the
    // honest thing to hand back.
    expect(screen.getByRole("button", { name: /^Download / })).toBeInTheDocument();
  });

  it("names the floor when the clip was never going to fit", async () => {
    compressVideo.mockResolvedValue(
      resultOf(38 * MB, plan({ met: false, atFloor: true, videoBitrate: 120_000 })),
    );
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: /Discord/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));

    expect(await screen.findByText(/COULD NOT REACH 10 MB/)).toBeInTheDocument();
  });

  it("discloses that a lean clip was not padded out to fill the ceiling", async () => {
    compressVideo.mockResolvedValue(resultOf(4 * MB, plan({ met: true, sourceCapped: true })));
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: /Discord/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));

    expect(await screen.findByText(/ALREADY SPENDS LESS THAN 10 MB/)).toHaveTextContent(
      /DOES NOT INFLATE A FILE TO FILL A CEILING/,
    );
  });

  it("never claims it does not inflate over a download that is BIGGER than the input", async () => {
    /*
      The defect this whole footnote had: it was gated on `sourceCapped` alone
      — the cap having been APPLIED — and said "THIS TOOL DOES NOT INFLATE A
      FILE TO FILL A CEILING" whatever came out. A 20 s screencast spending
      36 kbps is under `SIZE_TARGET_MIN_VIDEO_BITRATE`, so the floor raises the
      encode above the source's own rate: 87.6 KB in, 238.3 KB out, with that
      sentence on screen beside it.

      The 80 MB source here is `makeFile()`; the run comes back at 96 MB.
    */
    compressVideo.mockResolvedValue(
      resultOf(96 * MB, plan({ met: true, sourceCapped: true, atFloor: true })),
    );
    loadFile({ mode: "target-size" });

    fireEvent.click(screen.getByRole("button", { name: /Discord/ }));
    fireEvent.click(screen.getByRole("button", { name: "Compress" }));

    const footnote = await screen.findByText(/ALREADY SPENDS LESS THAN 10 MB/);
    expect(footnote).not.toHaveTextContent(/DOES NOT INFLATE/);
    expect(footnote).toHaveTextContent(/LARGER THAN THE 80.0 MB YOU STARTED WITH/);
    expect(footnote).toHaveTextContent(/KEEP YOUR ORIGINAL/);
  });

  it("prints no verdict at all on the preset page", async () => {
    // A preset run carries no `sizeTarget`, so there is no ceiling to judge.
    compressVideo.mockResolvedValue(resultOf(9 * MB));
    loadFile();

    fireEvent.click(screen.getByRole("button", { name: "Compress" }));
    await screen.findByRole("button", { name: /^Download / });

    expect(screen.queryByText(/CEILING/)).toBeNull();
  });
});

describe("targetOutcomeText", () => {
  it("leads with the measured hit", () => {
    expect(targetOutcomeText(plan({ met: true }), 9_800_000, "10 MB", 120)).toMatch(
      /^UNDER THE 10 MB CEILING — THIS FILE IS/,
    );
  });

  it("prefers the measured hit even when the solve was clamped to the floor", () => {
    /*
      A clamped solve can still land under a generous ceiling — a near-static
      clip encodes far below the bitrate it was handed. Calling that a failure
      would be as wrong as calling an overshoot a success.
    */
    expect(targetOutcomeText(plan({ met: true, atFloor: true }), 1_000, "10 MB", 120)).toMatch(
      /^UNDER THE/,
    );
  });

  it("blames the floor, and quotes the clip length, when the target was unreachable", () => {
    const text = targetOutcomeText(
      plan({ met: false, atFloor: true, videoBitrate: 120_000 }),
      38 * MB,
      "10 MB",
      2530,
    );

    expect(text).toMatch(/^COULD NOT REACH 10 MB/);
    expect(text).toContain("120 KBPS");
    expect(text).toContain("42:10.0 OF VIDEO");
  });

  it("still says something useful when the container declared no duration", () => {
    // MediaRecorder WebM — every browser screen recording, this site's own
    // included. The length is unknown; the rest of the sentence is not.
    const text = targetOutcomeText(
      plan({ met: false, atFloor: true }),
      38 * MB,
      "10 MB",
      null,
    );

    expect(text).toMatch(/^COULD NOT REACH 10 MB/);
    expect(text).toContain("A CLIP THIS LONG");
  });

  it("blames the encoder, not the floor, on a plain overshoot", () => {
    const text = targetOutcomeText(plan({ met: false }), 11 * MB, "10 MB", 120);

    expect(text).toMatch(/^MISSED THE 10 MB CEILING/);
    expect(text).toContain("789 KBPS SHOULD HAVE FIT");
    expect(text).not.toMatch(/COULD NOT REACH/);
  });
});

describe("sourceCappedText", () => {
  /*
    The never-inflate sentence is a claim about the DOWNLOAD, so like
    `targetOutcomeText` it is decided by weighing the download. `sourceCapped`
    only says the cap was applied — on a clip leaner than this tool's bitrate
    floor the cap is applied AND the file still grows, and the old
    unconditional string asserted the opposite of what the user could see.
  */
  it("makes the claim when the file really did come back smaller", () => {
    const text = sourceCappedText(
      plan({ sourceCapped: true, videoBitrate: 720_000 }),
      4 * MB,
      80 * MB,
      "10 MB",
    );

    expect(text).toMatch(/^THIS CLIP ALREADY SPENDS LESS THAN 10 MB ALLOWS/);
    expect(text).toContain("720 KBPS");
    expect(text).toContain("THIS TOOL DOES NOT INFLATE A FILE TO FILL A CEILING");
  });

  it("withdraws it, with both numbers, when the floor made the file bigger", () => {
    // F19's live repro, to the byte: 87.6 KB in at 36 kbps, 238.3 KB out at
    // the 120 kbps floor.
    const text = sourceCappedText(
      plan({ sourceCapped: true, atFloor: true, videoBitrate: 120_000 }),
      238_300,
      87_600,
      "25 MB",
    );

    expect(text).not.toMatch(/DOES NOT INFLATE/);
    expect(text).toContain("120 KBPS IS THE LOWEST THIS TOOL ENCODES");
    expect(text).toContain("232.7 KB");
    expect(text).toContain("85.5 KB");
    expect(text).toContain("KEEP YOUR ORIGINAL");
  });

  it("treats an exactly-equal re-encode as no saving, not as a win", () => {
    const text = sourceCappedText(plan({ sourceCapped: true }), 4 * MB, 4 * MB, "10 MB");

    expect(text).not.toMatch(/DOES NOT INFLATE/);
  });
});

describe("the WebCodecs pre-flight — asked of the codecs, before anything starts", () => {
  /*
    F20. `isWebCodecsEncodeSupported` only asks whether VideoEncoder,
    AudioEncoder, VideoFrame and requestVideoFrameCallback EXIST, and modern
    WebKit and Gecko define all four. So no banner rendered, Compress stayed
    enabled, and Safari's failure arrived from inside the encode as
    mp4-muxer's own "null is not an object (evaluating
    'track.info.decoderConfig.colorSpace')" — while the page's aboutText and
    FAQ both promise "Safari and Firefox are checked before anything starts".
  */

  it("refuses Firefox up front, on the AAC encoder it does not ship", async () => {
    stubBrowser({ aac: false });

    await expect(encodePipelineProblem()).resolves.toMatch(/doesn't support AAC/);
  });

  it("refuses WebKit on the codec description its encoder does not return", async () => {
    // Everything WebKit answers YES to; the one thing it does not hand back.
    stubBrowser({ aac: true, h264: true, decoderConfig: false });

    await expect(encodePipelineProblem()).resolves.toMatch(
      /doesn't return the H.264 codec description/,
    );
  });

  it("passes a browser that can actually run the pipeline", async () => {
    stubBrowser({});

    await expect(encodePipelineProblem()).resolves.toBeNull();
  });

  it("refuses an engine with no H.264 encoder at all", async () => {
    stubBrowser({ h264: false });

    await expect(encodePipelineProblem()).resolves.toMatch(/Chrome or Edge/);
  });

  it("treats a probe that THROWS as inconclusive, never as a refusal", async () => {
    /*
      A browser behaving unexpectedly under the probe must not be locked out
      of a tool that may work for it. Only an explicit `supported: false`, or
      a chunk with no description, blocks the button.
    */
    stubBrowser({ aac: "throws" });

    await expect(encodePipelineProblem()).resolves.toBeNull();
  });

  it("puts the probe's own sentence on screen before a file is ever dropped", async () => {
    stubBrowser({ aac: false });
    compressVideo.mockResolvedValue(resultOf(9 * MB, plan()));
    render(<CompressVideoUI mode="target-size" />);

    // The drop state: no file, no click, and the banner is already there.
    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn't support AAC/);
  });

  it("disables Compress on the refused browser, on BOTH slugs", async () => {
    for (const mode of ["target-size", "preset"] as const) {
      stubBrowser({ decoderConfig: false });
      const view = render(<CompressVideoUI mode={mode} />);

      await screen.findByRole("alert");
      fireEvent.click(screen.getByText("drop"));

      expect(screen.getByRole("button", { name: "Compress" }), mode).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/H.264 codec description/);
      view.unmount();
    }
    expect(compressVideo).not.toHaveBeenCalled();
  });

  it("says nothing extra on a browser the probe cleared", async () => {
    stubBrowser({});
    render(<CompressVideoUI mode="target-size" />);

    await waitFor(() => expect(screen.getByText("drop")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
