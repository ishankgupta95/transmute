import { test, expect, type Page } from "@playwright/test";
import { uploadFile, downloadButton } from "../helpers";
import { tinyWav } from "../fixtures";

/*
  The stale-result class, for the three audio tools.

  Each of these tools finishes a run, and then leaves every control live. The
  bug they all shared: changing an input updated the readouts (the stat strip,
  the OUTPUT rows, the join order) while the Download button went on holding
  the OLD bytes, with no way to re-run — so the UI described an output that had
  never been produced.

  The contract pinned here is the one the whole codebase uses: an edit that
  changes what a re-run would produce drops the result and restores the primary
  action. `merge-pdf` has the same guard in conversion/hardening.spec.ts.

  WAV output throughout — it keeps these off the slow lamejs encoder.
*/

/** Take a tool from "file loaded" to "result on screen". */
async function runToResult(page: Page, primary: RegExp) {
  await page.getByRole("button", { name: primary }).first().click();
  await expect(downloadButton(page)).toBeVisible({ timeout: 60_000 });
}

test.describe("audio tools invalidate a stale result", () => {
  test("audio-trimmer: format, bitrate preset and handle moves all clear it", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/audio-trimmer");
    await uploadFile(page, tinyWav(1));
    await expect(page.getByLabel("Selection end")).toBeEnabled({ timeout: 20_000 });

    await page.getByRole("button", { name: "WAV", exact: true }).click();
    await runToResult(page, /^Trim$/);

    // Output format — the strip's FORMAT cell moves, so the download must too.
    await page.getByRole("button", { name: "MP3", exact: true }).click();
    await expect(downloadButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Trim", exact: true })).toHaveCount(1);

    // A preset writes format + bitrate in one go.
    await page.getByRole("button", { name: "WAV", exact: true }).click();
    await runToResult(page, /^Trim$/);
    await page.getByRole("button", { name: "Podcast", exact: true }).click();
    await expect(downloadButton(page)).toHaveCount(0);

    // Moving a handle changes the selection the output was cut from.
    await page.getByRole("button", { name: "WAV", exact: true }).click();
    await runToResult(page, /^Trim$/);
    await page.getByLabel("Selection start").fill("0.3");
    await expect(downloadButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Trim", exact: true })).toHaveCount(1);
  });

  test("audio-trimmer: no button labelled Cancel destroys the loaded file", async ({ page }) => {
    await page.goto("/audio-trimmer");
    await uploadFile(page, tinyWav(1));
    await expect(page.getByLabel("Selection end")).toBeEnabled({ timeout: 20_000 });

    // Idle, the quiet link starts a new file over — it must not claim to
    // cancel anything, because there is nothing running to cancel.
    await expect(page.getByRole("button", { name: "START OVER" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "CANCEL", exact: true })).toHaveCount(0);
  });

  test("wav-to-mp3: a new bitrate clears the result and restores Convert", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/wav-to-mp3");
    await uploadFile(page, tinyWav(0.3));
    await runToResult(page, /^Convert$/);

    await page.getByRole("button", { name: "320", exact: true }).click();
    await expect(downloadButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Convert", exact: true })).toHaveCount(1);
  });

  test("merge-audio: reordering or removing a file clears the stale merge", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/merge-audio");
    await uploadFile(page, [
      { ...tinyWav(0.2), name: "a.wav" },
      { ...tinyWav(0.2), name: "b.wav" },
    ]);

    await page.getByRole("button", { name: "WAV", exact: true }).click();
    await runToResult(page, /Merge 2 files/);

    // Reorder: the join order is the whole point of this tool, and the old
    // merge is in the old order.
    await page.getByRole("button", { name: "Move down" }).first().click();
    await expect(downloadButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Merge 2 files/ })).toHaveCount(1);

    // Remove: the merge contains a file that is no longer in the queue.
    await runToResult(page, /Merge 2 files/);
    await page.getByRole("button", { name: "Remove file" }).first().click();
    await expect(downloadButton(page)).toHaveCount(0);
  });
});
