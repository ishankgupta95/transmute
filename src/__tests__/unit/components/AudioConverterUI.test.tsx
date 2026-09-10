import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

/*
  Two properties, and they are the two the audio cluster kept getting wrong.

  1. THE REGISTRY SEEDS THE FORMAT, IT DOES NOT LOCK IT. The output format used
     to be a literal in the client wrapper, which is what made `wav-to-mp3` and
     `m4a-to-mp3` byte-identical. It now arrives as `defaultFormat` and lands in
     `useState` — a page can open on WAV and the user can still ask for MP3, and
     the ENGINE has to receive the changed value, not the seed.

  2. NOTHING HERE IS LOSSLESS AND THE COPY HAS TO SAY SO. Every path decodes to
     PCM and encodes again. The extra sentence about a lossy SOURCE is derived
     from the loaded file's own extension, so one page says different things
     about a .ogg and a .wav — deriving it from the page would put "your source
     is already lossy" on a lossless master.

  Copy strings are duplicated here rather than imported: a test that reads the
  constant it is checking cannot notice the constant changing, and the e2e suite
  locates these same sentences.
*/

/** Rendered for `format === "mp3"`, whatever page you are on. */
const MP3_QUALITY_NOTE =
  "MP3 is a lossy format. This run decodes your file and encodes it again, and the encoder throws part of the sound away to make it small — a higher bitrate throws away less, but no bitrate makes it lossless.";
/** The one arm of this component allowed to use the word lossless. */
const FLAC_QUALITY_NOTE =
  "FLAC compresses the decoded samples without discarding any of them, so this step is lossless — decode the FLAC and the same samples come back, at roughly half the size of WAV.";
/*
  The WAV arm's note, which is NOT allowed to say "discards nothing". The engine
  behind this chip is `encodePcmToWav`, hard-wired to `BYTES_PER_SAMPLE = 2`
  (`audio-pcm.ts`), so a 24-bit or 32-bit-float source is quantised to 16 bits
  per sample and comes back SMALLER — which the DELTA cell then paints green.
*/
const WAV_QUALITY_NOTE =
  "WAV stores the decoded samples uncompressed, so nothing is thrown away to make the file small. It is written at 16 bits per sample, though: a 24-bit or 32-bit-float source is reduced to 16-bit here, and that resolution does not come back. Nothing is compressed either — expect a file several times the size of a compressed source, and a smaller one than a 24-bit master.";

/** Derived from the LOADED FILE's extension, never from the page. */
const OGG_TO_MP3_GENERATIONAL_NOTE =
  "Your source is OGG, which is already lossy. What it dropped when it was made is gone, and encoding it to MP3 is a second lossy pass over what is left — it cannot come out sounding better than the file you started with.";
/** The silent-loss disclosure for the two arms that decode to raw samples. */
const DECODE_METADATA_NOTE =
  "Only the sound comes across. The decode reduces your file to raw samples, so tags, cover art and chapter marks are not in the download.";
/** …and for the FFmpeg arm, which drops the picture and claims nothing else. */
const FFMPEG_METADATA_NOTE =
  "Cover art does not come across — the encoder is told to drop attached pictures. Tags are handed to FFmpeg along with the file and may survive; nothing here promises they will.";

const OGG_TO_FLAC_GENERATIONAL_NOTE =
  "Your source is OGG, which is already lossy. FLAC keeps exactly what is left of it, which is not the same as keeping the original recording — nothing here can bring back what the OGG encoder discarded.";

const convertAudio = vi.fn();

vi.mock("@/lib/tools/audio-convert", () => ({
  convertAudio: (...args: unknown[]) => convertAudio(...args),
}));

/*
  No AudioContext in jsdom, and the waveform is decoration anyway — the
  component's own catch renders "PREVIEW UNAVAILABLE" and carries on. That is
  the DEFAULT set in `beforeEach`; the staleness test below replaces it with
  promises it can settle by hand, in an order the real world produces and the
  component used to get wrong.
*/
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

/*
  Two buttons so a test can load either a lossless or an already-lossy source
  into the SAME page — the real zone only renders while no file is loaded.
*/
vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <>
      <button onClick={() => onFiles([makeFile("master.wav")])}>drop wav</button>
      <button onClick={() => onFiles([makeFile("podcast.ogg")])}>drop ogg</button>
      <button onClick={() => onFiles([makeFile("voice.m4a")])}>drop m4a</button>
    </>
  ),
}));

