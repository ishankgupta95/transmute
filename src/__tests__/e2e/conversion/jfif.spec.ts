import { test, expect } from "@playwright/test";
import { tinyJpg, tinyPng } from "../fixtures";
import type { FixtureFile } from "../helpers";
import { convert, downloadAffordance, uploadFixture } from "./support";
import { assertJpeg } from "./validators";

/**
 * jfif-to-jpg promises a byte-identical rename — the strongest possible
 * assertion, so it is asserted literally: the downloaded bytes must EQUAL the
 * uploaded buffer. Any pipeline that decoded and re-encoded (stripping EXIF,
 * shifting quality) fails here even though its output would still be a JPEG.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i.
 * A pure byte copy has no engine dependency at all, so these cases must run
 * in BOTH projects — titles avoid those tokens.
 */

test.describe("jfif-to-jpg — byte-identical rename", () => {
  test("hands back the exact input bytes under a .jpg name", async ({ page }) => {
    const jpg = tinyJpg();
    const fixture: FixtureFile = {
      name: "photo.jfif",
      mimeType: "image/jpeg",
      buffer: jpg.buffer,
    };

    // No `action`: the tool runs on drop — the download affordance is the
    // signal the byte check passed.
    const { name, bytes } = await convert(page, {
      slug: "jfif-to-jpg",
      input: fixture,
    });

    expect(name).toBe("photo.jpg");
    expect(
      bytes.equals(jpg.buffer),
      "output must be byte-identical to the input — nothing re-encoded",
    ).toBe(true);
    assertJpeg(bytes);
  });

  test("rejects a file whose bytes are not JPEG, with no download", async ({ page }) => {
    const png = tinyPng();
    const impostor: FixtureFile = {
      name: "fake.jfif",
      mimeType: "image/jpeg", // the OS-reported MIME lies too; bytes decide
      buffer: png.buffer,
    };

    await page.goto("/jfif-to-jpg");
    await uploadFixture(page, impostor);

    await expect(
      page
        .locator('[role="alert"]')
        .filter({ hasText: /isn't JPEG data underneath/ }),
    ).toBeVisible();
    await expect(downloadAffordance(page)).toHaveCount(0);
  });
});
