import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/*
 * ───────────────────────────────────────────────────────────────────────────
 * THE FFmpeg ARGV INVENTORY GATE — the evidence the LGPL-core decision rests on
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `scripts/build-ffmpeg-core-lgpl.sh` proposes rebuilding the FFmpeg WASM core
 * without `--enable-gpl --enable-libx264 --enable-libx265`. Whether that is a
 * free win or a product regression turns on ONE question: does any argv this
 * app builds reach a GPL component?
 *
 * From 2026-09-02 to 2026-09-05 that question was answered by a COMMENT —
 * `build-ffmpeg-core-lgpl.sh:33-35` and the matching table in
 * `licensing-posture.md` — asserting that `-vf`/`-af`/`-filter`/`-lavfi`/`-map`
 * were absent from src/ and that the app issued three FFmpeg command lines,
 * none of which could reach x264 or x265.
 *
 * Every one of those claims had gone false, and nothing noticed, because there
 * was nothing to notice: no line of that script greps src/ for anything. It
 * could not fail, because it never ran. That is this repo's own recorded
 * failure mode in a new shape — a verification gate that cannot fail proves
 * nothing (see the LICENSING GATE block in `scripts/build-qpdf-wasm.sh` and
 * `src/__tests__/unit/data/qpdf-artifact.test.ts`, both written after the same
 * disease in `strings BIG | grep -q PATTERN` form).
 *
 * What had actually happened, verified 2026-09-05 and re-derived here on every
 * unit run:
 *
 *   * `-map 0:a:0` ships in FOUR production sites and is load-bearing for
 *     correctness, not incidental: FFmpeg's default stream selection picks the
 *     "best" audio stream, not the first, while every honest statement the
 *     audio cluster makes describes the FIRST. It cannot be deleted to make
 *     the old sentence true again.
 *   * `-c:v libx264` became a LIVE argv (`lib/tools/video-remux.ts`), reachable
 *     from the "Re-encode to H.264" toggle that six container pages render.
 *     Dropping `--enable-libx264` removes a shipped feature; it is no longer a
 *     free win, it is a product trade-off. THAT IS AN OWNER DECISION and this
 *     file does not make it — it only refuses to let the evidence rot again.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW IT READS THE TREE
 * ───────────────────────────────────────────────────────────────────────────
 * Comments are stripped first, with a hand-written scanner rather than a
 * regex, because the interesting names are ALSO the names the comments
 * discuss: `video-remux.ts` mentions `libx264`/`libx265` four times and only
 * ONE of them is argv. A naive `grep libx264 src/` reports four GPL call sites
 * where there is one, and a line-comment regex misses the block comment above
 * `transcodeArgs`, where two more sit. The stripper blanks comment bytes in
 * place (newlines kept) so byte offsets — and the line numbers derived from
 * them — survive.
 *
 * Then every string/template literal is extracted with its offset, and the
 * scan works on literals only. An FFmpeg flag that never appears as a literal
 * is not an argv this repo can audit statically, which is itself a finding
 * (see the `-c:v` assertion below).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE DELIBERATELY DOES NOT COVER — stated so nobody over-reads it
 * ───────────────────────────────────────────────────────────────────────────
 * 1. A filtergraph string built from variables cannot be resolved statically.
 *    What is pinned instead is WHICH files may build one at all, which filter
 *    names each of them has been licence-reviewed for, and that no well-known
 *    GPL-only filter name appears in their literals. A new file is caught by
 *    the file allowlist; a GPL filter smuggled into an already-allowed file is
 *    caught by the denylist only if it is on that list, which is not
 *    exhaustive.
 * 2. The implicit-encoder trap ("an .mp4 output with no `-c:v` defaults to
 *    libx264") is not detected in general — that needs the muxer's defaults,
 *    which live in the binary, not the source. The partial cure is the `-c` /
 *    `-c:v` assertion below: every codec selection in the tree today is an
 *    explicit literal, and a NEW file that wrote a video container without one
 *    would still trip the argv-file allowlist.
 * 3. AUDIO encoder selection (`-c:a`, `-acodec`, `-b:a`) is deliberately not
 *    gated. There is no GPL audio encoder in this core's static-link set to
 *    catch — the configure line's audio half is libmp3lame (LGPL) plus
 *    libopus/libvorbis/libtheora (BSD) — so a rule there would be ceremony,
 *    and it would collide with `audio-convert.ts`'s table-driven `-c:a`.
 *    `assertSafeFFmpegAudioArgs` is what guards that argv, for the unrelated
 *    stereo-Opus trap.
 * 4. It says nothing about what is IN the shipped binary. That is the other
 *    half, and it lives in `scripts/build-ffmpeg-core-lgpl.sh`'s `strings`
 *    blocks (which are correctly written and can genuinely fail) — the wasm
 *    core is gitignored, so a unit test cannot read it.
 */