import { AudioConverterUI } from "@/components/tools/AudioConverterUI";

function makeFile(name: string): File {
  return new File([new Uint8Array(2048)], name, { type: "audio/mpeg" });
}

function converted(fileName: string, newSize = 512): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(newSize)]),
    fileName,
    originalSize: 2048,
    newSize,
  };
}

// `name` as a string is a full-string match, so this never catches
// "Download master.mp3" while reaching for "Download".
const chip = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
  convertAudio.mockResolvedValue(converted("master.mp3"));
  computeWaveform.mockRejectedValue(new Error("no AudioContext in jsdom"));
});

/**
 * Hand every `computeWaveform` call a promise this test settles itself, and
 * return the resolvers in call order. The point is the ORDER: a decode that is
 * already in flight cannot be cancelled, so the only interesting case is the
 * one where the file on screen finishes FIRST and the abandoned file finishes
 * after it.
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

describe("AudioConverterUI — the registry seeds the format, the user owns it", () => {
  it("opens on the format the registry declared", async () => {
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="flac" />);
    fireEvent.click(screen.getByText("drop wav"));

    expect(await screen.findByRole("button", { name: "FLAC" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(chip("MP3")).toHaveAttribute("aria-pressed", "false");
  });

  it("sends the format the user picked to the engine, not the one it opened on", async () => {
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="wav" />);
    fireEvent.click(screen.getByText("drop wav"));

    // The seed is a starting point. Locking it — reading `defaultFormat` at the
    // call site instead of the state — is the regression this pins.
    fireEvent.click(await screen.findByRole("button", { name: "FLAC" }));
    fireEvent.click(chip("Convert"));

    await waitFor(() => expect(convertAudio).toHaveBeenCalledTimes(1));
    expect(convertAudio.mock.calls[0][1]).toMatchObject({ format: "flac" });
  });

  it("reveals the bitrate chips only on the MP3 arm, because only MP3 has one", async () => {
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="wav" />);
    fireEvent.click(screen.getByText("drop wav"));

    await screen.findByRole("button", { name: "WAV" });
    expect(screen.queryByRole("group", { name: "MP3 bitrate" })).toBeNull();

    fireEvent.click(chip("MP3"));
    expect(screen.getByRole("group", { name: "MP3 bitrate" })).toBeInTheDocument();

    fireEvent.click(chip("320"));
    fireEvent.click(chip("Convert"));
    await waitFor(() => expect(convertAudio).toHaveBeenCalledTimes(1));
    expect(convertAudio.mock.calls[0][1]).toMatchObject({ format: "mp3", bitrate: 320 });
  });

  it("drops a finished result when the format changes, so no readout describes bytes nobody has", async () => {
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop wav"));

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));
    expect(await screen.findByRole("button", { name: /^Download / })).toBeInTheDocument();

    fireEvent.click(chip("FLAC"));

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(chip("Convert")).toBeInTheDocument();
  });
});

describe("AudioConverterUI — what the page says it costs", () => {
  it("says MP3 is lossy on the MP3 arm", async () => {
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop wav"));

    expect(await screen.findByText(MP3_QUALITY_NOTE)).toBeInTheDocument();
    // The lossless sentence must not be reachable from a lossy arm.
    expect(screen.queryByText(FLAC_QUALITY_NOTE)).toBeNull();
  });

  it("moves the sentence with the chips, not with the page", async () => {
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop wav"));
    await screen.findByText(MP3_QUALITY_NOTE);

    fireEvent.click(chip("FLAC"));
    expect(screen.getByText(FLAC_QUALITY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(MP3_QUALITY_NOTE)).toBeNull();

    fireEvent.click(chip("WAV"));
    expect(screen.getByText(WAV_QUALITY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(FLAC_QUALITY_NOTE)).toBeNull();
  });

  it("warns about a second lossy pass only when the LOADED FILE is already lossy", async () => {
    render(<AudioConverterUI acceptFormats=".wav,.ogg" defaultFormat="mp3" />);

    fireEvent.click(screen.getByText("drop wav"));
    expect(await screen.findByText(MP3_QUALITY_NOTE)).toBeInTheDocument();
    // A WAV master has lost nothing yet. Saying otherwise would be a lie the
    // page tells about a file it can see.
    expect(screen.queryByText(OGG_TO_MP3_GENERATIONAL_NOTE)).toBeNull();

    fireEvent.click(chip("START OVER"));
    fireEvent.click(screen.getByText("drop ogg"));
    expect(await screen.findByText(OGG_TO_MP3_GENERATIONAL_NOTE)).toBeInTheDocument();
  });

  it("still says it when the output is lossless, because FLAC cannot undo an OGG", async () => {
    render(<AudioConverterUI acceptFormats=".ogg" defaultFormat="flac" />);
    fireEvent.click(screen.getByText("drop ogg"));

    expect(await screen.findByText(FLAC_QUALITY_NOTE)).toBeInTheDocument();
    expect(screen.getByText(OGG_TO_FLAC_GENERATIONAL_NOTE)).toBeInTheDocument();
  });

  it("discloses that the decode arms carry nothing but the sound", async () => {
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop wav"));

    expect(await screen.findByText(DECODE_METADATA_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(FFMPEG_METADATA_NOTE)).toBeNull();
  });

  it("does not repeat that claim on the arm that hands the whole file to FFmpeg", async () => {
    // The FLAC arm never decodes to samples, so "tags are not in the download"
    // would be a claim about a path that does not do that. `-vn` is measured;
    // what FFmpeg does with the tags is not, so the copy does not say.
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="flac" />);
    fireEvent.click(screen.getByText("drop wav"));

    expect(await screen.findByText(FFMPEG_METADATA_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(DECODE_METADATA_NOTE)).toBeNull();
  });

  it("stays quiet about an .m4a, which may be AAC or may be Apple Lossless", async () => {
    /*
      The container decides, and there is no container parser on this page. A
      confident "your source is already lossy" over an ALAC master is exactly
      the class of wrong sentence this cluster exists to avoid, so the extension
      list deliberately omits .m4a.
    */
    render(<AudioConverterUI acceptFormats=".m4a,.aac" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop m4a"));

    expect(await screen.findByText(MP3_QUALITY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/which is already lossy/)).toBeNull();
  });
});

