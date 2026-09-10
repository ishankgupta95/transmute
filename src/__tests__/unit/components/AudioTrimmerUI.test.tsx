import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  The trimmer's canvas is a RULER, not decoration.

  `computeWaveform` supplies the duration the timeline, the end-cap, both
  handles and the SEL readout are drawn against — and it cannot be cancelled.
  `reset()` and the setState calls beside it clear what is on screen; a decode
  already in flight goes on running and writes whenever it finishes. So a file
  the user discarded can hand its length to the file they are looking at now,
  and a two-second clip gets presented on a fifteen-minute timeline with its
  selection bracket squeezed into a fraction of a percent of the waveform.

  The second property here is the stale-run one the whole codebase shares: an
  edit that changes what a re-run would produce drops the finished result — and
  drops a FAILED one too, because the FORMAT cell, the OUTPUT rows and the SEL
  readout all follow the controls. An error left standing gets re-labelled with
  settings that were never run.

  Copy strings are duplicated rather than imported: a test that reads the
  constant it is checking cannot notice the constant changing.
*/

/**
 * The WAV preset's note. `audio-trim.ts` encodes through `encodeWav` →
 * `encodePcmToWav`, which is `BYTES_PER_SAMPLE = 2` (`audio-pcm.ts`), so a chip
 * labelled "Lossless" has to say which depth it writes at.
 */
const LOSSLESS_PRESET_NOTE =
  "WAV — uncompressed, written at 16 bits per sample, roughly ten times the size. Nothing is compressed away; a 24-bit source is still reduced to 16-bit.";

const trimAudio = vi.fn();

vi.mock("@/lib/tools/audio-trim", () => ({
  trimAudio: (...args: unknown[]) => trimAudio(...args),
}));

const computeWaveform = vi.fn();

vi.mock("@/lib/tools/media-preview", () => ({
  computeWaveform: (...args: unknown[]) => computeWaveform(...args),
  extractFilmstrip: vi.fn(() => Promise.resolve([])),
}));

interface Waveform {
  peaks: number[];
  duration: number;
  sampleRate: number;
  channels: number;
}

// The real zone only renders while no file is loaded, so two buttons let one
// test load a second file after START OVER.
vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <>
      <button onClick={() => onFiles([makeFile("lecture.wav")])}>drop long</button>
      <button onClick={() => onFiles([makeFile("clip.mp3")])}>drop short</button>
    </>
  ),
}));

import { AudioTrimmerUI } from "@/components/tools/AudioTrimmerUI";

function makeFile(name: string): File {
  return new File([new Uint8Array(2048)], name, { type: "audio/mpeg" });
}

const chip = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
  trimAudio.mockResolvedValue({
    blob: new Blob([new Uint8Array(512)]),
    fileName: "clip-trimmed.mp3",
    originalSize: 2048,
    newSize: 512,
  });
  computeWaveform.mockRejectedValue(new Error("no AudioContext in jsdom"));
});

/**
 * Hand every `computeWaveform` call a promise this test settles itself, in call
 * order. The ORDER is the point — see the staleness test below.
 */