const ROOT = process.cwd();
const SRC = resolve(ROOT, "src");

/* ─────────────────────────── THE ALLOWLISTS ─────────────────────────────
 * Every entry below is a licence review that was actually performed. Adding a
 * row is the moment to redo it — and to update `scripts/build-ffmpeg-core-lgpl.sh`
 * and `licensing-posture.md`, which the last two assertions in this file tie
 * to the same facts.
 */

/**
 * Files that may construct an FFmpeg argv. Detected by import of
 * `ffmpeg-loader` OR a call to `ffmpeg.exec(` / `ffmpeg.ffprobe(` — two
 * independent signals that agreed exactly on 2026-09-05, so a file that
 * renames the handle is still caught by its import.
 */
const ALLOWED_ARGV_FILES: Record<string, string> = {
  "lib/tools/audio-convert.ts":
    "-i / -map 0:a:0 / -vn / -c:a <flac|mp3|wav from AUDIO_FORMAT_SPECS>. No GPL encoder is selectable: the value comes from a closed table and passes assertSafeFFmpegAudioArgs.",
  "lib/tools/audio-decode.ts":
    "-i / -acodec pcm_s16le / -f wav. Native PCM, no implicit default consulted.",
  "lib/tools/extract-audio.ts":
    "Three argvs: -c:a copy, -c:a pcm_s16le, and -b:a <n>k into .mp3 (libmp3lame, LGPL — there is no libshine in this core).",
  "lib/tools/video-probe.ts": "ffprobe only: -v error -print_format json -show_streams -show_format -o. Encodes nothing.",
  "lib/tools/video-remux.ts":
    "THE ONE GPL SITE. copyArgs/mute/rotate are -c copy; transcodeArgs passes -c:v libx264 (GPL-2.0-or-later) and is reachable from the VideoRemuxUI 'Re-encode to H.264' toggle.",
  "lib/tools/video-trim.ts": "-ss / -i / -t / -c copy / -avoid_negative_ts. Stream copy pre-empts every muxer default.",

  /*
   * Wave 3B, reviewed in advance (2026-09-05) rather than left to red-light
   * work already contracted. The review is the point of the entry, so it is
   * recorded here in full:
   *
   *   audio-effects.ts — the first `-af` in this repo's history. `loudnorm`
   *     (af_loudnorm.c) and `silenceremove` (af_silenceremove.c) are
   *     libavfilter's OWN sources, LGPL-2.1-or-later with the rest of the
   *     core and outside the `--enable-gpl` set; `areverse` (f_reverse.c) is
   *     the same. Both filters plus their full AVOption tables were found in
   *     the shipped binary. They change nothing about the LGPL argument.
   *   video-split.ts / video-merge.ts — stream copies only, by decision D3/D4
   *     of this wave. A `-filter_complex concat` fallback would have selected
   *     libx264 and DEEPENED the GPL entanglement, which is one of the three
   *     recorded reasons that fallback was cut.
   *
   * The flag-level rules below apply to these three in full: if any of them
   * lands with a `-vf`, an unvetted filter, or a GPL encoder, this gate reds.
   */
  "lib/tools/audio-effects.ts": "Wave 3B: -af loudnorm / silenceremove / areverse, all libavfilter's own LGPL sources.",
  "lib/tools/video-split.ts": "Wave 3B: -ss / -t / -c copy, one run per segment. Stream copy only.",
  "lib/tools/video-merge.ts": "Wave 3B: -f concat -safe 0 -i list.txt -c copy. Stream copy only.",
};

