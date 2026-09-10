import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtractAudioFormat, ExtractAudioResult } from "@/lib/tools/extract-audio";

/*
  One arm of this tool is lossless and two are not, and the whole page turns on
  telling them apart HONESTLY.

  "Keep original" asks FFmpeg for `-c:a copy`. That is what we asked for; it is
  not what necessarily happened. An engine that could not put the track into any
  container it knows and fell back to an encode reports `streamCopied: false`,
  and the page has to follow it — a sentence derived from the picker would print
  "nothing was re-encoded" over a run that re-encoded, which is the silent
  success this cluster exists to stop.

  Copy strings are duplicated rather than imported: a test that reads the
  constant it is checking cannot notice the constant changing, and the e2e suite
  locates these same sentences.
*/

/** Rendered from the PICKER, before a run. Future tense. */
const COPY_PLAN_NOTE =
  "NOTHING WILL BE RE-ENCODED — THE AUDIO TRACK IS LIFTED OUT OF THE CONTAINER BIT FOR BIT, WHICH TAKES MILLISECONDS.";
/** Rendered from `ExtractAudioResult.streamCopied === true`, after a run. */
const COPIED_RESULT_NOTE =
  "NOTHING WAS RE-ENCODED — THE AUDIO TRACK IN THE DOWNLOAD IS THE ONE THAT WAS INSIDE YOUR FILE, BIT FOR BIT.";
/** Rendered from `ExtractAudioResult.streamCopied === false`. */
const REENCODED_RESULT_NOTE =
  "THIS RUN DECODED AND RE-ENCODED THE AUDIO — THE DOWNLOAD IS A NEW ENCODE, NOT THE TRACK THAT WAS INSIDE YOUR FILE.";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const extractAudio = vi.fn();

vi.mock("@/lib/tools/extract-audio", () => ({
  extractAudio: (...args: unknown[]) => extractAudio(...args),
}));

vi.mock("@/lib/tools/media-preview", () => ({
  extractFilmstrip: vi.fn(() => Promise.resolve([])),
  computeWaveform: vi.fn(() => Promise.reject(new Error("no AudioContext in jsdom"))),
}));

// Two buttons so a test can swap the loaded file for a different one — the
// real zone only renders while no file is loaded, which is exactly when a swap
// happens.
vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <>
      <button onClick={() => onFiles([makeFile("holiday.mp4")])}>drop first</button>
      <button onClick={() => onFiles([makeFile("lecture.mkv")])}>drop second</button>
    </>
  ),
}));

import { ExtractAudioUI } from "@/components/tools/ExtractAudioUI";

function makeFile(name: string): File {
  return new File([new Uint8Array(4096)], name, { type: "video/mp4" });
}

function extractResult(
  streamCopied: boolean,
  fileName = "holiday.m4a",
  extra: Partial<ExtractAudioResult> = {},
): ExtractAudioResult {
  return {
    blob: new Blob([new Uint8Array(256)], { type: "audio/mp4" }),
    fileName,
    originalSize: 4096,
    newSize: 256,
    streamCopied,
    sourceCodec: "aac",
    ...extra,
  };
}

// `name` as a string is a full-string match, so this never catches
// "Download master.mp3" while reaching for "Download".
const chip = (name: string) => screen.getByRole("button", { name });

function renderTool(defaultFormat: ExtractAudioFormat = "original") {
  return render(
    <ExtractAudioUI acceptFormats=".mp4,.webm,.mov,.avi,.mkv" defaultFormat={defaultFormat} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
  extractAudio.mockResolvedValue(extractResult(true));
});

