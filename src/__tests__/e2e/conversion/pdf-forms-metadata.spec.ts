import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  toolError,
  probeImageInPage,
} from "./support";
import { assertJpeg, assertPdf, hasExifSegment } from "./validators";
import type { FixtureFile } from "../helpers";
// Types only — erased at compile time. pdf-lib itself is pulled in with
// `await import(…)` inside the helpers below, the way `validators.ts` does it.
import type { PDFContext, PDFDict } from "pdf-lib";

/**
 * The AcroForm and metadata cluster: /fill-pdf-form, /flatten-pdf and
 * /remove-metadata.
 *
 * These three shipped with unit coverage only, and this repo's recorded lesson
 * is that jsdom has no canvas and no WebAssembly, so a green unit suite says
 * nothing about what a real browser hands the user. Everything below therefore
 * drives the real page, captures the real download, and re-parses the BYTES
 * that came back.
 *
 * ── WHY THE FIXTURES ARE BUILT HERE RATHER THAN CHECKED IN ──
 *
 * Verified against `src/__tests__/fixtures/samples/`: not one of the 28 files
 * there carries an /AcroForm, and not one carries an XMP packet. So the form
 * documents and the metadata document are built inline with pdf-lib and
 * uploaded as bytes, the same way `src/__tests__/unit/lib/pdf-engine.test.ts`
 * and `pdf-engine-stamp-forms.test.ts` build theirs. NO NEW FIXTURE FILE WAS
 * ADDED to the samples directory by this spec.
 *
 * ── FOUR METHOD RULES, all of them learned from this repo's own scars ──
 *
 * 1. A RAW BYTE GREP OVER A PDF IS UNSOUND. pdf-lib saves with object streams,
 *    so the structure is Flate-compressed, and every string it draws is written
 *    as a HEX STRING through the font's encoding. Measured again here:
 *    `Buffer.from(bytes).includes("Grace Hopper")` is FALSE on a flattened
 *    document that visibly shows the name. Text assertions therefore inflate
 *    the content streams, follow `/Resources /XObject` into the appearance
 *    streams `flatten()` leaves behind, and compare against `winAnsiHex()`.
 *    The ONE place a raw scan is used is the XMP packet, and only with a
 *    positive control in the same test — the marker is asserted PRESENT in the
 *    uploaded bytes before it is asserted ABSENT from the download. Without
 *    that control, "not found" would prove nothing.
 *
 * 2. EVERY REFUSAL TEST CARRIES A CONTROL PROVING THE HAZARD IS REAL. The
 *    blocked-flatten cases first load the same fixture bytes with pdf-lib here
 *    in Node and watch `form.flatten()` throw `Unexpected N type: undefined`.
 *    Without that, "the page refused" would be indistinguishable from "the page
 *    refuses everything".
 *
 * 3. TOOL-STATE TEXT IS SCOPED TO `[data-tool-surface]`. The FAQ and how-to
 *    copy on all three pages quotes the UI's own sentences almost verbatim
 *    ("no form fields", "XMP", "flatten"), so a page-wide `getByText` matches
 *    the marketing prose and passes over a dead tool.
 *
 * 4. CONTROLS ARE FOUND BY ROLE + EXACT NAME. The tool surface is a NAMED
 *    REGION (an sr-only <h2> holding the tool's name), so `getByLabel("…")` is
 *    a substring match that also matches the <section> itself.
 *
 * NOTE ON TITLES: `conversion-webkit` greps out /gif|FFmpeg|MP4/i against the
 * project name, the file path and the joined describe/test titles. All three
 * tools here are pure pdf-lib / ExifReader / canvas and must run in BOTH
 * engines — the image path especially, since the JPEG APP1 sweep in
 * `stripExifData` exists precisely because WebKit's encoder writes an Exif
 * block of its own. No title below may contain those words.
 */

// ────────────────────────────────────────────────────────────────────────────
// Byte-level readers — the only sound way to assert on a saved PDF
// ────────────────────────────────────────────────────────────────────────────

/**
 * A string as pdf-lib writes it into a content or appearance stream.
 *
 * The standard fonts encode WinAnsi, one byte per character for everything
 * drawn here, and pdf-lib emits the result as an UPPERCASE hex string:
 * `<41646120...>` is "Ada ...". ASCII arguments only — WinAnsi and Latin-1
 * disagree over 0x80–0x9F, and nothing here goes near it.
 */
function winAnsiHex(text: string): string {
  return Buffer.from(text, "latin1").toString("hex").toUpperCase();
}

async function loadPdf(bytes: Buffer) {
  const { PDFDocument } = await import("pdf-lib");
  // `updateMetadata: false` matters as much here as in the engine: the default
  // restamps /Producer and /ModDate on load, which would quietly repopulate
  // the very dictionary the metadata assertions are about.
  return PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
}

/** Inflate one indirect stream, or return its raw bytes when it is not Flate. */
function inflateStream(context: PDFContext, ref: unknown): string {
  const stream = context.lookup(ref as never) as { getContents?: () => Uint8Array } | undefined;
  if (!stream || typeof stream.getContents !== "function") return "";
  const raw = Buffer.from(stream.getContents());
  try {
    return inflateSync(raw).toString("latin1");
  } catch {
    return raw.toString("latin1");
  }
}

