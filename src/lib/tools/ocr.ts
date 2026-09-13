/**
 * OCR — reading the words out of a picture, entirely in the tab.
 *
 * The engine is tesseract.js 7 + tesseract.js-core 7 (both Apache-2.0),
 * SELF-HOSTED. That last word is the whole of the work here: the library ships
 * pointing at a public CDN by default — `tessdata.projectnaptha.com` for the
 * language model, jsDelivr for the core — so every one of the four paths below
 * is an override, and a dropped override does not break, it silently starts
 * talking to someone else's server. That is why the e2e guard for this engine
 * asserts BOTH that every request was same-origin AND that the engine was
 * fetched at all; a run in which nothing loaded would otherwise pass.
 *
 * Nothing here is bundled. `copy:wasm` stages five files into
 * `public/tesseract/` and this module reaches them over the network, which is
 * why `tesseract.js` is a devDependency rather than a dependency — the same
 * arrangement `@ffmpeg/core` has, and the reason both are named by hand on
 * /licenses instead of by the notices generator.
 */

/** One word Tesseract found, in SOURCE-IMAGE pixels with the origin top-left. */
export interface OcrWordBox {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** The shape `blocks` comes back in, named once so both readers share it. */
type OcrBlocks = ReadonlyArray<{
  paragraphs?: ReadonlyArray<{ lines?: ReadonlyArray<{ words?: ReadonlyArray<OcrWordBox> }> }>;
}> | null;

/**
 * What `createWorker` gives back, narrowed to the calls this file makes.
 *
 * ⚠ `output` IS THE THIRD ARGUMENT, and getting that wrong fails SILENTLY.
 * The real signature is `recognize(image, options, output, jobId)`. The second
 * argument is the Tesseract-parameter passthrough: anything it does not
 * recognise is handed to `api.SetVariable()`, which ignores an unknown key
 * without throwing or warning. So `recognize(blob, { blocks: true })` returns
 * a perfectly good `text` and `blocks: null`, and a caller that wanted word
 * boxes gets none while everything looks like it worked.
 *
 * `blocks` is off by default twice over — `createWorker` defaults `output` to
 * `{ text: true }`, and the worker's own defaults carry `blocks: false` — so
 * it has to be asked for explicitly.
 */
type TesseractWorker = {
  recognize: (
    image: Blob,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ) => Promise<{
    data: {
      text: string;
      confidence: number;
      blocks: OcrBlocks;
    };
  }>;
  terminate: () => Promise<unknown>;
};

type TesseractApi = {
  createWorker: (
    langs: string,
    oem: number,
    options: Record<string, unknown>,
  ) => Promise<TesseractWorker>;
};

/**
 * ⚠ WHAT `import()` ACTUALLY HANDS BACK, which is not what it looks like.
 *
 * `dist/tesseract.esm.min.js` is a CommonJS bundle wrapped for ESM, and its
 * ONLY export is the default: its last line is literally
 * `export { tesseract_min as default };`. There are no named exports at all,
 * so `const { createWorker } = await import(…)` compiles, type-checks, and
 * hands back `undefined` — the failure surfaces at the call as "createWorker
 * is not a function", several layers away from the import that caused it.
 *
 * This repo has been here before: the HEIC decoder hit the same class of bug
 * twice. heic2any's UMD left an EMPTY namespace and had to be read off
 * `globalThis`; libheif-js, which replaced it on 2026-09-12, leaves an empty
 * namespace AND sets no global, so image-convert.ts loads it with a script tag
 * instead. Same disease, milder form here — this default is real.
 *
 * The union is not defensive padding: it is what lets the accessor below
 * accept either shape, so a future build of the library that adds named
 * exports does not break this file.
 */
type TesseractModule = TesseractApi | { default: TesseractApi };

function api(module: TesseractModule): TesseractApi {
  const candidate = "default" in module ? module.default : module;
  if (typeof candidate?.createWorker !== "function") {
    // Named rather than left to fail at the call site: this is the one error
    // here that means "the library's packaging changed", not "OCR went wrong".
    throw new Error("The OCR engine loaded but exposed no createWorker — its packaging changed.");
  }
  return candidate;
}

/**
 * THIS FUNCTION IS LOAD-BEARING — the same one `audio-pcm.ts` explains at
 * length for lamejs, pointed at a different directory.
 *
 * Do not inline it into the `import()` and do not make the call site a plain
 * template literal. esbuild `define`s `process.env.__NEXT_ROUTER_BASEPATH` to
 * `""`, so a bare literal would fold to "/tesseract/tesseract.esm.min.js",
 * which the bundler can resolve on disk and inline — putting the library back
 * inside a chunk and breaking the self-hosting claim at the same time.
 *
 * `attempt` is the module-map cache-buster: a failed `import()` is remembered
 * as failed for that exact specifier, and every later import of it rejects
 * without touching the network. `sw-policy.ts` matches engine URLs on PATH
 * ONLY, so `?retry=N` still classifies as an engine and still comes out of the
 * engine cache offline.
 */
function engineUrl(name: string, attempt = 0): string {
  const base = `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/tesseract/${name}`;
  return attempt === 0 ? base : `${base}?retry=${attempt}`;
}

let tesseract: Promise<TesseractModule> | null = null;
let attempts = 0;

function loadTesseract(): Promise<TesseractModule> {
  if (!tesseract) {
    tesseract = (
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ engineUrl(
          "tesseract.esm.min.js",
          attempts++,
        )
      ) as Promise<TesseractModule>
    ).catch((err) => {
      // Drop the memo as well as the specifier: a plain `??=` would replay the
      // rejected promise forever and no retry would ever reach the network.
      tesseract = null;
      throw err;
    });
  }
  return tesseract;
}

