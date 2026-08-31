import { describe, expect, it } from "vitest";
import { tools } from "@/data/tools";
import {
  DEFAULT_SURFACE_HEIGHTS,
  toolSurfaceHeights,
} from "@/data/tool-surface-heights";

/**
 * The surface-height map is the CLS contract for tool pages: ToolPageLayout
 * reserves these pixels before the ssr:false tool UI mounts. A tool without an
 * entry falls back to the DropZone default, which is only right for the
 * standard converter archetype — so every registered tool must be measured.
 * After adding or reshaping a tool, regenerate with the dev server running:
 * `node scripts/measure-tool-surfaces.mjs`.
 */
describe("tool-surface-heights", () => {
  it("covers every registered tool", () => {
    const missing = tools
      .map((tool) => tool.slug)
      .filter((slug) => !(slug in toolSurfaceHeights));
    expect(
      missing,
      "unmeasured tools — run `node scripts/measure-tool-surfaces.mjs` with the dev server up",
    ).toEqual([]);
  });

  it("holds plausible pixel values", () => {
    for (const [slug, h] of Object.entries(toolSurfaceHeights)) {
      for (const key of ["sm", "md"] as const) {
        expect(h[key], `${slug}.${key}`).toBeGreaterThanOrEqual(300);
        expect(h[key], `${slug}.${key}`).toBeLessThanOrEqual(1200);
      }
    }
    expect(DEFAULT_SURFACE_HEIGHTS.sm).toBeGreaterThanOrEqual(300);
    expect(DEFAULT_SURFACE_HEIGHTS.md).toBeGreaterThanOrEqual(300);
  });
});
