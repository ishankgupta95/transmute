import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { captureDownload, primaryAction, probeImageInPage } from "./support";
import { assertZip } from "./validators";

/**
 * Phase 3 gate: batches are genuinely parallel and the main thread stays
 * responsive while they run.
 *
 * Files are synthesised in-page (busy canvases → PNG Files → DataTransfer)
 * rather than checked in: the point is scheduling behaviour, not codec
 * fidelity — the rest of the suite owns byte-level correctness.
 */

const FILE_COUNT = 6;

/** Build N distinct, deliberately-busy PNGs and drop them on the tool. */
async function injectBatch(page: Page, count: number): Promise<void> {
  await page.locator('input[type="file"]').first().waitFor({ state: "attached" });
  await page.evaluate(async (n) => {
    const make = async (seed: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 1500;
      const ctx = canvas.getContext("2d")!;
      // High-entropy content so every encode pass does real work.
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `hsl(${(i * 7 + seed * 41) % 360}, ${40 + ((i * 13) % 55)}%, ${25 + ((i * 29) % 50)}%)`;
        ctx.fillRect((i * 37 + seed * 61) % 1960, (i * 53) % 1460, 42, 42);
      }
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      return new File([blob!], `batch-${seed}.png`, { type: "image/png" });
    };
    const files: File[] = [];
    for (let seed = 1; seed <= n; seed++) files.push(await make(seed));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, count);
}

/** Queue-row states as shown in the UI, e.g. ["DONE","RUNNING","QUEUED",…]. */
async function sampleStates(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("span")]
      .map((s) => s.textContent ?? "")
      .filter((t) => ["DONE", "RUNNING", "QUEUED", "FAILED"].includes(t)),
  );
}

test.describe("worker-pool batch", () => {
  test("compress-image: 6 files complete correctly and concurrently", async ({ page }) => {
    await page.goto("/compress-image");
    await injectBatch(page, FILE_COUNT);

    // Target-size mode forces the binary search (up to 11 encode passes per
    // file), so each file takes long enough that overlap is observable.
    await page.getByRole("button", { name: "Target size" }).click();
    await page.getByLabel("Target file size in KB").fill("300");

    // poolSize()'s clamp, computed from the browser's own value — the pool
    // module isn't importable from page.evaluate (no import map).
    const expectedThreads: number = await page.evaluate(() =>
      Math.max(1, Math.min((navigator.hardwareConcurrency ?? 2) - 1, 4)),
    );
    const run = primaryAction(page, /^Compress$/);
    await run.click();

    // Sample the queue table's states while the batch runs. The rows only
    // say RUNNING once their worker reports progress, so two RUNNING rows in
    // one sample = two workers genuinely in flight.
    let maxRunning = 0;
    for (let i = 0; i < 400; i++) {
      const states = await sampleStates(page);
      maxRunning = Math.max(maxRunning, states.filter((s) => s === "RUNNING").length);
      if (states.length > 0 && states.every((s) => s === "DONE")) break;
      await page.waitForTimeout(25);
    }

    const finalStates = await sampleStates(page);
    expect(finalStates, "all rows should finish").toHaveLength(FILE_COUNT);
    expect(finalStates.every((s) => s === "DONE"), `states: ${finalStates}`).toBe(true);

    // Concurrency: on any machine whose pool has ≥2 workers, at least two
    // files must have been observed running at once. (A sequential for-loop
    // — the old implementation — pins this at 1.)
    if (expectedThreads >= 2) {
      expect(maxRunning, "files observed running simultaneously").toBeGreaterThanOrEqual(2);
    }

    // The honest thread count from the pool, not a seeded number.
    await expect(
      page.getByText(new RegExp(`6 OF 6 DONE · \\d+ THREADS · RUNS ON THIS DEVICE`)),
    ).toBeVisible();

    // Correctness: the ZIP carries all six outputs and each one decodes.
    const zip = await captureDownload(page, page.getByRole("button", { name: /Download all/ }));
    const names = await assertZip(zip.bytes, { minEntries: FILE_COUNT });
    expect(names).toHaveLength(FILE_COUNT);

    const JSZip = (await import("jszip")).default;
    const opened = await JSZip.loadAsync(zip.bytes);
    for (const name of names) {
      const bytes = Buffer.from(await opened.files[name].async("uint8array"));
      const mime = name.endsWith(".webp") ? "image/webp" : "image/jpeg";
      const dims = await probeImageInPage(page, bytes, mime);
      expect(dims.width, `${name} decodes at full width`).toBe(2000);
      expect(dims.height, `${name} decodes at full height`).toBe(1500);
    }
  });

  test("main thread stays responsive during a batch (no long task > 200 ms)", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "longtask PerformanceObserver is Chromium-only");

    await page.goto("/compress-image");
    await injectBatch(page, FILE_COUNT);
    await page.getByRole("button", { name: "Target size" }).click();
    await page.getByLabel("Target file size in KB").fill("300");

    // Observe long tasks only while the batch runs — file synthesis above is
    // test scaffolding, not the pipeline under test.
    await page.evaluate(() => {
      const w = window as typeof window & { __longTasks?: number[] };
      w.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__longTasks!.push(entry.duration);
      }).observe({ type: "longtask" });
    });

    await primaryAction(page, /^Compress$/).click();
    await expect(page.getByText(/6 OF 6 DONE/)).toBeVisible({ timeout: 120_000 });

    const longTasks: number[] = await page.evaluate(
      () => (window as typeof window & { __longTasks?: number[] }).__longTasks ?? [],
    );
    const worst = Math.max(0, ...longTasks);
    expect(
      worst,
      `longest main-thread task during the batch was ${Math.round(worst)} ms (all: ${longTasks
        .map((d) => Math.round(d))
        .join(", ")})`,
    ).toBeLessThanOrEqual(200);
  });
});
