import { defineConfig, devices } from "@playwright/test";

/**
 * The real-conversion suite (`src/__tests__/e2e/conversion/`) drives FFmpeg.wasm,
 * WebCodecs, pdf-lib and lamejs end to end against genuinely-encoded fixtures. It
 * is minutes rather than seconds, so it is opt-in via `npm run test:e2e:conversion`
 * and excluded from the default run.
 */
const conversionOnly = !!process.env.TRANSMUTE_CONVERSION_E2E;

export default defineConfig({
  testDir: "./src/__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: conversionOnly
    ? [
        {
          name: "conversion",
          testDir: "./src/__tests__/e2e/conversion",
          // WASM cores load and encode in real time; the default 30s is far
          // too tight even with the FFmpeg core served from a local cache.
          timeout: 240_000,
          expect: { timeout: 150_000 },
          use: {
            ...devices["Desktop Chrome"],
            permissions: ["microphone"],
            launchOptions: {
              args: [
                // Auto-accept getUserMedia/getDisplayMedia and feed synthetic
                // media, so the screen-recorder path runs without a human
                // picking a capture source.
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--auto-select-desktop-capture-source=Entire screen",
                "--allow-http-screen-capture",
              ],
            },
          },
        },
        {
          /*
            The same conversions in WebKit — the engines the suite guards
            (Web Audio, lamejs, pdf-lib, pdfjs, canvas, FFmpeg.wasm) all run
            in Safari, and its decoder quirks are exactly what the m4a/Ogg
            FFmpeg fallback exists for. Excluded: the WebCodecs video specs,
            the screen recorder (both lean on Chromium launch flags), and the
            GIF/FFmpeg-tagged hardening cases pending a WebKit-tuned pass.
          */
          name: "conversion-webkit",
          testDir: "./src/__tests__/e2e/conversion",
          timeout: 240_000,
          expect: { timeout: 150_000 },
          testIgnore: ["**/video.spec.ts", "**/interactions.spec.ts"],
          grepInvert: /gif|FFmpeg|MP4/i,
          use: { ...devices["Desktop Safari"] },
        },
      ]
    : [
        {
          name: "chromium",
          testIgnore: /conversion\//,
          use: { ...devices["Desktop Chrome"] },
        },
      ],
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
