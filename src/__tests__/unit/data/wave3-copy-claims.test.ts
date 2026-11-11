import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getToolBySlug, type Tool } from "@/data/tools";
import { getToolCopy } from "@/data/tool-copy";
import { faqs } from "@/data/faqs";
import { getWorkspaceTool } from "@/data/workspace";

/**
 * The server-only copy for a tool. `aboutText`, `relatedTools` and `titleTag`
 * moved off `Tool` into src/data/tool-copy.ts so they stop shipping to the
 * client — see that file's header. Throws rather than returning undefined: a
 * registry entry with no copy entry is a bug these suites should catch.
 */
const copyOf = (slug: string) => {
  const c = getToolCopy(slug);
  if (!c) throw new Error(`${slug} has no tool-copy entry`);
  return c;
};


/*
 * THE COPY-CLAIM GATE for the ten Wave-3 tools, written as the last step of an
 * adversarial-review fix pass.
 *
 * Five fix agents made ten engines honest and then wrote down the registry and
 * FAQ sentences that had to move with them. Registry copy is shipped prose —
 * `description` is the meta tag, `hubLine` is the hub card, `subtitle` and
 * `aboutText` are on the page, FAQ answers are emitted as FAQPage JSON-LD, and
 * `acceptFormats` renders as the DropZone's ACCEPTS line — so each of those
 * sentences is a claim about code in a different file, and nothing in tsc,
 * lint or the registry tests reads a word of it.
 *
 * Each block below pins BOTH halves: the sentence, and the artifact in the
 * engine that makes it true. Revert either one and this goes red. Every
 * negative assertion ("the copy no longer says X") is paired with a positive
 * one over the same string, because a negative search passes just as happily
 * on an empty read or a typo'd path.
 */

const root = process.cwd();
const readSrc = (rel: string) => readFileSync(resolve(root, rel), "utf8");

/**
 * These modules DOCUMENT what this file searches for — `audio-effects.ts`
 * spends a header paragraph on the very `-map_metadata` default it fixes — so
 * strip block comments and whole-line `//` comments before asking what a
 * module actually does. Whole-line only: a trailing `//` could be in a string.
 * The same trick `tool-copy-claims.test.ts` and `size-claims.test.ts` use.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const AUDIO_EFFECTS = codeOnly(readSrc("src/lib/tools/audio-effects.ts"));
const VIDEO_MERGE = codeOnly(readSrc("src/lib/tools/video-merge.ts"));
const VIDEO_SPLIT = codeOnly(readSrc("src/lib/tools/video-split.ts"));
const RECORDER_SHELL = codeOnly(readSrc("src/components/tools/MediaRecorderShell.tsx"));
const AUDIO_RECORDER_UI = codeOnly(readSrc("src/components/tools/AudioRecorderUI.tsx"));
const WEBCAM_RECORDER_UI = codeOnly(readSrc("src/components/tools/WebcamRecorderUI.tsx"));
const SCREEN_RECORDER_UI = codeOnly(readSrc("src/components/tools/ScreenRecorderUI.tsx"));
/** Read raw, NOT `codeOnly`: the rows this file checks are data, not code. */
const WORKSPACE_SRC = readSrc("src/data/workspace.ts");

const tool = (slug: string): Tool => {
  const t = getToolBySlug(slug);
  if (!t) throw new Error(`${slug} is not in the registry`);
  return t;
};

/** The registry prose a tool ships, lowercased. Excludes HowTo steps on purpose. */
const registryCopy = (slug: string): string => {
  const t = tool(slug);
  return [
    t.description,
    t.hubLine ?? "",
    t.h1,
    t.subtitle,
    copyOf(slug).aboutText,
    copyOf(slug).titleTag ?? "",
  ]
    .join("\n")
    .toLowerCase();
};

/** One tool's own FAQ block, question and answer together, lowercased. */
const faqCopy = (slug: string): string =>
  (faqs[slug] ?? []).flatMap((f) => [f.question, f.answer]).join("\n").toLowerCase();

