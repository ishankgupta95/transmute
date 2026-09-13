import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tools, getToolBySlug, type Tool } from "@/data/tools";

/*
 * THE SIZE-CLAIM GATE
 *
 * "NO SIZE CAP" (DropZone.tsx) and "MAX SIZE / NONE" (ToolPageLayout.tsx) are
 * ABSOLUTE claims, and they render by default — from the ABSENCE of a field.
 * That is the dangerous direction: a tool that holds the whole file in memory
 * and then expands it makes the claim by doing nothing at all.
 *
 * So the invariant this file pins is a DISJOINTNESS: the set of tools making
 * the absolute claim and the set of tools with a known ceiling must not
 * intersect. `Tool.maxSizeMB` covers the ceilings that are enforced;
 * `Tool.practicalLimitNote` covers the ones that are merely real.
 *
 * WHAT COUNTS AS "A KNOWN CEILING" IS READ OUT OF THE CODE, not listed here.
 * The measured shape (scout audit, Wave 3) is the in-tab audio decode: an
 * `AudioBuffer` is float32, so a decode is ~2x a 16-bit WAV on disk and ~20 MB
 * per minute of 44.1 kHz stereo, and it lands beside a full copy of the input
 * that `await file.arrayBuffer()` already made. Four exported functions are
 * the doors into it:
 *
 *   decodeAudioFile  src/lib/tools/audio-decode.ts:274  (:279 arrayBuffer,
 *                    :253/:261 decodeAudioData, :217 the FFmpeg fallback that
 *                    first expands to pcm_s16le at :228)
 *   decodeAudio      src/lib/tools/video-utils.ts:106   (:109 arrayBuffer)
 *   detectAudio      src/lib/tools/video-utils.ts:88    (:91 arrayBuffer)
 *   computeWaveform  src/lib/tools/media-preview.ts:87  (:95 arrayBuffer)
 *
 * `reachesAnInTabDecode` walks a tool UI's import closure looking for CALLS to
 * those four. Calls, not definitions — `media-preview.ts` also exports
 * `extractFilmstrip`, which draws video frames and decodes no audio, and four
 * PDF UIs plus Mp4ToMp3UI import it. Treating the module as tainted would have
 * put a memory warning on /split-pdf and taken the honest "NO SIZE CAP" off
 * /mp4-to-mp3, whose input is MOUNTED rather than copied (verified end to end
 * at 2500 MiB — see the derivation block atop src/lib/tools/ffmpeg-loader.ts).
 *
 * SCOPE, stated honestly: this gate is the audio-decode expansion, because
 * that is the shape that was measured. It is not a general "reads the whole
 * file" detector — pdf-lib holds a document's bytes and its parsed object
 * graph, which is a real ceiling nobody has measured, and inventing a warning
 * for it here would be the same sin in the other direction.
 *
 * THE SECOND MEASURED SHAPE, added after /hash-generator was found printing
 * "NO SIZE CAP" over a 2.2 GB failure: a UI that reads the dropped file with
 * `await file.arrayBuffer()` and then hands that buffer to a WORKER CLIENT.
 * The worker clients transfer it (`hash-client.ts`: "`data` is TRANSFERRED to
 * the worker … it avoids copying a 100 MB file across the boundary"), so the
 * whole file has to exist as ONE JS ArrayBuffer, entire, at one instant, on
 * the main thread — which is ceiling (2) in the derivation block atop
 * `ffmpeg-loader.ts`: 2040 MiB allocates, 2047 MiB throws. That is a ceiling
 * with a measurement behind it, so it is in scope.
 *
 * `readsWholeFileIntoAWorker` is deliberately narrower than "calls
 * `.arrayBuffer()`". Sixteen PDF UIs and SubtitleConverterUI make that call
 * too and hand the bytes to pdf-lib or a text decoder in-thread; that is the
 * unmeasured ceiling the paragraph above refuses to invent a warning for, and
 * widening the scan to them would have written sixteen sentences nobody
 * measured. KNOWN GAP, left open on purpose: merge-pdf's own FAQ says "the
 * practical limit depends on your device's memory" while its page prints
 * NONE. That contradiction is real, and it is the pdf-lib ceiling — it wants
 * a measurement, not a regex.
 */

