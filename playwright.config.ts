import { defineConfig, devices } from "@playwright/test";

/**
 * The real-conversion suite (`src/__tests__/e2e/conversion/`) drives FFmpeg.wasm,
 * WebCodecs, pdf-lib and lamejs end to end against genuinely-encoded fixtures. It
 * is minutes rather than seconds, so it is opt-in via `npm run test:e2e:conversion`
 * and excluded from the default run.
 */
const conversionOnly = !!process.env.TRANSMUTE_CONVERSION_E2E;

/**
 * The PWA suite (`src/__tests__/e2e/pwa/`), opt-in via `npm run test:e2e:pwa`.
 *
 * It gets its own project — and its own web server — because it CANNOT run
 * against the other two's. Those start `npm run dev`, and the service worker
 * registers in production builds only: ServiceWorkerRegistration.tsx gates on
 * `process.env.NODE_ENV`, which the compiler inlines, so under `next dev` the
 * whole registration folds away. A PWA spec pointed at the dev server would
 * pass or fail for reasons that have nothing to do with this feature. So this
 * project serves the BUILT `out/` as static files over `http://localhost` — a
 * secure context, which is what makes `navigator.serviceWorker` and the Cache
 * API exist at all.
 *
 * The gate is the same shape as the conversion one on purpose: one env var,
 * read once, swapping the whole `projects` array so the default run's
 * behaviour is bit-identical when it is unset.
 */
const pwaOnly = !!process.env.TRANSMUTE_PWA_E2E;

/**
 * The real-file suite (`src/__tests__/e2e/real-files/`), opt-in via
 * `TRANSMUTE_REAL_FILES=<dir> npm run test:e2e:real`.
 *
 * Every other suite runs on tiny GENERATED fixtures. This one is pointed at a
 * directory of the user's own files — 12 MP phone photos, iPhone HEIC/HEVC,
 * Word-exported and scanned PDFs, long audio — and runs each file through the
 * relevant tools, one test per (file x tool). The directory is never part of
 * the repo (see `.gitignore`) and its contents are never read when the var is
 * unset: the default, conversion and PWA runs are bit-identical without it
 * (the default project's `testIgnore` below keeps the spec out of them).
 *
 * Same shape as the conversion gate: one env var, read once, swapping the
 * whole `projects` array. It uses the dev server on 3000 like the conversion
 * gate does, so it needs no web server of its own. Chromium only, like the
 * conversion gate (see there), with much longer budgets: a 200 MB video is
 * minutes, not seconds.
 */
const realFilesOnly = !!process.env.TRANSMUTE_REAL_FILES;

/**
 * NOT 3000, where `npm run dev` lives: this project must be able to run while
 * a dev server is up, and Playwright would otherwise happily hand a PWA spec
 * the dev server — where no worker registers and every assertion here would
 * fail for the wrong reason.
 *
 * Declared here and passed to the server on its command line rather than
 * imported from it. Playwright transpiles this config through its own CJS
 * hook, and importing the `.mjs` server module from it dies with
 * `ReferenceError: exports is not defined in ES module scope` — the hook
 * rewrites the ESM file to CJS and Node then loads it as ESM. So the number is
 * defined once, in the file that needs it twice, and travels as argv.
 */
const PWA_PORT = 4319;

export default defineConfig({
  testDir: "./src/__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: pwaOnly ? `http://localhost:${PWA_PORT}` : "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  /*
    CHROMIUM ONLY, by decision (2026-11-11): the product targets Chromium-based
    browsers. The `conversion-webkit` and `real-files-webkit` projects were
    removed — that halved the pre-push run. Their `grepInvert` (gif|FFmpeg|MP4)
    only ever narrowed WebKit, so no Chromium coverage went with them. Specs
    still carry comments recording what was MEASURED in WebKit; they are
    history, not a live run.
  */
  projects: realFilesOnly
    ? [
        {
          name: "real-files",
          testDir: "./src/__tests__/e2e/real-files",
          // Real inputs are big and the WASM cores load cold: 15 min a test,
          // 10 min for any single expectation (a download appearing).
          timeout: 900_000,
          expect: { timeout: 600_000 },
          use: { ...devices["Desktop Chrome"] },
        },
      ]
    : conversionOnly
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
      ]
    : pwaOnly
      ? [
          {
            /*
              Chromium only, and that is a limitation worth naming rather than
              hiding. WebKit's service-worker support under Playwright does not
              expose the same controller/claim timing, and a spec that waits on
              `navigator.serviceWorker.controller` there would be measuring the
              driver rather than the worker. The worker's own decisions are
              browser-independent and are covered exhaustively in jsdom by
              `src/__tests__/unit/lib/sw-policy.test.ts`; what this project adds
              is the part only a real browser can show — that the script
              registers at scope `/`, activates, survives the network being cut,
              and stores exactly what it was told to store.
            */
            name: "pwa",
            testDir: "./src/__tests__/e2e/pwa",
            // Install precaches two documents and one spec stores a 164 KB
            // engine over a real HTTP round trip; the default 30s is tight
            // once a cold Chromium start-up is in the same budget.
            timeout: 90_000,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : [
          {
            name: "chromium",
            // `pwa/` and `real-files/` join `conversion/` here: all are opt-in projects with
            // their own web server, and collecting either into the default run
            // would point it at a server that is not running.
            testIgnore: /(conversion|pwa|real-files)\//,
            use: { ...devices["Desktop Chrome"] },
          },
        ],
  webServer: pwaOnly
    ? {
        command: `node src/__tests__/e2e/pwa/static-server.mjs ${PWA_PORT}`,
        port: PWA_PORT,
        /*
          NOT reused, even locally. The other two projects can reuse a dev
          server because any `next dev` on 3000 serves this repo; this one
          cannot, because "something is listening on 4319" says nothing about
          which directory it is rooted in. Reusing a server left over from a
          previous, pre-rebuild run would test the old export while reporting
          on the new one.
        */
        reuseExistingServer: false,
        // The server refuses to start against a missing or stale `out/` and
        // says how to fix it. Piped so that message reaches the runner instead
        // of dying inside Playwright's process handling.
        stdout: "pipe",
        stderr: "pipe",
      }
    : {
        command: "npm run dev",
        port: 3000,
        reuseExistingServer: !process.env.CI,
      },
});
