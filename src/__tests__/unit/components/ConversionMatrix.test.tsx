import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ConversionMatrix } from "@/components/home/ConversionMatrix";
import { getToolBySlug } from "@/data/tools";
import { getWorkspaceTool, workspaceTools } from "@/data/workspace";

/*
  The homepage matrix makes TWO claims per cell, and until this file nothing
  asserted either one.

  A filled cell says a tool exists ("a filled cell is a tool that already
  exists" — the legend beside it in `src/app/page.tsx`). An empty cell says the
  opposite out loud: its aria-label ends "— no tool", because the state is
  carried by colour alone and a screen reader has to hear the negative.

  So the matrix goes stale in two directions, and the second one is silent. It
  had drifted three ways before this test existed, every one of them an empty
  cell claiming "no tool" for a tool that shipped:

    - PDF→PNG and PDF→WEBP  (`pdf-to-png`, `pdf-to-webp`)
    - HEIC→PDF              (`heic-to-pdf`)
    - WEBP→WEBP             (`resize-image`, whose `outputFormat` maps
                             webp→webp — the JPG and PNG diagonals were
                             already filled from the same function)

  ...and the six container tools had no row at all, so MOV, MKV and AVI were
  simply absent from a grid whose whole job is "read down for what you have".

  The table below is the gate. Every entry names the slug that proves the cell,
  and the test checks the slug against the REGISTRY — that the tool exists,
  that its `acceptFormats` really takes the source extension, and that its
  workspace route really produces the target — before checking that the cell is
  filled. Then it checks the reverse: that the set of filled cells is EXACTLY
  this table, so a cell invented without a tool fails too.

  …and that reverse was not enough. Both of those walks start from PROVEN, so
  they only ever look at cells somebody remembered to list. The empty cells —
  the ones that say "no tool" out loud — were checked against nothing at all,
  which is the silent direction this comment opens by describing. Four more had
  gone stale exactly that way by the time anyone looked: MP4, MOV, MKV and AVI
  → WAV, all four served by `video-to-wav` / `mp4-to-wav`, in a column the grid
  already had. "the grid never says 'no tool' about a tool that exists" below
  is the missing half: it walks every EMPTY cell against the whole registry
  rather than against a list.
*/

/** `"FROM→TO": the slug that makes the cell true.` */
const PROVEN: Record<string, string> = {
  "JPG→PNG": "jpg-to-png",
  "JPG→WEBP": "jpg-to-webp",
  "JPG→PDF": "jpg-to-pdf",
  "JPG→JPG": "compress-image",
  "JPG→GIF": "gif-maker",
  "PNG→JPG": "png-to-jpg",
  "PNG→WEBP": "png-to-webp",
  "PNG→PDF": "png-to-pdf",
  "PNG→PNG": "resize-image",
  "PNG→GIF": "gif-maker",
  "HEIC→JPG": "heic-to-jpg",
  "HEIC→PDF": "heic-to-pdf",
  "HEIC→WEBP": "heic-to-webp",
  "WEBP→JPG": "webp-to-jpg",
  "WEBP→PNG": "webp-to-png",
  "WEBP→PDF": "webp-to-pdf",
  "WEBP→GIF": "gif-maker",
  "WEBP→WEBP": "resize-image",
  "PDF→JPG": "pdf-to-jpg",
  "PDF→PNG": "pdf-to-png",
  "PDF→WEBP": "pdf-to-webp",
  "PDF→PDF": "compress-pdf",
  "MP4→JPG": "video-thumbnail",
  "MP4→PNG": "video-to-images",
  "MP4→WEBP": "video-to-images",
  "MP4→GIF": "video-to-gif",
  "MP4→MP4": "compress-video",
  "MP4→MP3": "mp4-to-mp3",
  "MP4→WAV": "mp4-to-wav",
  "MOV→JPG": "video-thumbnail",
  "MOV→PNG": "video-to-images",
  "MOV→WEBP": "video-to-images",
  "MOV→GIF": "video-to-gif",
  "MOV→MP4": "mov-to-mp4",
  "MOV→MP3": "mp4-to-mp3",
  "MOV→WAV": "video-to-wav",
  "MKV→MP4": "mkv-to-mp4",
  "MKV→MP3": "mp4-to-mp3",
  "MKV→WAV": "video-to-wav",
  "AVI→MP4": "avi-to-mp4",
  "AVI→MP3": "mp4-to-mp3",
  "AVI→WAV": "video-to-wav",
  "WAV→MP3": "wav-to-mp3",
  "WAV→WAV": "audio-trimmer",
  "JSON→CSV": "json-to-csv",
};

