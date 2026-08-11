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
  "video",
  "audio",
  "text",
  "gen",
  "icons",
  "color",
  "data",
  "record",
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
