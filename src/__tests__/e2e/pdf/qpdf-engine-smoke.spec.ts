import { test, expect, type Page } from "@playwright/test";
import {
  SAMPLES,
  captureDownload,
  downloadAffordance,
  toolError,
  uploadFixture,
  watchQpdfRequests,
} from "../conversion/support";
import { assertEncryptedPdf } from "../conversion/validators";

/**
 * THE ONE GATE CI RUNS THAT ACTUALLY LOADS THE qpdf ENGINE.
 *
 * protect-pdf, unlock-pdf, pdf-permissions and repair-pdf are the only tools on
 * the site backed by a fetched WebAssembly engine (`/qpdf.js` + a 2.3 MB
 * `/qpdf.wasm`, staged into `public/` out of `vendor/qpdf/` by `copy:wasm`).
 * Their functional coverage lives in `conversion/pdf-security.spec.ts`, which is
 * in the opt-in `conversion` project — and the default project, the only one
 * `npm run test:e2e` and therefore CI runs, carries `testIgnore: /conversion\//`.
 * So before this file existed, every gate CI ran was blind to the engine:
 *
 *   - the unit suite cannot run WASM at all;
 *   - `qpdf-artifact.test.ts` reads `vendor/qpdf/*` and never checks that
 *     anything reached `public/`;
 *   - the all-tools and responsive sweeps load the four routes but never drop a
 *     file, and the engine is not touched until a file is dropped — measured:
 *     with `/qpdf.wasm` 404ing there are ZERO console errors at page load.
 *
 * Drop the `cp vendor/qpdf/qpdf.js vendor/qpdf/qpdf.wasm public/` clause from
 * the long `copy:wasm` one-liner, and lint, tsc, the unit suite and the whole
 * default E2E run all stayed green while the four tools shipped dead.
 *
 * This case exists to be the thing that goes red then, so it asserts the two
 * facts nothing else does — that the engine was served from our own origin, and
 * that the BYTES that came back are genuinely encrypted. A "Download" button
 * appearing is explicitly not enough: that is the state a tool reaches over any
 * blob at all.
 *
 * Deliberately ONE case and one document. This runs on every push, so it buys
 * the smallest end-to-end proof that the engine loads and produces output;
 * wrong passwords, restrictions, repair and the reader-level "will this open"
 * claims stay in the conversion suite, which owns them.
 *
 * `assertEncryptedPdf` rather than `assertPdf` is not a style choice: pdf-lib
 * cannot parse an AES-256 document even with `ignoreEncryption: true` (measured:
 * it throws "Expected instance of PDFDict, but got instance of undefined"), so
 * routing encrypted output through the ordinary PDF validator would fail on a
 * perfectly good file.
 */

/** Spaces are deliberate: `callMain` takes a real argv, there is no shell. */
const PASSWORD = "smoke battery staple";

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/**
 * Record any qpdf engine request the server refused.
 *
 * `watchQpdfRequests` answers "where did the engine come from"; this answers
 * "was it actually there", which is the deploy failure this file exists for. It
 * matters because the two are indistinguishable at the assertion that would
 * otherwise catch a missing artifact: without it a 404 shows up only as a
 * primary button that never becomes enabled, i.e. a timeout with no cause in
 * it. With it, the poll below fails in seconds naming the URL and the status.
 *
 * Listens on the page AND the context because `qpdf.js` / `qpdf.wasm` are
 * fetched from inside the worker; the dedupe makes hearing both harmless.
 */