/** One page's content streams, inflated and concatenated in file order. */
async function pageContent(bytes: Buffer, index: number): Promise<string> {
  const { PDFArray, PDFName } = await import("pdf-lib");
  const doc = await loadPdf(bytes);
  const raw = doc.getPage(index).node.get(PDFName.of("Contents"));
  const contents = doc.context.lookup(raw);
  const refs: unknown[] =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : [raw];
  return refs.map((ref) => inflateStream(doc.context, ref)).join("\n");
}

/**
 * Every XObject on a page, keyed by resource name, inflated.
 *
 * Form XObjects — the appearance streams `flatten()` re-uses — come back as
 * readable operators, which is where a flattened field's text actually lives.
 * An image XObject inflates to sample data, harmless noise the callers here
 * only test for the presence of.
 */
async function pageXObjects(bytes: Buffer, index: number): Promise<Record<string, string>> {
  const { PDFDict, PDFName } = await import("pdf-lib");
  const doc = await loadPdf(bytes);
  const resources = doc.getPage(index).node.Resources();
  const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const out: Record<string, string> = {};
  if (!xObjects) return out;
  for (const [name, value] of xObjects.entries()) {
    out[name.asString()] = inflateStream(doc.context, value);
  }
  return out;
}

/**
 * How many APP1 segments a JPEG carries.
 *
 * BOTH kinds of provenance ride in APP1 — Exif (`Exif\0\0`) and XMP
 * (`http://ns.adobe.com/xap/1.0/\0`) — and `stripExifData`'s sweep drops the
 * marker wholesale rather than the Exif flavour only. `hasExifSegment` in
 * validators.ts answers the narrower question; this one is the promise the
 * tool's own copy makes ("every APP1 segment is then swept out"), so a build
 * that dropped Exif and left an XMP packet in place still fails.
 */
function countApp1Segments(buf: Buffer): number {
  let segments = 0;
  let o = 2;
  while (o + 4 <= buf.length && buf[o] === 0xff) {
    const marker = buf.readUInt16BE(o);
    if (marker === 0xffda || marker === 0xffd9) break; // start of scan / end
    const len = buf.readUInt16BE(o + 2);
    if (len < 2 || o + 2 + len > buf.length) break;
    if (marker === 0xffe1) segments += 1;
    o += 2 + len;
  }
  return segments;
}

/** Field names in the saved document, sorted. `[]` means the form is empty. */
async function savedFieldNames(bytes: Buffer): Promise<string[]> {
  const doc = await loadPdf(bytes);
  return doc
    .getForm()
    .getFields()
    .map((field) => field.getName())
    .sort();
}

/** Every stored field value, read back the way a form reader would. */
async function savedFieldValues(bytes: Buffer): Promise<Record<string, unknown>> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  return {
    who: form.getTextField("who").getText(),
    reference: form.getTextField("reference").getText(),
    agree: form.getCheckBox("agree").isChecked(),
    plan: form.getRadioGroup("plan").getSelected(),
    city: form.getDropdown("city").getSelected(),
    langs: form.getOptionList("langs").getSelected(),
  };
}

/** The /Info keys the saved document still declares, sorted. */
async function savedInfoKeys(bytes: Buffer): Promise<string[]> {
  const { PDFDict } = await import("pdf-lib");
  const doc = await loadPdf(bytes);
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict);
  if (!info) return [];
  return info
    .keys()
    .map((key) => key.asString())
    .sort();
}

/**
 * How many objects in the saved document still hang an XMP `/Metadata` stream:
 * the catalog, any page, and any image XObject.
 *
 * Deliberately the same three places `metadataStreamRefs` walks — a count that
 * only looked at the catalog would agree with an engine that left the page's
 * and the photograph's packets in place, which is the exact bug this tool
 * exists to avoid.
 */
async function savedXmpHolders(bytes: Buffer): Promise<number> {
  const { PDFDict: DictClass, PDFName, PDFStream } = await import("pdf-lib");
  const doc = await loadPdf(bytes);
  let holders = 0;
  const consider = (dict: PDFDict | undefined) => {
    if (dict && dict.get(PDFName.of("Metadata")) !== undefined) holders += 1;
  };
  consider(doc.catalog);
  for (const page of doc.getPages()) {
    consider(page.node);
    const xObjects = page.node.Resources()?.lookupMaybe(PDFName.of("XObject"), DictClass);
    if (!xObjects) continue;
    for (const [, value] of xObjects.entries()) {
      const resolved = doc.context.lookup(value);
      if (resolved instanceof PDFStream) consider(resolved.dict);
    }
  }
  return holders;
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture builders — real documents, built here because none is checked in
// ────────────────────────────────────────────────────────────────────────────

const A4: [number, number] = [595, 842];

/** The 4×2 RGB PNG the metadata fixture places, so an image XObject exists. */
const PNG_4X2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAH0lEQVR4nAXBMQEAAAyDMIRNGCeiKnAJ0JE0AjvTZg9cogixVC78TwAAAABJRU5ErkJggg==",
  "base64",
);

/** The XMP packet id, used as the marker in the one sound raw byte scan. */
const XMP_MARKER = "W5M0MpCehiHzreSzNTczkc9d";

/**
 * A form carrying one field of every kind the engine can write, plus a
 * read-only text field and a line of ordinary page text.
 *
 * The page text is load-bearing for the flatten cases: "the page's own content
 * survived" is only meaningful against content the page already had.
 *
 * `brokenRadio` adds a SECOND radio group and deletes its widgets' `/AP`. That
 * is the documented hazard shape — measured in this file's own control: with
 * `/AP` gone, pdf-lib's `flatten()` throws `Unexpected N type: undefined` and
 * the document is left half-flattened and unsaveable.
 */