/**
 * `OEM.LSTM_ONLY`. Written as a literal because the enum lives inside the
 * module we deliberately do not import at build time.
 *
 * It has to match the MODEL: we serve the `tessdata_fast` English model, which
 * is LSTM-only and carries no legacy Tesseract component, and we serve the
 * LSTM-only engine core to match (2.86 MB against the full core's 3.45 MB).
 * Asking this build for a legacy mode would ask both halves for something
 * neither of them has.
 */
const LSTM_ONLY = 1;

/**
 * Every path tesseract.js would otherwise resolve for itself.
 *
 * ⚠ `corePath` MUST end in `.js` and MUST name the file. The library's own
 * selector is a literal two-character test — `corePath.slice(-2) === "js"` —
 * and anything else is treated as a DIRECTORY, whereupon it appends one of six
 * `*.wasm.js` names chosen by feature detection. Those are the single-file
 * builds with the binary base64'd inside them: 3.9–4.7 MB each, we would have
 * to serve all six to cover every browser, and none of them can be streamed.
 * Naming the file skips detection entirely and pins the one variant we stage.
 *
 * The variant is FIXED SIMD, and that is measured rather than assumed:
 * `WebAssembly.validate` of wasm-feature-detect's own probe module returns
 * true for fixed SIMD in Chromium, Firefox AND WebKit, while relaxed SIMD —
 * which is what the library's own auto-selection picks first in Chromium — is
 * false in WebKit. One pinned fixed-SIMD core runs everywhere the site's own
 * e2e projects run.
 *
 * ⚠ `langPath` is a DIRECTORY, and it must be the SAME directory as
 * `workerPath`. tesseract.js never hands Emscripten a `locateFile`, so the
 * core glue resolves its sibling `.wasm` against `self.location.href` — which
 * inside a worker is the URL of `worker.min.js`, not of the glue. Splitting
 * them 404s the binary and reports it as `CompileError: expected 4 bytes,
 * fell off end`, which names neither the file nor the cause.
 */
function workerOptions(
  attempt: number,
  onProgress?: (progress: OcrProgress) => void,
): Record<string, unknown> {
  return {
    /*
      `logger` is destructured out on the MAIN thread (createWorker.js:22) and
      called there (:220); it is never part of the payload posted to the
      worker, so passing a function here is safe rather than an unclonable
      value waiting to throw.
    */
    ...(onProgress
      ? {
          logger: (m: { status?: string; progress?: number }) =>
            onProgress({
              phase: m.status ?? "",
              fraction: typeof m.progress === "number" ? m.progress : 0,
            }),
        }
      : {}),
    workerPath: engineUrl("worker.min.js", attempt),
    corePath: engineUrl("tesseract-core-simd-lstm.js", attempt),
    langPath: `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/tesseract`,
    /*
      ⚠ The default is TRUE, and true is not merely against this repo's rules
      — it does not work here at all. In blob mode the worker's own URL is
      `blob:…`, `new URL(".", "blob:…")` throws, the caught error leaves the
      script directory as the empty string, and the core's request for its
      `.wasm` becomes an unresolvable bare filename. It does not reject: the
      promise from `createWorker` never settles at all.
    */
    workerBlobURL: false,
    /** We serve `eng.traineddata.gz`; the library appends `.gz` when this is on. */
    gzip: true,
    /*
      NO INDEXEDDB. Left alone, tesseract.js writes the 4.1 MB decompressed
      model into IndexedDB under the unnamespaced key "./eng.traineddata".
      Nothing leaves the device either way — but this site has ONE storage
      story, and it is the opt-in on /offline-access where every byte is named
      and counted before anything is written. A second, invisible cache would
      make that page under-report what is actually on disk, which is the same
      kind of quiet inaccuracy the rest of this repo spends its time removing.
      The HTTP cache still spares the download on a repeat visit.
    */
    cacheMethod: "none",
  };
}

