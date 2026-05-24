import { test, expect } from "@playwright/test";
import { uploadFile } from "../helpers";

/**
 * /markdown-to-pdf — paste/upload Markdown, get a styled PDF via the browser
 * print dialog. We can't assert final PDF contents (the dialog isn't
 * scriptable), so coverage stops at:
 *   - the live preview rendering correctly,
 *   - the Export click invoking `window.print` from inside the hidden iframe.
 */

test.describe("markdown-to-pdf", () => {
  test("page smoke: H1, FAQ count, related tools, no console errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/markdown-to-pdf");

    // Single H1 carrying the registry-defined headline.
    const h1 = page.locator("h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(/Convert Markdown to PDF/i);

    // FAQ section: 5 bespoke FAQs + 1 PRIVACY_FAQ = 6 details.
    await expect(page.locator("details")).toHaveCount(6);

    // Related tools surface the registry cross-links.
    await expect(
      page.getByRole("link", { name: /Markdown to HTML/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Merge PDF/i }),
    ).toBeVisible();

    // No console errors during initial render.
    expect(consoleErrors, consoleErrors.join("\n")).toHaveLength(0);
  });

  test("paste mode: typing markdown updates the live preview", async ({ page }) => {
    await page.goto("/markdown-to-pdf");

    const editor = page.getByLabel("Markdown source");
    await editor.fill("# Hello world\n\nThis is **bold** with `code`.");

    const preview = page.getByTestId("markdown-pdf-preview");
    await expect(preview.locator("h1")).toHaveText("Hello world");
    await expect(preview.locator("strong")).toHaveText("bold");
    await expect(preview.locator("code")).toHaveText("code");
  });

  test("upload mode: dropping a .md file populates markdown and preview", async ({
    page,
  }) => {
    await page.goto("/markdown-to-pdf");

    // Switch to upload tab and drop a file.
    await page.getByRole("tab", { name: /Upload/i }).click();

    const md = "# From file\n\nUploaded body content.";
    await uploadFile(page, {
      name: "sample.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(md, "utf-8"),
    });

    const preview = page.getByTestId("markdown-pdf-preview");
    await expect(preview.locator("h1")).toHaveText("From file");
    await expect(preview).toContainText("Uploaded body content.");
  });

  test("Export to PDF button stays disabled when input is empty", async ({
    page,
  }) => {
    await page.goto("/markdown-to-pdf");
    const exportBtn = page.getByRole("button", { name: /Export to PDF/i });
    await expect(exportBtn).toBeDisabled();
    await page.getByLabel("Markdown source").fill("Anything.");
    await expect(exportBtn).toBeEnabled();
  });

  test("Export to PDF invokes window.print inside the hidden iframe", async ({
    page,
  }) => {
    await page.goto("/markdown-to-pdf");

    // Patch the parent's HTMLIFrameElement *after* the page boots so the
    // override applies to the dynamically-mounted PrintFrame iframe. The
    // patched print() flips a parent-visible flag and then fires `afterprint`
    // synchronously so the React parent un-mounts the iframe — mirroring the
    // user pressing Cancel in the print dialog.
    await page.evaluate(() => {
      (window as unknown as { __printInvoked?: boolean }).__printInvoked = false;
      const desc = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        "contentWindow",
      );
      if (!desc?.get) return;
      const origGet = desc.get;
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        configurable: true,
        get(this: HTMLIFrameElement) {
          const win = origGet.call(this) as Window | null;
          if (win && !(win as unknown as { __patchedPrint?: boolean }).__patchedPrint) {
            (win as unknown as { __patchedPrint: boolean }).__patchedPrint = true;
            try {
              win.print = () => {
                (window as unknown as { __printInvoked: boolean }).__printInvoked = true;
                win.dispatchEvent(new Event("afterprint"));
              };
            } catch {
              /* cross-origin iframe — irrelevant here */
            }
          }
          return win;
        },
      });
    });

    await page.getByLabel("Markdown source").fill("# Hello\n\nBody paragraph.");

    const exportBtn = page.getByRole("button", { name: /Export to PDF/i });
    await expect(exportBtn).toBeEnabled();
    await exportBtn.click();

    // win.print() should be invoked inside the hidden iframe shortly after
    // Export is clicked — the iframe itself unmounts on `afterprint`, so we
    // can't observe it directly. The parent-visible flag is the contract.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __printInvoked?: boolean }).__printInvoked === true,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