const SRC = join(dirname(new URL(import.meta.url).pathname), "../../../");

const readSrc = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/*
  Comments in these files QUOTE the very literals this gate looks for — the
  doc comment on `DropZone.sizeCapMB` names "NO SIZE CAP", and the block above
  each ternary explains why the absolute wording is reserved. Searching raw
  source would match the explanation instead of the code, so strip block
  comments and whole-line `//` comments before looking at what actually
  renders. (Whole-line only: a trailing `//` could be inside a string.)
*/
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The four functions that put a float32 AudioBuffer in the tab. */
const DECODE_ENTRY_POINTS = ["decodeAudioFile", "decodeAudio", "detectAudio", "computeWaveform"];

const DECLARATION = new RegExp(
  `(?:export\\s+)?(?:async\\s+)?function\\s+(?:${DECODE_ENTRY_POINTS.join("|")})\\s*\\(`,
  "g",
);
const CALL = new RegExp(`\\b(?:${DECODE_ENTRY_POINTS.join("|")})\\s*\\(`);

/** `@/x` and `./x` module specifiers, from both static and dynamic imports. */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:from\s*|import\s*\(\s*)"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function resolveSpecifier(spec: string, fromRel: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = join(dirname(fromRel), spec);
  else return null;
  for (const ext of [".ts", ".tsx"]) {
    if (existsSync(join(SRC, base + ext))) return base + ext;
  }
  return null;
}

/** The file in a UI's import closure that calls one of the four, or null. */
function reachesAnInTabDecode(entryRel: string): string | null {
  const seen = new Set<string>();
  const stack = [entryRel];
  while (stack.length) {
    const rel = stack.pop() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);
    // Strip the four functions' own declarations so a module that merely
    // DEFINES one (media-preview.ts) is not mistaken for one that uses it.
    const source = readSrc(rel).replace(DECLARATION, "");
    if (CALL.test(source)) return rel;
    for (const spec of importSpecifiers(source)) {
      const next = resolveSpecifier(spec, rel);
      if (next && next.startsWith("lib/")) stack.push(next);
    }
  }
  return null;
}

const TOOL_UI_DIR = "components/tools";
const toolUIs = readdirSync(join(SRC, TOOL_UI_DIR))
  .filter((f) => f.endsWith("UI.tsx"))
  .map((f) => ({ file: f, rel: `${TOOL_UI_DIR}/${f}`, source: readSrc(`${TOOL_UI_DIR}/${f}`) }))
  .filter((ui) => ui.source.includes("<DropZone"));

const declaresACeiling = (t: Tool) => Boolean(t.maxSizeMB || t.practicalLimitNote);

/**
 * The second measured shape: the UI reads the dropped file into one
 * ArrayBuffer and ships that buffer to a pool worker, which takes it by
 * transfer. Both halves are required — `.arrayBuffer()` alone is the
 * in-thread pdf-lib read this gate deliberately does not model.
 */
const readsWholeFileIntoAWorker = (source: string) =>
  /\.arrayBuffer\(\)/.test(codeOnly(source)) &&
  /@\/lib\/workers\/[a-z0-9-]+-client/.test(codeOnly(source));

