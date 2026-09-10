import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tools, type Tool } from "@/data/tools";

/*
 * THE FILE-INPUT GATE
 *
 * The homepage prints a number next to the words "tools that take a file of
 * any size". Until this file, that number was
 * `tools.filter(t => !t.maxSizeMB && !t.practicalLimitNote).length` — and 24
 * of the tools it counted take no file at all. /password-generator's own spec
 * panel reads ACCEPTS: NONE, MAX SIZE: NONE; it mounts no drop zone and no
 * `<input type="file">`, and it cannot be evidence about file sizes in either
 * direction. Counting it made 66 read as 90.
 *
 * That is the same failure as the "∞ file size ceiling" claim the count
 * replaced, one level in: a claim nobody derived from the thing it describes.
 * A count is only better than an assertion if the count is right.
 *
 * So `Tool.takesNoFile` exists, and this file is what stops it becoming
 * decoration. It is NOT checked against `acceptFormats`, which would be
 * circular and wrong — `acceptFormats` is empty for the 24 AND for
 * `hash-generator` and `base64-encode-decode`, whose File chips mount a real
 * drop zone accepting every type, which no extension list describes. It is
 * checked
 * against the COMPONENT: every tool that declares no formats has its UI read
 * off disk and asked whether it mounts a file input at all.
 *
 * The direction that matters is the silent one. A generator that gains a drop
 * zone, or a converter added with `takesNoFile` copy-pasted onto it, is a tool
 * quietly added to or removed from a number on the front page.
 */

const SRC = join(dirname(new URL(import.meta.url).pathname), "../../../");

const readSrc = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/*
  Several of these components explain in prose why they have no drop zone, and
  DropZone's own doc comment names the props this scan looks for. Strip block
  comments and whole-line `//` comments so the search reads what renders rather
  than what someone wrote about it — the same trick size-claims.test.ts uses.
*/
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Everything on this site that puts a file picker on screen. */
const FILE_INPUT = /<DropZone|type="file"|<FileInput|<QpdfToolShell/;

/** `csv-to-json` → `CsvToJsonUI.tsx`. The convention every tool UI follows. */
const uiFileFor = (slug: string) =>
  `components/tools/${slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}UI.tsx`;

const declaresFormats = (t: Tool) => t.acceptFormats.trim() !== "";

/** The tools whose registry entry names no extensions — 26 of 116. */
const formatless = tools.filter((t) => !declaresFormats(t));

describe("takesNoFile matches what the component actually mounts", () => {
  it("finds a UI for every tool that declares no formats", () => {
    // A scan whose file resolution breaks is a gate that passes vacuously.
    expect(formatless.length).toBeGreaterThan(20);
    const missing = formatless
      .map((t) => ({ slug: t.slug, rel: uiFileFor(t.slug) }))
      .filter(({ rel }) => !existsSync(join(SRC, rel)))
      .map(({ slug, rel }) => `${slug} → ${rel} does not exist`);
    expect(missing).toEqual([]);
  });

  it.each(formatless.map((t) => [t.slug, t] as const))(
    "%s declares takesNoFile iff its UI mounts no file input",
    (slug, t) => {
      const source = codeOnly(readSrc(uiFileFor(slug)));
      const mountsAPicker = FILE_INPUT.test(source);
      expect(
        Boolean(t.takesNoFile),
        mountsAPicker
          ? `${slug} mounts a file input but is counted as taking no file`
          : `${slug} mounts no file input but is counted among the tools that take one`,
      ).toBe(!mountsAPicker);
    },
  );

  it("catches the two tools whose File chip the registry cannot describe", () => {
    /*
      The positive control, and the reason `acceptFormats` is not the
      predicate. Both of these declare no formats and both mount a real drop
      zone that accepts every type, so both take files. Assert it from the
      component, not from the flag, so the test fails if the scan stops seeing
      the zone rather than quietly agreeing with itself.
    */
    for (const slug of ["hash-generator", "base64-encode-decode"]) {
      expect(FILE_INPUT.test(codeOnly(readSrc(uiFileFor(slug)))), `${slug}`).toBe(true);
      expect(tools.find((t) => t.slug === slug)?.takesNoFile, slug).toBeUndefined();
    }
  });

  it("never sets the flag on a tool that names extensions", () => {
    // The other direction: a tool with a picker string has a picker.
    const wrong = tools.filter((t) => declaresFormats(t) && t.takesNoFile).map((t) => t.slug);
    expect(wrong).toEqual([]);
  });
});

describe("the homepage size tile counts only tools that take a file", () => {
  const page = codeOnly(readSrc("app/page.tsx"));
  const fileTools = tools.filter((t) => !t.takesNoFile);
  const uncapped = fileTools.filter((t) => !t.maxSizeMB && !t.practicalLimitNote);
  const bounded = fileTools.filter((t) => t.maxSizeMB || t.practicalLimitNote);

  it("derives the population from takesNoFile rather than from every tool", () => {
    expect(page, "the tile counts generators again").toMatch(/!t\.takesNoFile/);
    expect(page).toContain("!t.maxSizeMB && !t.practicalLimitNote");
  });

  it("the two halves of the sentence partition the file tools exactly", () => {
    // "N take one of any size — the other M name their ceiling" is only true
    // if N + M is the whole population and nothing is in both halves.
    expect(uncapped.length + bounded.length).toBe(fileTools.length);
    expect(uncapped.filter((t) => bounded.includes(t))).toEqual([]);
    expect(uncapped.length).toBeGreaterThan(0);
    expect(bounded.length).toBeGreaterThan(0);
  });

  it("the honest count is smaller than the one that counted generators", () => {
    /*
      The regression, stated as arithmetic. If these two ever agree it is
      because `takesNoFile` has stopped being set, and the tile is back to
      telling readers that a password generator takes a file of any size.
    */
    const naive = tools.filter((t) => !t.maxSizeMB && !t.practicalLimitNote).length;
    expect(naive - uncapped.length).toBe(tools.filter((t) => t.takesNoFile).length);
    expect(uncapped.length).toBeLessThan(naive);
  });

  it("no tool that takes no file carries a size ceiling", () => {
    // Mutually exclusive by meaning: a ceiling is a statement about an input
    // this tool does not have. Either field on one of these is a copy bug.
    const odd = tools
      .filter((t) => t.takesNoFile && (t.maxSizeMB || t.practicalLimitNote))
      .map((t) => t.slug);
    expect(odd).toEqual([]);
  });
});