/** Grid labels → the extensions the file picker would spell them with. */
const EXTENSIONS: Record<string, string[]> = {
  JPG: ["jpg", "jpeg"],
  PNG: ["png"],
  HEIC: ["heic", "heif"],
  WEBP: ["webp"],
  PDF: ["pdf"],
  MP4: ["mp4"],
  MOV: ["mov"],
  MKV: ["mkv"],
  AVI: ["avi"],
  WAV: ["wav"],
  JSON: ["json"],
  GIF: ["gif"],
  MP3: ["mp3"],
  CSV: ["csv"],
};

/**
 * `resize-image` and `compress-image` re-encode by source type rather than to
 * one fixed target, so their workspace route reads "IMG → …". The output side
 * of those two is pinned by `src/__tests__/unit/lib/image-resize.test.ts`'s
 * coverage of `outputFormat`; here they are allowed to prove any image target.
 */
const IMG_OUT = new Set(["resize-image", "compress-image"]);

const filledLabel = (from: string, to: string) =>
  from === to ? `${from} optimises in place` : `${from} to ${to}`;

/**
 * What a slug's file picker actually takes, in the same terms the grid labels
 * use. Same fallback as the per-cell check above: the dev tools read pasted
 * text and declare no `acceptFormats`, so their workspace ACCEPTS label is the
 * only statement of what they read.
 */
const acceptedExts = (slug: string): Set<string> => {
  const set = new Set(
    (getToolBySlug(slug)?.acceptFormats ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.startsWith("."))
      .map((s) => s.slice(1)),
  );
  if (set.size === 0) {
    for (const token of (getWorkspaceTool(slug)?.accept ?? "").split(" ")) {
      set.add(token.toLowerCase());
    }
  }
  return set;
};

/** The output side of a slug's workspace route: "VIDEO → WAV" → ["WAV"]. */
const writtenFormats = (slug: string): string[] =>
  ((getWorkspaceTool(slug)?.route ?? "").split(" → ")[1] ?? "").split(" · ");