describe("ExtractAudioUI — the registry seeds the arm, the user owns it", () => {
  it("opens on the arm the registry declared", () => {
    renderTool("wav");
    fireEvent.click(screen.getByText("drop first"));

    expect(chip("WAV")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Keep original")).toHaveAttribute("aria-pressed", "false");
  });

  it("sends the arm the user picked to the engine, not the one it opened on", async () => {
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    fireEvent.click(chip("MP3"));
    fireEvent.click(chip("320"));
    fireEvent.click(chip("Extract Audio"));

    await waitFor(() => expect(extractAudio).toHaveBeenCalledTimes(1));
    expect(extractAudio.mock.calls[0][1]).toMatchObject({ format: "mp3", bitrate: 320 });
  });

  it("offers a bitrate only on the arm that has one", () => {
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    expect(screen.queryByRole("group", { name: "MP3 bitrate" })).toBeNull();
    fireEvent.click(chip("WAV"));
    expect(screen.queryByRole("group", { name: "MP3 bitrate" })).toBeNull();
    fireEvent.click(chip("MP3"));
    expect(screen.getByRole("group", { name: "MP3 bitrate" })).toBeInTheDocument();
  });
});

describe("ExtractAudioUI — the no-re-encode claim comes off the result", () => {
  it("predicts the copy in the future tense before anything runs", () => {
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    expect(screen.getByText(COPY_PLAN_NOTE)).toBeInTheDocument();
    // The past-tense claim describes a run. There has not been one.
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });

  it("promises nothing about a re-encode arm before it runs", () => {
    renderTool("mp3");
    fireEvent.click(screen.getByText("drop first"));

    expect(screen.queryByText(COPY_PLAN_NOTE)).toBeNull();
  });

  it("says nothing was re-encoded when the engine reports a stream copy", async () => {
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));
    extractAudio.mockResolvedValue(extractResult(true));

    fireEvent.click(chip("Extract Audio"));

    expect(await screen.findByText(COPIED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(REENCODED_RESULT_NOTE)).toBeNull();
    expect(screen.getByText("Re-encoded").parentElement).toHaveTextContent("No");
  });

  it("believes the result over the picker when the two disagree", async () => {
    /*
      THE TEST THIS FILE EXISTS FOR. The user asked to keep the original; the
      engine reports that it did not. The sentence on screen has to describe the
      RUN — a picker-derived claim gets exactly this case wrong, and gets it
      wrong silently.
    */
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));
    extractAudio.mockResolvedValue(extractResult(false, "holiday.mp3"));

    fireEvent.click(chip("Extract Audio"));

    expect(await screen.findByText(REENCODED_RESULT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
    expect(screen.queryByText(COPY_PLAN_NOTE)).toBeNull();
    expect(screen.getByText("Re-encoded").parentElement).toHaveTextContent("Yes");
  });

  it("shows the engine's own reason for a fallback instead of swallowing it", async () => {
    /*
      `extract-audio.ts` puts the WHY in `warnings` — "this file's AC3 track
      could not be copied out unchanged, so it was re-encoded to MP3". Nothing
      else on the page carries it, and none of the nine audio/video UIs rendered
      `warnings` before this one, so dropping it leaves the user with a
      re-encode and no explanation.
    */
    const reason =
      "This file's audio is AC3, which none of the containers this tool writes can hold as-is, so it was re-encoded to MP3 at 192 kbps.";
    extractAudio.mockResolvedValue(
      extractResult(false, "holiday.mp3", { sourceCodec: "ac3", warnings: [reason] }),
    );
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    fireEvent.click(chip("Extract Audio"));

    expect(await screen.findByText(reason)).toBeInTheDocument();
    // Not an error: the run produced the audio that was asked for, in a
    // different format. The red state is reserved for a run that failed.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(REENCODED_RESULT_NOTE)).toBeInTheDocument();
  });

  it("reports the codec the probe actually found", async () => {
    extractAudio.mockResolvedValue(extractResult(true, "holiday.opus", { sourceCodec: "opus" }));
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    fireEvent.click(chip("Extract Audio"));

    await screen.findByRole("button", { name: "Download holiday.opus" });
    expect(screen.getByText("TRACK").parentElement).toHaveTextContent("OPUS");
  });

  it("says the codec was unreadable rather than inventing one", async () => {
    // A probe that could not read the file returns null, and the engine runs
    // the extract anyway. "AAC" printed over that would be a guess.
    extractAudio.mockResolvedValue(extractResult(false, "holiday.mp3", { sourceCodec: null }));
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    fireEvent.click(chip("Extract Audio"));

    await screen.findByRole("button", { name: "Download holiday.mp3" });
    expect(screen.getByText("TRACK").parentElement).toHaveTextContent("UNREADABLE");
  });

  it("names the container the engine actually wrote, which the copy arm cannot know in advance", async () => {
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));
    // A WebM's track comes out as Opus, not as the .m4a an AAC track would get.
    extractAudio.mockResolvedValue(extractResult(true, "holiday.opus"));

    fireEvent.click(chip("Extract Audio"));

    await screen.findByRole("button", { name: "Download holiday.opus" });
    expect(screen.getByText("File").parentElement).toHaveTextContent("OPUS");
  });
});

