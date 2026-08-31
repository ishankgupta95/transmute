/**
 * Large-input regression guard.
 *
 * The FFmpeg tools used to reject anything over an undocumented 100 MB. The cap
 * is now derived from the real ceilings (see the header of
 * `src/lib/tools/ffmpeg-loader.ts`): audio extraction mounts its source through
 * WORKERFS and has no input cap at all, and the trimmer's cap is the size its
 * same-sized output can still be held at.
 *
 * The fixture is built in the page rather than checked in: a noisy canvas plus a
 * real audio track recorded through MediaRecorder gives a genuinely valid ~120 MB
 * file (noise defeats the encoder, so the bitrate stays high) without adding a
 * binary blob to the repo.
 */
import { expect, test } from "@playwright/test";
import { captureDownload, downloadAffordance, primaryAction } from "./support";
import { assertMp3 } from "./validators";

test.setTimeout(900_000);

/** Build a real, valid, large recording in the page and drop it on the tool. */
async function buildAndDrop(page: import("@playwright/test").Page, secs: number, mbps: number) {
  return page.evaluate(async ([s, m]) => {
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 720;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(c.width, c.height);
    let raf = 0;
    const draw = () => {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v; d[i + 1] = (v * 7) & 255; d[i + 2] = (v * 13) & 255; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    const vs = c.captureStream(30);
    const ac = new AudioContext();
    const osc = ac.createOscillator(); osc.frequency.value = 440;
    const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start();
    const rec = new MediaRecorder(
      new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]),
      { mimeType: "video/webm", videoBitsPerSecond: m * 1_000_000 },
    );
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(1000);
    await new Promise((r) => setTimeout(r, s * 1000));
    await new Promise<void>((r) => { rec.onstop = () => r(); rec.stop(); });
    cancelAnimationFrame(raf); osc.stop(); await ac.close();
    const blob = new Blob(chunks, { type: "video/webm" });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "big-recording.webm", { type: "video/webm" }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return blob.size;
  }, [secs, mbps] as const);
}

test("a real ~125 MB recording extracts to MP3 with no size cap", async ({ page }) => {
  await page.goto("/mp4-to-mp3");
  expect(await page.locator("label").first().innerText()).toContain("NO SIZE CAP");

  const size = await buildAndDrop(page, 30, 45);
  console.log(`INPUT ${(size / 1024 / 1024).toFixed(1)} MB`);
  expect(size).toBeGreaterThan(100 * 1024 * 1024);

  const alerts = (await page.locator('[role="alert"]').allInnerTexts()).join(" ");
  expect(alerts, "large file was rejected").not.toMatch(/too large|Maximum/i);

  const t0 = Date.now();
  await primaryAction(page, /Extract Audio/).click();
  const dl = downloadAffordance(page);
  await expect(dl).toBeVisible({ timeout: 600_000 });
  const { name, bytes } = await captureDownload(page, dl);
  console.log(`OUTPUT ${name} ${(bytes.length / 1024 / 1024).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  expect(name).toMatch(/\.mp3$/);
  assertMp3(bytes);
  expect(bytes.length).toBeGreaterThan(100_000);
});

test("the same recording is accepted by the trimmer, which advertises a real cap", async ({ page }) => {
  await page.goto("/video-trimmer");
  const zone = await page.locator("label").first().innerText();
  console.log("TRIMMER ZONE:", zone.replace(/\n/g, " | "));
  expect(zone).not.toContain("MAX 100 MB");
  const size = await buildAndDrop(page, 20, 45);
  console.log(`INPUT ${(size / 1024 / 1024).toFixed(1)} MB`);
  const alerts = (await page.locator('[role="alert"]').allInnerTexts()).join(" ");
  expect(alerts, "trimmer rejected the file").not.toMatch(/too large|Maximum/i);
});
