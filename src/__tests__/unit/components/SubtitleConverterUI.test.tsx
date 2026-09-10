import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

/*
  The engine is covered exhaustively in unit/lib/subtitles.test.ts. This file
  covers the wiring the engine cannot: that the ORIGINAL bytes are what the
  encoding picker re-decodes, that the disclosures actually render, and that a
  download is only offered for a file that converted.

  DropZone is replaced with a button, the way the PDF page tools' tests do it —
  jsdom has no drag-and-drop and no File.arrayBuffer of its own.
*/

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button
      onClick={() => onFiles([(globalThis as { __nextFile?: File }).__nextFile as File])}
    >
      drop
    </button>
  ),
}));

import { SubtitleConverterUI } from "@/components/tools/SubtitleConverterUI";

const SRT = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Un café crème",
  "",
  "2",
  "00:00:05,500 --> 00:00:08,250",
  "Second cue",
  "",
].join("\n");

/** Latin-1 / Windows-1252 bytes — every code point below 0x100 is one byte. */
const latin1 = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

function makeFile(bytes: Uint8Array, name: string): File {
  // One detached ArrayBuffer backs both the File and the `arrayBuffer()` the
  // component awaits — jsdom's File does not always provide the latter.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type: "" });
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(buffer) });
  return file;
}

