import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { tinyRectPng } from "../fixtures";
import {
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  probeImageInPage,
  toolError,
} from "./support";
import { assertPng } from "./validators";

/**
 * The eight canvas EDIT verbs, driven end to end and judged on their PIXELS.
 *
 * These pages own no arithmetic of their own — `lib/tools/image-edit-core.ts`
 * plans every output size and `drawEdit` paints every one of them — and that
 * whole module is invisible to the unit suite, because jsdom has no canvas.
 * `editOutputPlan` can be unit-tested (it is pure), but nothing below it can:
 * whether a 90° turn actually turned the picture, whether the border offsets
 * put the photo inside the frame, whether the pixelate blocks landed on the
 * region the user selected — all of that is `ctx.drawImage`, and only a real
 * browser has one.
 *
 * So every case here decodes the DOWNLOADED bytes and reads pixels out of
 * them. Each one is built so that the obvious plausible-but-wrong
 * implementation fails it:
 *
 *   rotate-image     a transposed canvas with the picture drawn unturned has
 *                    the right dimensions, so the corner marker is checked too.
 *   flip-image       a mirror changes no dimension at all, so dimensions prove
 *                    nothing and only the marker's corner can.
 *   add-border       a sum check passes on a frame painted on the wrong sides,
 *                    so the four edges are sampled individually.
 *   crop-circle      a square output with opaque corners is a crop, not a
 *                    circle — the corner's ALPHA is the whole verb.
 *   image-splitter   the tile widths are asserted as a SUM against the source
 *                    width. This repo has already shipped 219 + 563 + 219 =
 *                    1001 px inside a 1000 px frame from independently-rounded
 *                    halves; a per-tile size assertion would not have caught it.
 *   social-…-resizer cover must fill the frame and contain must letterbox in
 *                    the pad colour, which is a pixel fact, not a size fact.
 *   watermark-image  a run that drew nothing still produces a valid PNG at the
 *                    right size, so marked pixels are counted by region.
 *   pixelate-image   the region has to be genuinely destroyed AND the rest of
 *                    the picture left alone. The second half is not padding: a
 *                    review this session found the blocks painted at the
 *                    SOURCE coordinates on an output canvas the ceiling had
 *                    shrunk, which left the selected region fully legible and
 *                    mosaicked a different part of the photo instead. The
 *                    over-the-ceiling case at the bottom of this file is that
 *                    defect's regression test.
 *
 * TITLE TRAP — `playwright.config.ts` sets `grepInvert: /gif|FFmpeg|MP4/i` on
 * `conversion-webkit`, matched against the project name, the FILE PATH, every
 * describe title and every test title joined together. None of those three
 * tokens may appear in this file's name or in any title below, or WebKit drops
 * the case silently. Slugs and engine names inside a test BODY are fine.
 */

/** Luminance step that counts as an edge when scanning a line (0–255). */
const STEP_DELTA = 40;

/** How far two channel values may differ and still be "the same colour". */
const CHANNEL_TOLERANCE = 8;

// ────────────────────────────────────────────────────────────────────────────
// Fixtures painted in the page
// ────────────────────────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number];

/**
 * What to paint. Declarative rather than a callback because the painter runs
 * inside `page.evaluate`, which cannot receive a function as an argument.
 *
 *   solid        one colour, edge to edge.
 *   corner-mark  a solid field with one distinctly-coloured square in the TOP
 *                LEFT. One marker is enough to pin all four corners: a turn or
 *                a mirror moves it to exactly one of the other three, and
 *                which one is the assertion.
 *   stripes      vertical bars of `period` pixels, half in each colour. Fine
 *                detail that a mosaic has to destroy and that an untouched
 *                area has to keep.
 */
type Recipe =
  | { kind: "solid"; rgb: Rgb }
  | { kind: "corner-mark"; base: Rgb; mark: Rgb; size: number }
  | { kind: "stripes"; period: number; a: Rgb; b: Rgb };

/**
 * Paint a fixture on a canvas IN THE PAGE and hand it to the tool's file
 * input, the way `image.spec.ts` builds its 12 MP noise JPEG.
 *
 * In-page rather than in `fixtures.ts` because two of these are large enough
 * that shipping them as bytes through `setInputFiles` would be the slow part
 * of the run — and because `fixtures.ts`'s own contract is "anything that can
 * be constructed in pure JS", which a canvas painting is not.
 */