/**
 * The positive half. These six exist today; if one disappears the inventory
 * changed and the two documents have to be re-read — including the good news
 * case where `video-remux.ts` stops being an FFmpeg caller at all, which is
 * exactly what would unblock the LGPL core.
 */
const REQUIRED_ARGV_FILES = [
  "lib/tools/audio-convert.ts",
  "lib/tools/audio-decode.ts",
  "lib/tools/extract-audio.ts",
  "lib/tools/video-probe.ts",
  "lib/tools/video-remux.ts",
  "lib/tools/video-trim.ts",
];

/** `-af`/`-vf`/`-lavfi`/`-filter*` may only be built by these files. */
const FILTERGRAPH_ALLOWLIST: Record<string, { flags: string[]; filters: string[] }> = {
  "lib/tools/audio-effects.ts": { flags: ["-af"], filters: ["loudnorm", "silenceremove", "areverse"] },
};

/**
 * `-map` is stream SELECTION, not a filtergraph — the retired comment lumped
 * the two together and that is half of why it read as false. Pinned separately
 * so the distinction survives.
 */
const ALLOWED_MAP_FILES = ["lib/tools/audio-convert.ts", "lib/tools/extract-audio.ts", "lib/tools/audio-effects.ts"];
const REQUIRED_MAP_FILES = ["lib/tools/audio-convert.ts", "lib/tools/extract-audio.ts"];

/** GPL-2.0-or-later encoders in the shipped core's static-link set. */
const GPL_ENCODERS = ["libx264", "libx265"];

/**
 * Where a `libx264`/`libx265` string literal is allowed to exist at all, and
 * how many. `exact: 1` on video-remux.ts is doing double duty: it pins the
 * single GPL call site AND self-tests the comment stripper, because that file
 * names the two encoders three more times in prose (`:165`, `:326`, `:332`).
 * If stripping ever breaks, this count reads 4 and the gate says so.
 */
const GPL_LITERAL_ALLOWLIST: Record<string, { exact?: number; atLeast?: number; why: string }> = {
  "lib/tools/video-remux.ts": { exact: 1, why: "the -c:v value in transcodeArgs — the app's only GPL-reachable argv" },
  "app/licenses/page.tsx": {
    atLeast: 1,
    why: "the configure line reproduced from `strings` on the shipped core; the GPL notice REQUIRES this disclosure while the GPL core ships",
  },
};

/** Video encoders an argv may name. `copy` is handled by the `-c` rule. */
const VETTED_VIDEO_ENCODERS = ["libx264"];

/**
 * A sample of libavfilter's GPL-only filters (FFmpeg 5.1). NOT exhaustive —
 * see gap (1) in the header. It is belt-and-braces behind the file allowlist,
 * and it is aimed at the realistic accident: reaching for a denoiser or a
 * deinterlacer from a tutorial without noticing that half of those are the
 * `--enable-gpl` half of libavfilter.
 */
const GPL_ONLY_FILTERS = [
  "boxblur", "colormatrix", "cover_rect", "cropdetect", "delogo", "eq", "find_rect",
  "fspp", "histeq", "hqdn3d", "kerndeint", "mcdeint", "mpdecimate", "nnedi",
  "owdenoise", "perspective", "phase", "pp", "pp7", "pullup", "repeatfields",
  "sab", "smartblur", "spp", "stereo3d", "super2xsai", "tinterlace", "uspp",
  "vaguedenoiser", "vidstabdetect", "vidstabtransform",
];

/* ───────────────────────────── THE SCANNER ────────────────────────────── */

