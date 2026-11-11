import { test, expect, type Page } from "@playwright/test";

import { captureDownload, downloadAffordance } from "./support";
import { IMAGE_MAE, decodeGif, diffGrids, expectSameImage, gifFrameGrid, imageGridInPage } from "./fidelity";

/**
 * The GIF verbs, and the decoder underneath them.
 *
 * ⚠ THIS FILE IS THE ONLY THING THAT COVERS THE WEBKIT DECODE PATH, and the
 * two paths are genuinely different code. Chromium and Firefox have a built-in
 * `ImageDecoder`; **WebKit does not have it at all** — measured — so Safari
 * falls back to the bundled omggif reader. A suite that ran only in Chromium
 * would leave half the decoder unexercised while reporting full coverage.
 *
 * The fixture is generated rather than checked in, with KNOWN frame count and
 * KNOWN per-frame delays, so "did it keep the animation" and "did it keep the
 * timing" are checkable facts rather than eyeballing.
 *
 * ⚠ THE FILENAME IS LOAD-BEARING. conversion-webkit carries
 * `grepInvert: /gif|FFmpeg|MP4/i`, and that pattern matches the FILE PATH as
 * well as the title. This file was first written as `gif-verbs.spec.ts` and
 * was collected 4 times in chromium and **0 times in WebKit** — silently, with
 * the run still green. Since WebKit is the only project that exercises the
 * omggif path, the filter would have removed exactly the coverage this file
 * exists for. Hence `animation-verbs`, and no `gif` in any title below.
 *
 * That filter is aimed at the FFmpeg-tagged `video-to-gif` hardening cases,
 * not at GIF as a format — nothing here touches FFmpeg or WebCodecs.
 */

/**
 * A 16x16, three-frame animation: red, green, blue, shown for 100, 200 and
 * 300 ms. Every one of those numbers is asserted below.
 *
 * INLINE BASE64 rather than a checked-in binary or a call into gifenc. Not
 * laziness — gifenc is CommonJS and its interop here is a trap: under
 * Playwright's ESM transform `import pkg from "gifenc"` yields a FUNCTION
 * rather than the exports object, so destructuring `GIFEncoder` gives
 * undefined and fails at the call site, and `createRequire` is unavailable in
 * the same scope. A frozen fixture sidesteps all of it and has the better
 * property anyway: the expected frame count and delays cannot drift with a
 * dependency bump.
 *
 * Reproduce with:
 *   node -e 'const {GIFEncoder,quantize,applyPalette}=require("gifenc");
 *     const e=GIFEncoder(),W=16;
 *     [[255,0,0],[0,255,0],[0,0,255]].forEach((c,i)=>{
 *       const p=new Uint8Array(W*W*4);
 *       for(let k=0;k<W*W;k++){p[k*4]=c[0];p[k*4+1]=c[1];p[k*4+2]=c[2];p[k*4+3]=255;}
 *       const q=quantize(p,256); e.writeFrame(applyPalette(p,q),W,W,{palette:q,delay:100*(i+1)});
 *     }); e.finish(); console.log(Buffer.from(e.bytes()).toString("base64"))'
 */
const THREE_FRAME_GIF_B64 =
  "R0lGODlhEAAQAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAEAAQAAAIHQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFgQEBACH5BAAUAAAALAAAAAAQABAAgAD/AAAAAAgdAAEIHEiwoMGDCBMqXMiwocOHECNKnEixosWBAQEAIfkEAB4AAAAsAAAAABAAEACAAAD/AAAACB0AAQgcSLCgwYMIEypcyLChw4cQI0qcSLGixYEBAQA7";

const threeFrameAnimation = (): Buffer => Buffer.from(THREE_FRAME_GIF_B64, "base64");

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/** Count frames and read delays back out of a GIF, in Node, with omggif. */
async function readBack(bytes: Buffer): Promise<{ frames: number; delaysMs: number[]; width: number }> {
  const { GifReader } = await import("omggif");
  const reader = new GifReader(new Uint8Array(bytes));
  const frames = reader.numFrames();
  const delaysMs: number[] = [];
  for (let i = 0; i < frames; i += 1) delaysMs.push(reader.frameInfo(i).delay * 10);
  return { frames, delaysMs, width: reader.width };
}

/**
 * PIXELS, not just counts and delays: output frame k must look like source
 * frame `order[k]`. The fixture's frames are solid red, green and blue, so a
 * verb that kept the count but repeated frame 0, dropped the palette, or
 * reversed the delays over unreversed pictures fails here.
 */
async function expectFrames(bytes: Buffer, order: number[], label: string): Promise<void> {
  const src = await decodeGif(threeFrameAnimation());
  const out = await decodeGif(bytes);
  expect(out.frames.length, `${label}: frame count`).toBe(order.length);
  const grid = { width: Math.min(8, out.width), height: Math.min(8, out.height) };
  order.forEach((from, k) => {
    expectSameImage(diffGrids(gifFrameGrid(src, from, grid), gifFrameGrid(out, k, grid), grid), {
      maxMae: IMAGE_MAE.lossy,
      label: `${label} frame ${k} (should be source frame ${from})`,
    });
  });
}

async function runTool(page: Page, route: string, primary?: RegExp) {
  await page.goto(route);
  const input = surfaceOf(page).locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 60_000 });
  await input.setInputFiles({
    name: "animation.gif",
    mimeType: "image/gif",
    buffer: threeFrameAnimation(),
  });
  if (primary) {
    const button = surfaceOf(page).getByRole("button", { name: primary }).first();
    await expect(button).toBeVisible({ timeout: 60_000 });
    await button.click();
  }
  const dl = downloadAffordance(page);
  await expect(dl).toBeVisible({ timeout: 120_000 });
  return captureDownload(page, dl);
}

