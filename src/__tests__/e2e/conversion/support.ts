import { expect, type Page, type Locator } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FixtureFile } from "../helpers";

/**
 * Shared plumbing for the real-conversion suite.
 *
 * Unlike the rest of the E2E specs, these tests feed tools genuinely-encoded
 * media (see `scripts/generate-test-fixtures.mjs`) and assert the *bytes that
 * come back* are a valid file of the expected type — parsing containers, and
 * where it matters decoding the output in the browser. A tool that renders a
 * Download button over a 0-byte or malformed blob fails here.
 */

const SAMPLES_DIR = path.resolve(process.cwd(), "src/__tests__/fixtures/samples");

/** Load a checked-in real-media fixture. */
export async function sample(name: string, mimeType: string): Promise<FixtureFile> {
  return { name, mimeType, buffer: await readFile(path.join(SAMPLES_DIR, name)) };
}

export const SAMPLES = {
  mp4: () => sample("sample-video.mp4", "video/mp4"),
  webm: () => sample("sample-video.webm", "video/webm"),
  mp3: () => sample("sample-audio.mp3", "audio/mpeg"),
  m4a: () => sample("sample-audio.m4a", "audio/mp4"),
  wav: () => sample("sample-audio.wav", "audio/wav"),
  wav96kMono: () => sample("sample-audio-96k-mono.wav", "audio/wav"),
  wav6ch: () => sample("sample-audio-6ch.wav", "audio/wav"),
  vbrMp3: () => sample("sample-audio-vbr.mp3", "audio/mpeg"),
  jpgPortrait: () => sample("sample-photo-portrait.jpg", "image/jpeg"),
  jpg: () => sample("sample-photo.jpg", "image/jpeg"),
  pdf: () => sample("sample-doc.pdf", "application/pdf"),
  pdf60: () => sample("sample-doc-60p.pdf", "application/pdf"),
  svg: () => sample("sample-vector.svg", "image/svg+xml"),
};

/** Deliberately undecodable bytes wearing a given filename. */
export function corruptFixture(name: string, mimeType: string): FixtureFile {
  const buffer = Buffer.alloc(4096);
  for (let i = 0; i < buffer.length; i++) buffer[i] = (i * 197 + 13) & 0xff;
  return { name, mimeType, buffer };
}

// ────────────────────────────────────────────────────────────────────────────
// Driving a tool
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assert the FFmpeg core was served from our own origin, not a CDN.
 *
 * This used to be a route-intercepting cache, because the loader pulled ~31 MB
 * from unpkg and Playwright gives every test a cold HTTP cache. The core is now
 * self-hosted out of `public/`, so the tests exercise the real production load
 * path — and this guard fails if anyone points it back at a CDN.
 */
export function forbidCdnCore(page: Page): void {
  page.on("request", (request) => {
    const url = request.url();
    if (/unpkg\.com|cdn\.jsdelivr\.net/.test(url) && /ffmpeg-core/.test(url)) {
      throw new Error(`FFmpeg core must be self-hosted, but was fetched from ${url}`);
    }
  });
}

export async function uploadFixture(
  page: Page,
  fixtures: FixtureFile | FixtureFile[],
): Promise<void> {
  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached" });
  await input.setInputFiles(Array.isArray(fixtures) ? fixtures : [fixtures]);
}

/** The tool's primary action in the controls rail (`ToolActions`). */
export function primaryAction(page: Page, label: RegExp): Locator {
  return page.getByRole("button", { name: label }).first();
}

/** Every tool's download affordance is labelled `Download <filename>`. */
export function downloadAffordance(page: Page): Locator {
  return page.getByRole("button", { name: /^Download / }).first();
}

/**
 * Click something that triggers `triggerDownload` and return the bytes.
 * `triggerDownload` defers its `revokeObjectURL` by 1s, so the blob is still
 * live when Playwright reads it.
 */
export async function captureDownload(
  page: Page,
  trigger: Locator,
  timeout = 120_000,
): Promise<{ name: string; bytes: Buffer }> {
  const waiter = page.waitForEvent("download", { timeout });
  await trigger.click();
  const download = await waiter;
  const file = await download.path();
  if (!file) throw new Error("download produced no file");
  return { name: download.suggestedFilename(), bytes: await readFile(file) };
}

/**
 * Full happy path: upload, run the primary action, wait for the result, and
 * capture the downloaded bytes.
 */
export async function convert(
  page: Page,
  opts: {
    slug: string;
    input: FixtureFile | FixtureFile[];
    action?: RegExp;
    /** Tweak controls after upload, before the primary action fires. */
    setup?: (page: Page) => Promise<void>;
    timeout?: number;
  },
): Promise<{ name: string; bytes: Buffer }> {
  const { slug, input, action, setup, timeout = 150_000 } = opts;
  forbidCdnCore(page);
  await page.goto(`/${slug}`);
  await uploadFixture(page, input);
  if (setup) await setup(page);
  if (action) {
    const button = primaryAction(page, action);
    await expect(button).toBeEnabled({ timeout: 30_000 });
    await button.click();
  }
  const dl = downloadAffordance(page);
  await expect(dl).toBeVisible({ timeout });
  return captureDownload(page, dl);
}

/** Surface the tool's inline error text, so failures report the real cause. */
export async function toolError(page: Page): Promise<string | null> {
  const alert = page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
  if (await alert.count() === 0) return null;
  return (await alert.textContent())?.trim() ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// In-browser decode probes — the strongest validity signal available
// ────────────────────────────────────────────────────────────────────────────

/**
 * Decode audio bytes with the browser's own decoder. If this resolves, the
 * output is genuinely playable audio rather than merely well-shaped bytes.
 */
export async function decodeAudioInPage(
  page: Page,
  bytes: Buffer,
): Promise<{ duration: number; channels: number; sampleRate: number; peak: number }> {
  return page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ac = new AudioContext();
    const decoded = await ac.decodeAudioData(buf.buffer);
    let peak = 0;
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      // Sparse scan: enough to distinguish signal from digital silence.
      for (let i = 0; i < data.length; i += 32) peak = Math.max(peak, Math.abs(data[i]));
    }
    const out = {
      duration: decoded.duration,
      channels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
      peak,
    };
    await ac.close();
    return out;
  }, bytes.toString("base64"));
}

/**
 * Load video bytes into a real `<video>` and read back what the demuxer found.
 * Proves the container is seekable and carries a decodable track.
 */
export async function probeVideoInPage(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<{ duration: number; width: number; height: number }> {
  return page.evaluate(
    async ({ b64, type }: { b64: string; type: string }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buf], { type }));
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("metadata timeout")), 20_000);
          video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => {
            clearTimeout(timer);
            reject(new Error(`video decode error: ${video.error?.message ?? "unknown"}`));
          };
          video.src = url;
        });
        return {
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { b64: bytes.toString("base64"), type: mime },
  );
}

/** Decode image bytes via `createImageBitmap` and return real dimensions. */
export async function probeImageInPage(
  page: Page,
  bytes: Buffer,
  mime: string,
): Promise<{ width: number; height: number }> {
  return page.evaluate(
    async ({ b64, type }: { b64: string; type: string }) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([buf], { type }));
      const out = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return out;
    },
    { b64: bytes.toString("base64"), type: mime },
  );
}
