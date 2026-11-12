import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  SAMPLES,
  uploadFixture,
  downloadAffordance,
  captureDownload,
  toolError,
  watchQpdfRequests,
} from "./support";
import type { QpdfEngineWatch } from "./support";
import { assertEncryptedPdf, assertNotEncryptedPdf, openPdfAsReader } from "./validators";
import { expectPdfPages } from "./fidelity";
import type { FixtureFile } from "../helpers";

/**
 * The four qpdf-backed security tools: protect-pdf, unlock-pdf,
 * pdf-permissions and repair-pdf.
 *
 * Every case here asserts the BYTES that came back, and where the claim is
 * about what a reader will do with the file, it asserts that through a real
 * decryptor rather than by grepping for `/Encrypt` — a file no reader can open
 * would pass a grep just as well as a correctly encrypted one.
 *
 * NO NEW CHECKED-IN FIXTURES, deliberately, for both inputs that this suite
 * cannot express with `sample-doc.pdf` as it stands:
 *
 *   - the encrypted input for unlock-pdf is produced by running protect-pdf
 *     FIRST, in the browser, and feeding its download straight back in. That is
 *     a genuine round trip through the shipped engine and it proves both tools
 *     at once; a checked-in encrypted file would prove only that we can read
 *     what we once wrote.
 *   - the damaged input for repair-pdf is built in `damagedPdf()` below.
 *     `corruptFixture()` is NOT reusable here: its 4,096 pseudo-random bytes
 *     carry no `%PDF-` header at all, and qpdf correctly refuses them (measured:
 *     exit 2, "unable to find trailer dictionary"). Repair cannot fix a file
 *     that is not a PDF, and should not pretend to.
 *
 * NOTE ON TITLES: the conversion-webkit project greps out /gif|FFmpeg|MP4/i
 * against the project name, the FILE PATH, every describe title and the test
 * title — a banned word anywhere in that chain silently drops the case from
 * WebKit. Every case here must run in BOTH engines: the qpdf artifact is built
 * with `-fwasm-exceptions`, and that was measured working in WebKit and Firefox
 * as well as Chromium (a wrong password returns exit 2 with a clean message,
 * and a reconstruction returns exit 3 with output, identically in all three).
 * So no title, and not the filename either, may contain those words.
 */

/** The fixture is a real 5-page A4 document; nothing here may lose a page. */
const SOURCE_PAGES = 5;

/** Spaces and length are deliberate: `callMain` takes an argv, there is no shell. */
const PASSWORD = "correct horse battery staple";

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/**
 * Everything the tool is currently SAYING about the loaded file.
 *
 * Scoped to the shell's own notice regions — `ErrorMessage` is role=alert,
 * `WarningMessage` and qpdf's warning block are role=status — rather than to
 * the whole surface, because the rail carries standing explanatory copy that
 * would make a text assertion pass whatever the tool concluded about THIS file.
 * Joining all of them is the `large-input.spec.ts` idiom, and it means Next's
 * empty route announcer (also role=alert, but outside the surface) cannot
 * interfere either.
 */
async function toolNotices(page: Page): Promise<string> {
  const notices = surfaceOf(page).locator('[role="alert"], [role="status"]');
  return (await notices.allInnerTexts()).join(" ");
}

/**
 * Load a tool with a file, watching where its engine is served from.
 *
 * The watcher goes on before the navigation: for the three encrypting tools
 * `qpdf.js` is fetched by the pre-flight probe that fires the moment a file is
 * dropped, which is well before anything the test does.
 */
async function openWith(
  page: Page,
  slug: string,
  input: FixtureFile,
  primaryLabel: string,
): Promise<QpdfEngineWatch> {
  const watch = watchQpdfRequests(page);
  await page.goto(`/${slug}`);
  await uploadFixture(page, input);
  // The rail only exists once a file is loaded; waiting for the primary is
  // what makes a later `count()` of the password fields meaningful rather than
  // a race with the mount.
  await expect(
    surfaceOf(page).getByRole("button", { name: primaryLabel, exact: true }),
    `${slug} never rendered its "${primaryLabel}" action`,
  ).toBeVisible({ timeout: 60_000 });
  return watch;
}

/**
 * Fill every password box on the surface with the same value, and say how many
 * there were.
 *
 * `QpdfPasswordField` is a bare `input type="password"` with an aria-label and
 * no visible `<label>`, so the input's own type is the locator. One value in
 * all of them is exactly what these tools want: protect-pdf renders the
 * password and its confirmation, which have to match, and its owner password —
 * when it asks for one at all — may equal the user password, which is the
 * documented default (qpdf refuses a user password with no owner password).
 */
