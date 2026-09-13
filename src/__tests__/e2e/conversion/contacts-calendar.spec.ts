import { test, expect, type Page } from "@playwright/test";
import { captureDownload, downloadAffordance } from "./support";

/**
 * `/vcf-to-csv` and `/ics-to-csv`.
 *
 * The parsing itself is covered exhaustively by
 * `unit/lib/rfc-content-lines.test.ts` — it is pure string work with no canvas
 * and no wasm, so it has none of the blind spot the media tools have, and
 * duplicating those cases here would buy nothing.
 *
 * What is NOT covered there, and is the only reason this file exists, is the
 * wiring: that a dropped file reaches the parser, that what comes back is
 * offered as a real download with the right name, and that the warnings the
 * engine computes actually render. A tool can have a perfect parser and still
 * hand the user an empty file.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/** Folded on purpose: the ORG value is split the way a real exporter splits it. */
const VCF = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Lovelace;Ada;Byron;Ms.;",
  "FN:Ada Lovelace",
  "ORG:A Very Long Organisation Name That Real Exporters Would Fold Right ",
  " Here And Continue",
  "EMAIL;TYPE=WORK:ada@work.example",
  "EMAIL;TYPE=HOME:ada@home.example",
  "X-SOCIALPROFILE:somewhere",
  "END:VCARD",
].join("\r\n");

const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:1@example",
  "SUMMARY:Weekly sync",
  "DTSTART;TZID=Europe/London:20260910T140000",
  "RRULE:FREQ=WEEKLY;COUNT=10",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

async function convert(
  page: Page,
  route: string,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto(route);
  const input = surfaceOf(page).locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 60_000 });
  await input.setInputFiles(file);
  const dl = downloadAffordance(page);
  await expect(dl).toBeVisible({ timeout: 60_000 });
  return captureDownload(page, dl);
}

test.describe("contacts and calendars as spreadsheets", () => {
  test("vcf-to-csv writes a row per contact, with folded values rejoined", async ({ page }) => {
    const { name, bytes } = await convert(page, "/vcf-to-csv", {
      name: "contacts.vcf",
      mimeType: "text/vcard",
      buffer: Buffer.from(VCF, "utf8"),
    });
    expect(name).toBe("contacts.csv");

    const csv = bytes.toString("utf8");
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("Last name");
    // Two emails in the file means two numbered columns, not one crammed cell.
    expect(header).toContain("Email 1");
    expect(header).toContain("Email 2");
    expect(row).toContain("Lovelace");
    expect(row).toContain("ada@work.example (WORK)");
    // The folded ORG value came back whole — the failure that would otherwise
    // look like a working conversion with a truncated column.
    expect(row).toContain("Fold Right Here And Continue");
    // Exactly one contact, so exactly one data row.
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });

  test("vcf-to-csv names what it left out rather than dropping it silently", async ({ page }) => {
    await page.goto("/vcf-to-csv");
    const input = surfaceOf(page).locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: 60_000 });
    await input.setInputFiles({
      name: "contacts.vcf",
      mimeType: "text/vcard",
      buffer: Buffer.from(VCF, "utf8"),
    });
    const notice = surfaceOf(page).locator('[role="alert"], [role="status"]');
    await expect(notice.filter({ hasText: /X-SOCIALPROFILE/ }).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("ics-to-csv keeps the zone in its own column and does not expand a repeat", async ({
    page,
  }) => {
    const { name, bytes } = await convert(page, "/ics-to-csv", {
      name: "calendar.ics",
      mimeType: "text/calendar",
      buffer: Buffer.from(ICS, "utf8"),
    });
    expect(name).toBe("calendar.csv");

    const csv = bytes.toString("utf8");
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toContain("Start zone");
    expect(rows[1]).toContain("2026-09-10 14:00:00");
    expect(rows[1]).toContain("Europe/London");
    expect(rows[1]).toContain("FREQ=WEEKLY;COUNT=10");
    // COUNT=10 must NOT become ten rows: one event, one row.
    expect(rows, "a repeating event was expanded into occurrences").toHaveLength(2);
  });
});