const allCopy = (slug: string): string => `${registryCopy(slug)}\n${faqCopy(slug)}`;

// ── normalize-audio ────────────────────────────────────────────────

describe("normalize-audio copy follows the loudnorm run", () => {
  /*
    The engine asks for `linear=true` and loudnorm refuses it whenever a single
    gain would breach the true-peak ceiling — measured, that is most unmastered
    speech and music. `parseNormalizationType` reads which one happened out of
    pass 2's own JSON, so the page can no longer promise the better one.
  */
  it("does not promise the dynamics are left alone, and names the ride", () => {
    const copy = allCopy("normalize-audio");
    expect(copy).toContain("rides the gain");
    expect(copy).not.toContain("applies a single, linear gain, so the dynamics inside the file are left alone");
    expect(copy).not.toContain("the second feeds them back and applies one linear gain");
  });

  it("the mode the copy promises to report is actually derived from the run", () => {
    expect(AUDIO_EFFECTS).toContain("normalizationType: parseNormalizationType(");
    expect(AUDIO_EFFECTS).toContain('run.normalizationType === "dynamic"');
  });

  /*
    `mp3SafeSampleRate` is deliberately round-UP: a 37 800 Hz source is written
    at 44 100 while the NEAREST carriable rate is 32 000. "Nearest" was the
    wrong word on three surfaces.
  */
  it("states the MP3 rate rule as round-up, never as nearest", () => {
    const copy = allCopy("normalize-audio");
    expect(copy).toContain("rounded up");
    expect(copy).not.toContain("the nearest rate mp3");
    expect(copy).not.toContain("moved to the nearest rate");
  });

  it("the round-up rule is what the function implements", () => {
    expect(AUDIO_EFFECTS).toContain("if (candidate >= rate) return candidate;");
  });

  /*
    The tag claim was FALSE and the code was fixed rather than the words:
    `-vn` drops an attached picture and nothing else, while FFmpeg's default
    `-map_metadata 0` copied ID3 title/artist/album straight through. The
    sentence kept naming the wrong mechanism, which is the misconception that
    made the code wrong in the first place.
  */
  it("names the real reason tags do not survive", () => {
    const copy = allCopy("normalize-audio");
    expect(copy).toContain("metadata is explicitly dropped");
    expect(copy).not.toContain("tags and cover art do not survive: the audio stream is taken out");
  });

  it("the metadata really is dropped rather than copied, on BOTH FFmpeg argvs", () => {
    // Counted, not searched: `loudnormPass2Args` and `removeSilence` each build
    // their own argv and each page makes the tag claim, so a `toContain` here
    // stays green while one of the two silently goes back to FFmpeg's copying
    // `-map_metadata 0` default. Measured: it did.
    const hits = AUDIO_EFFECTS.match(/"-map_metadata", "-1"/g) ?? [];
    expect(hits).toHaveLength(2);
  });
});

// ── change-audio-volume and reverse-audio ──────────────────────────

describe("the two Web Audio tools no longer promise an unchanged shape on every arm", () => {
  /*
    `planEncode` is the identity for WAV and FLAC and folds to stereo + caps at
    48 kHz for MP3, which is the DEFAULT arm. "Length, channel count and sample
    rate all come out unchanged" was false there for any surround or hi-res
    source, with no warning until this pass added `shapeWarnings`.
  */
  for (const slug of ["change-audio-volume", "reverse-audio"]) {
    it(`${slug} scopes the shape claim to WAV and FLAC`, () => {
      const copy = allCopy(slug);
      expect(copy).toContain("wav and flac");
      expect(copy).toMatch(/mp3 (carries|is the exception)/);
      expect(copy).not.toContain("length, channel count and sample rate all come out unchanged");
      expect(copy).not.toContain("length, channel count and sample rate all come out the same");
      expect(copy).not.toContain("length, channel count and sample rate come out identical");
    });
  }

  it("reverse-audio's meta description no longer claims an unchanged rate", () => {
    const description = tool("reverse-audio").description.toLowerCase();
    expect(description).toContain("length never changes");
    expect(description).not.toContain("sample rate come out unchanged");
  });

  it("the fold and the cap are real, and both are reported", () => {
    expect(AUDIO_EFFECTS).toContain("sampleRate: Math.min(sourceRate, MAX_MP3_SAMPLE_RATE)");
    expect(AUDIO_EFFECTS).toContain("function shapeWarnings(");
    expect(AUDIO_EFFECTS).toContain("const warnings = shapeWarnings(plan, sourceRate, sourceChannels);");
  });
});