describe("AudioConverterUI — the format readouts describe the run", () => {
  it("labels the output with the extension the engine actually wrote", async () => {
    // The engine fell back to WAV on a page whose chips say MP3. The readouts
    // have to follow the file, not the chip — this is what a picker-derived
    // label gets wrong.
    convertAudio.mockResolvedValue(converted("master.wav", 8192));
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop wav"));

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));
    await screen.findByRole("button", { name: "Download master.wav" });

    /*
      The FORMAT cell on the canvas and the Format row in the rail, both read
      off `result.fileName`. Scoped to their own cells: "MP3" and "WAV" are also
      chip labels three inches away, and the control heading is spelt FORMAT
      too — hence the exact `textContent` match on the stat cell, which is only
      ever its own label followed by its own value.
    */
    const statCells = screen.getAllByText("FORMAT").map((el) => el.parentElement?.textContent);
    expect(statCells).toContain("FORMATWAV");
    expect(statCells).not.toContain("FORMATMP3");
    expect(screen.getByText("Format").parentElement).toHaveTextContent("WAV");
    expect(screen.getByText("Format").parentElement).not.toHaveTextContent("MP3");
  });
});

describe("AudioConverterUI — the header describes the file on screen", () => {
  it("drops a discarded file's decode instead of letting it rewrite the loaded one", async () => {
    /*
      `computeWaveform` cannot be cancelled. `reset()` and the setState calls
      beside it clear what is on screen; they do nothing to a decode already in
      flight. Without a run fence the abandoned file's duration, sample rate and
      channel count land on top of the file the user is looking at — a 2-second
      clip whose header reads 15:00.

      THE ORDER BELOW IS THE WHOLE TEST. The NEW file resolves first and the
      ABANDONED one second; settle them the other way round and the assertion
      passes with or without the fence, because the newer write lands last
      either way.
    */
    const resolve = deferredWaveforms();
    render(<AudioConverterUI acceptFormats=".wav,.ogg" defaultFormat="mp3" />);

    // The long file, then a change of mind, then the short one.
    fireEvent.click(screen.getByText("drop wav"));
    fireEvent.click(await screen.findByRole("button", { name: "START OVER" }));
    fireEvent.click(screen.getByText("drop ogg"));
    expect(resolve).toHaveLength(2);

    await act(async () => {
      resolve[1]({ peaks: [0.5, 0.5], duration: 2, sampleRate: 48000, channels: 2 });
    });
    expect(screen.getByText("48 kHz · STEREO · 0:02 · 2.0 KB")).toBeInTheDocument();

    // The 15-minute file the user threw away lands now.
    await act(async () => {
      resolve[0]({ peaks: [1, 1], duration: 900, sampleRate: 44100, channels: 1 });
    });

    expect(screen.getByText("48 kHz · STEREO · 0:02 · 2.0 KB")).toBeInTheDocument();
    // Not in the meta line, and not on the waveform's right-hand end-cap.
    expect(screen.queryByText(/15:00/)).toBeNull();
    expect(screen.queryByText(/44\.1 kHz/)).toBeNull();
    expect(screen.queryByText(/MONO/)).toBeNull();
  });

  it("does not let a discarded file's FAILED decode blank a preview that has drawn", async () => {
    const resolvers: Array<{ resolve: (w: Waveform) => void; reject: (e: Error) => void }> = [];
    computeWaveform.mockImplementation(
      () => new Promise<Waveform>((resolve, reject) => resolvers.push({ resolve, reject })),
    );
    render(<AudioConverterUI acceptFormats=".wav,.ogg" defaultFormat="mp3" />);

    fireEvent.click(screen.getByText("drop wav"));
    fireEvent.click(await screen.findByRole("button", { name: "START OVER" }));
    fireEvent.click(screen.getByText("drop ogg"));

    await act(async () => {
      resolvers[1].resolve({ peaks: [0.5, 0.5], duration: 2, sampleRate: 48000, channels: 2 });
    });
    await act(async () => {
      resolvers[0].reject(new Error("no AudioContext in jsdom"));
    });

    expect(screen.queryByText("PREVIEW UNAVAILABLE — CONVERSION STILL RUNS")).toBeNull();
    expect(screen.getByText("48 kHz · STEREO · 0:02 · 2.0 KB")).toBeInTheDocument();
  });
});

