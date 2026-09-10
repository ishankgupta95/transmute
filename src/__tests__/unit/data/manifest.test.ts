import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";
import { FILE_HANDLER_ACCEPT, SHARE_ACCEPT_TYPES } from "@/lib/pwa/open-with";
import { SHARE_TARGET_ACTION, SHARE_TARGET_FILE_FIELD } from "@/lib/pwa/share-target";

/*
  `src/app/manifest.ts` builds `/manifest.webmanifest`, which has shipped since
  commit 2ea0ab3 and is what an install actually reads. Two OS integration
  points were added to it; everything that was already there is pinned below
  FIRST, because the failure mode of editing an installed app's manifest is not
  a broken build — it is an installed icon that changes, or a start URL that
  stops matching, on a device nobody here can see.
*/

const m = manifest();

describe("what already worked, unchanged", () => {
  it("keeps the identity an installed app was installed with", () => {
    expect(m.name).toBe("Transmute — Free Online File Conversion Tools");
    expect(m.short_name).toBe("Transmute");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#0f111c");
    expect(m.theme_color).toBe("#161826");
  });

  it("keeps all three icons, the maskable one included", () => {
    expect(m.icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });
});

describe("share_target", () => {
  it("POSTs multipart to the landing route", () => {
    // A POST with no server behind it: the service worker answers this URL in
    // `fetch`. See src/lib/pwa/share-target.ts.
    expect(m.share_target?.action).toBe(SHARE_TARGET_ACTION);
    expect(m.share_target?.method).toBe("post");
    expect(m.share_target?.enctype).toBe("multipart/form-data");
  });

  it("names the field the worker reads out of the form data", () => {
    const files = m.share_target?.params.files;
    const first = Array.isArray(files) ? files[0] : files;
    expect(first?.name).toBe(SHARE_TARGET_FILE_FIELD);
    expect(first?.accept).toEqual([...SHARE_ACCEPT_TYPES]);
  });

  it("asks for files and nothing else", () => {
    /*
      `title`, `text` and `url` are the other three params the spec allows, and
      declaring any of them puts Transmute in the share sheet for plain text
      and links. A file converter offering itself as a destination for a shared
      URL is an over-claim, and the landing page would have nothing to do with
      it.
    */
    expect(Object.keys(m.share_target?.params ?? {})).toEqual(["files"]);
  });
});

describe("file_handlers", () => {
  it("launches the same route the share sheet posts to", () => {
    // One landing page for both: from the page's side a share and an "Open
    // with" are the same event — files arrived from outside the tab.
    expect(m.file_handlers).toHaveLength(1);
    expect(m.file_handlers?.[0].action).toBe(SHARE_TARGET_ACTION);
  });

  it("declares exactly what open-with.ts derived from the registry", () => {
    expect(m.file_handlers?.[0].accept).toEqual(FILE_HANDLER_ACCEPT);
  });

  it("hands the manifest its own arrays, not the module's", () => {
    // The declaration is read once per build and must not be editable in
    // place by whatever reads it.
    const accept = m.file_handlers?.[0].accept ?? {};
    for (const [mime, exts] of Object.entries(accept)) {
      expect(exts).not.toBe(FILE_HANDLER_ACCEPT[mime]);
    }
  });

  it("points every action at a route inside the manifest scope", () => {
    // No `scope` is declared, so it defaults to the start URL's directory,
    // "/". Both actions have to sit under it or the browser drops the whole
    // declaration.
    for (const action of [m.share_target?.action, m.file_handlers?.[0].action]) {
      expect(action?.startsWith("/")).toBe(true);
    }
  });

  it("declares no launch_handler", () => {
    /*
      Deliberate. The three client modes trade an unwanted second window
      against navigating a window that may be minutes into a conversion, and
      which one "auto" picks for a file launch is not something this repo can
      measure. Declaring nothing leaves the browser's default in place; pinning
      a mode on a guess would be a claim we cannot support.
    */
    expect(m.launch_handler).toBeUndefined();
  });
});