// ── remove-silence ─────────────────────────────────────────────────

describe("remove-silence copy separates the argv from the file", () => {
  /*
    "No `-ar` is passed" is true of the argv and is NOT the same statement as
    "nothing is resampled": 96 kHz and 88.2 kHz sources both came back as
    48 kHz MP3s, EXIT 0, in both silence modes, while WAV and FLAC kept the
    source rate. The claim is now scoped and the run reads both rates back.
  */
  it("does not claim nothing is resampled", () => {
    const copy = allCopy("remove-silence");
    expect(copy).toContain("48 khz");
    expect(copy).not.toContain("nothing is resampled");
    // Anchored: the corrected answer OPENS "On WAV and FLAC the sample rate is
    // the source's…", so a plain substring search would match the fix as well
    // as the defect. The lie was the unqualified sentence at the start.
    expect(copy).not.toMatch(/^the sample rate is the source's — silenceremove/m);
  });

  it("both rates are read back off the run so the page can say when they differ", () => {
    expect(AUDIO_EFFECTS).toContain("sourceSampleRate: parseSourceSampleRate(lines)");
    expect(AUDIO_EFFECTS).toContain("sampleRate: parseOutputSampleRate(lines)");
    expect(AUDIO_EFFECTS).toContain("run.sourceSampleRate !== run.sampleRate");
  });
});

// ── merge-video ────────────────────────────────────────────────────

describe("merge-video copy matches the compatibility check and the guard", () => {
  /*
    CONTRACT PART 7 §C1: an MP4 and an MKV holding identical H.264/AAC differ
    in nothing the original property list named. `video timebase` is now a row
    the refusal table can print, and the copy is the user's only warning about
    what will be refused.
  */
  it("names the timing base among the properties that must match, on BOTH surfaces", () => {
    // Per-surface, not over the union: the aboutText and the "Why won't it
    // join my clips?" answer are two independent enumerations of what must
    // match, and a union check lets either one silently drop the row.
    // The whole clause, not the bare words "timing base": the rewrap sentence
    // on both surfaces also says "timing base", so a two-word search stays
    // green while the ENUMERATION — the thing the refusal table prints from —
    // quietly loses the row. Measured: it did.
    const CLAUSE = "the timing base that container counts in";
    expect(copyOf("merge-video").aboutText.toLowerCase()).toContain(CLAUSE);
    expect(faqCopy("merge-video")).toContain(CLAUSE);
  });

  it("the timebase really is compared", () => {
    expect(VIDEO_MERGE).toContain('property: "video timebase"');
    expect(VIDEO_MERGE).toContain("timeBase: video?.time_base ?? null");
  });

  /*
    The mp4+mkv story is the page's headline measurement and it was told wrong
    on both surfaces: "nothing in that pair differs except the container" is
    false — `video-merge.ts`'s own header measures 1/57600 against 1/1000 and
    says in as many words that an earlier revision claiming the timebase
    "differs because of it" was measured false. Two properties differ, and the
    module compares both.
  */
  it("does not claim the mp4/mkv pair differed in the container alone", () => {
    const copy = allCopy("merge-video");
    expect(copy).toContain("1/57600 against 1/1000");
    expect(copy).not.toContain("nothing in that pair differs except the container,");
    expect(copy).not.toContain("nothing differed except the container,");
  });

  it("the two properties that pair really differs in are both compared", () => {
    expect(VIDEO_MERGE).toContain('property: "file format"');
    expect(VIDEO_MERGE).toContain('property: "video timebase"');
  });

  /*
    CONTRACT PART 7 §C2. The HEVC row wrote 5.234 s where 4.132 s went in, so a
    one-sided check passes garbage. Two surfaces say "short or runs long" and
    both must keep saying it — softening either one re-introduces the lie in
    the opposite direction.
  */
  it("keeps the two-sided guard promise on both surfaces", () => {
    expect(copyOf("merge-video").aboutText.toLowerCase()).toContain("comes up short or runs long");
    expect(faqCopy("merge-video")).toContain("comes up short or runs long");
  });

  it("the guard really is two-sided", () => {
    expect(VIDEO_MERGE).toContain(
      "Math.abs(outputSeconds - totalSeconds) > DURATION_TOLERANCE_SECONDS",
    );
  });

  /*
    The rewrap remedy is no longer a cure: `video-to-mp4`'s stream copy picks
    its own timing base (measured 1/16000 from an MKV, against an untouched
    MP4's 1/57600), so the rewrapped pair can come straight back refused.
  */
  it("does not promise a rewrap always makes clips joinable", () => {
    const copy = allCopy("merge-video");
    expect(copy).toContain("1/16000");
    expect(copy).not.toContain("rewrapped losslessly by the video to mp4 tool and then joined here for nothing");
  });
});

// ── split-video ────────────────────────────────────────────────────

describe("split-video copy matches the planner", () => {
  /*
    `interiorCuts` emits the leftover as its OWN shorter final part and only
    folds a remainder under MIN_SEGMENT_SECONDS (0.05 s). The FAQ promised the
    opposite, which was false for every source length that is not within 0.05 s
    of a multiple of the chosen part length — i.e. essentially every real video.
  */
  it("does not promise the leftover rides on the last part", () => {
    const copy = allCopy("split-video");
    expect(copy).toContain("final shorter part of its own");
    expect(copy).not.toContain("riding along on the last part");
  });

  it("the planner really emits a short final part, folding only a sub-threshold sliver", () => {
    expect(VIDEO_SPLIT).toContain("for (let at = every; at < sourceSeconds - MIN_SEGMENT_SECONDS; at += every)");
    expect(VIDEO_SPLIT).toContain("export const MIN_SEGMENT_SECONDS = 0.05;");
  });
});

// ── video-to-images and video-thumbnail ────────────────────────────

describe("the two frame tools accept only what the browser can demux", () => {
  /*
    Both walk `playAndExtractFrames` through the browser's own <video>, the
    same walk `video-to-gif` uses. Measured across Chromium, Firefox and
    WebKit, the repo's own sample-video.avi fails with
    DEMUXER_ERROR_COULD_NOT_OPEN and `canPlayType("video/x-msvideo")` is empty
    everywhere; MKV plays in Chromium and Firefox but not WebKit and rides out
    with it so the three tools sharing one walk share one accept list.
  */
  const SHARED = ".mp4,.webm,.mov";

  for (const slug of ["video-to-images", "video-thumbnail"]) {
    it(`${slug} declares exactly video-to-gif's accept list`, () => {
      expect(tool(slug).acceptFormats).toBe(SHARED);
      expect(tool(slug).acceptFormats).toBe(tool("video-to-gif").acceptFormats);
    });

    it(`${slug} names no container it cannot open, anywhere it renders`, () => {
      expect(allCopy(slug)).not.toMatch(/\bavi\b|\bmkv\b|matroska/);
      expect(tool(slug).acceptFormats).not.toMatch(/avi|mkv/);
      expect(tool(slug).practicalLimitNote ?? "").not.toMatch(/\bavi\b|\bmkv\b/i);
    });

    it(`${slug}'s workspace ACCEPTS label agrees with its file picker`, () => {
      const fromRegistry = tool(slug)
        .acceptFormats.split(",")
        .map((s) => s.trim().replace(/^\./, "").toUpperCase())
        .join(" ");
      expect(getWorkspaceTool(slug)?.accept).toBe(fromRegistry);

      /*
        …and the LITERAL in the source, which the runtime value does not pin.
        `workspaceTools` rewrites `accept` from the registry for every tool
        that takes files (`workspace.ts`: "derived && derived !== tool.accept"),
        so a stale literal in `rawWorkspaceTools` is invisible to every runtime
        assertion — including the one above, which passes on any literal at
        all. It is still the line a maintainer reads, so it is checked as text.
      */
      const row = WORKSPACE_SRC.split("\n").find((l) => l.includes(`slug: "${slug}"`));
      expect(row, `no workspace row for ${slug}`).toBeDefined();
      expect(row).toContain(`accept: "${fromRegistry}"`);
    });
  }
});

// ── the recorders ──────────────────────────────────────────────────

describe("recorder copy matches the shell and the MIME candidate lists", () => {
  /*
    `MediaRecorderShell.startRecording` runs acquireStream → setLiveStream →
    recorder.start(1000) → setStatus("recording") in one continuation, and the
    preview <video> is gated on `isLive` (recording or paused). The picture
    cannot exist before capture, so "frame yourself before anything is
    captured" described a state the machine has no path to.
  */
  it("webcam-recorder does not promise a preview before capture", () => {
    const copy = registryCopy("webcam-recorder");
    expect(copy).toContain("the live preview appears as the recording starts");
    expect(copy).not.toContain("before anything is captured");
  });

  it("the preview really is gated on the recording state", () => {
    expect(RECORDER_SHELL).toContain('const isLive = status === "recording" || status === "paused";');
    expect(RECORDER_SHELL).toContain("{isLive && showPreview && (");
  });

  /*
    The workspace `route` renders on five surfaces including the tool's own
    page. Both recorders' candidate lists end in a non-WebM container — audio
    falls through to audio/ogg then audio/mp4 (downloaded as .m4a), video to
    video/mp4 — so a rail reading "⏺ → WEBM" promised a container the page may
    not write. `screen-recorder`'s list is WebM-only and its row is correct.
  */
  it("audio-recorder's route lists every container its candidates can produce", () => {
    const route = getWorkspaceTool("audio-recorder")?.route ?? "";
    expect(route).toBe("⏺ → WEBM · OGG · M4A");
    expect(AUDIO_RECORDER_UI).toContain('"audio/ogg;codecs=opus"');
    expect(AUDIO_RECORDER_UI).toContain('"audio/mp4"');
  });

  it("webcam-recorder's route admits the MP4 arm", () => {
    const route = getWorkspaceTool("webcam-recorder")?.route ?? "";
    expect(route).toBe("⏺ → WEBM · MP4");
    // Counted: the file carries TWO candidate lists — with microphone audio
    // and without — and BOTH fall through to video/mp4, so either one alone
    // can write the container the route names. A `toContain` would stay green
    // on whichever half survived.
    expect(WEBCAM_RECORDER_UI.match(/"video\/mp4"/g) ?? []).toHaveLength(2);
  });

  it("screen-recorder's WebM-only route is left alone, because its list is WebM-only", () => {
    expect(getWorkspaceTool("screen-recorder")?.route).toBe("⏺ → WEBM");
    expect(SCREEN_RECORDER_UI).toContain(
      'const MIME_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm"] as const;',
    );
  });

  it("every route the recorders carry still holds exactly one arrow", () => {
    for (const slug of ["audio-recorder", "webcam-recorder", "screen-recorder"]) {
      const route = getWorkspaceTool(slug)?.route ?? "";
      expect([...route].filter((c) => c === "→")).toHaveLength(1);
      expect(route.split(" → ")).toHaveLength(2);
    }
  });
});