describe("ExtractAudioUI — a superseded run binds nothing", () => {
  it("drops a run that was cancelled while FFmpeg still held it", async () => {
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));
    const run = deferred<ExtractAudioResult>();
    extractAudio.mockReturnValueOnce(run.promise);

    fireEvent.click(chip("Extract Audio"));
    await waitFor(() => expect(extractAudio).toHaveBeenCalledTimes(1));

    fireEvent.click(chip("Cancel"));
    run.resolve(extractResult(true));

    // The primary is back, which only happens once the run has been dropped.
    await waitFor(() => expect(chip("Extract Audio")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });

  it("never lets an abandoned run overwrite the file that replaced it", async () => {
    /*
      The dangerous ordering, and the one a user reaches: cancel a slow run,
      load a different video, run that. FFmpeg's worker is terminated on cancel
      but the promise is still out there, and when it settles it is holding the
      FIRST video's audio. Without the run-token fence it calls setResult() over
      the second video's surface — the Download button then hands over the wrong
      audio, and "nothing was re-encoded" describes a run for a file that is no
      longer on screen.

      Keyed off the FILE rather than call order: `extractAudio` is reached
      through a dynamic import(), so a mockReturnValueOnce chain could hand the
      second file the first one's promise all by itself and test the mock.
    */
    const abandoned = deferred<ExtractAudioResult>();
    extractAudio.mockImplementation((file: File) =>
      file.name === "holiday.mp4"
        ? abandoned.promise
        : Promise.resolve(extractResult(false, "lecture.mp3", { sourceCodec: "aac" })),
    );
    renderTool("original");

    fireEvent.click(screen.getByText("drop first"));
    fireEvent.click(chip("Extract Audio"));
    await waitFor(() => expect(extractAudio).toHaveBeenCalledTimes(1));

    fireEvent.click(chip("Cancel"));
    fireEvent.click(chip("CHANGE FILE"));
    fireEvent.click(screen.getByText("drop second"));
    fireEvent.click(chip("Extract Audio"));
    await screen.findByRole("button", { name: "Download lecture.mp3" });

    await act(async () => {
      abandoned.resolve(extractResult(true, "holiday.m4a"));
    });

    expect(screen.queryByRole("button", { name: "Download holiday.m4a" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download lecture.mp3" })).toBeInTheDocument();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
    expect(screen.getByText(REENCODED_RESULT_NOTE)).toBeInTheDocument();
  });

  it("drops a finished result when the arm changes, so no readout describes bytes nobody has", async () => {
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    fireEvent.click(chip("Extract Audio"));
    expect(await screen.findByText(COPIED_RESULT_NOTE)).toBeInTheDocument();

    fireEvent.click(chip("MP3"));

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
    expect(chip("Extract Audio")).toBeInTheDocument();
  });

  it("surfaces an engine failure instead of a half-finished success", async () => {
    extractAudio.mockRejectedValue(new Error("This file has no audio track."));
    renderTool("original");
    fireEvent.click(screen.getByText("drop first"));

    fireEvent.click(chip("Extract Audio"));

    expect(await screen.findByRole("alert")).toHaveTextContent("This file has no audio track.");
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.queryByText(COPIED_RESULT_NOTE)).toBeNull();
  });
});
