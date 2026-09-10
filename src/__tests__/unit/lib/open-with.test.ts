import { describe, it, expect } from "vitest";
import {
  FILE_HANDLER_ACCEPT,
  FILE_HANDLER_EXTENSIONS,
  FILE_HANDLER_MIN_TOOLS,
  SHARE_ACCEPT_TYPES,
  extensionOf,
  toolCountByExtension,
  toolsForFile,
} from "@/lib/pwa/open-with";
import { tools } from "@/data/tools";

/*
  `file_handlers` puts Transmute in the operating system's "Open with" menu.
  That is a claim made to a machine rather than to a reader, which makes it
  exactly the kind that rots quietly: nothing on the site would look wrong if
  the manifest offered to open a format no page accepts. So the declaration is
  DERIVED from `acceptFormats` — the same string that becomes the
  `<DropZone accept=…>` — and what is asserted below is the derivation, not a
  transcription of it.
*/

describe("extensionOf", () => {
  it("lowercases, because a phone writes IMG_0042.HEIC", () => {
    expect(extensionOf("IMG_0042.HEIC")).toBe(".heic");
    expect(extensionOf("holiday.JPG")).toBe(".jpg");
  });

  it("takes the last extension and ignores the path", () => {
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf("C:\\Users\\me\\scan.pdf")).toBe(".pdf");
    expect(extensionOf("/tmp/scan.pdf")).toBe(".pdf");
  });

  it("finds none where there is none", () => {
    // A dotfile is a name, not an extension; a trailing dot is neither.
    for (const name of ["README", ".bashrc", "trailing.", ""]) {
      expect(extensionOf(name), name).toBe("");
    }
  });
});

describe("toolsForFile", () => {
  it("ranks the tool built for the format above the one that tolerates it", () => {
    /*
      The whole point of the ranking. Six tools accept .heic; the three that
      accept ONLY .heic/.heif were built for the file the user just shared,
      while the other three, which take eight or nine formats, merely tolerate
      it. Names, not slugs, because the ordering is by specificity then
      alphabetical — which is why Remove Metadata, at nine accepted formats,
      sorts last of all.
    */
    expect(toolsForFile("IMG_0042.HEIC").map((t) => t.name)).toEqual([
      "HEIC to JPG",
      "HEIC to PDF",
      "HEIC to WebP",
      "EXIF Data Viewer & Remover",
      "Images to PDF",
      "Remove Metadata",
    ]);
  });

  it("only ever returns tools whose own drop zone would accept the file", () => {
    // The destination page is where the user picks the file again. A
    // suggestion its picker would reject is worse than no suggestion.
    for (const name of ["a.pdf", "b.mp4", "c.png", "d.wav", "e.svg"]) {
      const ext = extensionOf(name);
      for (const tool of toolsForFile(name)) {
        expect(
          tool.acceptFormats.toLowerCase().split(",").map((t) => t.trim()),
          `${tool.slug} was offered for ${ext}`,
        ).toContain(ext);
      }
    }
  });

  it("offers nothing for a format nothing here opens", () => {
    expect(toolsForFile("layers.psd")).toEqual([]);
    expect(toolsForFile("README")).toEqual([]);
  });

  it("never offers a tool that takes no file", () => {
    // The 24 generators plus the two whose zones take any type but advertise
    // no list (tools.ts:268-275). A QR-code generator for a shared MP4 is
    // noise, not a suggestion.
    const offered = new Set(
      ["a.jpg", "b.pdf", "c.mp3", "d.mp4"].flatMap((n) => toolsForFile(n).map((t) => t.slug)),
    );
    for (const tool of tools.filter((t) => t.takesNoFile)) {
      expect(offered.has(tool.slug), `${tool.slug} takes no file`).toBe(false);
    }
  });

  it("matches on the filename, not on a MIME token in acceptFormats", () => {
    // `markdown-to-pdf` carries a literal `text/markdown` beside its
    // extensions. A filename has no MIME type, so that token must never match.
    expect(toolsForFile("notes.text/markdown")).toEqual([]);
  });
});

describe("the file_handlers declaration", () => {
  const counts = toolCountByExtension();

  it("declares nothing below the measured threshold", () => {
    expect(FILE_HANDLER_MIN_TOOLS).toBe(5);
    for (const ext of FILE_HANDLER_EXTENSIONS) {
      expect(counts.get(ext) ?? 0, `${ext} is declared`).toBeGreaterThanOrEqual(
        FILE_HANDLER_MIN_TOOLS,
      );
    }
  });

  it("leaves no format above the threshold silently undeclared", () => {
    /*
      The gate that makes this a derivation rather than a list. If a new tool
      pushes .txt or .zip past five, this fails and someone has to decide
      whether Transmute should become the operating system's opener for it —
      rather than the manifest quietly staying behind, or quietly growing.
    */
    const promoted = [...counts.entries()]
      .filter(([, n]) => n >= FILE_HANDLER_MIN_TOOLS)
      .map(([ext]) => ext)
      .filter((ext) => !FILE_HANDLER_EXTENSIONS.includes(ext));
    expect(promoted).toEqual([]);
  });

  it("keeps the text, data and archive formats out", () => {
    // The rung below the threshold, and the reason the threshold is five: a
    // general-purpose converter has no business being the default opener for
    // a .txt or a .zip. Each of these is under five today; the test above is
    // what notices if that changes.
    for (const ext of [".txt", ".md", ".json", ".csv", ".zip", ".docx", ".xlsx", ".har"]) {
      expect(FILE_HANDLER_EXTENSIONS, `${ext} must not be declared`).not.toContain(ext);
    }
  });

  it("declares each extension exactly once across the map", () => {
    // A manifest requirement, not a preference: an extension may appear only
    // once across the whole `file_handlers` array.
    expect(new Set(FILE_HANDLER_EXTENSIONS).size).toBe(FILE_HANDLER_EXTENSIONS.length);
  });

  it("pins the MIME types the manifest ships with", () => {
    expect(Object.keys(FILE_HANDLER_ACCEPT)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/bmp",
      "image/gif",
      "image/svg+xml",
      "image/heic",
      "image/heif",
      "image/tiff",
      "application/pdf",
      "audio/mpeg",
      "audio/wav",
      "audio/mp4",
      "audio/aac",
      "audio/flac",
      "audio/ogg",
      "audio/x-ms-wma",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "video/x-matroska",
      "video/x-msvideo",
    ]);
    expect(FILE_HANDLER_ACCEPT["image/jpeg"]).toEqual([".jpg", ".jpeg"]);
    expect(FILE_HANDLER_ACCEPT["video/mp4"]).toEqual([".mp4", ".m4v"]);
    // `.oga` is in the MIME table but only one tool accepts it, so the
    // threshold keeps it out of the shipped group.
    expect(FILE_HANDLER_ACCEPT["audio/ogg"]).toEqual([".ogg", ".opus"]);
  });

  it("every declared extension starts with a dot", () => {
    // The manifest spec requires it, and `extensionOf` produces the same shape
    // — which is what lets the page match a launched file against this list.
    for (const ext of FILE_HANDLER_EXTENSIONS) {
      expect(ext.startsWith("."), ext).toBe(true);
      expect(ext).toBe(ext.toLowerCase());
    }
  });

  it("shares its formats with the share sheet, from one derivation", () => {
    // Two declarations, one source: the OS can never offer Transmute for two
    // different sets of formats depending on which menu you came from.
    expect([...SHARE_ACCEPT_TYPES]).toEqual(Object.keys(FILE_HANDLER_ACCEPT));
  });
});