async function dropFile(bytes: Uint8Array, name = "episode.srt") {
  (globalThis as { __nextFile?: File }).__nextFile = makeFile(bytes, name);
  render(<SubtitleConverterUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByLabelText("Source subtitles");
}

const output = () => screen.getByLabelText("Converted subtitles").textContent ?? "";

/** Every disclosure on screen at once — several can render together. */
const warnings = () =>
  screen
    .getAllByRole("status")
    .map((node) => node.textContent ?? "")
    .join(" ");

describe("SubtitleConverterUI", () => {
  it("converts a dropped SRT to WebVTT and offers it for download", async () => {
    await dropFile(new TextEncoder().encode(SRT));
    fireEvent.click(screen.getByRole("button", { name: "VTT" }));
    await waitFor(() => expect(output()).toContain("WEBVTT"));
    expect(output()).toContain("00:00:01.000 --> 00:00:04.000");
    expect(screen.getByLabelText("Download episode.vtt")).toBeInTheDocument();
  });

  it("reads a Windows-1252 file without replacement characters, and says it guessed", async () => {
    /*
      The failure this guards: the default TextDecoder is non-fatal, so the
      accented bytes come back as U+FFFD and the tool reports success. The
      file the user downloads then has black diamonds where the accents were.
    */
    await dropFile(latin1(SRT));
    expect(screen.getByLabelText("Source subtitles").textContent).toContain("café crème");
    expect(screen.getByLabelText("Source subtitles").textContent).not.toContain("�");
    expect(screen.getByRole("status").textContent).toMatch(/not valid UTF-8/);
    expect(screen.getByRole("status").textContent).toMatch(/Windows-1252/);
  });

  it("re-decodes the ORIGINAL bytes when the encoding is changed by hand", async () => {
    /*
      Decoding once and keeping the string would mean the picker re-decodes
      mojibake, and no choice could ever recover the file. Windows-1251 reads
      the same 0xE9 and 0xE8 bytes as Cyrillic й and и, which is the proof
      that the BYTES — not the previous text — went through the second decode.
    */
    await dropFile(latin1(SRT));
    fireEvent.change(screen.getByLabelText("Read the file as"), {
      target: { value: "windows-1251" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Source subtitles").textContent).toContain("Un cafй crиme"),
    );
    fireEvent.change(screen.getByLabelText("Read the file as"), {
      target: { value: "windows-1252" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Source subtitles").textContent).toContain("crème"),
    );
  });

  it("does not warn about the encoding for a clean UTF-8 file", async () => {
    await dropFile(new TextEncoder().encode(SRT));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clamps a cue the shift pushed across zero and says so", async () => {
    await dropFile(new TextEncoder().encode(SRT));
    fireEvent.change(screen.getByLabelText("Time shift"), { target: { value: "-2" } });
    await waitFor(() => expect(output()).toContain("00:00:00,000"));
    expect(output()).not.toContain("-00:");
    expect(screen.getByRole("status").textContent).toMatch(/pulled to 00:00:00/);
  });

  it("refuses an unreadable time shift instead of shifting by a guess", async () => {
    await dropFile(new TextEncoder().encode(SRT));
    fireEvent.change(screen.getByLabelText("Time shift"), { target: { value: "soon" } });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/could not be read/),
    );
    expect(screen.queryByLabelText("Converted subtitles")).not.toBeInTheDocument();
  });

  it("applies the frame-rate re-time, scaling rather than nudging", async () => {
    await dropFile(new TextEncoder().encode(SRT));
    fireEvent.click(screen.getByLabelText("Re-time between frame rates"));
    // Default pair is 25 → 23.976, so every time is multiplied by 1.0427: the
    // cue at 1 s gains 43 ms and the cue at 5.5 s gains 235 ms. A constant
    // offset could not produce two different gains.
    await waitFor(() => expect(output()).toContain("00:00:05,735"));
    expect(output()).toContain("00:00:01,043");
  });

  it("warns that ASS styling is a one-way trip, naming the styles that went", async () => {
    const ass = [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Karaoke,,0,0,0,,{\\k25}Twin{\\k30}kle",
    ].join("\n");
    await dropFile(new TextEncoder().encode(ass), "signs.ass");
    const warning = screen.getByRole("status").textContent ?? "";
    expect(warning).toMatch(/one-way trip/);
    expect(warning).toContain("Karaoke");
    expect(output()).toContain("Twinkle");
    expect(output()).not.toContain("\\k");
  });

  it("converts pasted text with no file at all", () => {
    render(<SubtitleConverterUI />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("Paste your subtitles"), { target: { value: SRT } });
    fireEvent.click(screen.getByRole("button", { name: "VTT" }));
    expect(output()).toContain("WEBVTT");
    expect(screen.getByLabelText("Download subtitles.vtt")).toBeInTheDocument();
  });

  it("ignores a slow file read that lands after the file was replaced", async () => {
    /*
      `arrayBuffer()` is async. Drop a file, change your mind, drop another:
      without a guard the first read resolves last and the pane fills with the
      OLD file's cues under the NEW file's name — and the download follows the
      pane.
    */
    let releaseSlow!: (buffer: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>((resolve) => {
      releaseSlow = resolve;
    });
    const staleBytes = new TextEncoder().encode(SRT.replace("Second cue", "STALE CUE"));
    const slow = new File([new ArrayBuffer(0)], "slow.srt");
    Object.defineProperty(slow, "arrayBuffer", { value: () => pending });

    (globalThis as { __nextFile?: File }).__nextFile = slow;
    render(<SubtitleConverterUI />);
    fireEvent.click(screen.getByText("drop"));

    fireEvent.click(screen.getByText("CHANGE FILE"));
    (globalThis as { __nextFile?: File }).__nextFile = makeFile(
      new TextEncoder().encode(SRT),
      "fresh.srt",
    );
    fireEvent.click(screen.getByText("drop"));
    await screen.findByLabelText("Source subtitles");

    const staleBuffer = new ArrayBuffer(staleBytes.byteLength);
    new Uint8Array(staleBuffer).set(staleBytes);
    releaseSlow(staleBuffer);
    await waitFor(() => expect(output()).toContain("Second cue"));
    expect(screen.getByLabelText("Source subtitles").textContent).not.toContain("STALE CUE");
    expect(screen.getByLabelText("Download fresh.srt")).toBeInTheDocument();
  });

  it("says a blank line was taken out of a cue, rather than writing a broken file", async () => {
    /*
      `\N` at the start of an ASS Text field is an ordinary nudge-down. Written
      into an SRT verbatim it lands a BLANK LINE directly under the timing
      line, which every parser reads as the end of the cue — so the words
      become an untimed block and every block after them is misread. The tool
      showed "2 CUES", "Cues out: 2 of 2" and no warning at all.
    */
    const ass = [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,\\NPushed down one line",
      "Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,Next cue",
    ].join("\n");
    await dropFile(new TextEncoder().encode(ass), "signs.ass");
    await waitFor(() => expect(output()).toContain("Pushed down one line"));
    expect(output()).not.toContain("00:00:01,000 --> 00:00:04,000\n\n");
    expect(warnings()).toMatch(/blank line/);
  });

  it("warns about dropped positioning even when the target is WebVTT", async () => {
    /*
      The note used to be suppressed for a WebVTT target, on the theory that
      WebVTT can hold positioning. It can; this tool does not write it. So the
      one conversion that dropped every cue setting was also the one that said
      nothing about it — and picking SRT instead would have warned.
    */
    const vtt = [
      "WEBVTT",
      "",
      "STYLE",
      "::cue(.yellow) { color: yellow }",
      "",
      "intro",
      "00:00:01.000 --> 00:00:04.000 region:speaker align:start line:0 position:10%",
      "Welcome to the show.",
      "",
    ].join("\n");
    await dropFile(new TextEncoder().encode(vtt), "captions.vtt");
    fireEvent.click(screen.getByRole("button", { name: "VTT" }));
    await waitFor(() => expect(output()).toContain("Welcome to the show."));
    expect(output()).not.toContain("region:");
    expect(warnings()).toMatch(/positioning/);
    expect(warnings()).toMatch(/STYLE or REGION/);
  });

  it("converts an SRT whose dialogue starts a line with 'Dialogue:'", async () => {
    // Detection used to read that as ASS, find no events, and refuse the file
    // outright — with no source-format control anywhere to argue with.
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:04,000",
      "She never answers.",
      "Dialogue: he never listens.",
      "",
    ].join("\n");
    await dropFile(new TextEncoder().encode(srt), "transcript.srt");
    await waitFor(() => expect(output()).toContain("Dialogue: he never listens."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Download transcript.srt")).toBeInTheDocument();
  });

  it("does not blame a time shift nobody typed for a file of zero-length cues", () => {
    render(<SubtitleConverterUI />);
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    fireEvent.change(screen.getByLabelText("Paste your subtitles"), {
      target: { value: "1\n00:00:01,000 --> 00:00:01,000\nZero length\n" },
    });
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toMatch(/ends at or before its own start time/);
    expect(alert).not.toMatch(/smaller negative offset/);
  });

  it("offers no download at all when nothing converted", async () => {
    await dropFile(new TextEncoder().encode("this is not a subtitle file\n"), "notes.srt");
    expect(screen.getByRole("alert").textContent).toMatch(/does not look like/);
    expect(screen.queryByLabelText(/^Download/)).not.toBeInTheDocument();
  });
});