async function uploadPainted(
  page: Page,
  spec: { width: number; height: number; name: string; recipe: Recipe },
): Promise<void> {
  await page.locator('input[type="file"]').first().waitFor({ state: "attached" });
  await page.evaluate(
    async ({
      width,
      height,
      name,
      recipe,
    }: {
      width: number;
      height: number;
      name: string;
      recipe: Recipe;
    }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const css = (c: readonly [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

      if (recipe.kind === "stripes") {
        const half = recipe.period / 2;
        for (let x = 0; x < width; x += recipe.period) {
          ctx.fillStyle = css(recipe.a);
          ctx.fillRect(x, 0, half, height);
          ctx.fillStyle = css(recipe.b);
          ctx.fillRect(x + half, 0, half, height);
        }
      } else if (recipe.kind === "corner-mark") {
        ctx.fillStyle = css(recipe.base);
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = css(recipe.mark);
        ctx.fillRect(0, 0, recipe.size, recipe.size);
      } else {
        ctx.fillStyle = css(recipe.rgb);
        ctx.fillRect(0, 0, width, height);
      }

      // PNG, always: these fixtures are judged pixel by pixel, and a JPEG
      // would put ringing on every edge the assertions read across.
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      const file = new File([blob!], name, { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    spec,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Reading pixels back out of a downloaded file
// ────────────────────────────────────────────────────────────────────────────

interface PixelProbe {
  /** `[x, y]` pairs to read as RGBA. */
  points?: readonly (readonly [number, number])[];
  /** Horizontal runs to count luminance edges along. */
  scans?: readonly { y: number; x0: number; x1: number }[];
  /** Rectangles to count pixels at or above `minLuma` in. */
  boxes?: readonly {
    x: number;
    y: number;
    width: number;
    height: number;
    minLuma: number;
  }[];
}

interface ProbeResult {
  width: number;
  height: number;
  /** RGBA per requested point, in order. */
  points: number[][];
  /** Per scan: how many times the luminance jumped by more than `STEP_DELTA`. */
  steps: number[];
  /** Per box: how many pixels reached its `minLuma`. */
  marked: number[];
}

/**
 * Decode the bytes with the browser's own decoder and measure them.
 *
 * One round trip for every measurement a test needs, because the decode is the
 * expensive part — the over-the-ceiling pixelate case reads an 8192 × 728
 * raster, and doing that once per assertion would triple the run.
 *
 * `steps` is the workhorse. Counting luminance EDGES along a line separates
 * "fine detail" from "flat blocks" without pinning any particular colour: a
 * 10 px stripe pattern scores about one edge per 5 px, and the same span after
 * a 50 px mosaic scores nearly none — whatever the browser's downscale filter
 * decided each block's average should be.
 */
async function probePixels(
  page: Page,
  bytes: Buffer,
  mime: string,
  probe: PixelProbe,
): Promise<ProbeResult> {
  return page.evaluate(
    async ({
      b64,
      type,
      spec,
      stepDelta,
    }: {
      b64: string;
      type: string;
      spec: PixelProbe;
      stepDelta: number;
    }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([buf], { type }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      // No fill: the canvas starts fully transparent, so an alpha channel in
      // the file survives into `getImageData` instead of being composited away.
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      const { width, height } = bitmap;
      bitmap.close();
      const data = ctx.getImageData(0, 0, width, height).data;
      const at = (x: number, y: number) => (y * width + x) * 4;
      const luma = (o: number) =>
        0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];

      const points = (spec.points ?? []).map(([x, y]) => {
        const o = at(x, y);
        return [data[o], data[o + 1], data[o + 2], data[o + 3]];
      });

      const steps = (spec.scans ?? []).map(({ y, x0, x1 }) => {
        let edges = 0;
        let previous = luma(at(x0, y));
        for (let x = x0 + 1; x <= x1; x++) {
          const current = luma(at(x, y));
          if (Math.abs(current - previous) > stepDelta) edges++;
          previous = current;
        }
        return edges;
      });

      const marked = (spec.boxes ?? []).map((box) => {
        let count = 0;
        for (let y = box.y; y < box.y + box.height; y++) {
          for (let x = box.x; x < box.x + box.width; x++) {
            if (luma(at(x, y)) >= box.minLuma) count++;
          }
        }
        return count;
      });

      return { width, height, points, steps, marked };
    },
    { b64: bytes.toString("base64"), type: mime, spec: probe, stepDelta: STEP_DELTA },
  );
}

/** Assert an RGBA reading is a given opaque colour, within tolerance. */
function expectColour(actual: number[], expected: Rgb, why: string): void {
  const [r, g, b, a] = actual;
  expect(a, `${why} — must be opaque`).toBeGreaterThan(250);
  expect(
    Math.max(Math.abs(r - expected[0]), Math.abs(g - expected[1]), Math.abs(b - expected[2])),
    `${why} — read rgb(${r},${g},${b}), expected rgb(${expected.join(",")})`,
  ).toBeLessThanOrEqual(CHANNEL_TOLERANCE);
}

// ────────────────────────────────────────────────────────────────────────────
// Driving the shared controls
// ────────────────────────────────────────────────────────────────────────────

/** Pick an option out of one of `ToolChoice`'s labelled chip groups. */
function chip(page: Page, group: string, label: string) {
  return page
    .getByRole("group", { name: group })
    .getByRole("button", { name: label, exact: true });
}

/** Run the primary action and hand back the bytes the download produced. */
async function runAndDownload(
  page: Page,
  action: RegExp,
  slug: string,
): Promise<{ name: string; bytes: Buffer }> {
  const button = primaryAction(page, action);
  await expect(button, `${slug} never offered its primary action`).toBeEnabled({
    timeout: 60_000,
  });
  await button.click();
  const dl = downloadAffordance(page);
  await expect(dl, `${slug} failed: ${await toolError(page)}`).toBeVisible({ timeout: 150_000 });
  return captureDownload(page, dl);
}

/**
 * `<input type="color">` is not a fillable input as far as Playwright is
 * concerned, so the value goes in through the prototype setter — which also
 * defeats React's value tracker, so the synthetic `onChange` fires. Every call
 * site below re-asserts the field's value afterwards, so a browser where this
 * stops working fails on the control rather than on the pixels.
 */
async function setColourInput(page: Page, label: string, hex: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.evaluate((el, value) => {
    const field = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }, hex);
  await expect(input, "the colour control did not take the value").toHaveValue(hex);
}

// ────────────────────────────────────────────────────────────────────────────

test.describe("image edit verbs — real pixels", () => {
  test("rotate-image transposes the frame and carries the corner with it", async ({ page }) => {
    const W = 240;
    const H = 120;
    const MARK = 40;
    const BASE: Rgb = [20, 30, 160];
    const CORNER: Rgb = [240, 200, 20];

    await page.goto("/rotate-image");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "turn.png",
      recipe: { kind: "corner-mark", base: BASE, mark: CORNER, size: MARK },
    });

    /*
      Three turns off one upload. Changing the chip drops the result, which
      swaps the footer's download back to the primary — the invariant every
      one of these pages states — so the loop can just click and run again.

      `corner` is where the marker (top-left of the source) must END UP. That
      pairing is the half a dimension check cannot make: `drawEdit` sizes the
      canvas from `editOutputPlan` and then draws through `ctx.rotate`, so a
      turn that never reached the context still produces a correctly-transposed
      output — with the picture squashed into it unturned.
    */
    const cases: { label: string; width: number; height: number; corner: [number, number] }[] = [
      { label: "90° right", width: H, height: W, corner: [H - 10, 10] },
      { label: "180°", width: W, height: H, corner: [W - 10, H - 10] },
      { label: "90° left", width: H, height: W, corner: [10, W - 10] },
    ];

    for (const turn of cases) {
      await chip(page, "Rotation", turn.label).click();
      await expect(primaryAction(page, /^Rotate$/)).toBeVisible();

      const { name, bytes } = await runAndDownload(page, /^Rotate$/, "rotate-image");
      expect(name).toBe("turn-rotated.png");

      const header = assertPng(bytes);
      expect(
        { width: header.width, height: header.height },
        `${turn.label}: the IHDR must carry the turned frame`,
      ).toEqual({ width: turn.width, height: turn.height });
      // Decoded as well as declared — a header can say anything.
      expect(await probeImageInPage(page, bytes, "image/png")).toEqual({
        width: turn.width,
        height: turn.height,
      });

      const probe = await probePixels(page, bytes, "image/png", {
        points: [turn.corner, [Math.floor(turn.width / 2), Math.floor(turn.height / 2)]],
      });
      expectColour(probe.points[0], CORNER, `${turn.label}: the marker's new corner`);
      expectColour(probe.points[1], BASE, `${turn.label}: the middle of the picture`);
    }
  });

  test("flip-image moves the pixels, not just the preview", async ({ page }) => {
    /*
      A mirror changes no dimension, so there is nothing about the SIZE of the
      output that a no-op would get wrong. The marker is the entire test: the
      corner it started in must be plain field afterwards, and the corner it
      landed in must hold it.
    */
    const W = 200;
    const H = 120;
    const BASE: Rgb = [30, 140, 60];
    const CORNER: Rgb = [230, 40, 120];

    await page.goto("/flip-image");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "mirror.png",
      recipe: { kind: "corner-mark", base: BASE, mark: CORNER, size: 40 },
    });

    const cases: { label: string; landed: [number, number] }[] = [
      { label: "Horizontal", landed: [W - 10, 10] },
      { label: "Vertical", landed: [10, H - 10] },
    ];

    for (const axis of cases) {
      await chip(page, "Flip axis", axis.label).click();
      await expect(primaryAction(page, /^Flip$/)).toBeVisible();

      const { name, bytes } = await runAndDownload(page, /^Flip$/, "flip-image");
      expect(name).toBe("mirror-flipped.png");
      expect(
        assertPng(bytes),
        `${axis.label}: a mirror must not resize the picture`,
      ).toEqual({ width: W, height: H });

      const probe = await probePixels(page, bytes, "image/png", {
        points: [axis.landed, [10, 10]],
      });
      expectColour(probe.points[0], CORNER, `${axis.label}: the corner the marker moved to`);
      expectColour(
        probe.points[1],
        BASE,
        `${axis.label}: the marker's ORIGINAL corner — still marked means nothing moved`,
      );
    }
  });

  test("add-border pays out each edge on its own side", async ({ page }) => {
    /*
      Four DIFFERENT widths, because equal ones make the arithmetic a
      tautology: 24 on every side sums correctly whether the engine read `left`
      as `left` or as `right`. With 40/20/10/30 the picture's own corner sits
      at exactly (left, top) and nowhere else, and the four samples below say
      so one edge at a time.
    */
    const W = 200;
    const H = 100;
    const EDGES = { top: 10, right: 20, bottom: 30, left: 40 };
    const PHOTO: Rgb = [20, 40, 200];
    const FRAME: Rgb = [255, 0, 255];
    const FRAME_HEX = "#ff00ff";

    await page.goto("/add-border");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "framed.png",
      recipe: { kind: "solid", rgb: PHOTO },
    });

    await page.getByRole("button", { name: "Set each edge separately" }).click();
    for (const [edge, px] of Object.entries(EDGES)) {
      const field = page.getByRole("spinbutton", {
        name: edge[0].toUpperCase() + edge.slice(1),
        exact: true,
      });
      await field.fill(String(px));
    }
    // The hex FIELD, not the swatch: `<input type="color">` cannot be filled
    // and this is the one a brand colour gets pasted into anyway.
    await page.getByLabel("Border colour hex").fill(FRAME_HEX);

    const surface = page.locator("[data-tool-surface]");
    // The page prints the sum before the run; the file has to agree with it.
    await expect(surface).toContainText(`${W} × ${H} → ${W + 60} × ${H + 40}`);

    const { name, bytes } = await runAndDownload(page, /^Add border$/, "add-border");
    expect(name).toBe("framed-bordered.png");
    expect(assertPng(bytes), "output = source + the four edge widths").toEqual({
      width: W + EDGES.left + EDGES.right,
      height: H + EDGES.top + EDGES.bottom,
    });

    const outW = W + EDGES.left + EDGES.right;
    const outH = H + EDGES.top + EDGES.bottom;
    const probe = await probePixels(page, bytes, "image/png", {
      points: [
        [Math.floor(outW / 2), Math.floor(EDGES.top / 2)], // inside the top band
        [outW - Math.ceil(EDGES.right / 2), Math.floor(outH / 2)], // inside the right band
        [Math.floor(outW / 2), outH - Math.ceil(EDGES.bottom / 2)], // inside the bottom band
        [Math.floor(EDGES.left / 2), Math.floor(outH / 2)], // inside the left band
        [EDGES.left + 2, EDGES.top + 2], // the photo's own top-left corner
        [EDGES.left - 3, EDGES.top - 3], // one step outside it — still frame
      ],
    });
    expectColour(probe.points[0], FRAME, "the top band");
    expectColour(probe.points[1], FRAME, "the right band");
    expectColour(probe.points[2], FRAME, "the bottom band");
    expectColour(probe.points[3], FRAME, "the left band");
    expectColour(
      probe.points[4],
      PHOTO,
      "the picture must start exactly at (left, top) — an offset read from the wrong edge lands here",
    );
    expectColour(probe.points[5], FRAME, "and must not start one pixel earlier");
  });

  test("crop-circle returns a square with transparent corners and never offers JPG", async ({
    page,
  }) => {
    const W = 200;
    const H = 120;
    const PHOTO: Rgb = [220, 90, 30];

    await page.goto("/crop-circle");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "avatar.png",
      recipe: { kind: "solid", rgb: PHOTO },
    });

    /*
      The missing chip is the tool's headline claim ("NO JPG HERE — JPEG HAS NO
      ALPHA CHANNEL"), and it is a claim about a control, so it is asserted on
      the control. `OutputFormatPicker` renders whatever `formats` it is handed;
      a default list slipping back in would restore the chip and quietly start
      writing circles onto white squares.
    */
    const formats = page.getByRole("group", { name: "Output format" });
    await expect(formats.getByRole("button", { name: "PNG", exact: true })).toBeVisible();
    await expect(formats.getByRole("button", { name: "WEBP", exact: true })).toBeVisible();
    await expect(
      formats.getByRole("button", { name: "JPG", exact: true }),
      "a JPG circle is a circle on a white square, so the chip must not exist",
    ).toHaveCount(0);

    const { name, bytes } = await runAndDownload(page, /^Crop circle$/, "crop-circle");
    expect(name).toBe("avatar-circle.png");

    // 100% of the SHORTER edge is the default, so the frame is 120 × 120.
    const header = assertPng(bytes);
    expect(header, "a circle needs a square frame, sized off the shorter edge").toEqual({
      width: H,
      height: H,
    });

    const probe = await probePixels(page, bytes, "image/png", {
      points: [
        [H / 2, H / 2],
        [3, 3],
        [H - 4, 3],
        [3, H - 4],
        [H - 4, H - 4],
      ],
    });
    expectColour(probe.points[0], PHOTO, "the centre of the circle");
    for (let i = 1; i < 5; i++) {
      expect(
        probe.points[i][3],
        `corner ${i} must be transparent — an opaque corner means no circle was cut`,
      ).toBe(0);
    }
  });

  test("image-splitter tiles add up to the source exactly", async ({ page }) => {
    /*
      1001 × 503 into 3 × 3, because neither axis divides evenly and both
      leftovers are odd. That is the shape of the bug this repo has already
      shipped: a letterbox calculation rounded two halves independently and
      reported 219 + 563 + 219 = 1001 px inside a 1000 px frame. Each tile
      being "about a third" would have passed that; the SUM is what fails it.
    */
    const W = 1001;
    const H = 503;
    const source = tinyRectPng(W, H, [40, 90, 210]);

    await page.goto("/image-splitter");
    await uploadFixture(page, source);

    await page.getByRole("spinbutton", { name: "Rows", exact: true }).fill("3");
    await page.getByRole("spinbutton", { name: "Columns", exact: true }).fill("3");

    const surface = page.locator("[data-tool-surface]");
    // The page prints the addition term by term. Asserting it here is what
    // makes the on-screen claim and the bytes below one fact rather than two.
    await expect(surface).toContainText(`ACROSS: 334 + 333 + 334 = ${W} PX`);
    await expect(surface).toContainText(`DOWN: 168 + 167 + 168 = ${H} PX`);

    await primaryAction(page, /^Split$/).click();

    /*
      NOT `downloadAffordance`: every tile in the deck is its own
      `Download <filename>` button and the deck renders BEFORE the rail, so
      `.first()` would hand back one tile. The ZIP button is named for what it
      saves, so it can be asked for by name.
    */
    const zipButton = page.getByRole("button", { name: "Download 9 tiles (ZIP)", exact: true });
    await expect(zipButton, `split failed: ${await toolError(page)}`).toBeVisible({
      timeout: 150_000,
    });
    const { name, bytes } = await captureDownload(page, zipButton);
    expect(name).toBe("sample-1001x503-tiles.zip");

    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(entries.length, "a 3 × 3 grid is nine files, not eight and not ten").toBe(9);

    const sizes = new Map<string, { width: number; height: number }>();
    for (const entry of entries) {
      const tile = Buffer.from(await zip.files[entry].async("uint8array"));
      const label = /-(r\d+c\d+)\.png$/.exec(entry)?.[1];
      expect(label, `${entry} is not a tile filename`).toBeTruthy();
      sizes.set(label!, assertPng(tile));
    }

    for (let row = 1; row <= 3; row++) {
      const widths = [1, 2, 3].map((col) => sizes.get(`r${row}c${col}`)!.width);
      expect(
        widths.reduce((a, b) => a + b, 0),
        `row ${row}: ${widths.join(" + ")} must be exactly the source width`,
      ).toBe(W);
    }
    for (let col = 1; col <= 3; col++) {
      const heights = [1, 2, 3].map((row) => sizes.get(`r${row}c${col}`)!.height);
      expect(
        heights.reduce((a, b) => a + b, 0),
        `column ${col}: ${heights.join(" + ")} must be exactly the source height`,
      ).toBe(H);
    }
    // No tile may be padded or stretched to hide a rounding slip: every tile in
    // a row shares its height, every tile in a column shares its width.
    for (let row = 1; row <= 3; row++) {
      const heights = new Set([1, 2, 3].map((col) => sizes.get(`r${row}c${col}`)!.height));
      expect(heights.size, `row ${row} must be one height throughout`).toBe(1);
    }
  });

  test("social-media-image-resizer writes the stated sizes, and fills or pads them", async ({
    page,
  }) => {
    const W = 400;
    const H = 200;
    const PHOTO: Rgb = [20, 40, 200];
    const PAD: Rgb = [0, 255, 0];

    await page.goto("/social-media-image-resizer");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "post.png",
      recipe: { kind: "solid", rgb: PHOTO },
    });

    // The two the page opens on — a 1:1 and a 1.9:1, so one frame crops the
    // 2:1 source vertically and the other horizontally.
    const expected = [
      { id: "square-1080", width: 1080, height: 1080 },
      { id: "link-1200x630", width: 1200, height: 630 },
    ];

    /** Pull both outputs out of the ZIP, keyed by the preset id in the name. */
    const runAndUnzip = async (): Promise<Map<string, Buffer>> => {
      await primaryAction(page, /^Resize$/).click();
      const zipButton = page.getByRole("button", {
        name: `Download ${expected.length} sizes (ZIP)`,
        exact: true,
      });
      await expect(zipButton, `resize failed: ${await toolError(page)}`).toBeVisible({
        timeout: 150_000,
      });
      const { bytes } = await captureDownload(page, zipButton);
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(bytes);
      const out = new Map<string, Buffer>();
      for (const entry of Object.keys(zip.files).filter((n) => !zip.files[n].dir)) {
        const id = expected.find((e) => entry.includes(`-${e.id}.`))?.id;
        expect(id, `${entry} does not name one of the selected presets`).toBeTruthy();
        out.set(id!, Buffer.from(await zip.files[entry].async("uint8array")));
      }
      return out;
    };

    // ── Cover: every frame filled edge to edge, nothing padded. ──
    const cover = await runAndUnzip();
    expect(cover.size, "one file per selected preset").toBe(expected.length);
    for (const frame of expected) {
      const bytes = cover.get(frame.id)!;
      expect(assertPng(bytes), `${frame.id} must be written at its stated size`).toEqual({
        width: frame.width,
        height: frame.height,
      });
      const probe = await probePixels(page, bytes, "image/png", {
        points: [
          [4, 4],
          [frame.width - 5, 4],
          [4, frame.height - 5],
          [frame.width - 5, frame.height - 5],
          [frame.width >> 1, frame.height >> 1],
        ],
      });
      for (const [i, corner] of ["top-left", "top-right", "bottom-left", "bottom-right", "centre"].entries()) {
        expectColour(probe.points[i], PHOTO, `${frame.id} cover: ${corner} must be picture`);
      }
    }

    // ── Contain: the whole picture inside the frame, the rest in the pad. ──
    await chip(page, "How each frame is filled", "Contain").click();
    await setColourInput(page, "Pad colour", "#00ff00");
    const contain = await runAndUnzip();

    /*
      1080 × 1080 from a 400 × 200 source: `contain` scales by min(2.7, 5.4) =
      2.7, so the picture is 1080 × 540 and there are 270 px bands top and
      bottom. Those bands are the only thing that distinguishes contain from
      cover on a flat source, which is why the pad colour is set to something
      the source is not.
    */
    const square = contain.get("square-1080")!;
    expect(assertPng(square)).toEqual({ width: 1080, height: 1080 });
    const bands = await probePixels(page, square, "image/png", {
      points: [
        [540, 60],
        [540, 1020],
        [540, 540],
        [20, 540],
        [1060, 540],
      ],
    });
    expectColour(bands.points[0], PAD, "contain: the top band is the pad colour");
    expectColour(bands.points[1], PAD, "contain: the bottom band is the pad colour");
    expectColour(bands.points[2], PHOTO, "contain: the middle is the picture");
    expectColour(
      bands.points[3],
      PHOTO,
      "contain: the picture still spans the full width — nothing was cropped",
    );
    expectColour(bands.points[4], PHOTO, "contain: and reaches the right edge");

    // The 1.9:1 frame is nearly the source's own ratio, so it letterboxes only
    // slightly — its size is the fact worth pinning there.
    expect(assertPng(contain.get("link-1200x630")!)).toEqual({ width: 1200, height: 630 });
  });

  test("watermark-image paints where it says, and tiling paints everywhere", async ({ page }) => {
    /*
      A black field and a white mark, so "was anything drawn" is a pixel count
      rather than a byte diff — the same run twice through a PNG encoder is
      byte-identical, but a run that drew NOTHING is also a valid PNG of the
      right size, and only the pixels tell the two apart.
    */
    const W = 400;
    const H = 300;
    const MARKED_LUMA = 96;

    await page.goto("/watermark-image");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "credit.png",
      recipe: { kind: "solid", rgb: [0, 0, 0] },
    });

    await page.getByLabel("Watermark text", { exact: true }).fill("MARK");
    await page.getByRole("slider", { name: "Opacity", exact: true }).fill("1");
    await page.getByRole("slider", { name: "Size", exact: true }).fill("0.15");

    /** Marked pixels in the top half, the bottom-right quadrant, and overall. */
    const boxes = [
      { x: 0, y: 0, width: W, height: H / 2, minLuma: MARKED_LUMA },
      { x: W / 2, y: H / 2, width: W / 2, height: H / 2, minLuma: MARKED_LUMA },
      { x: 0, y: 0, width: W, height: H, minLuma: MARKED_LUMA },
    ];

    // ── Bottom right: the mark is in that corner and NOWHERE near the top. ──
    const corner = await runAndDownload(page, /^Apply watermark$/, "watermark-image");
    expect(corner.name).toBe("credit-watermarked.png");
    expect(assertPng(corner.bytes), "a watermark must not resize the picture").toEqual({
      width: W,
      height: H,
    });
    const cornerPixels = await probePixels(page, corner.bytes, "image/png", { boxes });
    expect(
      cornerPixels.marked[1],
      "the bottom-right stamp must actually reach the pixels",
    ).toBeGreaterThan(100);
    expect(
      cornerPixels.marked[0],
      "a corner stamp must leave the top half of the picture alone",
    ).toBe(0);

    // ── Tiled: the same stamp repeated over the subject itself. ──
    await chip(page, "Watermark position", "Tiled").click();
    await expect(primaryAction(page, /^Apply watermark$/)).toBeVisible();
    const tiled = await runAndDownload(page, /^Apply watermark$/, "watermark-image");
    const tiledPixels = await probePixels(page, tiled.bytes, "image/png", { boxes });

    expect(
      tiledPixels.marked[0],
      "tiling is the mode that covers the subject — the top half must be marked too",
    ).toBeGreaterThan(100);
    expect(
      tiledPixels.marked[2],
      "tiling must mark strictly more of the picture than one corner stamp does",
    ).toBeGreaterThan(cornerPixels.marked[2]);
  });

  test("pixelate-image destroys the selected region and only that region", async ({ page }) => {
    /*
      The source is 10 px vertical stripes, so every horizontal scan across an
      UNTOUCHED span reads about one luminance edge per 5 px, and the same span
      after a 50 px mosaic reads almost none. Three scans pin both axes of the
      selection:

        inside   the chosen band            → must go flat
        left of  it, at the same height     → must keep its detail
        above    it, at the same columns    → must keep its detail

      Drop either of the last two and a tool that pixelated the WHOLE image
      would pass, which is the failure mode a "the region is blurry" assertion
      on its own has.
    */
    const W = 600;
    const H = 400;
    const REGION = { x: 300, y: 100, width: 200, height: 200 };

    await page.goto("/pixelate-image");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "redact.png",
      recipe: { kind: "stripes", period: 10, a: [0, 0, 0], b: [255, 255, 255] },
    });

    await page.getByRole("slider", { name: "Block size", exact: true }).fill("50");
    // The four fields ARE the stored rectangle. They clamp against each other,
    // so the order matters and the readout below is what proves it landed.
    for (const key of ["x", "y", "width", "height"] as const) {
      await page
        .getByRole("spinbutton", { name: `Region ${key} in image pixels`, exact: true })
        .fill(String(REGION[key]));
    }
    await expect(page.locator("[data-tool-surface]")).toContainText(
      `${REGION.width} × ${REGION.height}`,
    );

    const { name, bytes } = await runAndDownload(page, /^Pixelate$/, "pixelate-image");
    expect(name).toBe("redact-pixelated.png");
    expect(assertPng(bytes), "pixelation must not resize the picture").toEqual({
      width: W,
      height: H,
    });

    const midY = REGION.y + REGION.height / 2;
    const probe = await probePixels(page, bytes, "image/png", {
      scans: [
        { y: midY, x0: REGION.x, x1: REGION.x + REGION.width - 1 },
        { y: midY, x0: 20, x1: 219 },
        { y: 40, x0: REGION.x, x1: REGION.x + REGION.width - 1 },
      ],
    });

    expect(
      probe.steps[0],
      "inside the selection the stripes must be gone — 200 px of 10 px stripes is ~40 edges, a 50 px mosaic is a handful",
    ).toBeLessThanOrEqual(8);
    expect(
      probe.steps[1],
      "the same row to the LEFT of the selection must still be striped",
    ).toBeGreaterThanOrEqual(25);
    expect(
      probe.steps[2],
      "the same columns ABOVE the selection must still be striped",
    ).toBeGreaterThanOrEqual(25);
  });

  test("pixelate-image covers the right pixels on a source past the canvas ceiling", async ({
    page,
  }) => {
    /*
      THE REGRESSION TEST FOR THE DEFECT THIS SESSION'S REVIEW FOUND.

      `MAX_CANVAS_DIMENSION` is 8192, so a 9000 px wide source is planned down
      to 8192 × 728 and the output canvas is a DIFFERENT COORDINATE SPACE from
      the one the region was chosen in. The shipped code painted the blocks at
      the source's own numbers: a selection at x = 8000 was mosaicked at
      x = 8000 on an 8192-wide canvas — over the wrong content — while the
      region the user had selected (which lands at x ≈ 7281 after the scale)
      came out fully legible. `editDestRect` is the mapping that fixes it, and
      below the ceiling it is the identity, which is why the case above cannot
      catch this and this one has to be its own test.

      The scans are placed against the SCALED rectangle, computed the way
      `editDestRect` computes it, so a regression that skips the mapping fails
      on scan 0 (the selection still legible) and again on scan 1 (a stripe of
      the picture nobody selected turned to blocks).
    */
    test.setTimeout(240_000);

    const W = 9000;
    const H = 800;
    const CEILING = 8192;
    const REGION = { x: 8000, y: 300, width: 800, height: 400 };

    // What `fitWithinCanvas` / `editDestRect` will produce for the above.
    const outW = CEILING;
    const outH = Math.round((H * CEILING) / W);
    const scaleX = outW / W;
    const scaleY = outH / H;
    const dest = {
      x: Math.floor(REGION.x * scaleX),
      y: Math.floor(REGION.y * scaleY),
      right: Math.ceil((REGION.x + REGION.width) * scaleX),
      bottom: Math.ceil((REGION.y + REGION.height) * scaleY),
    };

    await page.goto("/pixelate-image");
    await uploadPainted(page, {
      width: W,
      height: H,
      name: "panorama.png",
      // 20 px stripes: the background is drawn through a 0.91 downscale here,
      // so the pattern has to survive resampling and still read as detail.
      recipe: { kind: "stripes", period: 20, a: [0, 0, 0], b: [255, 255, 255] },
    });

    await page.getByRole("slider", { name: "Block size", exact: true }).fill("64");
    for (const key of ["x", "y", "width", "height"] as const) {
      await page
        .getByRole("spinbutton", { name: `Region ${key} in image pixels`, exact: true })
        .fill(String(REGION[key]));
    }

    const surface = page.locator("[data-tool-surface]");
    await expect(surface).toContainText(`${REGION.width} × ${REGION.height}`);

    const { bytes } = await runAndDownload(page, /^Pixelate$/, "pixelate-image");
    expect(assertPng(bytes), "the frame is reduced whole to fit the canvas ceiling").toEqual({
      width: outW,
      height: outH,
    });
    // And the engine says so, in the one shared wording `canvasCeilingWarning`
    // owns — a silently smaller output is still a change nobody asked for.
    await expect(surface).toContainText(`Scaled to ${outW} × ${outH}`);

    const midY = Math.floor((dest.y + dest.bottom) / 2);
    const probe = await probePixels(page, bytes, "image/png", {
      scans: [
        // Well inside the SCALED rectangle.
        { y: midY, x0: dest.x + 40, x1: dest.right - 40 },
        // The same row, far away from it — untouched picture.
        { y: midY, x0: 1000, x1: 1000 + (dest.right - dest.x - 80) },
        // The same columns, above the rectangle — untouched picture.
        { y: Math.floor(dest.y / 2), x0: dest.x + 40, x1: dest.right - 40 },
        // Where the un-mapped code painted its blocks: still picture.
        { y: midY, x0: REGION.x + 30, x1: outW - 12 },
      ],
    });

    /*
      The span is ~650 output px of an 18 px stripe pattern — roughly 70 edges
      while it is picture, and at most one per mosaic block (13 of them across
      the whole selection) once it is blocks. The thresholds sit in that gap
      rather than on either number, so a browser whose downscale filter aliases
      differently does not move them.
    */
    expect(
      probe.steps[0],
      "the SELECTED region must be mosaicked after the scale, not before it",
    ).toBeLessThanOrEqual(15);
    expect(
      probe.steps[1],
      "the rest of that row must keep its detail",
    ).toBeGreaterThanOrEqual(40);
    expect(
      probe.steps[2],
      "and so must the columns above the selection",
    ).toBeGreaterThanOrEqual(40);
    expect(
      probe.steps[3],
      "nothing may be mosaicked at the SOURCE coordinates — that is the defect this pins",
    ).toBeGreaterThanOrEqual(8);
  });
});