describe("the homepage conversion matrix", () => {
  const cellLabels = () => {
    render(<ConversionMatrix />);
    return screen
      .getAllByRole("cell")
      .map((c) => c.getAttribute("aria-label") ?? "");
  };

  it("renders one labelled cell per row × column", () => {
    // The positive control: every assertion below is a search over these.
    const labels = cellLabels();
    expect(labels.length).toBeGreaterThan(50);
    expect(labels.every((l) => l.length > 0)).toBe(true);
  });

  it.each(Object.entries(PROVEN))(
    "%s is backed by a registered tool that takes the source",
    (pair, slug) => {
      const [from] = pair.split("→");
      const tool = getToolBySlug(slug);
      expect(tool, `${pair} cites ${slug}, which is not in the registry`).toBeDefined();

      const accepted = new Set(
        tool!.acceptFormats
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.startsWith("."))
          .map((s) => s.slice(1)),
      );
      // The dev tools take pasted text, not a file, so `acceptFormats` is
      // empty and the workspace ACCEPTS label is the only statement of what
      // they read (`json-to-csv` → "JSON").
      if (accepted.size === 0) {
        for (const token of getWorkspaceTool(slug)!.accept.split(" ")) {
          accepted.add(token.toLowerCase());
        }
      }
      expect(
        EXTENSIONS[from].some((ext) => accepted.has(ext)),
        `${slug} is cited for ${pair} but reads ${[...accepted].join(",") || "nothing"}`,
      ).toBe(true);
    },
  );

  it.each(Object.entries(PROVEN))(
    "%s is backed by a tool that writes the target",
    (pair, slug) => {
      const [, to] = pair.split("→");
      if (IMG_OUT.has(slug)) return;
      const route = getWorkspaceTool(slug)?.route ?? "";
      const out = route.split(" → ")[1] ?? "";
      expect(
        out.split(" · ").includes(to),
        `${slug} is cited for ${pair} but its route is "${route}"`,
      ).toBe(true);
    },
  );

  it.each(Object.entries(PROVEN))("%s renders as a filled cell", (pair) => {
    const [from, to] = pair.split("→");
    const labels = cellLabels();
    expect(
      labels,
      `${pair} has a tool (${PROVEN[pair]}) but the grid tells a screen reader there is none`,
    ).toContain(filledLabel(from, to));
  });

  it("fills no cell this table cannot prove", () => {
    const expected = new Set(
      Object.keys(PROVEN).map((p) => {
        const [from, to] = p.split("→");
        return filledLabel(from, to);
      }),
    );
    const unproven = cellLabels().filter(
      (l) => !l.endsWith("— no tool") && !expected.has(l),
    );
    expect(
      unproven,
      "the legend promises every filled cell is a tool that already exists",
    ).toEqual([]);
  });

  it("never says 'no tool' about a tool that exists", () => {
    /*
      The half that was missing, and the only one that can catch drift NOBODY
      remembered — every other assertion in this file starts from PROVEN, so a
      route that ships without anyone touching the grid is invisible to all of
      them. This one starts from the rendered empty cells and searches the
      WHOLE registry for something that reads the source and writes the target.

      It found four: MP4/MOV/MKV/AVI → WAV, every one of them served by
      `video-to-wav` or `mp4-to-wav`, in a WAV column the grid already drew for
      the audio rows.

      Then it caught a fifth before it could rot at all. `heic-to-webp` landed
      with the Wave 4 image cluster and this walk went red in the same run that
      added it, while HEIC→WEBP was still one edit away from being a false
      negative — which is the whole reason it starts from the rendered cells
      and not from the table above.
    */
    const empty = cellLabels().filter((l) => l.endsWith("— no tool"));
    // A walk over nothing is a gate that cannot fail.
    expect(empty.length, "no empty cells were rendered at all").toBeGreaterThan(10);

    const lies: string[] = [];
    for (const label of empty) {
      const parsed = /^(\S+) to (\S+) — no tool$/.exec(label);
      expect(parsed, `empty cell label did not parse: ${label}`).toBeTruthy();
      const [, from, to] = parsed as RegExpExecArray;
      expect(EXTENSIONS[from], `no extensions known for ${from}`).toBeTruthy();
      const provers = workspaceTools
        .filter((w) => EXTENSIONS[from].some((ext) => acceptedExts(w.slug).has(ext)))
        .filter((w) => writtenFormats(w.slug).includes(to))
        .map((w) => `${w.slug} [${w.route}]`);
      if (provers.length) lies.push(`"${label}" — but ${provers.join(", ")}`);
    }

    expect(
      lies,
      "an empty cell is read out as a negative claim, and these ones are false",
    ).toEqual([]);
  });

  it("keeps the container tools' sources on the grid", () => {
    // The specific regression: six container tools shipped and the grid had no
    // MOV / MKV / AVI row, so those formats were absent from a matrix whose
    // caption is "read down for what you have".
    const labels = cellLabels();
    for (const from of ["MOV", "MKV", "AVI"]) {
      expect(labels).toContain(`${from} to MP4`);
    }
  });
});