function deferredWaveforms(): Array<(w: Waveform) => void> {
  const resolvers: Array<(w: Waveform) => void> = [];
  computeWaveform.mockImplementation(
    () =>
      new Promise<Waveform>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return resolvers;
}

describe("AudioTrimmerUI — the timeline belongs to the loaded file", () => {
  it("drops a discarded file's decode instead of letting it set the ruler", async () => {
    /*
      THE ORDER BELOW IS THE WHOLE TEST. The NEW file's decode resolves FIRST
      and the ABANDONED one second; settle them the other way round and the
      assertions pass with or without the fence, because the newer write lands
      last either way.
    */
    const resolve = deferredWaveforms();
    render(<AudioTrimmerUI />);

    fireEvent.click(screen.getByText("drop long"));
    fireEvent.click(await screen.findByRole("button", { name: "START OVER" }));
    fireEvent.click(screen.getByText("drop short"));
    expect(resolve).toHaveLength(2);

    // The two-second clip the user is looking at.
    await act(async () => {
      resolve[1]({ peaks: [0.5, 0.5], duration: 2, sampleRate: 48000, channels: 2 });
    });
    expect(screen.getByText("48 kHz · STEREO · 0:02.0 · 2.0 KB")).toBeInTheDocument();
    expect(screen.getByLabelText("Selection end")).toHaveAttribute("max", "2");

    // The fifteen-minute lecture they threw away lands now.
    await act(async () => {
      resolve[0]({ peaks: [1, 1], duration: 900, sampleRate: 44100, channels: 1 });
    });

    expect(screen.getByText("48 kHz · STEREO · 0:02.0 · 2.0 KB")).toBeInTheDocument();
    // The ruler itself: the handles must still travel over the clip, not over
    // a timeline that belongs to a file the user discarded.
    expect(screen.getByLabelText("Selection end")).toHaveAttribute("max", "2");
    expect(screen.getByLabelText("Selection start")).toHaveAttribute("max", "2");
    expect(screen.queryByText(/15:00\.0/)).toBeNull();
    expect(screen.queryByText(/44\.1 kHz/)).toBeNull();
  });

  it("drops a decode that lands in the window between START OVER and the next file", async () => {
    /*
      The narrower half of the same hazard, and the one `handleReset` covers.
      `handleReset` clears `duration` but NOT `startTime`/`endTime` — those are
      only ever clamped, by the next decode. So a stale decode that settles
      while the drop zone is showing writes `endTime = 900`, and the next file
      inherits it: if that file's own decode then fails there is no clamp, and
      the SEL readout offers a fifteen-minute selection of a clip whose length
      is unknown.
    */
    const resolve = deferredWaveforms();
    render(<AudioTrimmerUI />);

    fireEvent.click(screen.getByText("drop long"));
    fireEvent.click(await screen.findByRole("button", { name: "START OVER" }));
    // Lands with no file on screen at all.
    await act(async () => {
      resolve[0]({ peaks: [1, 1], duration: 900, sampleRate: 44100, channels: 1 });
    });

    // The next file's preview fails, so nothing clamps what the ghost left.
    computeWaveform.mockRejectedValue(new Error("no AudioContext in jsdom"));
    fireEvent.click(screen.getByText("drop short"));
    await act(async () => {});

    expect(screen.getByText("SEL 0:00.0")).toBeInTheDocument();
    expect(screen.queryByText(/15:00\.0/)).toBeNull();
    expect(screen.getByText("Selected").parentElement).toHaveTextContent("0:00.0");
  });

  it("keeps a selection the user set before the decode landed, clamped to the real clip", async () => {
    // The fence must not also throw away the CURRENT file's decode — the
    // handles are still nudged back inside the range it reports.
    const resolve = deferredWaveforms();
    render(<AudioTrimmerUI />);
    fireEvent.click(screen.getByText("drop short"));

    await act(async () => {
      resolve[0]({ peaks: [0.5, 0.5], duration: 2, sampleRate: 48000, channels: 2 });
    });

    expect(screen.getByText("48 kHz · STEREO · 0:02.0 · 2.0 KB")).toBeInTheDocument();
    expect(screen.getByLabelText("Selection end")).toHaveValue("2");
  });
});

describe("AudioTrimmerUI — a failed run does not outlive the settings that produced it", () => {
  async function failARun() {
    trimAudio.mockRejectedValue(new Error("Selected range is empty"));
    render(<AudioTrimmerUI />);
    fireEvent.click(screen.getByText("drop short"));
    fireEvent.click(await screen.findByRole("button", { name: "Trim" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Selected range is empty");
  }

  it("clears the error when the FORMAT changes, so the new chip is not labelled with the old arm's failure", async () => {
    await failARun();

    fireEvent.click(chip("WAV"));

    // The FORMAT cell has already moved to WAV. The error must not still be
    // under it, describing a run that was never attempted in WAV.
    expect(screen.getAllByText("FORMAT").map((el) => el.parentElement?.textContent)).toContain(
      "FORMATWAV",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the error when the BITRATE changes", async () => {
    await failARun();

    fireEvent.click(chip("320"));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the error when a preset rewrites the settings in one go", async () => {
    await failARun();

    fireEvent.click(chip("Podcast"));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the error when a handle moves the selection the run was cut from", async () => {
    const resolve = deferredWaveforms();
    trimAudio.mockRejectedValue(new Error("Selected range is empty"));
    render(<AudioTrimmerUI />);
    fireEvent.click(screen.getByText("drop short"));
    await act(async () => {
      resolve[0]({ peaks: [0.5, 0.5], duration: 2, sampleRate: 48000, channels: 2 });
    });

    fireEvent.click(chip("Trim"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Selection start"), { target: { value: "0.5" } });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AudioTrimmerUI — the Lossless preset names the depth its writer has", () => {
  it("does not offer WAV as unqualified lossless, because encodePcmToWav is 16-bit", async () => {
    render(<AudioTrimmerUI />);
    fireEvent.click(screen.getByText("drop short"));

    fireEvent.click(await screen.findByRole("button", { name: "Lossless" }));

    expect(screen.getByText(LOSSLESS_PRESET_NOTE)).toBeInTheDocument();
    expect(screen.getByText(/16 bits per sample/)).toBeInTheDocument();
    expect(screen.getByText(/24-bit source is still reduced to 16-bit/)).toBeInTheDocument();
  });
});
