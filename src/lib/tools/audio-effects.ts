import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import { throwIfAborted } from "@/lib/utils/abort";
import {
  AUDIO_FORMAT_SPECS,
  DEFAULT_MP3_BITRATE,
  assertSafeFFmpegAudioArgs,
  type AudioOutputFormat,
} from "./audio-format";
import { sniffSampleRate } from "./audio-decode";
import { MAX_MP3_SAMPLE_RATE } from "./audio-pcm";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Four audio effects, on two engines, and why the split falls where it does
 * ───────────────────────────────────────────────────────────────────────────
 * `normalizeAudio` and `removeSilence` are FFmpeg filter jobs — `loudnorm` and
 * `silenceremove` have no Web Audio equivalent worth writing (EBU R128 gating
 * and a hysteresis silence detector are not fifty lines each). `changeVolume`
 * and `reverseAudio` are the opposite: they are one multiply and one array walk
 * over samples we already have to decode, so paying a 31 MB engine download for
 * them would be absurd. Both of those were MEASURED working in FFmpeg
 * (`volume` 25 ms, `areverse` 8 ms on a 2 s stereo WAV) and are deliberately
 * not used.
 *
 * ⚠ THE ONE TRAP THIS FILE EXISTS TO NEUTRALISE: `loudnorm` RESAMPLES TO
 * 192 kHz. Measured 2026-09-05 against the shipped `public/ffmpeg-core.wasm`
 * (FFmpeg n5.1.4) in headless Chromium, on a 44 100 Hz stereo 2 s WAV
 * (352 844 B):
 *
 *   -af loudnorm=… -c:a pcm_s16le o.wav              pcm_s16le 192000 Hz  1 536 102 B
 *   -af loudnorm=… -ar 44100 -c:a pcm_s16le o.wav    pcm_s16le  44100 Hz    352 878 B
 *   -af "loudnorm=…,aresample=44100" …               EXIT 1, 0 bytes
 *
 * `loudnorm` is a double-precision filter that negotiates 192 kHz on its output
 * link, so without an explicit `-ar` the user gets a 4.35x larger file at a rate
 * they never asked for and were never told about. The in-filtergraph
 * `aresample` form does not work at all. The fix is the OUTPUT option `-ar`,
 * pinned to the source rate, and `loudnormPass2Args` is the only place that can
 * put it there — which is why it is exported and unit-tested.
 * (`silenceremove` does NOT do this: its output stayed 44 100 Hz, measured.)
 *
 * ⚠ AND THE SECOND HALF OF THE SAME TRAP: `-ar <sourceRate>` BREAKS MP3 ABOVE
 * 48 kHz. Measured on a 96 000 Hz source:
 *
 *   -ar 96000 -c:a libmp3lame   EXIT 1  "[libmp3lame] Specified sample rate 96000 is not supported"
 *   -ar 48000 -c:a libmp3lame   EXIT 0  → mp3 48000 Hz
 *   (no -ar)  -c:a libmp3lame   EXIT 0  → mp3 48000 Hz   (FFmpeg picked it)
 *   -ar 96000 -c:a pcm_s16le    EXIT 0  → wav 96000 Hz
 *   -ar 96000 -c:a flac         EXIT 0  → flac 96000 Hz
 *
 * So the pinned rate is the source rate for WAV and FLAC, and the nearest rate
 * MP3 can actually carry for MP3 — see `mp3SafeSampleRate`. The result reports
 * whichever rate was written, and the caller says so when it differs.
 *
 * TWO PASSES, AND HOW THE CLAIM IS KEPT HONEST
 *   Pass 1 runs `loudnorm=…:print_format=json -f null -`, which measures the
 *   programme loudness and prints it as JSON on stderr — there is no output
 *   file, so the ONLY way to reach it is the scoped log sink added to
 *   `ffmpeg-loader.ts` for this. Pass 2 feeds those measurements back as
 *   `measured_*` and ASKS for a linear gain with `linear=true`. Measured
 *   cost of pass 1, freshly booted core, every point EXIT 0 with JSON present:
 *   2 s → 40 ms, 8 s → 171 ms, 30 s → 663 ms, 60 s → 1 353 ms, 120 s → 2 707 ms.
 *   That is ≈22.5 ms per second of audio, so a five-minute podcast pays ~6.8 s
 *   for the analysis — which is why progress is reported across both passes.
 *
 *   When pass 1 produces nothing parseable the run FALLS BACK to single-pass
 *   and `twoPass` is false. This is not hypothetical: a digitally silent input
 *   prints `"input_i" : "-inf"` and `"target_offset" : "inf"` (measured), which
 *   cannot be fed back as `measured_I`. `twoPass` is derived from the argv that
 *   actually executed, not from a flag set alongside it, so no caller can
 *   print "analysed in two passes" over a run that was not.
 *
 * ⚠ `linear=true` IS A REQUEST, NOT A GUARANTEE — AND THE REFUSAL IS SILENT.
 *   Measured against the shipped core: loudnorm abandons linear mode and rides
 *   a time-varying gain whenever the linear offset would push the true peak
 *   past the target's TP ceiling — i.e. whenever the source's peak-to-loudness
 *   ratio exceeds `TP - I` (13 LU on Streaming, 14.5 on Podcast, 21 on
 *   Broadcast). That covers most unmastered speech and music, so it is the
 *   COMMON path, not an edge. Measured examples, all EXIT 0: a 20 s quiet voice
 *   memo went dynamic on all three presets and its loudness range fell from
 *   7.30 LU to 3.50 LU; a quiet bed with one transient landed at −17.11 LUFS
 *   against a −16 target. It prints NO warning at any log level — dumping all
 *   29 log lines of a fallback run found only the empty `[Parsed_loudnorm_0]`
 *   banner, and `strings` over the wasm finds no fallback message at all.
 *
 *   The ONLY way to see it is `print_format=json` on PASS 2, which prints
 *   `normalization_type` and does not disturb the written file (measured: the
 *   outputs hit the target either way). So pass 2 carries it, the log sink
 *   stays armed for pass 2 into a SEPARATE array — `parseLoudnormStats` takes
 *   the LAST object it finds, and a shared array would hand the caller pass 2's
 *   post-correction numbers as "measured" — and `normalizationType` is read off
 *   the run rather than assumed from the argv. Pass 1's own
 *   `normalization_type` is NOT a substitute: measured, a file reporting
 *   `dynamic` in pass 1 ran LINEAR in pass 2 and vice versa.
 *
 * `Aborted()` IS THE LAST LOG LINE OF EVERY `-f null -` RUN AND IS BENIGN.
 * Measured: exit code still 0, the JSON still present, and the same instance
 * ran 15+ further jobs afterwards. It is not a wasm trap and must never be
 * added to `WASM_TRAP_SIGNATURES`. `parseLoudnormStats` simply has to survive
 * it — hence the test that feeds it the captured log verbatim.
 *
 * SIZE: `validateFFmpegInput` is deliberately NOT called here, for the reason
 * spelled out in `audio-convert.ts` — it caps only the `stream-copy` shape and
 * its message is written about video trimming. These jobs mount their input
 * (no copy) and the real ceiling is MEMFS holding ONE output file, which
 * `describeFFmpegFailure` names in those words if a run ever reaches it.
 *
 * WHAT NO PATH HERE PRESERVES: tags and cover art. The Web Audio arms reduce
 * the file to raw samples, where metadata stops existing. The FFmpeg arms had
 * to be MADE to do it, and the earlier version of this comment named the wrong
 * mechanism: `-vn` plus `-map 0:a:0` drops an attached PICTURE STREAM and does
 * nothing whatever to global tags, whose default is `-map_metadata 0` — copy
 * them. Measured: an ID3 title, artist, album and comment survived both the
 * loudnorm and the silenceremove argv intact, in MP3, WAV and FLAC output.
 * `-map_metadata -1` is what actually makes the claim true (measured: the same
 * argv plus that flag comes back with none of the four), and it is on every
 * FFmpeg argv this file builds.
 *
 * ⚠ WHAT THE MP3 ARM COSTS ON THE WEB AUDIO PATH, because two pages state it:
 * MP3 carries at most two channels and at most 48 kHz. `resampleForMp3` moves
 * a higher rate down; `encodePcmToMp3` folds anything wider than stereo into
 * L/R at −3 dB per extra channel and then, if the sum crosses unity, divides
 * the WHOLE mix by its own peak. That last step is a level change nobody asked
 * for, it can fire at a gain of exactly 0 dB, and it happens inside a worker
 * that reports nothing back. `planEncode` therefore does the fold HERE, before
 * the encoder sees the samples — the bytes are identical, because the
 * encoder's own copy then sees two channels and returns them untouched, but
 * the peak, the clipping flag and the warnings finally describe the file that
 * is actually delivered.
 */