async function fillPasswords(page: Page, value: string): Promise<number> {
  const fields = surfaceOf(page).locator('input[type="password"]');
  const count = await fields.count();
  for (let i = 0; i < count; i++) await fields.nth(i).fill(value);
  return count;
}

/** Click the tool's primary and capture the document it hands back. */
async function runAndCapture(
  page: Page,
  primaryLabel: string,
): Promise<{ name: string; bytes: Buffer }> {
  const run = surfaceOf(page).getByRole("button", { name: primaryLabel, exact: true }).first();
  await expect(
    run,
    `"${primaryLabel}" never became clickable: ${await toolError(page)}`,
  ).toBeEnabled({ timeout: 90_000 });
  await run.click();

  const dl = downloadAffordance(page);
  await expect(dl, `${primaryLabel} failed: ${await toolError(page)}`).toBeVisible({
    timeout: 150_000,
  });
  return captureDownload(page, dl);
}

/**
 * `sample-doc.pdf` with its `startxref` offset pointed at nothing — the damage
 * repair-pdf exists for.
 *
 * The replacement offset is the SAME NUMBER OF DIGITS as the original, so the
 * only thing wrong with the document is where its trailer points: every object
 * is still present and still at the byte it was at. Measured through the
 * shipped engine on this exact fixture (offset 4984 → 9999): qpdf exits 3 and
 * reports "file is damaged", "offset 9999: xref not found" and "Attempting to
 * reconstruct cross-reference table", having written a document that re-parses
 * with all five pages.
 */
function damagedPdf(source: FixtureFile): FixtureFile {
  const buffer = Buffer.from(source.buffer);
  const marker = buffer.lastIndexOf("startxref");
  expect(marker, "the fixture must end with a startxref keyword").toBeGreaterThan(0);

  let start = marker + "startxref".length;
  while (start < buffer.length && (buffer[start] === 0x0a || buffer[start] === 0x0d)) start++;
  let end = start;
  while (end < buffer.length && buffer[end] >= 0x30 && buffer[end] <= 0x39) end++;
  const digits = end - start;
  expect(digits, "startxref must be followed by a byte offset").toBeGreaterThan(0);

  const wrong = "9".repeat(digits);
  // Without this the fixture could silently become undamaged — an offset that
  // already read 9999 would leave a perfectly good file wearing the name.
  expect(
    buffer.toString("latin1", start, end),
    "the fixture's real offset is already all nines, so this damages nothing",
  ).not.toBe(wrong);
  buffer.write(wrong, start, "latin1");

  return { name: "damaged-doc.pdf", mimeType: "application/pdf", buffer };
}

/** Run protect-pdf for real and return the encrypted document it produced. */
async function protectDocument(
  page: Page,
  password: string,
): Promise<{ file: FixtureFile; watch: QpdfEngineWatch }> {
  const watch = await openWith(page, "protect-pdf", await SAMPLES.pdf(), "Protect PDF");
  expect(
    await fillPasswords(page, password),
    "protect-pdf must offer a password field",
  ).toBeGreaterThan(0);
  const { name, bytes } = await runAndCapture(page, "Protect PDF");
  return { file: { name, mimeType: "application/pdf", buffer: bytes }, watch };
}