/**
 * Blank out comment bytes, in place, preserving length and newlines so offsets
 * still map to line numbers. Written as a scanner and not a regex because a
 * regex cannot tell `//` inside a string ("https://…") from a line comment,
 * and this tree has both.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const blank = (chunk: string) => chunk.replace(/[^\n]/g, " ");
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j += 1;
      out += blank(source.slice(i, j));
      i = j;
    } else if (c === "/" && d === "*") {
      const close = source.indexOf("*/", i + 2);
      const j = close === -1 ? source.length : close + 2;
      out += blank(source.slice(i, j));
      i = j;
    } else if (c === '"' || c === "'" || c === "`") {
      // Copied through verbatim: the literals ARE the evidence.
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

interface Literal {
  /** Contents, quotes removed. A template's `${…}` text is left in place. */
  value: string;
  start: number;
  end: number;
}

const LITERAL_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

function literalsOf(code: string): Literal[] {
  const out: Literal[] = [];
  LITERAL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LITERAL_RE.exec(code))) {
    out.push({ value: m[0].slice(1, -1), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const lineAt = (code: string, index: number) => code.slice(0, index).split("\n").length;

/**
 * The literal that directly follows `lits[k]` in an argv array — i.e. with
 * nothing but whitespace and a comma between them. Returns null when the next
 * argv element is an expression, which for a codec flag is a finding rather
 * than a nuisance: a dynamically chosen encoder cannot be licence-audited from
 * the source.
 */
function adjacentLiteral(code: string, lits: Literal[], k: number): Literal | null {
  const next = lits[k + 1];
  if (!next) return null;
  return /^[\s,]*$/.test(code.slice(lits[k].end, next.start)) ? next : null;
}

/**
 * Is this flag-shaped literal actually an ELEMENT of an argv, or is it an
 * argument to something else?
 *
 * Found the hard way, by this gate going red on `video-merge.ts`'s
 * `isStreamCopyArgs`, which reads `args[i].startsWith("-c")` — a predicate over
 * an argv, not a member of one. The tell is what comes next: an argv element is
 * followed by a comma or the closing bracket of the array, while a predicate's
 * argument is followed by `)`.
 *
 * KNOWN GAP, and the reason it is accepted: `args.push("-af"); args.push(f);`
 * would slip past this, because that `-af` is followed by `)`. It is accepted
 * because the file-level allowlist above catches a filtergraph in a NEW file
 * regardless of how the flag is written, and because a GPL encoder smuggled in
 * a second push is still a `libx264`/`libx265` literal in a file the GPL
 * literal allowlist does not name. The hole is "a filtergraph added to an
 * already-allowed argv file, one push per element" — narrow, and not the shape
 * anything in this tree is written in.
 */
function inArgvPosition(code: string, lit: Literal): boolean {
  return /^\s*[,\]]/.test(code.slice(lit.end));
}

/** A filter name in filtergraph NAME position: start, or after `,` `;` `[`. */
function gplFilterNamesIn(literalValue: string): string[] {
  return GPL_ONLY_FILTERS.filter((name) =>
    new RegExp(`(?:^|[,;\\[])${name}(?=[=,;\\[\\]]|$)`).test(literalValue),
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      walk(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

interface ScannedFile {
  rel: string;
  code: string;
  literals: Literal[];
  buildsArgv: boolean;
}

const files: ScannedFile[] = walk(SRC).map((full) => {
  const code = stripComments(readFileSync(full, "utf8"));
  return {
    rel: relative(SRC, full).split(/[\\/]/).join("/"),
    code,
    literals: literalsOf(code),
    buildsArgv: /["'`][^"'`]*ffmpeg-loader["'`]/.test(code) || /ffmpeg\.(exec|ffprobe)\(/.test(code),
  };
});

const isFiltergraphFlag = (value: string) =>
  value === "-vf" || value === "-af" || value === "-lavfi" || value.startsWith("-filter");

/** Every flag hit, as `file:line flag`, for both the assertions and the message. */
interface FlagHit {
  rel: string;
  line: number;
  flag: string;
  value: Literal | null;
}

const flagHits: FlagHit[] = [];
const gplLiteralHits: { rel: string; line: number; value: string }[] = [];

for (const file of files) {
  file.literals.forEach((lit, k) => {
    if (/^-[a-zA-Z]/.test(lit.value) && inArgvPosition(file.code, lit)) {
      flagHits.push({
        rel: file.rel,
        line: lineAt(file.code, lit.start),
        flag: lit.value,
        value: adjacentLiteral(file.code, file.literals, k),
      });
    }
    if (GPL_ENCODERS.some((name) => lit.value.includes(name))) {
      gplLiteralHits.push({ rel: file.rel, line: lineAt(file.code, lit.start), value: lit.value.slice(0, 48) });
    }
  });
}

const argvFiles = files.filter((f) => f.buildsArgv).map((f) => f.rel).sort();
const where = (hits: { rel: string; line: number }[]) => hits.map((h) => `${h.rel}:${h.line}`).sort();

/** The sentence every failure message ends with. */
const UPDATE = [
  "The FFmpeg argv inventory changed, so the LGPL-core evidence is stale.",
  "Update BOTH of these in the same change, or this gate is a comment again:",
  "  scripts/build-ffmpeg-core-lgpl.sh   (its premise, and its allowlist call)",
  "  licensing-posture.md               (the dated inventory block)",
  "and add the new site to the allowlists at the top of this file, WITH the",
  "licence review that justifies it.",
].join("\n");

describe("the scanner this gate is built on", () => {
  /*
    A scan that matches nothing is a gate that cannot fail, which is the exact
    disease this file exists to cure — so the machinery is self-tested on
    fixtures before it is trusted on the tree.
  */
  it("strips comments without eating the literals that are the evidence", () => {
    const stripped = stripComments(
      ['const url = "https://example.com/-af";', "// -c:v libx265", "/* -vf delogo */", 'const a = ["-c:v", "libx264"];'].join("\n"),
    );
    expect(stripped).toContain('"https://example.com/-af"');
    expect(stripped).toContain('"libx264"');
    expect(stripped).not.toContain("libx265");
    expect(stripped).not.toContain("delogo");
    // Offsets must survive, or every line number this file reports is a lie.
    expect(stripped.split("\n").length).toBe(4);
  });

  it("tells an argv element from a predicate over an argv", () => {
    // The distinction video-merge.ts's `isStreamCopyArgs` forced. Both fixtures
    // are one character apart in the ways that matter.
    const argv = 'const a = ["-c", "copy", out];';
    const predicate = 'if (args[i].startsWith("-c")) return false;';
    const litOf = (code: string) => literalsOf(code)[0];
    expect(inArgvPosition(argv, litOf(argv))).toBe(true);
    expect(inArgvPosition(predicate, litOf(predicate))).toBe(false);
    expect(inArgvPosition('["-vn"]', litOf('["-vn"]'))).toBe(true);
  });

  it("recognises a GPL filter in name position and not in ordinary prose", () => {
    expect(gplFilterNamesIn("delogo=x=10:y=10")).toEqual(["delogo"]);
    expect(gplFilterNamesIn("loudnorm=I=-16,hqdn3d")).toEqual(["hqdn3d"]);
    expect(gplFilterNamesIn("request")).toEqual([]);
    expect(gplFilterNamesIn("mp3")).toEqual([]);
    expect(gplFilterNamesIn("loudnorm=I=-16:TP=-1.5:LRA=11")).toEqual([]);
  });

  it("reads a real tree at all", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(flagHits.length).toBeGreaterThan(20);
  });
});

describe("FFmpeg argv inventory — the LGPL-core premise, executed", () => {
  it("only the reviewed files build an FFmpeg argv", () => {
    const unknown = argvFiles.filter((rel) => !(rel in ALLOWED_ARGV_FILES));
    expect(
      unknown,
      `${unknown.join(", ")} builds an FFmpeg argv and has never been licence-reviewed.\n${UPDATE}`,
    ).toEqual([]);

    // The positive half: an empty scan would also pass the line above.
    const missing = REQUIRED_ARGV_FILES.filter((rel) => !argvFiles.includes(rel));
    expect(
      missing,
      `${missing.join(", ")} no longer builds an FFmpeg argv. If that is because the libx264 transcode arm moved to WebCodecs, this is GOOD NEWS and the LGPL core may now be a zero-cost change — say so in both documents.\n${UPDATE}`,
    ).toEqual([]);
  });

  it("libx264/libx265 appear only where they were reviewed, and only as often", () => {
    const unknown = gplLiteralHits.filter((h) => !(h.rel in GPL_LITERAL_ALLOWLIST));
    expect(
      unknown,
      `a GPL encoder name is a string literal in an unreviewed file: ${where(unknown).join(", ")}.\nlibx264 and libx265 are GPL-2.0-or-later, and every occurrence widens what --disable-gpl would break.\n${UPDATE}`,
    ).toEqual([]);

    for (const [rel, rule] of Object.entries(GPL_LITERAL_ALLOWLIST)) {
      const hits = gplLiteralHits.filter((h) => h.rel === rel);
      if (rule.exact !== undefined) {
        expect(
          hits.length,
          `${rel} was reviewed for exactly ${rule.exact} GPL-encoder literal (${rule.why}); found ${hits.length} at ${where(hits).join(", ")}.\n${UPDATE}`,
        ).toBe(rule.exact);
      }
      if (rule.atLeast !== undefined) {
        expect(
          hits.length,
          `${rel} must keep at least ${rule.atLeast} (${rule.why}); found ${hits.length}.`,
        ).toBeGreaterThanOrEqual(rule.atLeast);
      }
    }
  });

  it("every video encoder selection is an explicit, vetted literal", () => {
    /*
      Two flags decide whether an argv can reach x264/x265 at all. `-c:v` (or
      `-vcodec`) names a video encoder outright; `-c` sets every stream at once
      and is only ever `copy` here — which is the whole reason the trim, mute,
      rotate and remux-copy paths reach no encoder. A value that is not a
      literal is a finding, not an exemption: nobody can audit
      `["-c:v", codec]` from the source.
    */
    const problems: string[] = [];
    for (const hit of flagHits) {
      const isVideoCodecFlag = hit.flag === "-c:v" || hit.flag === "-vcodec";
      const isAllStreamsFlag = hit.flag === "-c";
      if (!isVideoCodecFlag && !isAllStreamsFlag) continue;

      if (!hit.value) {
        problems.push(`${hit.rel}:${hit.line} passes ${hit.flag} followed by an expression, not a string literal`);
        continue;
      }
      if (isAllStreamsFlag && hit.value.value !== "copy") {
        problems.push(`${hit.rel}:${hit.line} passes ${hit.flag} "${hit.value.value}" — only "copy" is reviewed`);
      }
      if (isVideoCodecFlag && !VETTED_VIDEO_ENCODERS.includes(hit.value.value)) {
        problems.push(`${hit.rel}:${hit.line} selects video encoder "${hit.value.value}"`);
      }
    }
    expect(problems, `${problems.join("\n")}\n${UPDATE}`).toEqual([]);

    // Positive: libx264 is STILL the value at the one site the documents
    // describe. This is the assertion that goes red the day someone ports the
    // transcode arm to WebCodecs — which is the outcome that unblocks the
    // LGPL core, so read the message before "fixing" it.
    const videoCodecValues = flagHits
      .filter((h) => h.flag === "-c:v" || h.flag === "-vcodec")
      .map((h) => `${h.rel}:${h.line} ${h.value?.value ?? "<expression>"}`);
    expect(videoCodecValues).toEqual(["lib/tools/video-remux.ts:347 libx264"]);
  });

  it("only the reviewed files build a filtergraph, with the filters they were reviewed for", () => {
    const filtergraphHits = flagHits.filter((h) => isFiltergraphFlag(h.flag));

    const unknown = filtergraphHits.filter((h) => {
      const entry = FILTERGRAPH_ALLOWLIST[h.rel];
      return !entry || !entry.flags.includes(h.flag);
    });
    expect(
      unknown,
      `an unreviewed filtergraph: ${unknown.map((h) => `${h.rel}:${h.line} ${h.flag}`).join(", ")}.\nAbout half of libavfilter's video filters are the --enable-gpl half; a filtergraph is licence-relevant even when the encoder is not.\n${UPDATE}`,
    ).toEqual([]);

    const gplFilters: string[] = [];
    for (const rel of Object.keys(FILTERGRAPH_ALLOWLIST)) {
      const file = files.find((f) => f.rel === rel);
      if (!file) continue; // allowlisted for a file that has not landed yet
      for (const lit of file.literals) {
        for (const name of gplFilterNamesIn(lit.value)) {
          gplFilters.push(`${rel}:${lineAt(file.code, lit.start)} uses the GPL-only filter "${name}"`);
        }
      }
    }
    expect(
      gplFilters,
      `${gplFilters.join("\n")}\nThese filters are only in the binary because it is built --enable-gpl. Using one makes the GPL core load-bearing.\n${UPDATE}`,
    ).toEqual([]);
  });

  it("`-map` is stream selection, and stays where it was reviewed", () => {
    /*
      The sentence that rotted first said `-map` appeared nowhere in src/. It
      appears four times, all `-map 0:a:0`, and it is load-bearing: without it
      FFmpeg picks the "best" audio stream while the probe describes the first,
      which is how a copy lands in a container that cannot hold it. It selects
      a stream; it builds no graph and reaches no encoder. Pinned separately
      from the filtergraph flags so that distinction cannot blur again.
    */
    const mapHits = flagHits.filter((h) => h.flag === "-map");
    const unknown = mapHits.filter((h) => !ALLOWED_MAP_FILES.includes(h.rel));
    expect(unknown, `unreviewed -map site: ${where(unknown).join(", ")}.\n${UPDATE}`).toEqual([]);

    const files_ = [...new Set(mapHits.map((h) => h.rel))];
    const missing = REQUIRED_MAP_FILES.filter((rel) => !files_.includes(rel));
    expect(missing, `${missing.join(", ")} no longer passes -map; the scan may be broken.\n${UPDATE}`).toEqual([]);
    expect(mapHits.length).toBeGreaterThanOrEqual(4);
  });

  it("the two documents name the GPL site this scan found", () => {
    /*
      The link that was missing. `build-ffmpeg-core-lgpl.sh` and
      `licensing-posture.md` are where the LGPL decision is argued; both must
      point at the file this scan says is the GPL-reachable one, so a rename or
      a move cannot leave them describing a path that no longer exists. This is
      also what makes the script's prose a maintained artifact rather than a
      three-day-old snapshot.
    */
    const script = readFileSync(resolve(ROOT, "scripts/build-ffmpeg-core-lgpl.sh"), "utf8");
    const posture = readFileSync(resolve(ROOT, "licensing-posture.md"), "utf8");

    const gplArgvFiles = [...new Set(gplLiteralHits.map((h) => h.rel))].filter((rel) => rel.startsWith("lib/"));
    expect(
      gplArgvFiles,
      `the set of GPL-reachable files changed. Both documents describe exactly one, and their prose has to be rewritten — not amended — when that number moves.\n${UPDATE}`,
    ).toEqual(["lib/tools/video-remux.ts"]);

    /*
      `.toContain` on the file's whole text would print all 174 lines of the
      script into the failure. The assertion is on the boolean, so a red run
      says what is wrong in one line.
    */
    for (const rel of gplArgvFiles) {
      const base = rel.split("/").pop() as string;
      expect(
        script.includes(base),
        `scripts/build-ffmpeg-core-lgpl.sh never mentions ${base}, the file that decides its premise.`,
      ).toBe(true);
      expect(
        posture.includes(base),
        `licensing-posture.md never mentions ${base}, the file that decides the LGPL conclusion.`,
      ).toBe(true);
    }

    // The script must actually RUN this gate. A premise stated in a comment is
    // what put the two documents three days out of date.
    expect(
      script.includes("ffmpeg-argv-inventory"),
      "scripts/build-ffmpeg-core-lgpl.sh no longer runs this gate — its premise is a comment again.",
    ).toBe(true);
  });

  it("neither document restates a claim this scan has retired", () => {
    /*
      Prose that asserts a greppable fact rots silently; that is the whole
      lesson of 2026-09-02. These three phrasings are the ones that went false,
      and they are banned outright — including in historical quotation, because
      a reader greps, they do not parse tense. Both documents now point at this
      gate instead of restating its output.
    */
    const banned: { pattern: RegExp; why: string }[] = [
      { pattern: /functional delta is zero/i, why: "false since video-remux.ts gained the libx264 transcode arm" },
      { pattern: /exactly three ffmpeg/i, why: "there are six argv-building files and eleven argv constructions" },
      { pattern: /nowhere\s+in\s+[`"']?src/i, why: "`-map` ships in four production sites; `-af` lands in Wave 3B" },
    ];
    for (const rel of ["scripts/build-ffmpeg-core-lgpl.sh", "licensing-posture.md"]) {
      const text = readFileSync(resolve(ROOT, rel), "utf8");
      for (const { pattern, why } of banned) {
        expect(pattern.test(text), `${rel} restates a retired claim (${pattern}): ${why}.`).toBe(false);
      }
    }
  });
});
