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

/** Below this a measurement is not a short tool, it is a page that never mounted. */
const FLOOR = 300;

/**
 * Above this a tool is reserving well over two mobile screens of blank space
 * and should be looked at rather than waved through.
 *
 * The bound was 1200 and the tallest developer tools now clear it — the tall
 * ones are tall because their controls rail is mostly explanatory copy (why an
 * ASS subtitle source loses its styling, what a PAL/NTSC re-time multiplies,
 * which chmod bits a leading 0 drops). That copy is the honest part of those
 * tools and is not worth trimming to satisfy a bound, so the bound moved
 * instead.
 *
 * No slug or pixel count is named here on purpose: this file is checked in
 * beside a GENERATED map, and every regeneration moves the tallest entry and
 * its number. The justification used to cite "subtitle-converter at 1511/1355"
 * and the very next regeneration made that false in both figures. The failure
 * message derives the current extremes instead, so what a maintainer reads is
 * measured rather than remembered.
 */
const CEILING = 1600;

type Axis = "sm" | "md";
const AXES = ["sm", "md"] as const;

/** The entry that owns the extreme on one axis, derived from the map as it is. */
function extreme(axis: Axis, pick: "tallest" | "shortest"): string {
  const entries = Object.entries(toolSurfaceHeights);
  if (entries.length === 0) return "(empty map)";
  const winner = entries.reduce((best, entry) =>
    pick === "tallest"
      ? entry[1][axis] > best[1][axis]
        ? entry
        : best
      : entry[1][axis] < best[1][axis]
        ? entry
        : best,
  );
  return `${winner[0]} at ${winner[1][axis]}px`;
}

/** What the map actually looks like right now, for any failure to quote. */
function measuredRange(): string {
  return AXES.map(
    (axis) =>
      `${axis}: tallest ${extreme(axis, "tallest")}, shortest ${extreme(axis, "shortest")}`,
  ).join("; ");
}

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

  /*
    A sanity check on the MEASUREMENT, not a design budget — it exists to catch
    a generator that recorded 0, or 50 000, because the page never mounted.
  */
  it("holds plausible pixel values", () => {
    const outOfBand = Object.entries(toolSurfaceHeights).flatMap(([slug, heights]) =>
      AXES.filter((axis) => heights[axis] < FLOOR || heights[axis] > CEILING).map(
        (axis) => `${slug}.${axis} = ${heights[axis]}px`,
      ),
    );

    expect(
      outOfBand,
      `outside ${FLOOR}–${CEILING}px. Measured now — ${measuredRange()}. ` +
        "A value near 0 means the page never mounted; a value over the ceiling means " +
        "the tool reserves more than two mobile screens and wants looking at.",
    ).toEqual([]);
  });

  it("keeps the unmeasured fallback inside the same band", () => {
    for (const axis of AXES) {
      expect(DEFAULT_SURFACE_HEIGHTS[axis], `DEFAULT_SURFACE_HEIGHTS.${axis}`).toBeGreaterThanOrEqual(
        FLOOR,
      );
      expect(DEFAULT_SURFACE_HEIGHTS[axis], `DEFAULT_SURFACE_HEIGHTS.${axis}`).toBeLessThanOrEqual(
        CEILING,
      );
    }
  });
});