async function formPdf(
  options: { brokenRadio?: boolean } = {},
): Promise<FixtureFile> {
  const { PDFDocument, PDFName, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("body", { x: 30, y: 30, size: 10, font });
  const form = doc.getForm();

  const who = form.createTextField("who");
  who.setText("Ada Lovelace");
  who.addToPage(page, { x: 20, y: 700, width: 240, height: 20 });

  // Read-only, and the LIBRARY does not enforce that — measured in
  // FillPdfFormUI's own header note: `setText` on a read-only field succeeds.
  // The page excluding it from the payload is the only lock there is.
  const locked = form.createTextField("reference");
  locked.setText("AL-1843");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 20, y: 660, width: 160, height: 20 });

  const agree = form.createCheckBox("agree");
  agree.check();
  agree.addToPage(page, { x: 20, y: 620, width: 18, height: 18 });

  const plan = form.createRadioGroup("plan");
  plan.addOptionToPage("basic", page, { x: 20, y: 580, width: 18, height: 18 });
  plan.addOptionToPage("pro", page, { x: 60, y: 580, width: 18, height: 18 });
  plan.select("pro");

  const city = form.createDropdown("city");
  city.setOptions(["London", "Paris", "Turin"]);
  city.select("Paris");
  city.addToPage(page, { x: 20, y: 540, width: 140, height: 20 });

  const langs = form.createOptionList("langs");
  langs.setOptions(["ada", "lisp", "rust"]);
  langs.select(["ada", "rust"]);
  langs.addToPage(page, { x: 20, y: 460, width: 140, height: 60 });

  if (options.brokenRadio) {
    const orphan = form.createRadioGroup("delivery");
    orphan.addOptionToPage("post", page, { x: 20, y: 380, width: 18, height: 18 });
    /*
      No reload dance needed here, and that is not luck: pdf-lib's radio
      `updateAppearances` reads the widget's on-value out of `/AP /N`, so with
      `/AP` gone it has nothing to key on and skips the widget entirely. The
      surgery therefore survives `save()`'s `updateFieldAppearances` pass.
    */
    for (const widget of orphan.acroField.getWidgets()) {
      widget.dict.delete(PDFName.of("AP"));
    }
  }

  return {
    name: "membership-form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  };
}

/**
 * A document that HAS an /AcroForm and no fields — what a form looks like once
 * it has been through a flatten.
 *
 * Its whole job is to be the other side of the `hasForm` discrimination: this
 * one must produce the "form dictionary with no fields left in it" sentence,
 * while a document that never had a form must produce the "no form fields"
 * one. If `readPdfForm` ever called `getForm()` before reading the catalog —
 * measured, that call CREATES an /AcroForm where there was none, `undefined`
 * before and `4 0 R` after — the two documents would become indistinguishable
 * and both would land on this sentence.
 */
async function alreadyFlattenedPdf(): Promise<FixtureFile> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("body", { x: 30, y: 30, size: 10, font });
  const field = doc.getForm().createTextField("who");
  field.setText("Ada Lovelace");
  field.addToPage(page, { x: 20, y: 700, width: 240, height: 20 });
  doc.getForm().flatten();
  return {
    name: "already-flattened.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  };
}

/**
 * A document carrying BOTH kinds of identifying metadata: all eight standard
 * /Info entries AND three XMP packets — one on the catalog, one on the page,
 * one on an embedded image.
 *
 * Both halves are the point. `remove-metadata`'s own copy says an /Info-only
 * clean "would report success over a document still naming you", so a fixture
 * with only /Info would let exactly that bug pass.
 *
 * ⚠ TWO SAVES, and the second is load-bearing. MEASURED: `embedPng` only
 * RESERVES a ref and queues the embedder; the image stream is not assigned
 * until `save()` flushes. Before the first save `lookup(imageRef)` is
 * undefined, so hanging `/Metadata` on the image silently does nothing — a
 * one-pass fixture carries TWO packets and quietly agrees with an engine that
 * misses the photograph's.
 */