describe("size claims — the absolute claim and the known ceilings stay disjoint", () => {
  it("finds the tool UIs at all (the scan is worthless if the glob breaks)", () => {
    expect(toolUIs.length).toBeGreaterThan(20);
    expect(toolUIs.map((u) => u.file)).toContain("CompressVideoUI.tsx");
  });

  it("no tool declares both an enforced cap and a practical note", () => {
    // The two render surfaces branch `maxSizeMB ? … : practicalLimitNote ? …`,
    // so a tool with both would silently drop the note. Mutually exclusive by
    // construction, per the doc comment on the field.
    const both = tools.filter((t) => t.maxSizeMB && t.practicalLimitNote).map((t) => t.slug);
    expect(both).toEqual([]);
  });

  it("every UI that decodes audio in the tab says so on its drop zone", () => {
    /*
      The gate. A UI whose import closure reaches one of the four decode entry
      points must pass EITHER `sizeCapMB` (a cap, so it prints the number) or
      `practicalLimitNote` (a ceiling, so it prints MEMORY-BOUND and the
      sentence). What it must not do is pass neither and print "NO SIZE CAP".
    */
    const offenders = toolUIs
      .map((ui) => ({ ...ui, decodeSite: reachesAnInTabDecode(ui.rel) }))
      .filter((ui) => ui.decodeSite !== null)
      .filter((ui) => !/sizeCapMB=/.test(ui.source) && !/practicalLimitNote=/.test(ui.source))
      .map((ui) => `${ui.file} decodes audio via ${ui.decodeSite} but claims no size cap`);

    expect(offenders).toEqual([]);
  });

  it("the decode scan actually fires on the UIs it is supposed to catch", () => {
    // A scan that matches nothing is a gate that cannot fail. These UI files
    // carry the slugs the audit measured (AudioConverterUI serves mp3-to-wav,
    // wav-to-mp3 and m4a-to-mp3); pin that the walk reaches them.
    //
    // The four audio-effects UIs joined the list when that cluster landed: all
    // four call `computeWaveform` directly, in their own source, to draw the
    // waveform on drop. That is a full 32-bit-float decode in the tab, and all
    // four declare a `practicalLimitNote` for it. VideoToImagesUI and
    // VideoThumbnailUI deliberately are NOT here — they decode video through a
    // <video> element, which none of the four entry points models — and they
    // carry a note anyway, for the frames they hold in memory.
    const bound = toolUIs
      .filter((ui) => reachesAnInTabDecode(ui.rel) !== null)
      .map((ui) => ui.file)
      .sort();
    expect(bound).toEqual([
      "AudioConverterUI.tsx",
      "AudioMergerUI.tsx",
      "AudioTrimmerUI.tsx",
      "ChangeAudioVolumeUI.tsx",
      "CompressVideoUI.tsx",
      "NormalizeAudioUI.tsx",
      "RemoveSilenceUI.tsx",
      "ReverseAudioUI.tsx",
      "WebmToMp4UI.tsx",
    ]);
  });

  it("every UI that ships a whole-file buffer to a worker says so on its drop zone", () => {
    /*
      /hash-generator printed "NO SIZE CAP", read a 2.2 GB ISO with
      `await f.arrayBuffer()`, and showed nothing at all when the allocation
      was refused. The decode scan above could not see it — no AudioBuffer is
      involved — but the claim is the same class: an absolute promise over a
      single allocation the browser will not always make.
    */
    const offenders = toolUIs
      .filter((ui) => readsWholeFileIntoAWorker(ui.source))
      .filter((ui) => !/sizeCapMB=/.test(ui.source) && !/practicalLimitNote=/.test(ui.source))
      .map((ui) => `${ui.file} reads the whole file into one transferred buffer but claims no size cap`);

    expect(offenders).toEqual([]);
  });

  /*
    ⚠ THIS POSITIVE CONTROL USED TO ANCHOR ON A REAL FILE, AND ON 2026-09-13 IT
    RAN OUT OF ONE.

    It asserted `bound).toContain("HashGeneratorUI.tsx")` — the scan proving
    itself by matching an actual offender. Then /hash-generator and
    /file-checksum were changed to hash off `blob.stream()` instead of reading
    the file into one transferred ArrayBuffer, and they were the LAST two UIs
    with that shape. `readsWholeFileIntoAWorker` now matches ZERO of the tool
    UIs, which is the good outcome for the product and the worst one for a
    gate: the population check below passes over an empty set, forever, no
    matter what anyone writes.

    So the control moved off the population and onto the PREDICATE. Two
    synthetic sources, one of each kind, prove the scan can still tell them
    apart — which is the property that was actually being guarded. If a future
    UI reintroduces the shape, the population check catches it; if someone
    breaks the regex, these do.
  */
  it("the whole-file-buffer scan can still tell the two shapes apart", () => {
    const offending = `
      import { computeHashesGuarded } from "@/lib/workers/hash-client";
      const data = await file.arrayBuffer();
      await computeHashesGuarded(data);
    `;
    const innocent = `
      import { computeHashesGuarded } from "@/lib/workers/hash-client";
      await computeHashesGuarded(file);
    `;
    const inThreadOnly = `const bytes = await file.arrayBuffer(); PDFDocument.load(bytes);`;

    expect(readsWholeFileIntoAWorker(offending), "the scan no longer matches the shape it exists for").toBe(true);
    expect(readsWholeFileIntoAWorker(innocent), "streaming to a worker is not a whole-file read").toBe(false);
    // The in-thread pdf-lib read is the unmeasured ceiling this gate
    // deliberately does not model; matching it would demand sentences nobody
    // has measured.
    expect(readsWholeFileIntoAWorker(inThreadOnly)).toBe(false);
  });

  it("no tool UI reads a whole file into a worker any more", () => {
    /*
      The fact the control above now rests on, asserted rather than assumed —
      so that if it changes, it changes LOUDLY and with a pointer to why the
      control is synthetic. The two that used to be here now stream.
    */
    const bound = toolUIs.filter((ui) => readsWholeFileIntoAWorker(ui.source)).map((ui) => ui.file);
    expect(
      bound,
      "a UI reintroduced the whole-file-into-a-worker shape; the synthetic " +
        "positive control above can go back to anchoring on a real file",
    ).toEqual([]);
  });

  it("the hash tools claim no ceiling, because they no longer have one", () => {
    /*
      ⚠ THIS ASSERTION IS THE REVERSE OF WHAT IT USED TO BE, and the reversal is
      the record. It required hash-generator to CARRY a note naming "one piece"
      or "a single buffer", because the File arm read the whole file into one
      ArrayBuffer and transferred it, so the renderer's single-allocation wall
      was a real ceiling on a page with no engine anywhere near it.

      Since 2026-09-13 both tools hash off `blob.stream()`. Nothing is
      materialised, so "NO SIZE CAP" is TRUE and a note would be the false
      claim. Both halves are checked: the registry must carry no note, and the
      UI must no longer read one — because the prop is what renders the
      sentence, and leaving it wired would have made the zone print the falsy
      branch for a reason nobody could see.
    */
    for (const slug of ["hash-generator", "file-checksum"]) {
      const t = getToolBySlug(slug);
      expect(t?.maxSizeMB, `${slug} enforces no cap`).toBeUndefined();
      expect(
        t?.practicalLimitNote,
        `${slug} streams now, so a practical-limit note would be a false claim`,
      ).toBeUndefined();
    }
    for (const file of ["HashGeneratorUI.tsx", "FileChecksumUI.tsx"]) {
      // codeOnly: the comment explaining WHY the prop is gone names it, and a
      // raw scan would read that explanation as the offence it documents.
      expect(
        codeOnly(readSrc(`${TOOL_UI_DIR}/${file}`)),
        `${file} still reads a note that no longer exists`,
      ).not.toContain("practicalLimitNote");
    }
  });

  it("the hash tools really do stream — the claim above rests on it", () => {
    // Without this the assertion above is just "we deleted a sentence". The
    // sentence is only safe to delete while the code streams.
    const digest = codeOnly(readSrc("lib/tools/hash-digest.ts"));
    expect(digest).toContain("blob.stream()");
    expect(digest, "a whole-file read would restore the ceiling silently").not.toContain(
      "arrayBuffer()",
    );
    for (const file of ["HashGeneratorUI.tsx", "FileChecksumUI.tsx"]) {
      expect(
        codeOnly(readSrc(`${TOOL_UI_DIR}/${file}`)),
        `${file} materialises the file again`,
      ).not.toMatch(/\.arrayBuffer\(\)/);
    }
  });

  it("every enforced cap carries its reason", () => {
    /*
      `sizeCapReason` shipped declared, rendered and passed by nobody. A bare
      "Maximum is 1.5 GB" is the exact thing `validateFFmpegInput` was rewritten
      to stop saying (ffmpeg-loader.ts: "A limit that exists because a browser
      tab cannot hold the result should say that"), so a zone that advertises a
      cap has to be able to explain it when it fires.
    */
    const bare = toolUIs
      .filter((ui) => /sizeCapMB=/.test(ui.source) && !/sizeCapReason=/.test(ui.source))
      .map((ui) => `${ui.file} enforces a cap with no reason to give when it rejects a file`);
    expect(bare).toEqual([]);
  });

  it("mp4-to-mp3 is left alone, because its claim is true", () => {
    // It mounts its input instead of copying it, so "NO SIZE CAP" is honest and
    // must not be swept up by a broader scan. `ffmpeg-loader.test.ts` pins the
    // engine half of the same claim.
    const t = getToolBySlug("mp4-to-mp3");
    expect(t?.maxSizeMB).toBeUndefined();
    expect(t?.practicalLimitNote).toBeUndefined();
    expect(reachesAnInTabDecode(`${TOOL_UI_DIR}/Mp4ToMp3UI.tsx`)).toBeNull();
  });

  it("a UI that reads a note off the registry finds one there", () => {
    /*
      The single-slug UIs pull their sentence with
      `getToolBySlug("x")?.practicalLimitNote` rather than retyping it, which is
      the right move — and it fails SILENTLY. Delete the registry field and the
      UI still passes the prop, still compiles, and quietly renders
      "NO SIZE CAP" again, because `undefined` is the falsy branch. So the slug
      each UI names has to still carry a note.
    */
    const broken: string[] = [];
    for (const ui of toolUIs) {
      /*
        The slug pattern is deliberately [a-z0-9-]+ rather than [^"]+: this
        scans raw source, and CompressVideoUI's own doc comment spells the
        pattern out as `getToolBySlug("…")?.practicalLimitNote` with an
        ellipsis placeholder, which [^"]+ matches and then reports as a missing
        note. A typo'd but slug-shaped name is still caught, because
        getToolBySlug returns undefined for it.
      */
      const re = /getToolBySlug\("([a-z0-9-]+)"\)\?\.practicalLimitNote/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ui.source))) {
        const note = getToolBySlug(m[1])?.practicalLimitNote;
        if (typeof note !== "string" || note.trim() === "") {
          broken.push(`${ui.file} reads ${m[1]}.practicalLimitNote, which is not set`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("every audio tool that takes a file declares a ceiling", () => {
    /*
      Registry-side companion to the UI scan. Every audio UI that mounts a drop
      zone is decode-bound (pinned above), so an audio tool added without a
      ceiling would be a new false "NONE" on a new page. The UI scan alone
      would not catch it: AudioConverterUI takes its note as a PROP from
      AudioToolClients, so a new slug with the field unset passes `undefined`
      and the UI still looks wired.

      `takesNoFile` is excluded, and it has to be — the two gates are otherwise
      unsatisfiable together. /audio-recorder mounts no picker at all, and
      `file-input-claims.test.ts` ("no tool that takes no file carries a size
      ceiling") fails on either field being set there, because a ceiling is a
      statement about an input the tool does not have. This filter is not a
      loosening: a tool can only reach it by declaring `takesNoFile`, which
      that same file independently checks against what the component really
      mounts.
    */
    const missing = tools
      .filter((t) => t.category === "audio-tools" && !t.takesNoFile && !declaresACeiling(t))
      .map((t) => t.slug);
    expect(missing).toEqual([]);
  });

  /*
    The wording check, and why it is a classifier rather than a substring.

    Its whole job is stated in the header: `practicalLimitNote` covers ceilings
    that are REAL, `maxSizeMB` covers ceilings that are ENFORCED, and a note
    that reads like a cap is "the exact lie a faked maxSizeMB would have been".
    It used to assert `/enforc/i`, which matches "Nothing is enforced" and
    "Enforced: 12 megapixels" equally happily — so did "Maximum 500 MB,
    enforced before the decode." and "Hard cap: 2 GB, enforced when the buffer
    is allocated.", both of which are exactly the sentence the comment forbade.

    So there are two admissible forms and nothing in between:

      DISCLOSURE  "Nothing is enforced, but …" — 29 of the 30 notes. Nothing is
                  ever compared against file.size, and the drop zone's
                  MEMORY-BOUND token means precisely this.
      ENFORCED    opens "Enforced:" — compress-png, whose ceiling is a
                  megapixel count that `maxSizeMB` cannot hold and whose UI
                  really does refuse the file. That form has to be PROVED
                  against the page rather than taken on the sentence's word,
                  which is what `corroboratesEnforcement` below is for.

    A third state on the render side is still open and is NOT this file's to
    close: ToolPageLayout and DropZone print MEMORY-BOUND for anything with a
    note, and their own comments define that token as "a ceiling it does not
    enforce" — so compress-png's spec row still reads MEMORY-BOUND over an
    enforced refusal. The page copy itself is honest ("12 MEGAPIXELS,
    ENFORCED"); the token is wrong and wants a field the two surfaces read.
  */
  const DISCLOSURE = /\bnothing is enforced\b/i;
  const ENFORCED = /^\s*Enforced:\s/;
  const noteKind = (note: string): "disclosure" | "enforced" | "neither" =>
    ENFORCED.test(note) ? "enforced" : DISCLOSURE.test(note) ? "disclosure" : "neither";

  /** The UI that pulls this slug's note off the registry, if one does. */
  const uiReadingNoteFor = (slug: string) =>
    toolUIs.find((ui) => ui.source.includes(`getToolBySlug("${slug}")?.practicalLimitNote`));

  it("the classifier can actually reject a note that reads like a cap", () => {
    /*
      A gate whose predicate never says no is the gate this one replaced. These
      four are the strings the audit fed the old assertion; all four passed it.
    */
    expect(noteKind("Nothing is enforced, but the file is decoded to 32-bit float in this tab."))
      .toBe("disclosure");
    expect(noteKind("Enforced: 12 megapixels. oxipng holds the whole decoded image in wasm memory."))
      .toBe("enforced");
    expect(noteKind("Maximum 500 MB, enforced before the decode.")).toBe("neither");
    expect(noteKind("Hard cap: 2 GB, enforced when the buffer is allocated.")).toBe("neither");
  });

  it("a practical note reads as a disclosure, or as an enforcement the page proves", () => {
    for (const t of tools) {
      const note = t.practicalLimitNote;
      if (note === undefined) continue;
      expect(note.trim(), `${t.slug}: empty note`).not.toBe("");

      const kind = noteKind(note);
      expect(
        kind,
        `${t.slug}: "${note}" neither disclaims enforcement nor declares it — it just reads like a cap`,
      ).not.toBe("neither");

      // Either way it must name the mechanism rather than land a bare number.
      expect(note, `${t.slug}: names no mechanism`).toMatch(/decode|buffer|memory|tab/i);

      if (kind === "enforced") {
        /*
          "Enforced:" is a claim about behaviour, so it is checked against the
          page: the tool has to refuse the file (a disabled primary action) and
          has to say the ceiling is enforced where the user can read it. A note
          that says Enforced over a page that quietly proceeds is worse than
          the cap-shaped wording this gate exists to forbid.
        */
        const ui = uiReadingNoteFor(t.slug);
        expect(ui, `${t.slug}: note declares enforcement but no UI reads it`).toBeDefined();
        const source = codeOnly(ui!.source);
        expect(source, `${ui!.file}: nothing refuses the file`).toMatch(/primaryDisabled=/);
        expect(source, `${ui!.file}: the page never tells the user it is enforced`).toMatch(
          /ENFORCED/,
        );
      }
    }
  });

  it("the enforced form is the exception, and it is the one that measured a ceiling", () => {
    // Paired positive: without this the branch above could go unexercised and
    // rot silently, which is how the /enforc/i substring survived so long.
    const enforced = tools
      .filter((t) => t.practicalLimitNote && noteKind(t.practicalLimitNote) === "enforced")
      .map((t) => t.slug);
    expect(enforced).toEqual(["compress-png"]);
    expect(tools.filter((t) => t.practicalLimitNote).length).toBeGreaterThan(20);
  });

  it("both render surfaces still guard the absolute claim", () => {
    /*
      The field is only worth setting if the two surfaces read it. Each absolute
      literal must sit behind a `practicalLimitNote` branch — delete the branch
      and the literal becomes unconditional again, which is where this started.
    */
    const guarded: [string, string][] = [
      [`${TOOL_UI_DIR}/DropZone.tsx`, '"NO SIZE CAP"'],
      [`${TOOL_UI_DIR}/ToolPageLayout.tsx`, '"NONE"'],
    ];
    for (const [rel, literal] of guarded) {
      const source = codeOnly(readSrc(rel));
      const at = source.indexOf(literal);
      expect(at, `${rel}: ${literal} not found`).toBeGreaterThan(-1);
      expect(
        source.slice(Math.max(0, at - 240), at),
        `${rel}: ${literal} is not guarded by practicalLimitNote`,
      ).toContain("practicalLimitNote");
    }
  });

  it("no marketing page makes the site-wide absolute claim", () => {
    /*
      The drop zones, the spec rows and the homepage tile stopped saying "no
      size cap"; /about went on saying it to every visitor, in a list of four
      things where the other three are true. It is false twice over — nine
      tools REFUSE a file over 1.5 GB ("File is too large (1.56 GB). Maximum
      is 1.5 GB." on /video-trimmer) and seventeen more disclose a memory
      ceiling on their own drop zone — so the one page that generalises about
      every tool is the last place it belongs.

      Comments are stripped first: this repo documents the literal it forbids
      (DropZone.tsx, the field docs, and the block on /about explaining why the
      sentence went), and a scan that matched the explanation would be a scan
      that can only be satisfied by silence.
    */
    const pages: string[] = [];
    const walk = (rel: string) => {
      for (const entry of readdirSync(join(SRC, rel))) {
        const child = `${rel}/${entry}`;
        if (statSync(join(SRC, child)).isDirectory()) walk(child);
        else if (entry === "page.tsx") pages.push(child);
      }
    };
    walk("app");
    // A walk that finds nothing is a gate that cannot fail.
    expect(pages).toContain("app/about/page.tsx");
    expect(pages).toContain("app/page.tsx");

    const offenders = pages.filter((rel) => /no size cap|no size limit/i.test(codeOnly(readSrc(rel))));
    expect(offenders).toEqual([]);

    // Paired positives: the claim is false BECAUSE these sets are non-empty,
    // and /about now counts them rather than denying them.
    expect(tools.filter((t) => t.maxSizeMB).length).toBeGreaterThan(0);
    expect(tools.filter((t) => t.practicalLimitNote).length).toBeGreaterThan(0);
    const about = codeOnly(readSrc("app/about/page.tsx"));
    expect(about, "/about still exists and still explains itself").toContain(
      "Why it works this way",
    );
    expect(about, "/about's numbers are typed in, not counted").toMatch(/t\.maxSizeMB/);
    expect(about).toMatch(/t\.practicalLimitNote/);
    expect(about, "/about counts generators as tools that take a file").toMatch(
      /t\.takesNoFile/,
    );
  });

  it("the homepage size stat is counted from the registry, not asserted", () => {
    /*
      It used to read "∞ — file size ceiling, your RAM is the only limit". Nine
      tools enforce 1.5 GB and seven more are memory-bound, and the wall behind
      those is V8's single-buffer limit, not RAM (ffmpeg-loader.ts:33-38). The
      tile now counts the tools that genuinely take a file of any size, which is
      exactly the set that prints "NO SIZE CAP".
    */
    const page = readSrc("app/page.tsx");
    const stats = /const STATS = \[[\s\S]*?\] as const;/.exec(codeOnly(page))?.[0];
    expect(stats, "STATS tile array not found in app/page.tsx").toBeTruthy();
    expect(stats, "the ∞ ceiling claim is back").not.toMatch(/∞/);
    expect(stats, "the size tile is a literal again, not a count").toContain(
      "String(UNCAPPED_TOOL_COUNT)",
    );
    expect(page).toContain("!t.maxSizeMB && !t.practicalLimitNote");
    expect(tools.filter((t) => !declaresACeiling(t)).length).toBeGreaterThan(0);
  });
});
