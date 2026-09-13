import { test, expect, type Page } from "@playwright/test";
import { toolError, watchTesseractRequests } from "../conversion/support";

/**
 * THE ONE GATE CI RUNS THAT ACTUALLY LOADS THE OCR ENGINE.
 *
 * Written for the same reason `pdf/qpdf-engine-smoke.spec.ts` was, and the
 * reasoning there applies here unchanged: `/image-to-text`'s functional
 * coverage lives in the opt-in `conversion` project, and the default project —
 * the only one `npm run test:e2e` and therefore CI runs — carries
 * `testIgnore: /conversion\//`. Without a case in a directory the default
 * project collects, every gate CI runs is blind to this engine:
 *
 *   - the unit suite cannot execute WebAssembly at all;
 *   - `tesseract-artifact.test.ts` reads `node_modules/` and `vendor/` and
 *     never checks that anything reached `public/`;
 *   - the all-tools sweep loads the route but never drops a file, and nothing
 *     is fetched until one is dropped — that is the whole point of the
 *     disclosure on the page, and it means a 404ing engine produces no console
 *     error at page load.
 *
 * So: delete the `cp … public/tesseract/` clause from the long `copy:wasm`
 * one-liner and lint, tsc, the unit suite and the rest of the default E2E run
 * all stay green over a tool that is dead on the deployed site. This is the
 * case that goes red then.
 *
 * ⚠ IT ASSERTS THE TEXT, NOT A DOWNLOAD BUTTON. "A download appeared" is the
 * state this tool reaches over any image at all, including one it read nothing
 * from — `recognizeImage` returns the empty string for a photo of a wall
 * rather than throwing. The image below is drawn in the page so the expected
 * string is known exactly, and the assertion is that those words came back.
 *
 * Deliberately ONE case and one image. This runs on every push; skew, empty
 * results, confidence and the self-hosting guard's negative arm belong to
 * `conversion/ocr.spec.ts`, which owns them.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/** Short, unambiguous, and free of the letter pairs OCR most often confuses. */
const PHRASE = "TRANSMUTE READS THIS";

/**
 * Draw `PHRASE` as large black text on white and hand back a PNG File.
 *
 * Built in the page rather than checked in as a 29th binary fixture, which is
 * this repo's stated default for image inputs — and here it earns it twice
 * over, because the assertion is that OCR returns THESE WORDS, so the input
 * and the expectation have to be written in one place or they drift apart.
 */
async function drawTextPng(page: Page, text: string): Promise<void> {
  await page.evaluate(async (phrase) => {
    // A large, plain, well-hinted face at high contrast: the case Tesseract is
    // actually good at. Anything more adventurous would be testing the fixture.
    const FONT = "600 84px Helvetica, Arial, sans-serif";
    const PAD = 48;

    /*
      MEASURE THE TEXT, then size the canvas around it. A fixed width silently
      CLIPS the last word — measured: at 1000 px this phrase lost its tail and
      OCR returned "TRANSMUTE READS TE", which reads like an engine that cannot
      spell rather than a fixture that cut the word in half. The failure is
      worse than useless, because it looks like evidence about Tesseract.
    */
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = FONT;
    const width = Math.ceil(measure.measureText(phrase).width);

    const canvas = document.createElement("canvas");
    canvas.width = width + PAD * 2;
    canvas.height = 220;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.fillText(phrase, PAD, canvas.height / 2);

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const file = new File([blob], "phrase.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector<HTMLInputElement>('[data-tool-surface] input[type="file"]');
    if (!input) throw new Error("image-to-text rendered no file input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
}

/**
 * Record any OCR artifact the server refused.
 *
 * `watchTesseractRequests` answers "where did the engine come from"; this
 * answers "was it actually there". Without it a missing artifact surfaces only
 * as text that never arrives — a timeout with no cause in it. With it, the
 * poll below fails in seconds naming the URL and the status.
 *
 * Both listeners are load-bearing: the library and the worker script are
 * fetched by the page, the core and the model from inside the worker.
 */
function watchEngineFailures(page: Page): string[] {
  const failures: string[] = [];
  const record = (url: string, status: number) => {
    if (!url.includes("/tesseract/") || status < 400) return;
    const line = `${new URL(url).pathname} → HTTP ${status}`;
    if (!failures.includes(line)) failures.push(line);
  };
  page.on("response", (response) => record(response.url(), response.status()));
  page.context().on("response", (response) => record(response.url(), response.status()));
  return failures;
}

test.describe("the OCR engine is reachable and does its job", () => {
  test("image-to-text loads Tesseract from this origin and reads the words back", async ({
    page,
  }) => {
    /*
      Generous on purpose. 4.9 MB of same-origin engine plus a recognition pass
      is not slow, but CI runs `workers: 1` on a cold browser cache, and a
      smoke test that goes yellow is worth less than one that goes red
      honestly.
    */
    test.setTimeout(180_000);

    // Both watchers go on before the navigation: nothing is fetched until a
    // file is dropped, but installing them after `goto` is how a guard quietly
    // stops observing the thing it was written for.
    const engineFailures = watchEngineFailures(page);
    const watch = watchTesseractRequests(page);

    await page.goto("/image-to-text");

    // The page must fetch NOTHING until it is given work — the claim the tool's
    // own copy makes, and the reason a 4.9 MB engine is acceptable here at all.
    watch.assertNeverFetched("the page has been opened but no image dropped");

    /*
      Wait for the input to EXIST before evaluating into the page. The tool UI
      is a `dynamic(..., { ssr: false })` client component, so on a cold start
      the markup is there before the file input is — and without this the
      evaluate below throws "rendered no file input", which reads like a broken
      selector rather than the race it actually is. (It caught me once.)
      `state: "attached"` rather than visible: DropZone's input is deliberately
      offscreen and driven by the surrounding label.
    */
    await surfaceOf(page)
      .locator('input[type="file"]')
      .first()
      .waitFor({ state: "attached", timeout: 60_000 });

    await drawTextPng(page, PHRASE);

    const surface = surfaceOf(page);
    const output = surface.getByRole("region", { name: "Recognised text" });

    /*
      Poll for a SETTLED state and then assert what it settled on, rather than
      polling until the text appears. With the engine missing, the tool reports
      a failure in about a second; a poll for the text alone would sit out its
      whole timeout before reporting a failure it already knew about.
      `null` means "still working".
    */
    const settled = async (): Promise<string | null> => {
      if (engineFailures.length > 0) return `engine fetch failed: ${engineFailures.join(", ")}`;
      if ((await output.count()) > 0) {
        const text = (await output.first().textContent()) ?? "";
        if (text.trim().length > 0) return "ready";
      }
      return await toolError(page);
    };

    await expect
      .poll(settled, {
        message: "OCR neither produced text nor reported a failure",
        timeout: 150_000,
      })
      .not.toBeNull();
    expect(await settled(), "OCR must finish and leave text on the page").toBe("ready");

    expect(
      engineFailures,
      "every OCR artifact must be served — a missing public/tesseract/ is a dead tool",
    ).toEqual([]);

    /*
      THE ASSERTION THAT MATTERS. Compared case-insensitively and with runs of
      whitespace collapsed, because OCR decides its own line breaks and this
      case is about whether the engine read the words — not about how it laid
      them out. Anything stricter would fail on a correct read.
    */
    const recognised = ((await output.first().textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    expect(recognised, `OCR returned "${recognised}" for an image reading "${PHRASE}"`).toContain(
      PHRASE,
    );

    // …and every byte of the engine came from us. Fails equally on a foreign
    // origin and on the engine never having been fetched at all.
    watch.assertSelfHostedAndUsed();
  });
});