async function metadataPdf(): Promise<FixtureFile> {
  const { PDFDocument, PDFDict: DictClass, PDFName, PDFRawStream, StandardFonts } =
    await import("pdf-lib");

  const first = await PDFDocument.create({ updateMetadata: false });
  const page = first.addPage(A4);
  const font = await first.embedFont(StandardFonts.Helvetica);
  page.drawText("body", { x: 30, y: 30, size: 10, font });
  page.drawImage(await first.embedPng(new Uint8Array(PNG_4X2)), {
    x: 10,
    y: 700,
    width: 80,
    height: 40,
  });
  first.setTitle("Quarterly numbers");
  first.setAuthor("Ada Lovelace");
  first.setSubject("Internal");
  first.setKeywords(["draft", "private"]);
  first.setCreator("Analytical Engine");
  first.setProducer("Widget Suite 9");
  first.setCreationDate(new Date("2020-01-02T03:04:05Z"));
  first.setModificationDate(new Date("2021-06-07T08:09:10Z"));

  const doc = await PDFDocument.load(await first.save(), { updateMetadata: false });
  const packet = (label: string) =>
    doc.context.register(
      PDFRawStream.of(
        doc.context.obj({ Type: PDFName.of("Metadata"), Subtype: PDFName.of("XML") }) as PDFDict,
        new TextEncoder().encode(
          `<?xpacket begin="" id="${XMP_MARKER}"?><x:xmpmeta xmlns:x="adobe:ns:meta/">` +
            `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
            `<rdf:Description dc:title="${label}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
        ),
      ),
    );

  doc.catalog.set(PDFName.of("Metadata"), packet("catalog"));
  const leaf = doc.getPage(0);
  leaf.node.set(PDFName.of("Metadata"), packet("page"));
  const xObjects = leaf.node.Resources()?.lookup(PDFName.of("XObject"), DictClass);
  for (const [, value] of xObjects?.entries() ?? []) {
    const stream = doc.context.lookup(value);
    if (stream instanceof PDFRawStream) {
      stream.dict.set(PDFName.of("Metadata"), packet("image"));
    }
  }

  return {
    name: "quarterly.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Reading the tool surface
// ────────────────────────────────────────────────────────────────────────────

/** Everything the tool itself renders — never the FAQ or the marketing copy. */
function surface(page: Page) {
  return page.locator("[data-tool-surface]");
}

/**
 * A `StatStrip` cell by its mono label. The value is the label span's sibling,
 * so the parent's text is `LABEL` + `VALUE` concatenated — the same
 * `.locator("..")` idiom pdf-pages.spec.ts uses.
 */
async function statValue(page: Page, label: string): Promise<string> {
  const cell = surface(page).getByText(label, { exact: true }).first().locator("..");
  const text = (await cell.textContent()) ?? "";
  return text.slice(label.length).trim();
}

/**
 * A `ToolAdvanced` row by its label.
 *
 * The drawer is a collapsed `<details>`, so the row exists in the DOM but is
 * not visible; open it once and read the value. Opening is idempotent —
 * `<summary>` toggles, so this only clicks when the drawer is still shut.
 */
async function advancedRow(page: Page, label: string): Promise<string> {
  const drawer = surface(page).locator("details").filter({ hasText: "ADVANCED" }).first();
  if (!(await drawer.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await drawer.locator("summary").click();
  }
  const row = drawer.getByText(label, { exact: true }).first().locator("..");
  const text = (await row.textContent()) ?? "";
  return text.slice(label.length).trim();
}

/** The one non-empty alert/status message on the surface, or null. */
async function surfaceNotice(page: Page): Promise<string | null> {
  const notice = surface(page)
    .locator('[role="status"], [role="alert"]')
    .filter({ hasText: /\S/ })
    .first();
  if ((await notice.count()) === 0) return null;
  return (await notice.textContent())?.trim() ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// fill-pdf-form
// ────────────────────────────────────────────────────────────────────────────

test.describe("fill-pdf-form — real output", () => {
  test("every field kind is read back with its value and its options, and the new values are in the saved document", async ({
    page,
  }) => {
    const source = await formPdf();
    await page.goto("/fill-pdf-form");
    await uploadFixture(page, source);

    // ── What the document says, drawn as one control per field ──
    await expect(
      surface(page).getByRole("textbox", { name: "who", exact: true }),
      `read failed: ${await toolError(page)}`,
    ).toHaveValue("Ada Lovelace", { timeout: 60_000 });

    await expect.poll(() => statValue(page, "FIELDS")).toBe("6");
    // Six fields, five editors: `reference` is read-only, and the page is the
    // only thing that keeps it that way.
    expect(await statValue(page, "EDITABLE")).toBe("5");
    expect(await statValue(page, "EDITED")).toBe("0");

    const reference = surface(page).getByRole("textbox", { name: "reference", exact: true });
    await expect(reference).toHaveValue("AL-1843");
    await expect(reference).toBeDisabled();

    const agree = surface(page).getByRole("checkbox", { name: "agree", exact: true });
    await expect(agree).toBeChecked();

    // The radio group's OPTIONS, not just its value: each declared option gets
    // its own button, plus the tool's own "Not set" escape.
    const radios = surface(page).getByRole("radiogroup", { name: "plan", exact: true });
    await expect(radios.getByRole("radio")).toHaveCount(3);
    await expect(radios.getByRole("radio", { name: "pro", exact: true })).toBeChecked();
    await expect(radios.getByRole("radio", { name: "basic", exact: true })).not.toBeChecked();

    const city = surface(page).getByRole("combobox", { name: "city", exact: true });
    await expect(city).toHaveValue("Paris");
    expect(await city.locator("option").allTextContents()).toEqual([
      "Not set",
      "London",
      "Paris",
      "Turin",
    ]);

    const langs = surface(page).getByRole("listbox", { name: "langs", exact: true });
    expect(await langs.locator("option").allTextContents()).toEqual(["ada", "lisp", "rust"]);
    expect(
      await langs.evaluate((el) =>
        Array.from((el as HTMLSelectElement).selectedOptions, (o) => o.value),
      ),
    ).toEqual(["ada", "rust"]);

    // ── Write a new value into every editable kind ──
    await surface(page).getByRole("textbox", { name: "who", exact: true }).fill("Grace Hopper");
    await agree.uncheck();
    await radios.getByRole("radio", { name: "basic", exact: true }).check();
    await city.selectOption("Turin");
    await langs.selectOption(["lisp"]);

    await expect.poll(() => statValue(page, "EDITED")).toBe("5");

    const action = primaryAction(page, /^Fill form$/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `fill failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("membership-form-filled.pdf");
    await assertPdf(bytes, { pages: 1 });

    // Still a form — the flatten box was never ticked.
    expect(await savedFieldNames(bytes)).toEqual([
      "agree",
      "city",
      "langs",
      "plan",
      "reference",
      "who",
    ]);
    expect(await savedFieldValues(bytes)).toEqual({
      who: "Grace Hopper",
      // Untouched: the library would have overwritten it without complaint.
      reference: "AL-1843",
      agree: false,
      plan: "basic",
      city: ["Turin"],
      langs: ["lisp"],
    });
  });

  test("fill and flatten bakes the values onto the page and empties the field list", async ({
    page,
  }) => {
    const source = await formPdf();
    await page.goto("/fill-pdf-form");
    await uploadFixture(page, source);

    await expect(
      surface(page).getByRole("textbox", { name: "who", exact: true }),
      `read failed: ${await toolError(page)}`,
    ).toHaveValue("Ada Lovelace", { timeout: 60_000 });

    await surface(page).getByRole("textbox", { name: "who", exact: true }).fill("Grace Hopper");
    await surface(page).getByRole("checkbox", { name: "Also flatten the form" }).check();
    await expect.poll(() => statValue(page, "FLATTEN")).toBe("ON");

    const action = primaryAction(page, /^Fill and flatten$/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `fill failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("membership-form-filled-flattened.pdf");
    await assertPdf(bytes, { pages: 1 });

    // Half one: there is nothing left to type into.
    expect(await savedFieldNames(bytes)).toEqual([]);

    // Half two: the value is ON THE PAGE. `flatten()` registers each widget's
    // appearance as a Form XObject and pushes a `Do` into the content stream,
    // so the operator is the proof the field became page content rather than
    // merely being deleted.
    const content = await pageContent(bytes, 0);
    expect(content, "each baked widget must be drawn into the page").toMatch(
      /\/FlatWidget-\d+ Do/,
    );
    // The page's own text is untouched by any of it.
    expect(content).toContain(`<${winAnsiHex("body")}> Tj`);

    const drawn = Object.values(await pageXObjects(bytes, 0)).join("\n");
    expect(drawn, "the typed value must be drawn into the baked appearance").toContain(
      winAnsiHex("Grace Hopper"),
    );
    expect(drawn, "the value it replaced must not still be drawn").not.toContain(
      winAnsiHex("Ada Lovelace"),
    );
    // The other fields came along, with the values they arrived holding.
    expect(drawn).toContain(winAnsiHex("Paris"));
    expect(drawn).toContain(winAnsiHex("AL-1843"));

    /*
      The control for the assertion above, kept as documentation of the trap:
      the name is plainly visible in this document and is NOT in its bytes.
      `expect(bytes.includes("Grace Hopper")).toBe(true)` is the assertion a
      reasonable person writes here, and it is always false.
    */
    expect(bytes.includes("Grace Hopper")).toBe(false);
  });

  test("a document with no form is refused, and no form dictionary is invented for it", async ({
    page,
  }) => {
    /*
      THE HONESTY CASE, and the one with a measured trap underneath it.

      `PDFDocument.getForm()` CREATES an /AcroForm on a document that has none.
      Measured in this repo's node_modules, pdf-lib 1.17.1, on a plain one-page
      document: `catalog.get(AcroForm)` is `undefined` before the call and
      `4 0 R` after it. So a `readPdfForm` that called `getForm()` before
      reading the catalog would report `hasForm: true` for EVERY document, and
      a fill that then saved would hand the user back a structural change they
      never asked for from a tool whose copy says it only touches form fields.

      What that bug looks like on this page is precise, which is what makes it
      testable through the browser: `hasForm` drives the sentence. A document
      with no form gets "This PDF has no form fields."; a document WITH a form
      dictionary and no fields gets "carries a form dictionary with no fields
      left in it". Under the bug the first document lands on the second
      sentence and the Advanced drawer reads "Present". The sibling test
      "an already-flattened document is told apart …" pins the other side, so
      the pair together is a real discrimination and not a one-way check.

      The remaining guarantee — that the file itself is unchanged — is kept by
      there being no output at all: the primary is disabled and nothing is
      offered to download.
    */
    const source = await SAMPLES.pdf();
    // Not vacuous: the fixture really is formless.
    const { PDFName } = await import("pdf-lib");
    const loaded = await loadPdf(source.buffer);
    expect(
      loaded.catalog.get(PDFName.of("AcroForm")),
      "the fixture must arrive with no /AcroForm or this test proves nothing",
    ).toBeUndefined();

    await page.goto("/fill-pdf-form");
    await uploadFixture(page, source);

    await expect(
      surface(page).getByText(/This PDF has no form fields\./),
      `read failed: ${await toolError(page)}`,
    ).toBeVisible({ timeout: 60_000 });
    // A refusal in words, not a stack trace: it says what it did with the file.
    await expect(surface(page).getByText(/Your file was read and not changed\./)).toBeVisible();
    await expect(
      surface(page).getByText(/this tool will not invent a form to put there/),
    ).toBeVisible();

    // NOT the already-flattened sentence — that one would mean an /AcroForm
    // had appeared on a document that never had one.
    await expect(
      surface(page).getByText(/carries a form dictionary with no fields left in it/),
    ).toHaveCount(0);
    expect(await advancedRow(page, "Form dictionary")).toBe("None");
    expect(await advancedRow(page, "Fields read")).toBe("0");

    expect(await statValue(page, "FIELDS")).toBe("0");
    await expect(surface(page).getByText("NO FIELDS TO FILL")).toBeVisible();
    await expect(primaryAction(page, /^Fill form$/)).toBeDisabled();
    expect(
      await downloadAffordance(page).count(),
      "a refused document must offer nothing to download",
    ).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// flatten-pdf
// ────────────────────────────────────────────────────────────────────────────

test.describe("flatten-pdf — real output", () => {
  test("the listed values are baked onto the page and the field list comes back empty", async ({
    page,
  }) => {
    const source = await formPdf();
    await page.goto("/flatten-pdf");
    await uploadFixture(page, source);

    // The reading pass, which is the whole left-hand side of this page: every
    // field, its kind and the value it currently holds.
    const table = surface(page);
    await expect(table.getByText("Ada Lovelace"), `read failed: ${await toolError(page)}`)
      .toBeVisible({ timeout: 60_000 });
    await expect(table.getByText("AL-1843")).toBeVisible();
    await expect(table.getByText("Checked", { exact: true })).toBeVisible();
    await expect(table.getByText("ada, rust", { exact: true })).toBeVisible();
    await expect(table.getByText("LIST BOX", { exact: true })).toBeVisible();
    await expect(table.getByText("RADIO", { exact: true })).toBeVisible();

    expect(await statValue(page, "FIELDS")).toBe("6");
    expect(await statValue(page, "FILLED IN")).toBe("6");
    expect(await statValue(page, "BLOCKED")).toBe("NONE");

    const action = primaryAction(page, /^Flatten form$/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `flatten failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { name, bytes } = await captureDownload(page, dl);

    expect(name).toBe("membership-form-flattened.pdf");
    await assertPdf(bytes, { pages: 1 });

    expect(await savedFieldNames(bytes)).toEqual([]);

    const content = await pageContent(bytes, 0);
    expect(content).toMatch(/\/FlatWidget-\d+ Do/);
    expect(content, "the page's own text must survive the bake").toContain(
      `<${winAnsiHex("body")}> Tj`,
    );

    const xObjects = await pageXObjects(bytes, 0);
    /*
      SEVEN, not six. `plan` is one field with TWO widgets, so a per-FIELD loop
      would silently lose a radio button off the page while every other
      assertion here still passed.
    */
    expect(Object.keys(xObjects).filter((n) => n.startsWith("/FlatWidget"))).toHaveLength(7);

    const drawn = Object.values(xObjects).join("\n");
    expect(drawn).toContain(winAnsiHex("Ada Lovelace"));
    expect(drawn).toContain(winAnsiHex("AL-1843"));
    expect(drawn).toContain(winAnsiHex("Paris"));
    // …and the raw scan the house rules forbid, kept as the control.
    expect(bytes.includes("Ada Lovelace")).toBe(false);
  });

  test("an already-flattened document is told apart from one that never had a form", async ({
    page,
  }) => {
    /*
      The other half of the `hasForm` discrimination described in
      "a document with no form is refused …". This document really does carry
      an /AcroForm with an empty /Fields — measured: `flatten()` empties
      /Fields and leaves the dictionary on the catalog — so it must produce the
      "form dictionary with no fields left in it" sentence, while the formless
      document must not. Read together, the two tests can only both pass when
      the report's `hasForm` is read from the catalog BEFORE `getForm()` is
      allowed to create one.
    */
    const source = await alreadyFlattenedPdf();
    const { PDFName } = await import("pdf-lib");
    const loaded = await loadPdf(source.buffer);
    expect(
      loaded.catalog.get(PDFName.of("AcroForm")),
      "the fixture must arrive WITH an /AcroForm or this test proves nothing",
    ).toBeDefined();
    expect(await savedFieldNames(source.buffer)).toEqual([]);

    await page.goto("/flatten-pdf");
    await uploadFixture(page, source);

    await expect(
      surface(page).getByText(/carries a form dictionary with no fields left in it/),
      `read failed: ${await toolError(page)}`,
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      surface(page).getByText(/This PDF has no form fields, so there is nothing to flatten\./),
    ).toHaveCount(0);

    expect(await advancedRow(page, "Form dictionary")).toBe("PRESENT");
    await expect(primaryAction(page, /^Flatten form$/)).toBeDisabled();
    expect(await downloadAffordance(page).count()).toBe(0);
  });

  test("a document with no form is refused and no form dictionary is invented for it", async ({
    page,
  }) => {
    const source = await SAMPLES.pdf();
    await page.goto("/flatten-pdf");
    await uploadFixture(page, source);

    await expect(
      surface(page).getByText(
        /This PDF has no form fields, so there is nothing to flatten\./,
      ),
      `read failed: ${await toolError(page)}`,
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      surface(page).getByText(/carries a form dictionary with no fields left in it/),
    ).toHaveCount(0);
    await expect(surface(page).getByText("No form fields in this document.")).toBeVisible();

    expect(await advancedRow(page, "Form dictionary")).toBe("ABSENT");
    await expect(primaryAction(page, /^Flatten form$/)).toBeDisabled();
    expect(await downloadAffordance(page).count()).toBe(0);
  });

  test("a radio group with no stored appearance is named before anything is flattened", async ({
    page,
  }) => {
    /*
      THE SECOND HONESTY CASE, and the reason `flattenBlockedBy` exists at all.

      THE CONTROL FIRST, in Node, on the identical bytes the browser is about
      to be handed: pdf-lib's own `flatten()` on this document throws
      `Unexpected N type: undefined`. It throws PART-WAY — fields before the
      failure are already deleted and already drawn — and the subsequent
      `save()` then throws too, so there is no half-flattened document to
      recover. Without this control, "the page refused" would be
      indistinguishable from "the page refuses everything".
    */
    const source = await formPdf({ brokenRadio: true });
    const doomed = await loadPdf(source.buffer);
    expect(
      () => doomed.getForm().flatten(),
      "the fixture must be a document pdf-lib genuinely cannot flatten",
    ).toThrow(/Unexpected N type/);

    await page.goto("/flatten-pdf");
    await uploadFixture(page, source);

    // Detected from the READING pass — nothing has been clicked, and the
    // blocking field is named rather than counted.
    await expect(
      surface(page).getByText(/no appearance stored in the file/),
      `read failed: ${await toolError(page)}`,
    ).toBeVisible({ timeout: 60_000 });
    const notice = (await surfaceNotice(page)) ?? "";
    expect(notice, "the refusal must name the field that blocks it").toContain("delivery");
    expect(notice).toContain("refused rather than half-done");

    expect(await statValue(page, "BLOCKED")).toBe("1");
    expect(await advancedRow(page, "Blocked fields")).toBe("1");
    // The rail lists it too, as the thing to go and fix.
    await expect(surface(page).getByText("BLOCKED BY")).toBeVisible();

    // No leap: the button cannot be pressed, so no half-flattened document can
    // exist, and nothing is offered to save.
    await expect(primaryAction(page, /^Flatten form$/)).toBeDisabled();
    expect(await downloadAffordance(page).count()).toBe(0);

    // And pdf-lib's own wording never reaches the user.
    expect(await surface(page).innerText()).not.toContain("Unexpected N type");
  });

  test("the same blocked document can still be filled, with the form left interactive", async ({
    page,
  }) => {
    /*
      The refusal is about FLATTENING, not about the document. A blocked form
      that could not be filled either would be a dead end on a file the tool
      can perfectly well serve — measured in the engine: filling this exact
      document works and the value reads back.
    */
    const source = await formPdf({ brokenRadio: true });
    await page.goto("/fill-pdf-form");
    await uploadFixture(page, source);

    await expect(
      surface(page).getByRole("textbox", { name: "who", exact: true }),
      `read failed: ${await toolError(page)}`,
    ).toHaveValue("Ada Lovelace", { timeout: 60_000 });

    await expect.poll(() => statValue(page, "FLATTEN")).toBe("BLOCKED");
    const flattenBox = surface(page).getByRole("checkbox", { name: "Also flatten the form" });
    await expect(flattenBox).toBeDisabled();
    await expect(surface(page).getByText(/Flattening is not available for this document/))
      .toBeVisible();
    await expect(surface(page).getByText(/delivery/).first()).toBeVisible();
    await expect(surface(page).getByText(/Filling still works/)).toBeVisible();

    await surface(page).getByRole("textbox", { name: "who", exact: true }).fill("Grace Hopper");
    const action = primaryAction(page, /^Fill form$/);
    await expect(action).toBeEnabled();
    await action.click();

    const dl = downloadAffordance(page);
    await expect(dl, `fill failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
    const { bytes } = await captureDownload(page, dl);

    await assertPdf(bytes, { pages: 1 });
    const doc = await loadPdf(bytes);
    const form = doc.getForm();
    expect(form.getTextField("who").getText()).toBe("Grace Hopper");
    // Still interactive: the delivery group is still there, still unflattened.
    expect(form.getFields().map((f) => f.getName()).sort()).toContain("delivery");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// remove-metadata — the PDF path
// ────────────────────────────────────────────────────────────────────────────

test.describe("remove-metadata — real output", () => {
  test("a document loses its properties AND its XMP packets, not just one of the two", async ({
    page,
  }) => {
    const source = await metadataPdf();

    /*
      TWO CONTROLS, and the second is the one that makes the XMP half of this
      test evidence rather than an artefact.

      · The XMP marker IS findable in the source bytes. An unfiltered
        PDFRawStream is written verbatim, so its absence from the download
        below means the stream is gone rather than merely compressed.
      · The /Info title is NOT findable in EITHER file — pdf-lib writes /Info
        strings as UTF-16BE hex (`<FEFF0051...>`), so "Quarterly numbers" is
        never in the bytes at all. That is why the /Info assertions below go
        through the dictionary and never through a scan.
    */
    expect(
      source.buffer.includes(XMP_MARKER),
      "the source must really carry an XMP packet in its bytes",
    ).toBe(true);
    expect(source.buffer.includes("Quarterly numbers")).toBe(false);
    expect(await savedXmpHolders(source.buffer)).toBe(3);
    expect(await savedInfoKeys(source.buffer)).toEqual([
      "/Author",
      "/CreationDate",
      "/Creator",
      "/Keywords",
      "/ModDate",
      "/Producer",
      "/Subject",
      "/Title",
    ]);

    await page.goto("/remove-metadata");
    await uploadFixture(page, source);

    // What the page found — both kinds, counted separately.
    await expect
      .poll(() => statValue(page, "INFO FIELDS"), { timeout: 60_000 })
      .toBe("8");
    expect(await statValue(page, "XMP PACKETS")).toBe("3");
    await expect(surface(page).getByText("Ada Lovelace")).toBeVisible();
    await expect(surface(page).getByText("Quarterly numbers")).toBeVisible();

    /*
      This page's primary hands the file to the browser in the same gesture
      that produces it (`triggerDownload` inside the run), which is the whole
      point of the tool — so the download is captured off the PRIMARY, not off
      a Download button that appears afterwards.
    */
    const { name, bytes } = await captureDownload(
      page,
      primaryAction(page, /^Remove metadata and download$/),
    );

    expect(name).toBe("quarterly-clean.pdf");
    await assertPdf(bytes, { pages: 1 });

    // Half one: /Info is DELETED, not blanked. pdf-lib's setters write
    // `<FEFF>` — a lone byte-order mark — for an empty value, so an emptied
    // /Title is still a /Title, and only the key list can tell the difference.
    expect(await savedInfoKeys(bytes), "every /Info key must be gone, not emptied").toEqual([]);

    // Half two: and every XMP packet with it. An /Info-only clean passes the
    // assertion above and still hands back a document naming its author.
    expect(await savedXmpHolders(bytes), "no object may still hang an XMP stream").toBe(0);
    expect(
      bytes.includes(XMP_MARKER),
      "the XMP bytes must leave the file, not merely be unreferenced",
    ).toBe(false);

    // Nothing about the page changed: the text and the embedded image stay.
    expect(await pageContent(bytes, 0)).toContain(`<${winAnsiHex("body")}> Tj`);
    expect(
      Object.keys(await pageXObjects(bytes, 0)).some((n) => n.startsWith("/Image")),
    ).toBe(true);

    // And the page's own re-read of the download says the same thing.
    await expect(
      surface(page).getByText(
        "RE-READ FROM THE DOWNLOAD: NO /INFO ENTRIES AND NO XMP PACKETS LEFT",
      ),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("a photograph comes back without its EXIF block", async ({ page }) => {
    const source = await SAMPLES.jpg();
    expect(
      hasExifSegment(source.buffer),
      "the fixture must start with an Exif APP1 segment",
    ).toBe(true);

    await page.goto("/remove-metadata");
    await uploadFixture(page, source);

    await expect
      .poll(() => statValue(page, "LOCATION"), { timeout: 60_000 })
      .toBe("PRESENT");
    expect(Number(await statValue(page, "TAGS FOUND"))).toBeGreaterThan(0);

    const { name, bytes } = await captureDownload(
      page,
      primaryAction(page, /^Remove metadata and download$/),
    );

    expect(name).toBe("sample-photo-clean.jpg");
    assertJpeg(bytes);
    /*
      The assertion the tool exists for, and the reason it must run in WebKit
      too: "re-encode through a canvas" is NOT on its own a guarantee, because
      Safari's JPEG encoder writes a fresh Exif APP1 of its own into the file
      it produces. `stripExifData` sweeps APP1 out of the encoded bytes
      afterwards, and this is what notices if that sweep is ever dropped.
    */
    expect(
      hasExifSegment(bytes),
      "the cleaned photograph must carry no Exif APP1 segment",
    ).toBe(false);
    // …and no APP1 of ANY kind, which is where an XMP packet would ride too.
    expect(countApp1Segments(source.buffer), "the fixture must carry an APP1 to lose").toBe(1);
    expect(countApp1Segments(bytes), "every APP1 segment must be swept out").toBe(0);

    // The picture itself survived the round trip intact.
    expect(await probeImageInPage(page, bytes, "image/jpeg")).toEqual({
      width: 800,
      height: 600,
    });

    /*
      The page's own re-read of the download, and this is where the honest
      answer is NOT "nothing left".

      MEASURED in Chromium on this fixture: the line reads "14 TAGS LEFT IN
      COLOUR PROFILE". That is not a leak and not a bug — the sweep drops APP1
      and deliberately leaves APP0/APP2, because JFIF and the colour profile
      say how to DRAW the picture rather than where it came from, and the ICC
      block in the output is the one this browser's encoder just wrote, not the
      source's (the canvas works in sRGB and carries nothing across). WebKit's
      encoder may write no profile at all, in which case the same code path
      prints the "nothing left" sentence.

      So the assertion is written as the property that actually matters and
      holds in both engines: the reader may still see a colour profile, and it
      may see NOTHING ELSE. `EXIF`, `GPS`, `IPTC` or `XMP` appearing in that
      list is the failure, and asserting the flat "no tags left" string instead
      would have made this test browser-specific rather than true.
    */
    const reread = surface(page).getByText(/^RE-READ FROM THE DOWNLOAD WITH THE SAME READER:/);
    await expect(reread).toBeVisible({ timeout: 60_000 });
    expect(await reread.textContent()).toMatch(
      /^RE-READ FROM THE DOWNLOAD WITH THE SAME READER: (NO EXIF, GPS, IPTC, XMP OR COLOUR-PROFILE TAGS LEFT|\d+ TAGS? LEFT IN COLOUR PROFILE)$/,
    );

    // The location warning went with the tags it was attached to.
    await expect(surface(page).getByText(/Contains location data/i)).toHaveCount(0);
  });
});
