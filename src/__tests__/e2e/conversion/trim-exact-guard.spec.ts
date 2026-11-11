import { test, expect } from "@playwright/test";
import { SAMPLES, uploadFixture } from "./support";

/*
  The trimmer's "Exact frame" re-encodes through WebCodecs + mp4-muxer, so it
  is only offered where the same pre-flight compress-video uses says the
  pipeline can write an MP4. That it FINISHES and starts on the picked frame is
  pinned in video.spec.ts ("video-trimmer's exact cut starts on the frame that
  was picked"). This file pins the other half: where the probe refuses, the
  choice is withdrawn and the reason is on the page BEFORE anything is clicked.

  The refusal is forced here with an encoder that returns its chunks without a
  decoderConfig — the shape that makes mp4-muxer crash, measured in Safari.
  (Chromium-only suite since 2026-11-11; the guard is browser-independent.)
*/

test.describe("trimmer exact cut, when the encoder cannot write an MP4", () => {
  test("Exact is not offered, and the page says why", async ({ page }) => {
    await page.addInitScript(() => {
      const Real = window.VideoEncoder;
      class NoConfig extends Real {
        constructor(init: VideoEncoderInit) {
          super({
            ...init,
            output: (chunk, meta) => init.output(chunk, meta ? { ...meta, decoderConfig: undefined } : meta),
          });
        }
      }
      window.VideoEncoder = NoConfig as unknown as typeof VideoEncoder;
    });
    await page.goto("/video-trimmer");
    await uploadFixture(page, await SAMPLES.mp4());
    await expect(page.getByLabel("Clip start")).toBeEnabled({ timeout: 90_000 });

    const cut = page.getByRole("group", { name: "Cut accuracy" });
    const surface = page.locator("[data-tool-surface]");
    await expect(surface.getByText(/Exact frame is not available here\./)).toBeVisible();
    await expect(surface.getByText(/can't write the compressed MP4/)).toBeVisible();
    await expect(cut.getByRole("button", { name: "Exact frame", exact: true })).toHaveCount(0);
    await expect(cut.getByRole("button", { name: "Fast", exact: true })).toBeEnabled();
  });
});
