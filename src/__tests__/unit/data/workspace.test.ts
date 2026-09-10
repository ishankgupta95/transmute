import { describe, expect, it } from "vitest";
import {
  pipelineByArchetype,
  workspaceTools,
  getWorkspaceTool,
  workspaceToolCount,
  type Archetype,
} from "@/data/workspace";
import { tools } from "@/data/tools";

/*
  Since Phase 4 the workspace mounts the real tool components, so this module
  is pure metadata: the rail entries (slug/name/category/route/engine/accept),
  the per-archetype pipeline chips, and nothing else. These tests pin the one
  thing that can silently rot: the metadata staying in step with the registry.
*/

const ARCHETYPES: Archetype[] = [
  "image",
  "batch",
  "pdfpages",
  "pdfdocs",
  "pdfimages",
  "video",
  "gif",
  "extract",
  "transcode",
  "audio",
  "text",
  "gen",
  "icons",
  "color",
  "data",
  "record",
  "audiofilter",
  "frames",
];

const registrySlugs = new Set(tools.map((t) => t.slug));
const workspaceSlugs = new Set(workspaceTools.map((t) => t.slug));

describe("workspace config tracks the tool registry", () => {
  it("has unique slugs", () => {
    expect(workspaceTools.length).toBe(workspaceSlugs.size);
  });

  it("covers every registered tool", () => {
    const missing = tools.filter((t) => !workspaceSlugs.has(t.slug)).map((t) => t.slug);
    expect(missing).toEqual([]);
  });

  it("has no entry for a tool the registry does not know", () => {
    const extra = workspaceTools
      .filter((t) => !registrySlugs.has(t.slug))
      .map((t) => t.slug);
    expect(extra).toEqual([]);
  });

  it("exports the count every UI derives from", () => {
    expect(workspaceToolCount).toBe(tools.length);
  });

  it("resolves tools by slug", () => {
    expect(getWorkspaceTool("compress-image")?.name).toBe("Image Compressor");
    expect(getWorkspaceTool("no-such-tool")).toBeUndefined();
  });

  it.each(workspaceTools.map((t) => [t.slug, t] as const))(
    "%s uses a known archetype",
    (_slug, tool) => {
      expect(ARCHETYPES).toContain(tool.kind);
    },
  );

  it.each(workspaceTools.map((t) => [t.slug, t] as const))(
    "%s has a two-sided route label",
    (_slug, tool) => {
      expect(tool.route.split(" → ")).toHaveLength(2);
    },
  );

  it.each(ARCHETYPES)("archetype %s has pipeline chips", (kind) => {
    expect(pipelineByArchetype[kind].length).toBeGreaterThan(0);
  });
});

/*
  The ACCEPTS line (ToolPageLayout's pipeline strip, its spec tile and the
  workspace PipelineBar) all render `WorkspaceTool.accept`, while the file
  picker on the same screen is built from `Tool.acceptFormats`. These used to
  be two hand-written lists and drifted 16 ways — mp4-to-mp3 advertised M4V
  the picker rejects, crop-image hid the GIF/BMP/AVIF it takes. `accept` is
  now derived, and this pins it so the two cannot part again.
*/
describe("the ACCEPTS label matches the file picker", () => {
  /** Extensions that spell one format two ways; either may back a token. */
  const ALIASES: Record<string, string[]> = {
    JPG: ["jpg", "jpeg"],
    TIFF: ["tiff", "tif"],
    HEIC: ["heic", "heif"],
    MD: ["md", "markdown"],
  };

  const fileTools = tools.filter((t) =>
    t.acceptFormats.split(",").some((token) => token.trim().startsWith(".")),
  );

  it("covers every tool that takes files", () => {
    expect(fileTools.length).toBeGreaterThan(30);
  });

  it.each(fileTools.map((t) => [t.slug, t] as const))(
    "%s claims exactly what its DropZone accepts",
    (slug, tool) => {
      const exts = new Set(
        tool.acceptFormats
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.startsWith("."))
          .map((s) => s.slice(1)),
      );
      const claimed = getWorkspaceTool(slug)!.accept.split(" ").filter(Boolean);

      // Nothing is advertised that the picker would reject.
      for (const token of claimed) {
        const candidates = ALIASES[token] ?? [token.toLowerCase()];
        expect(
          candidates.some((c) => exts.has(c)),
          `${slug} advertises ${token} but accepts ${[...exts].join(",")}`,
        ).toBe(true);
      }

      // Nothing the picker takes is hidden from the user.
      const covered = new Set(
        claimed.flatMap((token) => ALIASES[token] ?? [token.toLowerCase()]),
      );
      for (const ext of exts) {
        expect(covered.has(ext), `${slug} accepts .${ext} but never says so`).toBe(true);
      }
    },
  );
});