describe("AudioConverterUI — the WAV arm names the depth its writer has", () => {
  it("does not claim the WAV step discards nothing", async () => {
    /*
      `encodePcmToWav` is `BYTES_PER_SAMPLE = 2`. A 24-bit master converted here
      comes back 16-bit and one third smaller, under a green DELTA — so the one
      sentence the page may not say on this arm is that nothing was discarded.
    */
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="wav" />);
    fireEvent.click(screen.getByText("drop wav"));

    expect(await screen.findByText(WAV_QUALITY_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/discards nothing/)).toBeNull();
    // The fact the old sentence hid, said out loud.
    expect(screen.getByText(/16 bits per sample/)).toBeInTheDocument();
    expect(
      screen.getByText(/24-bit or 32-bit-float source is reduced to 16-bit/),
    ).toBeInTheDocument();
  });

  it("keeps the word lossless on the FLAC arm, which really is one", async () => {
    // FLAC goes file-to-file through FFmpeg and keeps the source depth, so the
    // fix above must not have blunted the claim that is true.
    render(<AudioConverterUI acceptFormats=".wav" defaultFormat="flac" />);
    fireEvent.click(screen.getByText("drop wav"));

    expect(await screen.findByText(FLAC_QUALITY_NOTE)).toBeInTheDocument();
  });
});

describe("AudioConverterUI — a failed run does not outlive the settings that produced it", () => {
  it("clears the error when the FORMAT changes, so the new chip is not labelled with the old arm's failure", async () => {
    /*
      Everything on the surface follows the chip — the trailing badge, the
      FORMAT cell, the QUALITY note, the OUTPUT rows. An error left standing is
      therefore re-labelled with a format that was never run: a user whose MP3
      decode failed switches to FLAC and reads "FLAC" directly above "Unable to
      decode audio data", so they give up on the one arm that does not use the
      decoder that just failed.
    */
    convertAudio.mockRejectedValue(new Error("Unable to decode audio data"));
    render(<AudioConverterUI acceptFormats=".flac" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop wav"));

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to decode audio data");

    fireEvent.click(chip("FLAC"));

    // The FORMAT cell has already moved. The error must not still be under it.
    expect(screen.getAllByText("FORMAT").map((el) => el.parentElement?.textContent)).toContain(
      "FORMATFLAC",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(chip("Convert")).toBeInTheDocument();
  });

  it("clears the error when the BITRATE changes", async () => {
    convertAudio.mockRejectedValue(new Error("Unable to decode audio data"));
    render(<AudioConverterUI acceptFormats=".mp3" defaultFormat="mp3" />);
    fireEvent.click(screen.getByText("drop wav"));

    fireEvent.click(await screen.findByRole("button", { name: "Convert" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    fireEvent.click(chip("320"));

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
