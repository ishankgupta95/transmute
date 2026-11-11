import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  ARCHIVE_FIXTURE_MEMBERS,
  SAMPLES,
  captureDownload,
  downloadAffordance,
  primaryAction,
  toolError,
  uploadFixture,
} from "./support";
import { assertZip } from "./validators";
import type { FixtureFile } from "../helpers";

/**
 * `create-zip` and `unzip-files`: members and BYTES, not "a .zip came back".
 *
 * `create-zip` is proven by opening its download with an independent reader
 * (jszip in Node) and comparing every member's bytes to the file that went in.
 * `unzip-files` is proven the other way round: extract from the checked-in
 * fixture and compare to the known member bodies.
 *
 * TITLES: no word matching /gif|FFmpeg|MP4/i — both tools must run in WebKit.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/** Binary, text and a non-ASCII name: the three shapes a zip writer gets wrong. */
async function inputs(): Promise<FixtureFile[]> {
  const jpg = await SAMPLES.jpg();
  const pdf = await SAMPLES.pdf();
  const wav = await SAMPLES.wav();
  return [
    jpg,
    pdf,
    wav,
    {
      name: "résumé ünïcode.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("héllo wörld — ✓\n".repeat(50), "utf8"),
    },
  ];
}

async function openZip(bytes: Buffer) {
  const JSZip = (await import("jszip")).default;
  return JSZip.loadAsync(bytes);
}

test.describe("zip tools — real output", () => {
  for (const level of ["Store", "Normal"] as const) {
    test(`create-zip (${level}) packs every file and each member's bytes equal its input`, async ({ page }) => {
      const files = await inputs();
      await page.goto("/create-zip");
      await uploadFixture(page, files);

      const surface = surfaceOf(page);
      await surface.getByRole("button", { name: level, exact: true }).click();
      await primaryAction(page, /^Create archive\.zip$/).click();

      const dl = downloadAffordance(page);
      await expect(dl, `create-zip failed: ${await toolError(page)}`).toBeVisible({ timeout: 60_000 });
      const { name, bytes } = await captureDownload(page, dl);

      expect(name).toBe("archive.zip");
      await assertZip(bytes);
      const zip = await openZip(bytes);
      const members = Object.values(zip.files).filter((f) => !f.dir);
      expect(members.map((m) => m.name).sort()).toEqual(files.map((f) => f.name).sort());
      for (const f of files) {
        const got = Buffer.from(await zip.files[f.name].async("uint8array"));
        expect(got.length, `${f.name}: size`).toBe(f.buffer.length);
        expect(got.equals(f.buffer), `${f.name}: bytes differ from the input`).toBe(true);
      }
      if (level === "Store") {
        // "Store" means no compression: the archive must be at least the sum
        // of its inputs.
        const total = files.reduce((n, f) => n + f.buffer.length, 0);
        expect(bytes.length).toBeGreaterThanOrEqual(total);
      } else {
        // Normal must really deflate the repetitive text and the PCM.
        const total = files.reduce((n, f) => n + f.buffer.length, 0);
        expect(bytes.length, "Normal level should shrink this input").toBeLessThan(total);
      }
    });
  }

  test("unzip-files lists the fixture and unpacks every member with the original bytes", async ({ page }) => {
    await page.goto("/unzip-files");
    await uploadFixture(page, await SAMPLES.zip());
    const surface = surfaceOf(page);

    for (const m of ARCHIVE_FIXTURE_MEMBERS) {
      await expect(surface.getByText(m.path).first(), `${m.path} should be listed`).toBeVisible({ timeout: 30_000 });
    }

    const dl = await captureDownload(page, surface.getByRole("button", { name: /^Download 3 files/ }));
    const bundle = await openZip(dl.bytes);
    const names = Object.keys(bundle.files).filter((n) => !bundle.files[n].dir).sort();
    expect(names).toEqual(ARCHIVE_FIXTURE_MEMBERS.map((m) => m.path).sort());
    for (const m of ARCHIVE_FIXTURE_MEMBERS) {
      expect(await bundle.files[m.path].async("string"), `${m.path} bytes`).toBe(m.body);
    }
  });

  test("unzip-files hands over just the one file that is left ticked, as itself", async ({ page }) => {
    await page.goto("/unzip-files");
    await uploadFixture(page, await SAMPLES.zip());
    const surface = surfaceOf(page);
    await expect(surface.getByText("values.csv").first()).toBeVisible({ timeout: 30_000 });

    // Untick everything but values.csv.
    await surface.getByRole("button", { name: "SELECT NONE" }).click();
    await surface.getByRole("checkbox", { name: "values.csv", exact: true }).check();
    await expect(surface.getByRole("checkbox", { checked: true })).toHaveCount(1);

    const dl = await captureDownload(page, surface.getByRole("button", { name: /^Download 1 file$/ }));
    expect(dl.name).toBe("values.csv");
    expect(dl.bytes.toString("utf8")).toBe("a,b,c\n1,2,3\n4,5,6\n");
  });

  test("a ZIP written by create-zip round-trips through unzip-files", async ({ page }) => {
    const files = await inputs();
    await page.goto("/create-zip");
    await uploadFixture(page, files);
    await primaryAction(page, /^Create archive\.zip$/).click();
    const made = await captureDownload(page, downloadAffordance(page).first(), 60_000);

    await page.goto("/unzip-files");
    await uploadFixture(page, { name: "roundtrip.zip", mimeType: "application/zip", buffer: made.bytes });
    const surface = surfaceOf(page);
    const dl = await captureDownload(page, surface.getByRole("button", { name: /^Download 4 files/ }));
    const bundle = await openZip(dl.bytes);
    for (const f of files) {
      const got = Buffer.from(await bundle.files[f.name].async("uint8array"));
      expect(got.equals(f.buffer), `${f.name} lost bytes across create-zip → unzip-files`).toBe(true);
    }
  });
});