// ── Loudness targets ──────────────────────────────────────────────

export type NormalizeTargetKey = "streaming" | "podcast" | "broadcast";

export interface NormalizeTarget {
  key: NormalizeTargetKey;
  label: string;
  /** Integrated loudness in LUFS. */
  I: number;
  /** True-peak ceiling in dBTP. */
  TP: number;
  /** Loudness range in LU. */
  LRA: number;
}

/**
 * The three published targets, with the numbers the publishers actually state.
 * `label` is a chip word, not a sentence — the prose that explains each one
 * belongs on the page, the way `AUDIO_FORMAT_SPECS` leaves labels to the UI.
 */
export const NORMALIZE_TARGETS: Record<NormalizeTargetKey, NormalizeTarget> = {
  streaming: { key: "streaming", label: "Streaming", I: -14, TP: -1, LRA: 11 },
  podcast: { key: "podcast", label: "Podcast", I: -16, TP: -1.5, LRA: 11 },
  broadcast: { key: "broadcast", label: "Broadcast", I: -23, TP: -2, LRA: 7 },
};

/**
 * Which gain loudnorm ACTUALLY applied, as it reports it in `normalization_type`.
 *
 * `linear` is one measured gain across the file and leaves the loudness range
 * alone; `dynamic` rides the gain and does not. `linear=true` only ASKS — see
 * the file header for the measured refusal condition.
 */
export type LoudnormMode = "linear" | "dynamic";