function watchEngineFailures(page: Page): string[] {
  const failures: string[] = [];
  const record = (url: string, status: number) => {
    if (!/\/qpdf\.(js|wasm)(\?|#|$)/.test(url) || status < 400) return;
    const line = `${new URL(url).pathname} → HTTP ${status}`;
    if (!failures.includes(line)) failures.push(line);
  };
  page.on("response", (response) => record(response.url(), response.status()));
  page.context().on("response", (response) => record(response.url(), response.status()));
  return failures;
}

test.describe("the PDF security engine is reachable and does its job", () => {
  test("protect-pdf loads qpdf from this origin and hands back an encrypted document", async ({
    page,
  }) => {
    /*
      Explicitly generous rather than left on the default 30s. Nothing here is
      slow — a 2.3 MB same-origin wasm plus a 5 KB document — but CI runs with
      `workers: 1` on a cold browser cache and two retries, and a smoke test
      that goes yellow is worth less than one that goes red honestly.
    */
    test.setTimeout(120_000);

    const source = await SAMPLES.pdf();
    // Without this the assertion below could be satisfied by a tool that handed
    // the input straight back, which is exactly what a dead engine cannot be
    // allowed to look like.
    expect(
      source.buffer.toString("latin1"),
      "the fixture must start out unencrypted or this test proves nothing",
    ).not.toContain("/Encrypt");

    // Both watchers go on before the navigation: the engine is fetched by the
    // pre-flight probe that fires the moment a file is dropped.
    const engineFailures = watchEngineFailures(page);
    const watch = watchQpdfRequests(page);

    await page.goto("/protect-pdf");
    await uploadFixture(page, source);

    const surface = surfaceOf(page);
    const run = surface.getByRole("button", { name: "Protect PDF", exact: true }).first();
    await expect(run, "protect-pdf never rendered its primary action").toBeVisible({
      timeout: 60_000,
    });

    // `QpdfPasswordField` is a bare `input type="password"` with an aria-label
    // and no visible <label>, so the input's own type is the locator. One value
    // in both boxes is what the tool wants — the password and its confirmation
    // have to match.
    const fields = surface.locator('input[type="password"]');
    const fieldCount = await fields.count();
    expect(fieldCount, "protect-pdf must offer a password field").toBeGreaterThan(0);
    for (let i = 0; i < fieldCount; i++) await fields.nth(i).fill(PASSWORD);

    /*
      Both waits below poll for a SETTLED state and then assert what it settled
      on, rather than polling until it equals "ready". The difference matters
      when the engine is missing: the shell disables the primary for good and
      shows a pre-flight error, and a poll for "ready" would sit out its whole
      timeout before reporting a failure it knew about in the first second.
      Measured with `public/qpdf.wasm` moved aside: 60s of waiting this way,
      ~2s the way it is written now, for the same message.

      `null` means "still working". Readiness is checked before the error so a
      finished run cannot be pre-empted by a stale alert.
    */
    const settled = async (ready: () => Promise<boolean>): Promise<string | null> => {
      if (engineFailures.length > 0) return `engine fetch failed: ${engineFailures.join(", ")}`;
      if (await ready()) return "ready";
      return await toolError(page);
    };

    const preflight = () => settled(() => run.isEnabled());
    await expect
      .poll(preflight, {
        message: "the qpdf pre-flight neither finished nor failed",
        timeout: 60_000,
      })
      .not.toBeNull();
    expect(
      await preflight(),
      "the qpdf pre-flight must finish and leave the tool runnable",
    ).toBe("ready");

    await run.click();

    const dl = downloadAffordance(page);
    const encrypted = async () => settled(async () => (await dl.count()) > 0);
    await expect
      .poll(encrypted, {
        message: "protect-pdf neither produced a download nor reported a failure",
        timeout: 90_000,
      })
      .not.toBeNull();
    expect(await encrypted(), "protect-pdf must produce a document to download").toBe("ready");

    expect(
      engineFailures,
      "every qpdf engine request must be served — a missing public/qpdf.wasm is a dead tool",
    ).toEqual([]);

    const { name, bytes } = await captureDownload(page, dl);
    expect(name).toBe("sample-doc-protected.pdf");

    /*
      The real assertion. `assertEncryptedPdf` checks the header, the %%EOF, the
      trailer's /Encrypt reference and the standard security handler, then reads
      the algorithm out of the encryption dictionary itself. AES-256 is V 5 /
      R 6 and is this tool's default; the permission word is asserted only to
      exist, because which bits it clears is the conversion suite's business,
      not this gate's.
    */
    const info = assertEncryptedPdf(bytes);
    expect(info.v, "the default is AES-256, written as V 5").toBe(5);
    expect(info.r, "AES-256 is revision 6").toBe(6);
    expect(info.p, "an encryption dictionary must carry a permission word").not.toBeNull();
    expect(bytes.length, "the output must be a real document, not a stub").toBeGreaterThan(1024);

    // And the engine came from us: fails both when it was fetched from a
    // foreign origin and when it was never fetched at all.
    watch.assertSelfHostedAndUsed();
  });
});
