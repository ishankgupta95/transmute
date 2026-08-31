import { describe, it, expect, vi } from "vitest";

import { drawContained } from "@/lib/tools/image-draw";

function fakeCtx() {
  return { drawImage: vi.fn() };
}

function fakeImage(naturalWidth: number, naturalHeight: number) {
  return { naturalWidth, naturalHeight } as unknown as HTMLImageElement;
}

describe("drawContained", () => {
  it("fills the box edge to edge for a square source", () => {
    const ctx = fakeCtx();
    drawContained(ctx, fakeImage(512, 512), 32);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 32, 32);
  });

  it("letterboxes a landscape source instead of squashing it", () => {
    const ctx = fakeCtx();
    // 800x600 (4:3) into a 48px square: 48x36, centred vertically.
    drawContained(ctx, fakeImage(800, 600), 48);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 6, 48, 36);
  });

  it("pillarboxes a portrait source instead of stretching it", () => {
    const ctx = fakeCtx();
    // 600x800 (3:4) into a 48px square: 36x48, centred horizontally.
    drawContained(ctx, fakeImage(600, 800), 48);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 6, 0, 36, 48);
  });

  it("preserves the source aspect ratio at every icon size", () => {
    for (const size of [16, 32, 48, 180, 192, 512]) {
      const ctx = fakeCtx();
      drawContained(ctx, fakeImage(1000, 250), size);
      const [, , , dw, dh] = ctx.drawImage.mock.calls[0] as unknown as [
        unknown,
        number,
        number,
        number,
        number,
      ];
      expect(dw / dh).toBeCloseTo(4, 5);
      expect(Math.max(dw, dh)).toBeCloseTo(size, 5);
    }
  });

  it("falls back to a full-box draw when the source has no intrinsic size", () => {
    // SVGs can decode with naturalWidth/Height of 0 — a naive scale would be
    // Infinity and the draw would vanish.
    const ctx = fakeCtx();
    drawContained(ctx, fakeImage(0, 0), 64);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 64, 64);
  });
});