test.describe("animation verbs", () => {
  test.setTimeout(180_000);

  test("the decoder returns every frame, not just the first", async ({ page }) => {
    /*
      THE POINT OF THE WHOLE CLUSTER. Before this decoder existed, reading an
      animation in this app kept frame 0 and warned about the rest. Reversing
      is the cheapest verb to prove it with: three frames in, three frames out.
    */
    const { bytes } = await runTool(page, "/reverse-gif");
    const out = await readBack(bytes);
    expect(out.frames, "the animation was flattened to a still").toBe(3);
    // Three frames that are all frame 0 would pass the count.
    await expectFrames(bytes, [2, 1, 0], "reversed");
  });

  test("reversing takes the delays with the frames", async ({ page }) => {
    // 100/200/300 in must come back 300/200/100 — not 100/200/300 over
    // reversed pictures, which is the classic wrong implementation.
    const { name, bytes } = await runTool(page, "/reverse-gif");
    expect(name).toBe("animation-reversed.gif");
    const out = await readBack(bytes);
    expect(out.delaysMs).toEqual([300, 200, 100]);
  });

  test("resizing scales the pixels and keeps the frames", async ({ page }) => {
    const { name, bytes } = await runTool(page, "/resize-gif", /^Resize GIF$/);
    expect(name).toBe("animation-resized.gif");
    const out = await readBack(bytes);
    // The slider defaults to 50%, so the 16px source becomes 8px.
    expect(out.width).toBe(8);
    expect(out.frames, "resizing must not drop frames").toBe(3);
    /*
      THE PAIRED CONTROL for the reversal case above. If the delays came back
      in this order there too, [300,200,100] would prove nothing about
      reversing — it would just be the order every verb happens to emit. A verb
      that does NOT reverse must leave them as they were.
    */
    expect(out.delaysMs, "a non-reversing verb must not touch the order").toEqual([100, 200, 300]);
    await expectFrames(bytes, [0, 1, 2], "resized");
  });

  test("splitting yields one file per frame, numbered in order", async ({ page }) => {
    const { name, bytes } = await runTool(page, "/split-gif");
    expect(name).toBe("animation-frames.zip");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(["frame-1.png", "frame-2.png", "frame-3.png"]);
    // …and they are real PNGs, not empty entries.
    const first = await zip.files["frame-1.png"].async("uint8array");
    expect(Buffer.from(first.subarray(1, 4)).toString("latin1")).toBe("PNG");
    // …holding frame k's pixels: red, green, blue — not three copies of one.
    const src = await decodeGif(threeFrameAnimation());
    const grid = { width: 8, height: 8 };
    for (let k = 0; k < 3; k++) {
      const png = await zip.files[`frame-${k + 1}.png`].async("nodebuffer");
      const got = await imageGridInPage(page, { bytes: png, mime: "image/png" }, grid);
      expect({ width: got.width, height: got.height }).toEqual({ width: 16, height: 16 });
      expectSameImage(diffGrids(gifFrameGrid(src, k, grid), got.rgb, grid), {
        maxMae: IMAGE_MAE.lossy,
        label: `frame-${k + 1}.png`,
      });
    }
  });

  test("the maker builds an animation from stills, ordered by filename", async ({ page }) => {
    /*
      Ordering is the claim worth pinning: files arrive from a drop in whatever
      order the OS supplies, so the tool sorts by name with a NUMERIC collator.
      The names below are chosen so a plain alphabetical sort would put
      frame-10 second — if that happened, the frame count would still be 3 and
      only the order would be wrong, which is why the delay check is here too.
    */
    await page.goto("/gif-maker");
    const input = surfaceOf(page).locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: 60_000 });

    /*
      Real PNG bytes, not SVG. `createImageBitmap` does not decode SVG, so an
      SVG fixture makes the tool report a decode failure and the test look like
      a tool bug — measured, that is exactly what happened first.
      8x8 solid colours, hand-built as IHDR + IDAT + IEND.
    */
    const PNG = {
      red: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
      green: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR4nGNg+M+AHQ0tCQDpMD/B9YBzjgAAAABJRU5ErkJggg==",
      blue: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR4nGNgYPiPAw0pCQCpcD/BFMrqcwAAAABJRU5ErkJggg==",
    };
    const png = (b64: string) => Buffer.from(b64, "base64");
    const stills = [PNG.red, PNG.green, PNG.blue];
    await input.setInputFiles([
      { name: "frame-1.png", mimeType: "image/png", buffer: png(PNG.red) },
      { name: "frame-2.png", mimeType: "image/png", buffer: png(PNG.green) },
      { name: "frame-10.png", mimeType: "image/png", buffer: png(PNG.blue) },
    ]);

    const dl = downloadAffordance(page);
    await expect(dl).toBeVisible({ timeout: 120_000 });
    const { name, bytes } = await captureDownload(page, dl);
    expect(name).toBe("animation.gif");

    const out = await readBack(bytes);
    expect(out.frames, "one frame per picture").toBe(3);
    // The default slider is 100 ms, applied to every frame.
    expect(out.delaysMs).toEqual([100, 100, 100]);

    // And each frame IS its picture, in numeric-name order: red, green, blue.
    const gif = await decodeGif(bytes);
    const grid = { width: 8, height: 8 };
    for (let k = 0; k < 3; k++) {
      const want = await imageGridInPage(page, { bytes: png(stills[k]), mime: "image/png" }, grid);
      expectSameImage(diffGrids(want.rgb, gifFrameGrid(gif, k, grid), grid), {
        maxMae: IMAGE_MAE.lossy,
        label: `frame ${k} of the made animation`,
      });
    }
  });
});