/** What pass 1 measured about the INPUT, plus the offset pass 2 needs. */
export interface LoudnessStats {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

// ── Log parsing ───────────────────────────────────────────────────

/**
 * Every field arrives as a JSON *string* (`"input_i" : "-9.56"`), and a silent
 * stretch arrives as `"-inf"` / `"inf"`, which `Number` turns into NaN. Both
 * are rejected here rather than downstream: a `measured_I=NaN` in the pass-2
 * filtergraph is a failed run, and a `measured_I=-inf` is a lie about the
 * input.
 */
function finiteFrom(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull `loudnorm`'s `print_format=json` object out of collected log lines.
 *
 * The lines arrive ONE PER LINE from `@ffmpeg/ffmpeg`'s log event — the object
 * is split across thirteen of them, preceded by a
 * `[Parsed_loudnorm_0 @ 0x…] ` banner and followed by `Aborted()` — so the join
 * has to happen here before anything can be parsed. The brace class excludes
 * `{`/`}` on purpose: the object has no nested braces, and a greedy `[\s\S]*`
 * over a 40-line log is a backtracking hazard for nothing.
 *
 * Returns null when the object is absent or unusable, which is the single
 * trigger for the single-pass fallback.
 */
export function parseLoudnormStats(logLines: readonly string[]): LoudnessStats | null {
  const matches = logLines.join("\n").match(/\{[^{}]*"target_offset"[^{}]*\}/g);
  if (!matches || matches.length === 0) return null;

  // The LAST one: a caller that collects across both passes would otherwise be
  // handed the analysis of a run that has already been corrected.
  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[matches.length - 1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const raw = parsed as Record<string, unknown>;
  const input_i = finiteFrom(raw.input_i);
  const input_tp = finiteFrom(raw.input_tp);
  const input_lra = finiteFrom(raw.input_lra);
  const input_thresh = finiteFrom(raw.input_thresh);
  const target_offset = finiteFrom(raw.target_offset);
  if (
    input_i === null ||
    input_tp === null ||
    input_lra === null ||
    input_thresh === null ||
    target_offset === null
  ) {
    return null;
  }
  return { input_i, input_tp, input_lra, input_thresh, target_offset };
}

/**
 * Which gain mode loudnorm reports it used, out of a run's own log.
 *
 * Read from PASS 2 and nowhere else. Pass 1 prints the same field, and using it
 * would be wrong in both directions: measured, `sample-audio-gaps.wav` reports
 * `dynamic` in pass 1 and runs LINEAR in pass 2, while other sources do the
 * reverse. Pass 1 has no `measured_tp` to test the linear offset against, so
 * its answer is about a different run.
 *
 * Returns null when the field is absent or is a value this module has never
 * seen — the caller then says nothing rather than guessing, which is the only
 * honest third state.
 */
export function parseNormalizationType(logLines: readonly string[]): LoudnormMode | null {
  const matches = logLines.join("\n").match(/\{[^{}]*"normalization_type"[^{}]*\}/g);
  if (!matches || matches.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[matches.length - 1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const value = (parsed as Record<string, unknown>).normalization_type;
  return value === "linear" || value === "dynamic" ? value : null;
}

/**
 * The INPUT's sample rate, read off FFmpeg's own stream header.
 *
 * Scanning stops at `Output #`, and that bound is the whole point: a pass-1 log
 * carries TWO `Stream #0:0: … Audio:` lines with the same stream number, and
 * the second one is `loudnorm`'s 192 000 Hz output link. Taking the last match
 * — or any match without the bound — pins `-ar 192000` onto the file and turns
 * the fix into the bug.
 */
export function parseSourceSampleRate(logLines: readonly string[]): number | null {
  for (const line of logLines) {
    if (/^\s*Output #/.test(line)) break;
    const m = /:\s*Audio:[^\n]*?,\s*(\d+)\s*Hz/.exec(line);
    if (m) {
      const rate = Number(m[1]);
      // The same sanity band `sniffSampleRate` applies, for the same reason.
      if (Number.isFinite(rate) && rate >= 8000 && rate <= 384000) return rate;
    }
  }
  return null;
}

/**
 * The rate FFmpeg says it WROTE, from the stream line after the `Output #`
 * bound — the mirror of `parseSourceSampleRate`, and its exact complement.
 *
 * `removeSilence` passes no `-ar` (deliberately; see its docblock), so the
 * output rate is whatever FFmpeg negotiated with the encoder. On the MP3 arm
 * that is a resample the tool did not ask for and cannot avoid: measured, a
 * 96 kHz and an 88.2 kHz source both came out at 48 kHz, EXIT 0, in both
 * silence modes, while the WAV and FLAC arms kept the source rate. Reading it
 * back is what lets the page state what happened instead of asserting that
 * nothing did.
 */
export function parseOutputSampleRate(logLines: readonly string[]): number | null {
  let afterOutput = false;
  for (const line of logLines) {
    if (/^\s*Output #/.test(line)) {
      afterOutput = true;
      continue;
    }
    if (!afterOutput) continue;
    const m = /:\s*Audio:[^\n]*?,\s*(\d+)\s*Hz/.exec(line);
    if (m) {
      const rate = Number(m[1]);
      if (Number.isFinite(rate) && rate >= 8000 && rate <= 384000) return rate;
    }
  }
  return null;
}

function clockToSeconds(h: string, m: string, s: string): number {
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return Number.isFinite(seconds) ? seconds : Number.NaN;
}

/**
 * The source duration, from the `Duration: 00:00:05.50` header line.
 *
 * Centisecond resolution, which is FFmpeg's and not a choice made here —
 * callers must not print more precision than that.
 */
export function parseInputDurationSeconds(logLines: readonly string[]): number | null {
  for (const line of logLines) {
    const m = /\bDuration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
    if (m) {
      const seconds = clockToSeconds(m[1], m[2], m[3]);
      if (Number.isFinite(seconds)) return seconds;
    }
  }
  return null;
}

/**
 * The duration FFmpeg actually WROTE, from the last progress line
 * (`size=  603kB time=00:00:03.49 bitrate=…`).
 *
 * Verified against ffprobe on the same outputs: a 5.500 s source with both ends
 * trimmed reported `time=00:00:03.49` against a probed 3.50 s, and the
 * every-gap recipe reported 02.03 against a probed 02.04. So this is within
 * ~0.05 s of the truth and no caller may present it as exact. The alternative —
 * a second FFmpeg job to ffprobe the output — costs a whole extra mount and run
 * to move the third decimal place.
 *
 * A stalled or failed run can print `time=-00:00:00.01`; a negative reading is
 * floored at zero rather than surfaced as a negative duration.
 */
export function parseOutputDurationSeconds(logLines: readonly string[]): number | null {
  let last: number | null = null;
  for (const line of logLines) {
    const m = /\btime=\s*(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
    if (!m) continue;
    const seconds = clockToSeconds(m[2], m[3], m[4]);
    if (!Number.isFinite(seconds)) continue;
    last = m[1] === "-" ? 0 : seconds;
  }
  return last;
}

// ── argv builders ─────────────────────────────────────────────────

/**
 * The rates libmp3lame will accept — MPEG-1 (32/44.1/48), MPEG-2 (16/22.05/24)
 * and MPEG-2.5 (8/11.025/12). Anything else is a hard `EXIT 1` from the encoder
 * initialiser, measured above; there is no silent repair inside FFmpeg once
 * `-ar` has been given explicitly.
 */
const MP3_SAMPLE_RATES: readonly number[] = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
];

/**
 * The lowest MP3-carriable rate that is not BELOW `rate`, capped at 48 kHz.
 *
 * Deliberately "round up", not "round to nearest". A 37 800 Hz source is not a
 * rate lame accepts, and the two candidates are 32 000 (throws away everything
 * above 16 kHz) and 44 100 (keeps the whole band and costs bytes). Nearest
 * would pick 32 000 by 500 Hz and quietly narrow the audio; rounding up only
 * ever costs file size, and only 96/88.2 kHz masters — which MP3 genuinely
 * cannot carry — are moved DOWN, to the 48 kHz ceiling. The caller reports the
 * rate it ended up with either way.
 */
export function mp3SafeSampleRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 44100;
  for (const candidate of MP3_SAMPLE_RATES) {
    if (candidate >= rate) return candidate;
  }
  return MP3_SAMPLE_RATES[MP3_SAMPLE_RATES.length - 1];
}

/** The rate that will actually be written, given the source and the format. */
export function outputSampleRateFor(format: AudioOutputFormat, sourceRate: number): number {
  return format === "mp3" ? mp3SafeSampleRate(sourceRate) : sourceRate;
}

/** `-c:a` (and `-b:a`) for a format, mirroring `AUDIO_FORMAT_SPECS`. */
function codecArgsFor(format: AudioOutputFormat, bitrate: number): string[] {
  if (format === "mp3") return ["-c:a", "libmp3lame", "-b:a", `${Math.round(bitrate)}k`];
  if (format === "flac") return ["-c:a", "flac"];
  // WAV: the same 16-bit depth `encodePcmToWav` writes everywhere else in this
  // cluster, so a page cannot mean two things by "WAV".
  return ["-c:a", "pcm_s16le"];
}

/**
 * Pass 1: measure, write nothing.
 *
 * `-f null -` is the whole output; the answer arrives on stderr. `-map 0:a:0`
 * and `-vn` are the house pair (`audio-convert.ts` explains why): the default
 * stream selection picks the "best" audio stream, not necessarily the first,
 * and every statement this module makes is about the FIRST one.
 */
export function loudnormPass1Args(inputPath: string, t: NormalizeTarget): string[] {
  return [
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn",
    "-af", `loudnorm=I=${t.I}:TP=${t.TP}:LRA=${t.LRA}:print_format=json`,
    "-f", "null", "-",
  ];
}

/**
 * Pass 2: apply. With `s`, this is a linear correction against measured
 * loudness; without it, `loudnorm`'s own single-pass dynamic mode.
 *
 * `-ar ${sampleRate}` IS NOT OPTIONAL — see the 192 kHz measurement in the file
 * header. It is placed as an OUTPUT option (after `-af`, before the codec)
 * because the in-filtergraph `aresample` form exits 1.
 *
 * `print_format=json` IS NOT OPTIONAL EITHER, and it is here for a different
 * reason: it is the only thing that makes `linear=true` checkable. Measured, it
 * costs nothing — the written file is byte-for-byte the job it would have been
 * — and it buys `normalization_type`, without which this module would be
 * asserting a mode it cannot see. See the file header.
 *
 * `-map_metadata -1` makes the page's "tags and cover art are not carried over"
 * true. Without it FFmpeg's default `-map_metadata 0` copies every global tag
 * straight through; measured, ID3 title/artist/album/comment all survived.
 */
export function loudnormPass2Args(
  inputPath: string,
  outputName: string,
  t: NormalizeTarget,
  s: LoudnessStats | null,
  sampleRate: number,
  codecArgs: readonly string[],
): string[] {
  const base = `loudnorm=I=${t.I}:TP=${t.TP}:LRA=${t.LRA}`;
  const measured = s
    ? `${base}:measured_I=${s.input_i}:measured_LRA=${s.input_lra}:measured_TP=${s.input_tp}:measured_thresh=${s.input_thresh}:offset=${s.target_offset}:linear=true`
    : base;
  return [
    "-i", inputPath,
    "-map", "0:a:0",
    "-vn",
    "-map_metadata", "-1",
    "-af", `${measured}:print_format=json`,
    "-ar", String(Math.round(sampleRate)),
    ...codecArgs,
    outputName,
  ];
}

/**
 * The `silenceremove` filtergraph for a mode.
 *
 * Both recipes were measured against a 5.500 s fixture built as
 * 1 s silence + 1 s tone + 1.5 s silence + 1 s tone + 1 s silence:
 *   "ends" → 3.50 s (the two outer stretches gone, the middle gap kept)
 *   "all"  → 2.04 s (every gap over the minimum gone)
 *
 * "ends" needs the `areverse` sandwich because `silenceremove`'s start detector
 * only ever looks at the head of the stream; reversing, trimming the new head,
 * and reversing back is how the tail gets the same treatment. The two
 * `areverse` calls buffer the whole stream, which is the cost of the mode.
 */
export function silenceRemoveFilter(
  o: Pick<RemoveSilenceOptions, "mode" | "thresholdDb" | "minGapSeconds">,
): string {
  // A positive threshold would mean "louder than full scale is silence", which
  // deletes the entire file; a NaN would be pasted into the filtergraph as the
  // literal "NaN" and fail the run with an FFmpeg parse error.
  const db = Number.isFinite(o.thresholdDb) ? Math.min(0, o.thresholdDb) : -50;
  if (o.mode === "ends") {
    const head = `silenceremove=start_periods=1:start_threshold=${db}dB:start_duration=0`;
    return `${head},areverse,${head},areverse`;
  }
  const gap = Number.isFinite(o.minGapSeconds) ? Math.max(0.05, o.minGapSeconds) : 0.5;
  return `silenceremove=stop_periods=-1:stop_duration=${gap}:stop_threshold=${db}dB`;
}

// ── Shared FFmpeg plumbing ────────────────────────────────────────

/** `"song.flac"` -> `"song"`. */
function baseNameOf(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

/**
 * The virtual filename FFmpeg reads, carrying the extension it uses as a
 * demuxer hint. `.dat` for a dot-less name, same call as `audio-convert.ts`.
 */
function ffmpegInputName(file: File): string {
  return "input" + (/\.[^./]+$/.exec(file.name)?.[0] ?? ".dat");
}

/**
 * Bytes off the head of the file for `sniffSampleRate`.
 *
 * A slice, not the whole file: the sniffers read a container header (WAV `fmt`,
 * FLAC STREAMINFO, Ogg page 1, the MP4 box walk) or a bounded scan window, and
 * materialising a 700 MB WAV to learn one integer would undo the entire point
 * of mounting the input. An MP4 with its `moov` atom at the END will not be
 * sniffable from here, which is exactly what the log fallback is for.
 */
const SNIFF_HEAD_BYTES = 1024 * 1024;

async function sniffRateFromHead(file: File): Promise<number | null> {
  try {
    const head = await file.slice(0, Math.min(file.size, SNIFF_HEAD_BYTES)).arrayBuffer();
    return sniffSampleRate(new Uint8Array(head));
  } catch {
    // An unreadable slice is not a reason to fail the job — the log fallback
    // and then 44 100 still produce a correct `-ar`.
    return null;
  }
}

/** The default when nothing could be learned. Never surfaced as a claim. */
const FALLBACK_SAMPLE_RATE = 44100;

/**
 * Split one `ctx.onProgress` across several FFmpeg runs.
 *
 * Each `exec` reports 0–100 for itself, so without this a two-pass normalise
 * fills the bar, empties it and fills it again. `band()` moves the window; the
 * returned reporter maps a pass's own percentage into it.
 */
function bandedProgress(report: ((progress: number) => void) | undefined) {
  let base = 0;
  let span = 100;
  return {
    band(nextBase: number, nextSpan: number) {
      base = nextBase;
      span = nextSpan;
    },
    onProgress: report
      ? (p: number) => report(Math.max(0, Math.min(100, Math.round(base + (p / 100) * span))))
      : undefined,
  };
}

/**
 * Pass 1 is analysis only and pass 2 does the encode, but measured they cost
 * about the same (2 s stereo source: 40 ms analysing, 44 ms writing WAV, 65 ms
 * writing MP3). 40/60 is that, rounded in the direction that never lets the bar
 * sit still at the handover.
 */
const PASS1_PROGRESS_SHARE = 40;

// ── normalize-audio ───────────────────────────────────────────────

export interface NormalizeAudioOptions {
  target: NormalizeTargetKey;
  format: AudioOutputFormat;
  bitrate?: number;
}

export interface NormalizeAudioResult extends ProcessedResult {
  /**
   * TRUE only when pass 1 produced parseable stats AND pass 2 ran with them.
   * Single source of the "two-pass" claim — the UI must never assert it
   * independently.
   */
  twoPass: boolean;
  measured: LoudnessStats | null;
  target: NormalizeTarget;
  /** The sample rate pinned onto the output via `-ar`. See the file header. */
  sampleRate: number;
  /**
   * Which gain loudnorm REPORTED it applied, read out of pass 2's own JSON.
   *
   * The single source of the "one linear gain / the dynamics were left alone"
   * claim. `null` means pass 2 printed nothing this module could read, and the
   * caller must then say nothing about the mode rather than assume the better
   * one — `twoPass` says how many passes ran and says nothing about this.
   */
  normalizationType: LoudnormMode | null;
}

/**
 * Bring a file to a published loudness target.
 *
 * Two FFmpeg runs inside ONE task, so the source is mounted once and the second
 * pass cannot be queued behind an unrelated job that changes the FS underneath
 * it.
 */
export async function normalizeAudio(
  file: File,
  options: NormalizeAudioOptions,
  ctx: ProcessingContext = {},
): Promise<NormalizeAudioResult> {
  const target = NORMALIZE_TARGETS[options.target];
  if (!target) throw new Error(`Unknown loudness target: ${String(options.target)}`);
  const spec = AUDIO_FORMAT_SPECS[options.format];
  if (!spec) throw new Error(`Unsupported audio output format: ${String(options.format)}`);

  const { runFFmpegTask, mountInputFile, unmountInputFile } = await import("./ffmpeg-loader");

  const sniffedRate = await sniffRateFromHead(file);
  throwIfAborted(ctx.signal);

  const inputName = ffmpegInputName(file);
  const outputName = `normalized.${spec.ext}`;
  const codecArgs = codecArgsFor(options.format, options.bitrate ?? DEFAULT_MP3_BITRATE);

  /*
    TWO ARRAYS, NOT ONE. The sink is armed for the whole task and switched
    between them, because the two passes answer different questions and must
    not be able to answer each other's: `parseLoudnormStats` takes the LAST
    object it finds, so pass 2's post-correction numbers in a shared array would
    be handed back as what the INPUT measured. `null` between the passes keeps
    the mount/unmount chatter out of both.
  */
  const pass1Lines: string[] = [];
  const pass2Lines: string[] = [];
  let sink: string[] | null = null;
  const progress = bandedProgress(ctx.onProgress);

  const run = await runFFmpegTask(
    async (ffmpeg) => {
      const inputPath = await mountInputFile(ffmpeg, file, inputName);

      try {
        // An output left behind by an earlier job would be read as this job's
        // answer if the exec below failed after creating nothing.
        await ffmpeg.deleteFile(outputName).catch(() => {
          /* nothing there yet */
        });

        progress.band(0, PASS1_PROGRESS_SHARE);
        const pass1 = loudnormPass1Args(inputPath, target);
        assertSafeFFmpegAudioArgs(pass1);
        sink = pass1Lines;
        const ret1 = await ffmpeg.exec(pass1);
        sink = null;

        // A failed analysis is NOT a failed job: `loudnorm` still normalises in
        // its single-pass dynamic mode, so the run continues and the result
        // says which mode it used. Throwing here would turn a working tool into
        // an error page over a measurement nobody asked for by name.
        const measured = ret1 === 0 ? parseLoudnormStats(pass1Lines) : null;

        throwIfAborted(ctx.signal);

        /*
          FFMPEG'S OWN ANSWER FIRST, THE HEADER SNIFF SECOND. `-ar` exists to
          pin the rate of the stream `loudnorm` is filtering, and that is the
          DECODER's output rate — which is exactly what pass 1's `Stream #0:0`
          line reports, after FFmpeg has demuxed and decoded the file. The sniff
          reads a container header, which is a different number whenever the two
          can disagree: measured on an HE-AAC ADTS file built with
          `afconvert -f adts -d aach@44100`, `sniffSampleRate` returns 22050
          (the SBR core rate, all ADTS carries) while FFmpeg's own line says
          `aac (HE-AAC), 44100 Hz`. Pinning 22050 there wrote a half-rate file
          and threw away the whole SBR-reconstructed band above 11 kHz — 2.77%
          of the file's energy, measured by FFT — under a panel reading "source
          rate pinned". A `??` chain can only repair a NULL answer, never a
          wrong-but-plausible one, so the authoritative source has to be first.
          The sniff still covers what it is good for: the moov-at-the-end MP4
          and the containers FFmpeg's line does not match, where the log parse
          returns null and the order stops mattering.
        */
        const sourceRate =
          parseSourceSampleRate(pass1Lines) ?? sniffedRate ?? FALLBACK_SAMPLE_RATE;
        const sampleRate = outputSampleRateFor(options.format, sourceRate);

        progress.band(PASS1_PROGRESS_SHARE, 100 - PASS1_PROGRESS_SHARE);
        const pass2 = loudnormPass2Args(
          inputPath,
          outputName,
          target,
          measured,
          sampleRate,
          codecArgs,
        );
        assertSafeFFmpegAudioArgs(pass2);
        sink = pass2Lines;
        const ret2 = await ffmpeg.exec(pass2);
        sink = null;
        if (ret2 !== 0) {
          throw new Error(
            `Could not normalise ${file.name || "this file"}. It may be damaged, or it may hold no audio at all.`,
          );
        }

        const data = await ffmpeg.readFile(outputName);
        return {
          blob: new Blob([data as BlobPart], { type: spec.mime }),
          measured,
          sampleRate,
          sourceRate,
          /*
            DERIVED FROM THE ARGV THAT ACTUALLY RAN, not from a flag set beside
            it. `measured_I=` is in the filtergraph if and only if pass 1
            produced usable numbers and pass 2 was built with them, so this
            cannot drift away from the truth the way a second boolean can.
          */
          twoPass: pass2.some((arg) => arg.includes("measured_I=")),
          /*
            AND THE MODE, READ OFF THE RUN — the same discipline as `twoPass`,
            applied to the one thing the argv genuinely cannot establish.
            `linear=true` in the filtergraph proves linear was REQUESTED;
            `normalization_type` in pass 2's JSON is what loudnorm did with the
            request. See the file header for the measured refusal condition.
          */
          normalizationType: parseNormalizationType(pass2Lines),
        };
      } finally {
        sink = null;
        await unmountInputFile(ffmpeg);
        await ffmpeg.deleteFile(outputName).catch(() => {
          /* never written */
        });
      }
    },
    {
      signal: ctx.signal,
      onProgress: progress.onProgress,
      onLog: (line) => {
        sink?.push(line);
      },
    },
  );

  const warnings: string[] = [];
  if (!run.twoPass) {
    warnings.push(
      "The analysis pass produced no usable loudness measurement, so this file was normalised in a single pass instead. Single-pass loudnorm adjusts as it goes rather than applying one measured gain, so the result lands near the target rather than on it.",
    );
  }
  /*
    The two-pass run that did NOT get the linear gain it asked for. Only ever
    raised on `run.normalizationType === "dynamic"` — the value loudnorm itself
    printed — so a run whose JSON was unreadable says nothing instead of
    guessing. See the file header for why this is the common path rather than
    an edge, and for the measurement behind the sentence.
  */
  if (run.twoPass && run.normalizationType === "dynamic") {
    warnings.push(
      `Loudnorm did not apply one measured gain to this file. A single gain big enough to reach ${target.I} LUFS would have pushed the true peak past the ${target.TP} dBTP ceiling, so it rode the gain across the file instead — the loudness range inside the recording was changed, and the result lands near ${target.I} LUFS rather than exactly on it. A source with more headroom above its peaks gets the linear correction.`,
    );
  }
  if (run.sampleRate !== run.sourceRate) {
    /*
      "Nearest" was the wrong word and this module knew it: `mp3SafeSampleRate`
      is deliberately round-UP, so a 37 800 Hz source is written at 44 100 while
      the nearest rate MP3 can carry is 32 000. Say the rule instead of naming
      the wrong one.
    */
    warnings.push(
      `Written at ${(run.sampleRate / 1000).toFixed(1)} kHz, not the source's ${(run.sourceRate / 1000).toFixed(1)} kHz — MP3 cannot carry that rate. Anything above MP3's ${MAX_MP3_SAMPLE_RATE / 1000} kHz ceiling is written at ${MAX_MP3_SAMPLE_RATE / 1000} kHz; anything else is rounded UP to the next rate MP3 accepts rather than to the nearest one, so none of the band is thrown away. Choose WAV or FLAC to keep the original rate.`,
    );
  }

  return {
    blob: run.blob,
    fileName: `${baseNameOf(file)}-normalized.${spec.ext}`,
    originalSize: file.size,
    newSize: run.blob.size,
    warnings: warnings.length > 0 ? warnings : undefined,
    twoPass: run.twoPass,
    measured: run.measured,
    target,
    sampleRate: run.sampleRate,
    normalizationType: run.normalizationType,
  };
}

// ── remove-silence ────────────────────────────────────────────────

export interface RemoveSilenceOptions {
  /** "ends" = leading + trailing; "all" = every gap over `minGapSeconds`. */
  mode: "ends" | "all";
  /** Negative, e.g. -50. Anything at or below this counts as silence. */
  thresholdDb: number;
  /** Used by "all" only. */
  minGapSeconds: number;
  format: AudioOutputFormat;
  bitrate?: number;
}

export interface RemoveSilenceResult extends ProcessedResult {
  originalSeconds: number;
  newSeconds: number;
  removedSeconds: number;
  /**
   * The rates FFmpeg reported for the stream it READ and the stream it WROTE,
   * or null when the log did not say. Both are read back rather than assumed,
   * because no `-ar` is passed and the MP3 encoder negotiates its own.
   */
  sourceSampleRate: number | null;
  sampleRate: number | null;
}

/**
 * Cut silence out of a file.
 *
 * The durations come out of FFmpeg's own log — the `Duration:` header for the
 * source and the final `time=` for what was written — because the alternative
 * is a second mount-and-run just to ffprobe an output we already have in hand.
 * They carry FFmpeg's centisecond resolution and were verified against ffprobe
 * to within ~0.05 s (see `parseOutputDurationSeconds`); callers round.
 *
 * No `-ar` here, deliberately: `silenceremove` was measured to preserve the
 * source rate (44 100 Hz in, 44 100 Hz out), so pinning one would be a resample
 * nobody asked for. The MP3 arm is the exception FFmpeg handles itself — 96 kHz
 * and 88.2 kHz sources both came out as 48 kHz MP3s with no `-ar` given,
 * measured, in both silence modes, while WAV and FLAC kept the source rate.
 * That is unavoidable (`-ar 96000 -c:a libmp3lame` EXITs 1: MPEG layer III has
 * no such rate) but it is NOT unsayable, and "no `-ar` is asked for" is a
 * statement about the argv, not about the file. So both rates are read back off
 * the run's own log and the caller is told when they differ — the same shape
 * `normalizeAudio` uses, derived rather than asserted.
 */
export async function removeSilence(
  file: File,
  options: RemoveSilenceOptions,
  ctx: ProcessingContext = {},
): Promise<RemoveSilenceResult> {
  const spec = AUDIO_FORMAT_SPECS[options.format];
  if (!spec) throw new Error(`Unsupported audio output format: ${String(options.format)}`);

  const { runFFmpegTask, mountInputFile, unmountInputFile } = await import("./ffmpeg-loader");

  const inputName = ffmpegInputName(file);
  const outputName = `desilenced.${spec.ext}`;
  const lines: string[] = [];

  const run = await runFFmpegTask(
    async (ffmpeg) => {
      const inputPath = await mountInputFile(ffmpeg, file, inputName);

      try {
        await ffmpeg.deleteFile(outputName).catch(() => {
          /* nothing there yet */
        });

        const args = [
          "-i", inputPath,
          "-map", "0:a:0",
          "-vn",
          // Makes the page's "tags and cover art are not carried over" true;
          // FFmpeg's default copies them. See the file header.
          "-map_metadata", "-1",
          "-af", silenceRemoveFilter(options),
          ...codecArgsFor(options.format, options.bitrate ?? DEFAULT_MP3_BITRATE),
          outputName,
        ];
        assertSafeFFmpegAudioArgs(args);

        const ret = await ffmpeg.exec(args);
        if (ret !== 0) {
          throw new Error(
            `Could not remove silence from ${file.name || "this file"}. It may be damaged, or it may hold no audio at all.`,
          );
        }

        const data = await ffmpeg.readFile(outputName);
        return {
          blob: new Blob([data as BlobPart], { type: spec.mime }),
          originalSeconds: parseInputDurationSeconds(lines) ?? 0,
          newSeconds: parseOutputDurationSeconds(lines) ?? 0,
          sourceSampleRate: parseSourceSampleRate(lines),
          sampleRate: parseOutputSampleRate(lines),
        };
      } finally {
        await unmountInputFile(ffmpeg);
        await ffmpeg.deleteFile(outputName).catch(() => {
          /* never written */
        });
      }
    },
    { signal: ctx.signal, onProgress: ctx.onProgress, onLog: (line) => lines.push(line) },
  );

  // Never negative: a source whose header duration is missing reads 0, and
  // "removed -3.5 seconds" is worse than "removed nothing".
  const removedSeconds = Math.max(0, run.originalSeconds - run.newSeconds);

  const warnings: string[] = [];
  if (removedSeconds === 0) {
    warnings.push(
      "Nothing was removed. Either there is no stretch quieter than the threshold, or it is shorter than the minimum gap — try a higher (less negative) threshold, or a shorter minimum gap.",
    );
  }
  // Only when BOTH numbers were actually read and they actually differ: a log
  // this parser could not follow says nothing rather than inventing a rate.
  if (
    run.sourceSampleRate !== null &&
    run.sampleRate !== null &&
    run.sourceSampleRate !== run.sampleRate
  ) {
    warnings.push(
      `Written at ${(run.sampleRate / 1000).toFixed(1)} kHz, not the source's ${(run.sourceSampleRate / 1000).toFixed(1)} kHz. Nothing here asked for a resample — MP3 tops out at ${MAX_MP3_SAMPLE_RATE / 1000} kHz, so the encoder picked a rate it can carry. Choose WAV or FLAC to keep the original rate.`,
    );
  }

  return {
    blob: run.blob,
    fileName: `${baseNameOf(file)}-silence-removed.${spec.ext}`,
    originalSize: file.size,
    newSize: run.blob.size,
    warnings: warnings.length > 0 ? warnings : undefined,
    originalSeconds: run.originalSeconds,
    newSeconds: run.newSeconds,
    removedSeconds,
    sourceSampleRate: run.sourceSampleRate,
    sampleRate: run.sampleRate,
  };
}

// ── Web Audio effects ─────────────────────────────────────────────

/**
 * Linear gain for a decibel figure. `0 dB` is exactly 1 — the identity, not
 * 0.9999999 — so a "no change" run is provably a no-op.
 */
export function gainFromDb(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return db === 0 ? 1 : Math.pow(10, db / 20);
}

/** The loudest absolute sample across every channel, 0..∞. */
export function peakOfChannels(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Encode a rendered buffer, WITHOUT this module ever importing `ffmpeg-loader`.
 *
 * MP3 and WAV go straight to the audio worker pool. FLAC has no pool encoder —
 * the pool has exactly two — so it goes out as a lossless 16-bit WAV and back
 * in through `convertAudio`, which owns the FFmpeg FLAC arm and its dynamic
 * import. That hop is lossless by construction (FLAC of a WAV of these samples
 * is FLAC of these samples), and it is the price of not putting a second
 * FFmpeg call site on two pages whose whole point is that they do not need one.
 * The cost is real and worth stating: the intermediate WAV exists in memory
 * beside the decoded buffer for the length of the encode.
 */
async function encodeBuffer(
  buffer: AudioBuffer,
  format: AudioOutputFormat,
  bitrate: number,
  outputBaseName: string,
  ctx: ProcessingContext,
): Promise<Blob> {
  if (format === "mp3") {
    const { resampleForMp3 } = await import("./audio-encode-mp3");
    const { encodeMp3 } = await import("@/lib/workers/audio-client");
    return encodeMp3(await resampleForMp3(buffer), bitrate, ctx);
  }

  const { encodeWav } = await import("@/lib/workers/audio-client");
  const wav = await encodeWav(buffer, ctx);
  if (format === "wav") return wav;

  const { convertAudio } = await import("./audio-convert");
  const intermediate = new File([wav], `${outputBaseName}.wav`, { type: "audio/wav" });
  return (await convertAudio(intermediate, { format: "flac" }, { signal: ctx.signal })).blob;
}

// ── What the MP3 arm actually delivers ────────────────────────────

/**
 * MP3 holds two channels. Mirrored from `encodePcmToMp3`'s own
 * `Math.min(channelData.length, 2)` in `audio-pcm.ts`, which does not export a
 * name for it; `audio-effects.test.ts` pins the fold this drives against the
 * arithmetic that file documents.
 */
const MP3_MAX_CHANNELS = 2;

/**
 * The -3 dB every channel beyond front L/R is summed in at — `SURROUND_FOLD_GAIN`
 * in `audio-pcm.ts`, same constant, same reason.
 */
const SURROUND_FOLD_GAIN = Math.SQRT1_2;

export interface StereoFold {
  /** Two channels for a wider input; the input untouched for one or two. */
  channels: Float32Array[];
  /** The peak the SUM reached, before anything was done to make it fit. */
  foldPeak: number;
  /** What the whole mix was multiplied by to fit: `1 / foldPeak`, or exactly 1. */
  scale: number;
}

/**
 * Sum a wider-than-stereo mix into L/R exactly the way the MP3 encoder would.
 *
 * A DELIBERATE DUPLICATE of `toStereoFloats` (`audio-pcm.ts`), and it is here so
 * the fold happens where a page can see it. The encoder's copy runs inside the
 * audio worker and reports nothing back, so measuring a peak before handing the
 * samples over described samples that were never written: six sub-unity
 * channels can sum above 1, at which point `toStereoFloats` divides the WHOLE
 * mix by its own peak. That is a level change nobody asked for, it fires at a
 * gain of exactly 0 dB on any reasonably loud 5.1 source, and past the point
 * where the sum crosses unity it makes the gain control inert — `fold(g·x)` is
 * `g·fold(x)`, so dividing by `g·foldPeak` cancels the `g`.
 *
 * Folding here first is what fixes it: the encoder's copy then sees two
 * channels and returns them untouched, so the bytes are unchanged, while
 * `peakAfter`, `clipped` and the warnings finally describe the delivered file.
 * The arithmetic is copied line for line, accumulation order included.
 */
export function foldToStereo(channels: readonly Float32Array[]): StereoFold {
  if (channels.length <= MP3_MAX_CHANNELS) {
    return { channels: channels.slice(), foldPeak: peakOfChannels(channels), scale: 1 };
  }

  const left = Float32Array.from(channels[0]);
  const right = Float32Array.from(channels[1]);
  for (let ch = 2; ch < channels.length; ch++) {
    const extra = channels[ch];
    for (let i = 0; i < left.length; i++) {
      const folded = extra[i] * SURROUND_FOLD_GAIN;
      left[i] += folded;
      right[i] += folded;
    }
  }

  let foldPeak = 0;
  for (let i = 0; i < left.length; i++) {
    foldPeak = Math.max(foldPeak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (foldPeak > 1) {
    for (let i = 0; i < left.length; i++) {
      left[i] /= foldPeak;
      right[i] /= foldPeak;
    }
    return { channels: [left, right], foldPeak, scale: 1 / foldPeak };
  }
  return { channels: [left, right], foldPeak, scale: 1 };
}

/** What `encodeBuffer` is about to be handed, and what the format costs. */
export interface EncodePlan {
  /** The samples the encoder receives. */
  channels: Float32Array[];
  /** The rate that will be WRITTEN. */
  sampleRate: number;
  /** The channel count that will be WRITTEN. */
  channelCount: number;
  /**
   * The peak the operation PRODUCED, before any encoder ceiling took it back —
   * a flat-top on the mono/stereo path, a whole-mix divide on the fold path.
   * This is what `clipped` means.
   */
  peakProduced: number;
  /** The peak of the samples the encoder is actually handed. */
  peakDelivered: number;
  /** TRUE when channels beyond stereo were summed into L/R to fit MP3. */
  folded: boolean;
  /** What the fold multiplied the whole mix by; exactly 1 when it fit. */
  foldScale: number;
}

/**
 * Decide what the chosen format will really be given, and measure it there.
 *
 * WAV and FLAC take whatever they are handed — every channel, the source rate —
 * so the plan is the identity and both peaks are the same number. MP3 is where
 * the two ceilings live, and both of them are stated here rather than
 * discovered afterwards by a page that cannot see them.
 *
 * The rate is `Math.min(source, 48 000)` and NOT `mp3SafeSampleRate`, because
 * this arm goes through `resampleForMp3`, whose rule is exactly that: it moves
 * anything above the ceiling down and returns everything else untouched. The
 * `-ar` round-up rule belongs to the FFmpeg arm and stating it here would be a
 * claim about a resample that does not happen.
 *
 * One honest limit: on a >48 kHz MP3 export `resampleForMp3` still runs after
 * this, and a resample can move a peak by a fraction of a decibel. `peakDelivered`
 * is measured before it, and no caller may present it as more exact than that.
 */
function planEncode(
  channels: Float32Array[],
  sourceRate: number,
  format: AudioOutputFormat,
): EncodePlan {
  if (format !== "mp3") {
    const peak = peakOfChannels(channels);
    return {
      channels,
      sampleRate: sourceRate,
      channelCount: channels.length,
      peakProduced: peak,
      peakDelivered: peak,
      folded: false,
      foldScale: 1,
    };
  }

  const fold = foldToStereo(channels);
  return {
    channels: fold.channels,
    sampleRate: Math.min(sourceRate, MAX_MP3_SAMPLE_RATE),
    channelCount: fold.channels.length,
    peakProduced: fold.foldPeak,
    peakDelivered: peakOfChannels(fold.channels),
    folded: channels.length > MP3_MAX_CHANNELS,
    foldScale: fold.scale,
  };
}

/**
 * The warnings that follow from the plan alone — the two things the MP3 arm
 * changes about the file's SHAPE, said only when they actually happened.
 *
 * Both pages carried "channels and rate come out unchanged" over this, which is
 * true on WAV and FLAC and false on the default arm for a hi-res or surround
 * source. A derived warning is what makes the page's claim follow the run.
 */
function shapeWarnings(plan: EncodePlan, sourceRate: number, sourceChannels: number): string[] {
  const out: string[] = [];
  if (plan.folded) {
    out.push(
      `MP3 carries at most ${MP3_MAX_CHANNELS} channels, so this ${sourceChannels}-channel mix was folded into stereo before encoding — the extra channels were summed into left and right at −3 dB${
        plan.foldScale < 1
          ? `, that sum reached ${dbfs(plan.peakProduced)}, and the whole mix was then scaled down by ${(-dbOf(plan.foldScale)).toFixed(1)} dB to fit. That scaling is not something you asked for`
          : ""
      }. Choose WAV or FLAC to keep all ${sourceChannels} channels.`,
    );
  }
  if (plan.sampleRate !== sourceRate) {
    out.push(
      `Written at ${(plan.sampleRate / 1000).toFixed(1)} kHz, not the source's ${(sourceRate / 1000).toFixed(1)} kHz — MP3 cannot carry rates above ${MAX_MP3_SAMPLE_RATE / 1000} kHz. Choose WAV or FLAC to keep the original rate.`,
    );
  }
  return out;
}

/** Copy `channels` into a fresh AudioBuffer of the same shape. */
function bufferFromChannels(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const context = new OfflineAudioContext(channels.length, Math.max(1, length), sampleRate);
  const buffer = context.createBuffer(channels.length, Math.max(1, length), sampleRate);
  for (let ch = 0; ch < channels.length; ch++) buffer.getChannelData(ch).set(channels[ch]);
  return buffer;
}

export interface ChangeVolumeOptions {
  gainDb: number;
  format: AudioOutputFormat;
  bitrate?: number;
}

/** The shape a Web Audio run read, and the shape it wrote. */
export interface DeliveredShape {
  /** The rate that was written. */
  sampleRate: number;
  /** The channel count that was written. */
  channels: number;
  sourceSampleRate: number;
  sourceChannels: number;
  /** TRUE when channels beyond stereo were summed into L/R to fit MP3. */
  foldedToStereo: boolean;
  /** What that fold multiplied the whole mix by; exactly 1 when it fit. */
  foldScale: number;
}

export interface ChangeVolumeResult extends ProcessedResult, DeliveredShape {
  /**
   * TRUE when the level the gain produced could not be stored — flat-topped by
   * `floatTo16Bit` on the mono/stereo path, or scaled down by the surround fold
   * on the MP3 path. Either way it is not the level that was asked for.
   */
  clipped: boolean;
  /** Loudest absolute sample before the gain, 0..1 for an undamaged decode. */
  peakBefore: number;
  /**
   * Loudest absolute sample of the file that was DELIVERED — measured after the
   * gain and after the surround fold, so it describes the download rather than
   * an intermediate nobody receives. `clipped` is about the peak the gain
   * produced, which is a different number whenever this one was pulled back.
   */
  peakAfter: number;
  /** The peak the gain produced, before any encoder ceiling took it back. */
  peakProduced: number;
}

/**
 * Multiply every sample by a fixed gain.
 *
 * NOTHING IS LIMITED, COMPRESSED OR NORMALISED HERE, and that is a decision.
 * A boost that pushes peaks above full scale is reported (`clipped`), not
 * quietly repaired: a tool that silently pulled the whole file back down would
 * hand back a file that is not the gain the user asked for, and a tool that
 * silently limited would change the shape of the loudest moments without
 * saying so. `/normalize-audio` is the page for "make it the right loudness".
 *
 * WHAT THE ENCODERS DO WITH AN OVER-UNITY SAMPLE, exactly, because `clipped`
 * has to mean something: `floatTo16Bit` (`audio-pcm.ts`) clamps to ±1, so WAV
 * at any channel count and MP3 from a mono or stereo source come out
 * flat-topped. The one exception is a source WIDER than stereo going to MP3,
 * where the fold to L/R peak-normalises — there the whole mix is scaled down
 * instead. Either way the file cannot hold the peak the gain produced, which is
 * what `clipped` reports.
 *
 * THE HOLE THAT REASONING USED TO HAVE, and why `planEncode` exists: the fold
 * can cross unity while every individual channel is far below it. Six channels
 * peaking at 0.5 sum to 2.03, so a 5.1 mix is rescaled — measured — on a run
 * requesting 0 dB, and the old code measured its peak on the six pre-fold
 * channels, reported `clipped: false`, emitted no warning, and let the page
 * print "nothing was flattened" over a file whose level it had changed. The
 * fold now happens in `planEncode` before anything is measured, so `peakAfter`
 * is the delivered peak, `clipped` is the peak the gain produced, and the fold
 * gets a warning of its own whatever the gain was.
 */
export async function changeAudioVolume(
  file: File,
  options: ChangeVolumeOptions,
  ctx: ProcessingContext = {},
): Promise<ChangeVolumeResult> {
  const spec = AUDIO_FORMAT_SPECS[options.format];
  if (!spec) throw new Error(`Unsupported audio output format: ${String(options.format)}`);
  if (!Number.isFinite(options.gainDb)) throw new Error("Volume change must be a number");

  const { decodeAudioFile } = await import("./audio-decode");
  const decoded = await decodeAudioFile(file, ctx);
  throwIfAborted(ctx.signal);

  const gain = gainFromDb(options.gainDb);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    // `.slice()` first: the decoded buffer is the caller's, and scaling it in
    // place would corrupt anything else still holding it (a waveform redraw,
    // a second run at a different gain).
    const data = decoded.getChannelData(ch).slice();
    if (gain !== 1) for (let i = 0; i < data.length; i++) data[i] *= gain;
    channels.push(data);
  }

  const peakBefore = peakOfChannels(
    Array.from({ length: decoded.numberOfChannels }, (_, ch) => decoded.getChannelData(ch)),
  );

  const sourceRate = decoded.sampleRate;
  const sourceChannels = decoded.numberOfChannels;
  // Measured on the samples the encoder will actually receive, not predicted as
  // `peakBefore * gain` — the two agree on the plain path, and only the
  // measured one survives the MP3 arm's fold.
  const plan = planEncode(channels, sourceRate, options.format);

  const baseName = baseNameOf(file);
  const blob = await encodeBuffer(
    bufferFromChannels(plan.channels, sourceRate),
    options.format,
    options.bitrate ?? DEFAULT_MP3_BITRATE,
    `${baseName}-volume`,
    ctx,
  );

  const clipped = plan.peakProduced > 1;
  const warnings = shapeWarnings(plan, sourceRate, sourceChannels);
  // Only on the path where the encoder FLATTENS. When the mix was folded, the
  // fold warning above already names the peak the sum reached and the decibels
  // it was pulled down by, and a second warning telling the user to lower a
  // gain that may have been 0 dB would be advice that does not work.
  if (clipped && !plan.folded) {
    warnings.push(
      `This gain pushes the loudest peak to ${dbfs(plan.peakProduced)}, above the 0 dBFS ceiling. No audio file can store that — the encoder either flattens those peaks or pulls the whole mix down, and neither is the level you asked for. ${(-dbOf(peakBefore)).toFixed(1)} dB is the most this file takes without going over.`,
    );
  }

  return {
    blob,
    fileName: `${baseName}-volume.${spec.ext}`,
    originalSize: file.size,
    newSize: blob.size,
    warnings: warnings.length > 0 ? warnings : undefined,
    clipped,
    peakBefore,
    peakAfter: plan.peakDelivered,
    peakProduced: plan.peakProduced,
    sampleRate: plan.sampleRate,
    channels: plan.channelCount,
    sourceSampleRate: sourceRate,
    sourceChannels,
    foldedToStereo: plan.folded,
    foldScale: plan.foldScale,
  };
}

/** A 0..∞ linear amplitude as dBFS, for copy. `0` reads as `-inf`. */
function dbfs(amplitude: number): string {
  if (!(amplitude > 0)) return "-inf dBFS";
  return `${dbOf(amplitude).toFixed(1)} dBFS`;
}

function dbOf(amplitude: number): number {
  return 20 * Math.log10(amplitude);
}

export interface ReverseAudioOptions {
  format: AudioOutputFormat;
  bitrate?: number;
}

export interface ReverseAudioResult extends ProcessedResult, DeliveredShape {}

/**
 * Play the file backwards.
 *
 * A per-channel reverse of the decoded samples — no filter, no second engine.
 * The REVERSE changes nothing but the order of the samples; what the chosen
 * output format costs is a separate question, and this function now answers it
 * instead of asserting there is no cost. WAV and FLAC really do carry the
 * channel count and rate through untouched. MP3 does not, and cannot: it holds
 * two channels and 48 kHz, so a hi-res or surround source comes back changed.
 * The delivered shape is returned and the differences are warned about, because
 * a claim of "unchanged" over the default arm was simply false — measured, a
 * 96 kHz source reached the MP3 encoder at 48 kHz and a 5.1 source at 2
 * channels, with no warning of either.
 */
export async function reverseAudio(
  file: File,
  options: ReverseAudioOptions,
  ctx: ProcessingContext = {},
): Promise<ReverseAudioResult> {
  const spec = AUDIO_FORMAT_SPECS[options.format];
  if (!spec) throw new Error(`Unsupported audio output format: ${String(options.format)}`);

  const { decodeAudioFile } = await import("./audio-decode");
  const decoded = await decodeAudioFile(file, ctx);
  throwIfAborted(ctx.signal);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const source = decoded.getChannelData(ch);
    const out = new Float32Array(source.length);
    for (let i = 0; i < source.length; i++) out[i] = source[source.length - 1 - i];
    channels.push(out);
  }

  const sourceRate = decoded.sampleRate;
  const sourceChannels = decoded.numberOfChannels;
  const plan = planEncode(channels, sourceRate, options.format);

  const baseName = baseNameOf(file);
  const blob = await encodeBuffer(
    bufferFromChannels(plan.channels, sourceRate),
    options.format,
    options.bitrate ?? DEFAULT_MP3_BITRATE,
    `${baseName}-reversed`,
    ctx,
  );

  const warnings = shapeWarnings(plan, sourceRate, sourceChannels);
  return {
    blob,
    fileName: `${baseName}-reversed.${spec.ext}`,
    originalSize: file.size,
    newSize: blob.size,
    warnings: warnings.length > 0 ? warnings : undefined,
    sampleRate: plan.sampleRate,
    channels: plan.channelCount,
    sourceSampleRate: sourceRate,
    sourceChannels,
    foldedToStereo: plan.folded,
    foldScale: plan.foldScale,
  };
}