test.describe("PDF security tools produce genuinely encrypted, genuinely repaired files", () => {
  test("protect-pdf writes a document that will not open without the password", async ({
    page,
  }) => {
    const watch = await openWith(page, "protect-pdf", await SAMPLES.pdf(), "Protect PDF");
    expect(await fillPasswords(page, PASSWORD)).toBeGreaterThan(0);
    const { name, bytes } = await runAndCapture(page, "Protect PDF");

    expect(name).toBe("sample-doc-protected.pdf");
    // AES-256 (V 5 / R 6) with the permission word untouched: the default is a
    // password, not a set of restrictions.
    expect(assertEncryptedPdf(bytes)).toEqual({ v: 5, r: 6, p: -4 });

    // The page's claim is "will not open without the password", so that is what
    // is tested — with pdfjs' own decryptor, which is as close as this suite
    // gets to a reader.
    expect(await openPdfAsReader(bytes), "the document must refuse to open unprompted").toBeNull();
    expect(
      await openPdfAsReader(bytes, `not ${PASSWORD}`),
      "and must refuse the wrong password",
    ).toBeNull();
    const opened = await openPdfAsReader(bytes, PASSWORD);
    expect(opened?.pages, "the password must open it, with every page intact").toBe(SOURCE_PAGES);
    // …and each page decrypts to its OWN content, in order — a page count
    // survives an encrypt/decrypt that garbled every page.
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "protected, opened with the password", PASSWORD);

    watch.assertSelfHostedAndUsed();
  });

  test("unlock-pdf takes off a password this site just put on", async ({ page }) => {
    const { file: locked, watch } = await protectDocument(page, PASSWORD);

    await page.goto("/unlock-pdf");
    await uploadFixture(page, locked);
    await expect(
      surfaceOf(page).getByRole("button", { name: "Remove password", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    expect(
      await fillPasswords(page, PASSWORD),
      "unlock-pdf must offer a password field",
    ).toBeGreaterThan(0);

    const { name, bytes } = await runAndCapture(page, "Remove password");
    expect(name).toBe("sample-doc-protected-unlocked.pdf");

    // No /Encrypt at all, and the document parses the ordinary way again.
    await assertNotEncryptedPdf(bytes, { pages: SOURCE_PAGES });
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "unlocked");
    // `getPermissions()` is null exactly when a document carries no encryption
    // dictionary — the restrictions come off with the password, because both
    // live in the same dictionary.
    expect(
      (await openPdfAsReader(bytes))?.allowed,
      "an unlocked document carries no permission flags either",
    ).toBeNull();

    watch.assertSelfHostedAndUsed();
  });

  test("unlock-pdf reports a wrong password instead of writing half a document", async ({
    page,
  }) => {
    const { file: locked } = await protectDocument(page, PASSWORD);

    await page.goto("/unlock-pdf");
    await uploadFixture(page, locked);
    const run = surfaceOf(page).getByRole("button", { name: "Remove password", exact: true });
    await expect(run).toBeVisible({ timeout: 60_000 });
    expect(await fillPasswords(page, "not the password at all")).toBeGreaterThan(0);
    await expect(run).toBeEnabled({ timeout: 60_000 });
    await run.click();

    // qpdf exits 2 with "invalid password" and writes nothing; the engine maps
    // that to one fixed sentence, which the shell renders verbatim.
    await expect
      .poll(async () => toolError(page), {
        message: "a wrong password must surface an inline error, not hang",
        timeout: 90_000,
      })
      .toMatch(/wrong or missing/i);
    await expect(
      downloadAffordance(page),
      "nothing may be offered for download after a failed decrypt",
    ).toHaveCount(0);
  });

  test("unlock-pdf says an unprotected file has no password to remove", async ({ page }) => {
    await openWith(page, "unlock-pdf", await SAMPLES.pdf(), "Remove password");

    /*
      The pre-flight is the whole point of this case. `--decrypt` on a document
      that was never encrypted is a silent no-op SUCCESS (measured rc 0), so a
      tool without the `--requires-password` probe would hand back a
      "successfully unlocked" copy of a file it did not touch.
    */
    await expect
      .poll(() => toolNotices(page), {
        message:
          "unlock-pdf must say this file is not protected — checked against its own " +
          "alert/status notices, not the rail's standing copy",
        timeout: 90_000,
      })
      .toMatch(/no password|not (password.)?(protected|encrypted)|nothing to remove/i);
    await expect(
      downloadAffordance(page),
      "a file with no password must not produce an 'unlocked' download",
    ).toHaveCount(0);
  });

  test("pdf-permissions restricts a document that still opens for anyone", async ({ page }) => {
    const watch = await openWith(page, "pdf-permissions", await SAMPLES.pdf(), "Apply restrictions");
    const surface = surfaceOf(page);

    // `PdfPermissionControls` renders each choice as a role=group of chips, so
    // "None" is scoped to its own group — Printing and Editing both offer one.
    await surface
      .getByRole("group", { name: "Printing" })
      .getByRole("button", { name: "None", exact: true })
      .click();
    await surface.getByLabel("Allow copying text and images").uncheck();
    // qpdf will not encrypt without an owner password, so the tool has to have
    // one; whether it asks or generates it is its own call, and either way the
    // fields it does render get filled.
    await fillPasswords(page, PASSWORD);

    const { name, bytes } = await runAndCapture(page, "Apply restrictions");
    expect(name).toBe("sample-doc-restricted.pdf");

    const info = assertEncryptedPdf(bytes);
    expect(info.v, "restrictions are written at AES-256").toBe(5);
    expect(info.r).toBe(6);
    // Measured P values at revision 6: --print=none is -2056 and --extract=n is
    // -20. They are bit clears in one word, so both together are -2072. This is
    // the assertion that would catch a UI that showed the controls and sent the
    // allow-all baseline (-4) to the engine.
    expect(info.p, "the chosen restrictions must reach the permission word").toBe(-2072);

    // And the claim that separates this tool from protect-pdf: no password.
    const opened = await openPdfAsReader(bytes);
    expect(opened?.pages, "a restrictions-only document must open with no password").toBe(
      SOURCE_PAGES,
    );
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "restricted, opened with no password");
    expect(opened?.allowed, "printing must be denied").not.toContain("PRINT");
    expect(opened?.allowed).not.toContain("PRINT_HIGH_QUALITY");
    expect(opened?.allowed, "copying must be denied").not.toContain("COPY");
    expect(opened?.allowed, "editing was left alone and must stay allowed").toContain(
      "MODIFY_CONTENTS",
    );

    watch.assertSelfHostedAndUsed();
  });

  test("repair-pdf rebuilds a document whose cross-reference table points nowhere", async ({
    page,
  }) => {
    const damaged = damagedPdf(await SAMPLES.pdf());
    const watch = await openWith(page, "repair-pdf", damaged, "Repair PDF");

    const { name, bytes } = await runAndCapture(page, "Repair PDF");
    expect(name).toBe("damaged-doc-repaired.pdf");
    await assertNotEncryptedPdf(bytes, { pages: SOURCE_PAGES });
    // Rebuilt, not merely re-indexed: every page's own content came back.
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "repaired");

    /*
      qpdf exits 3 on this file — "completed with warnings", which IS a success
      and is exactly the code a wrapper that collapsed "non-zero means failed"
      would have thrown on. Its warnings are the honest account of what it had
      to work around, so they have to reach the user rather than being swallowed
      into a green tick.
    */
    await expect
      .poll(() => toolNotices(page), {
        message: "the reconstruction qpdf performed must be reported, not swallowed",
        timeout: 60_000,
      })
      .toMatch(/reconstruct|damaged|xref/i);

    watch.assertSelfHostedAndUsed();
  });

  test("repair-pdf says a sound document was already sound", async ({ page }) => {
    const watch = await openWith(page, "repair-pdf", await SAMPLES.pdf(), "Repair PDF");
    // Captured before the run so the assertion below cannot be satisfied by the
    // rail's standing copy: the sentence has to be something the tool said
    // about THIS run.
    const before = (await surfaceOf(page).innerText()).toLowerCase();

    const { bytes } = await runAndCapture(page, "Repair PDF");
    await assertNotEncryptedPdf(bytes, { pages: SOURCE_PAGES });
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "re-saved sound document");

    // qpdf exits 0 with an empty stderr on an undamaged file (measured), so
    // there is nothing to report — and nothing to report must not be dressed up
    // as a rescue that happened.
    expect(
      await toolNotices(page),
      "a clean run must not claim it reconstructed anything",
    ).not.toMatch(/reconstruct|xref not found|file is damaged/i);

    /*
      Deliberately a description rather than a literal: what is fixed is that
      the tool "says when nothing was wrong" rather than claiming a rescue, not
      the sentence it says it in. Narrow enough not to collide with the rail's
      own standing copy, which already promises that a file that was fine comes
      back fine — hence the `before` assertion, which fails if that promise ever
      moves into the standing text and makes this case vacuous.
    */
    const SOUND =
      /parsed cleanly|nothing (needed|to) repair|no repairs? (was|were) needed|already sound|nothing was wrong/i;
    const after = (await surfaceOf(page).innerText()).toLowerCase();
    expect(before, "the tool said nothing about soundness before it ran").not.toMatch(SOUND);
    expect(after, "a repair that found nothing wrong must say so").toMatch(SOUND);

    watch.assertSelfHostedAndUsed();
  });

  test("protect-pdf refuses a password past the 127-byte limit before it encrypts", async ({
    page,
  }) => {
    await openWith(page, "protect-pdf", await SAMPLES.pdf(), "Protect PDF");

    /*
      THE SILENT-DATA-LOSS CASE. Measured: qpdf accepts a password over 127
      UTF-8 bytes, encrypts, exits 0 with an empty stderr — and the file then
      refuses that password for ever, and every truncation of it too. There is
      no warning to pass on, so the refusal has to happen here or not at all.
      128 ASCII bytes is one past the limit, which is the overshoot a length
      check written against UTF-16 code units would let through unnoticed.
    */
    const tooLong = "a".repeat(128);
    expect(Buffer.byteLength(tooLong, "utf8")).toBe(128);
    expect(await fillPasswords(page, tooLong)).toBeGreaterThan(0);

    const run = surfaceOf(page).getByRole("button", { name: "Protect PDF", exact: true }).first();
    // A dead button would be a defensible refusal, but not a complete one — a
    // user who cannot see why nothing happened will try the same password
    // again. So the click is attempted when it is live, and the words are what
    // is asserted either way.
    if (await run.isEnabled()) await run.click();

    await expect
      .poll(() => toolNotices(page), {
        message: "an over-long password must be refused in words, before qpdf runs",
        timeout: 60_000,
      })
      .toMatch(/limit is 127|127 bytes/i);
    await expect(
      downloadAffordance(page),
      "nothing may be encrypted with a password that can never be entered again",
    ).toHaveCount(0);
  });
});