/**
 * One tick from the engine's own logger.
 *
 * `phase` is tesseract.js's raw status string — "loading language traineddata",
 * "recognizing text" and so on. It is passed through rather than mapped onto a
 * fixed list because that list is the library's, not ours, and a version bump
 * that renames or adds a step would otherwise show a stale phase or none.
 */
export type OcrProgress = { phase: string; fraction: number };

export type OcrResult = {
  /** The recognised text, trailing blank lines trimmed. */
  text: string;
  /** Tesseract's own mean confidence, 0–100. Reported, never used as a gate. */
  confidence: number;
  /** True when the engine returned no printable characters at all. */
  empty: boolean;
};

/**
 * Read the text out of one image.
 *
 * The worker is created and terminated per call. That is deliberate: an OCR
 * run holds the decoded raster and the whole language model in wasm memory,
 * and a retained worker would keep both alive for the rest of the session on a
 * page a visitor may well use once.
 */
/** One page's worth of OCR: the text, and optionally where each word sat. */
export interface OcrPageResult extends OcrResult {
  /** Empty unless the session was asked for boxes. */
  readonly words: readonly OcrWordBox[];
}

/**
 * A worker held open across several images.
 *
 * ⚠ WHY THIS EXISTS. `recognizeImage` terminates its worker in a `finally`,
 * which is right for one picture and badly wrong for a 40-page document: the
 * 4.1 MB language model would be loaded, initialised and thrown away once per
 * page. A session pays that cost once.
 *
 * ⚠ THE PROGRESS SLOT IS MUTABLE ON PURPOSE. tesseract.js takes its `logger`
 * at CREATE time, not at recognize time, so a session cannot accept a
 * per-page callback as an argument — the logger installed for page 1 would go
 * on receiving page 7's ticks. One slot the session swaps before each page is
 * the only way to route them to the right caller.
 */
export interface OcrSession {
  recognize(
    image: Blob,
    options?: { onProgress?: (progress: OcrProgress) => void; words?: boolean },
  ): Promise<OcrPageResult>;
  close(): Promise<void>;
}

/** Flatten Tesseract's block → paragraph → line → word tree. */
function collectWords(data: { blocks: OcrBlocks }): OcrWordBox[] {
  const out: OcrWordBox[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (word?.text && word.bbox) out.push(word);
        }
      }
    }
  }
  return out;
}

export async function openOcrSession(): Promise<OcrSession> {
  const { createWorker } = api(await loadTesseract());
  // The slot the logger closes over; swapped per page. See the note above.
  let current: ((progress: OcrProgress) => void) | undefined;
  const worker = await createWorker(
    "eng",
    LSTM_ONLY,
    // Non-zero only after a failed load, so a retry asks for URLs the module
    // map has not already condemned. The first call is clean.
    workerOptions(Math.max(0, attempts - 1), (progress) => current?.(progress)),
  );

  return {
    async recognize(image, options = {}) {
      current = options.onProgress;
      try {
        // ⚠ `output` is the THIRD argument. As the second it is silently
        // swallowed by SetVariable and `blocks` comes back null.
        const { data } = await worker.recognize(
          image,
          {},
          options.words ? { blocks: true } : { text: true },
        );
        const text = data.text.replace(/\s+$/, "");
        return {
          text,
          confidence: data.confidence,
          empty: text.trim().length === 0,
          words: options.words ? collectWords(data) : [],
        };
      } finally {
        current = undefined;
      }
    },
    async close() {
      await worker.terminate();
    },
  };
}

export async function recognizeImage(
  image: Blob,
  options: { onProgress?: (progress: OcrProgress) => void } = {},
): Promise<OcrResult> {
  /*
    Reimplemented on the session so there is ONE place that knows how to build
    a worker. The exported name, signature and return type are unchanged, which
    is what keeps /image-to-text and its two e2e specs untouched by this.
  */
  const session = await openOcrSession();
  try {
    const { text, confidence, empty } = await session.recognize(image, {
      onProgress: options.onProgress,
    });
    return { text, confidence, empty };
  } finally {
    // Close even when recognize threw: the wasm heap is the expensive part and
    // a thrown run has already allocated it.
    await session.close();
  }
}
