import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * The engine-disclosure gate.
 *
 * Two pages make a promise about what this site downloads:
 *
 *   - the homepage table, framed as exhaustive ("No black box. These are the
 *     engines compiled into the page, and what each one costs you on first
 *     use") with a DOWNLOAD and a LOADED column;
 *   - the privacy policy's "External resources" section, which enumerates
 *     every library a tool fetches.
 *
 * Both were written when the PDF tools were pure JavaScript, and both survived
 * the arrival of a 2.3 MB WebAssembly engine — the privacy policy still said
 * "The PDF tools no longer pull a WebAssembly engine at all", and the homepage
 * table had no qpdf row. A third surface, a long-form post that walked a
 * reader through the same check in the Network tab, was wrong in the same way
 * and has since been deleted along with the rest of that section. A reader
 * with DevTools open would have caught all of them in about thirty seconds; no
 * test would have.
 *
 * This is that test. It reads the SHIPPED BYTES out of vendor/qpdf/ and checks
 * the copy against them, so the disclosure cannot drift from the artifact —
 * rebuild qpdf at a different size and the homepage's DOWNLOAD figure goes red
 * until someone updates it.
 *
 * Every negative assertion below is paired with a positive one. A negative
 * search ("the false sentence is gone") passes identically on a file that
 * failed to load, an empty read, or a typo'd path — the same trap
 * qpdf-artifact.test.ts documents at length. The `it("reads its sources")`
 * case, and the substring assertions in each block, are what make the
 * negatives mean something.
 */

const root = process.cwd();
const HOMEPAGE = resolve(root, "src/app/page.tsx");
const PRIVACY = resolve(root, "src/app/privacy/page.tsx");
const LICENSES = resolve(root, "src/app/licenses/page.tsx");
const QPDF_GLUE = resolve(root, "vendor/qpdf/qpdf.js");
const QPDF_WASM = resolve(root, "vendor/qpdf/qpdf.wasm");

/*
 * The two engines the developer hub gained on 2026-09-05. Both are read from
 * the exact paths `npm run copy:wasm` copies into public/, so the disclosure is
 * pinned to the artifact the build actually serves rather than to a number
 * somebody typed. Bump either package and the homepage figure goes red until it
 * is updated — the same mechanism the qpdf block above uses, one directory over.
 */
const ZXING_WASM = resolve(root, "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const LIBARCHIVE_WASM = resolve(root, "node_modules/libarchive-wasm/dist/libarchive.wasm");

const homepage = readFileSync(HOMEPAGE, "utf8");
const licenses = readFileSync(LICENSES, "utf8");
const privacy = readFileSync(PRIVACY, "utf8");

const glueBytes = statSync(QPDF_GLUE).size;
const wasmBytes = statSync(QPDF_WASM).size;

/*
 * The homepage DOWNLOAD column is binary-prefix and one decimal place —
 * measured against the rows that were already there: the HEIC decoder is
 * 1,513,632 B and reads "1.4 MB" (1.44 MiB; decimal would be 1.5), and the MP3
 * encoder is 231,475 B and reads "226 KB" (226.1 KiB; decimal would be 231).
 * A new row has to use the same ruler or the column stops being comparable.
 *
 * This comment is also where an error once lived, and the shape of it is worth
 * keeping. The MP3 row used to be lamejs at 259,508 B, the figure read
 * "254 KB", and this comment computed 253.4 KiB and then wrote 254 — so the
 * row being cited as the reference for the ruler was itself off by one. Both
 * vendored rows are pinned to their artifacts below now; they were the last
 * two ENGINES rows quoting a number nothing checked, which is exactly how that
 * one drifted. Do not reintroduce a hand-written byte count here: every figure
 * in this comment is derived from a `statSync` below, and the prose is only a
 * restatement of it.
 *
 * The figure is the PAIR, because a browser never fetches one without the
 * other: qpdf.js is the loader that instantiates qpdf.wasm.
 */
const expectedHomepageSize = `${((glueBytes + wasmBytes) / 1024 / 1024).toFixed(1)} MB`;

const zxingBytes = statSync(ZXING_WASM).size;
const libarchiveBytes = statSync(LIBARCHIVE_WASM).size;

/*
 * The two LGPL libraries are served from /vendor/ rather than bundled, which
 * is what keeps them replaceable — so like every other served artifact their
 * disclosed size is checkable, and until now neither was checked. They are
 * measured where copy:wasm reads them FROM (node_modules), not where it writes
 * them to, so the assertion holds on a clean checkout before any build.
 */
/*
 * The MP3 encoder is TWO files and the disclosed figure is their sum, for the
 * same reason the HEIC decoder below is: the glue resolves its binary as
 * `new URL("libmp3lame.wasm", import.meta.url)`, so a browser that fetches one
 * fetches both, and quoting the glue alone would understate the download by
 * 28x. Measured in vendor/ rather than node_modules because, unlike every
 * other served artifact here, we compile this one ourselves — see
 * scripts/build-libmp3lame-wasm.sh. It replaced lamejs (a pure-JavaScript port
 * of the same library, 259,508 B / "253 KB") on 2026-11-11.
 */
const LIBMP3LAME_FILES = [
  "vendor/libmp3lame/libmp3lame.js",
  "vendor/libmp3lame/libmp3lame.wasm",
];
/*
 * The HEIC decoder is TWO files and the disclosed figure is their sum, for the
 * same reason the OCR bundle below is five: image-convert.ts's loadLibheif()
 * fetches the glue and then hands it the binary itself, so a browser that
 * fetches one fetches both. Quoting the glue alone would understate the
 * download by 16x.
 */
const LIBHEIF_FILES = [
  "node_modules/libheif-js/libheif-wasm/libheif.js",
  "node_modules/libheif-js/libheif-wasm/libheif.wasm",
];
const libmp3lameBytes = LIBMP3LAME_FILES.reduce(
  (sum, f) => sum + statSync(resolve(root, f)).size,
  0,
);

/*
 * The OCR bundle is FIVE files, and the disclosed figure is their sum, because
 * a browser that fetches one fetches all five: the page loads the library, the
 * library spawns the worker, the worker pulls the core, the core pulls its
 * binary and the model. Quoting any one of them would understate the download
 * by between 2 and 80 times.
 *
 * The model is measured in vendor/ rather than node_modules — it has no npm
 * package, which is why it is checked in — and the other four where copy:wasm
 * reads them from, so all five hold on a clean checkout before any build.
 */
const TESSERACT_FILES = [
  "node_modules/tesseract.js/dist/tesseract.esm.min.js",
  "node_modules/tesseract.js/dist/worker.min.js",
  "node_modules/tesseract.js-core/tesseract-core-simd-lstm.js",
  "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm",
  "vendor/tessdata/eng.traineddata.gz",
];
const tesseractBytes = TESSERACT_FILES.reduce(
  (sum, f) => sum + statSync(resolve(root, f)).size,
  0,
);
const expectedTesseractSize = `${(tesseractBytes / 1024 / 1024).toFixed(1)} MB`;
const libheifBytes = LIBHEIF_FILES.reduce((sum, f) => sum + statSync(resolve(root, f)).size, 0);
const expectedLibmp3lameSize = `${Math.round(libmp3lameBytes / 1024)} KB`;
const expectedLibheifSize = `${(libheifBytes / 1024 / 1024).toFixed(1)} MB`;

/*
 * Same ruler, one artifact each.
 *
 * qpdf's figure is a PAIR because both halves are separately served files:
 * /qpdf.js is fetched to instantiate /qpdf.wasm. These two are not. copy:wasm
 * stages exactly one file per engine — the .wasm — and their JavaScript loaders
 * are bundled into the tool's own code-split chunk. So the figure is the served
 * artifact, which is also the number a reader sees against one request in the
 * Network tab.
 *
 * That choice is not cosmetic. The loaders' shipped size depends on the
 * bundler: measured with esbuild, libarchive's glue minifies to 66,712 bytes,
 * and adding it lands on 663.99 KiB — "664 KB" — while the 67,370-byte figure a
 * different measurement produced lands on 664.65, "665 KB". A disclosure whose
 * last digit turns on which bundler you asked cannot be pinned to an artifact,
 * and this file exists to pin disclosures to artifacts.
 *
 * WHAT THIS COMMENT USED TO SAY, AND WHY IT WAS THE BUG.
 * It justified the served-artifact ruler by adding that the bundled libraries
 * — "js-yaml, svgo, mammoth, bwip-js, marked, turndown, sql-formatter, diff,
 * qrcode" — have "no row in the table at all". Two of them did. `pica` and
 * `utif2` were rowed at 36 KB and 96 KB while `bwip-js` was excluded at
 * 947,409, on one mechanism (`await import(...)` out of a tool module) given
 * two verdicts. The rows are gone, the rule is stated at the top of `ENGINES`,
 * and `describe("bundled libraries")` below is what stops it drifting back.
 */
const expectedZxingSize = `${(zxingBytes / 1024 / 1024).toFixed(1)} MB`;
const expectedLibarchiveSize = `${Math.round(libarchiveBytes / 1024)} KB`;

/** `{ name: "qpdf", handles: "…", size: "…", when: "…" }` in the ENGINES table. */
const QPDF_ROW =
  /\{\s*name:\s*"qpdf",\s*handles:\s*"([^"]+)",\s*size:\s*"([^"]+)",\s*when:\s*"([^"]+)"\s*\}/;

/**
 * The same shape for any row. The key ORDER is load-bearing: the hub-claims
 * parser requires `name, handles, size` too, and a row written in another order
 * parses as absent and fails as "no ENGINES row named X" — which reads like a
 * typo in the name rather than a formatting mistake.
 */
const engineRow = (name: string) =>
  new RegExp(
    `\\{\\s*name:\\s*"${name}",\\s*handles:\\s*"([^"]+)",\\s*size:\\s*"([^"]+)",\\s*when:\\s*"([^"]+)"\\s*\\}`,
  );

/*
 * Every .ts/.tsx under src/lib and src/components, with comments stripped.
 *
 * Comment-stripping is the same trick file-input-claims.test.ts and
 * size-claims.test.ts use, and it matters more here than anywhere: the correct
 * WebAssembly loader is the one that QUOTES the CDN URL in a comment to explain
 * why it overrides it, so scanning raw text would fail exactly the file that got
 * it right. The bundled-library cases below use the same list to prove that a
 * library named in a disclosure is a library this site really imports.
 */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sourceText = [resolve(root, "src/lib"), resolve(root, "src/components")]
  .flatMap(sourceFiles)
  .map((file) => [file, codeOnly(readFileSync(file, "utf8"))] as const);

describe("engine disclosure", () => {
  it("reads its sources", () => {
    // The positive control for every negative assertion below.
    expect(homepage.length).toBeGreaterThan(1000);
    expect(privacy.length).toBeGreaterThan(1000);
    expect(glueBytes).toBeGreaterThan(0);
    expect(wasmBytes).toBeGreaterThan(0);
    // The two artifacts copy:wasm stages into the origin root. If either path
    // moves in a package upgrade, the copy step is broken and every size
    // assertion below is measuring nothing — so they are read here first.
    expect(zxingBytes, `${ZXING_WASM} is missing — copy:wasm copies this file`).toBeGreaterThan(0);
    expect(
      libarchiveBytes,
      `${LIBARCHIVE_WASM} is missing — copy:wasm copies this file`,
    ).toBeGreaterThan(0);
    // The pages this file is about, identified by the promises they make.
    expect(homepage).toContain("Every engine this site serves you as its own file");
    expect(licenses.length).toBeGreaterThan(1000);
    expect(privacy).toContain("External resources");
  });

  describe("homepage ENGINES table", () => {
    it("carries a qpdf row", () => {
      expect(
        QPDF_ROW.test(homepage),
        "the table is framed as exhaustive, so every engine with a download needs a row",
      ).toBe(true);
    });

    it("quotes the size of the artifact actually vendored", () => {
      const [, , size] = QPDF_ROW.exec(homepage) ?? [];
      expect(size, "no qpdf row to read a size from").toBeDefined();
      expect(
        size,
        `vendor/qpdf is ${glueBytes} + ${wasmBytes} bytes, which is ${expectedHomepageSize}`,
      ).toBe(expectedHomepageSize);
    });

    it("does not file qpdf under the free, already-loaded engines", () => {
      const [, handles, size, when] = QPDF_ROW.exec(homepage) ?? [];
      expect(size).not.toBe("0 KB");
      expect(when).not.toBe("BUILT IN");
      // The row has to say which tools pay for it, or the LOADED value is
      // unreadable — there are two "ON FIRST USE" rows.
      expect(handles?.toLowerCase()).toMatch(/password|protect|encrypt/);
    });

    it("no longer claims the PDF engines are free", () => {
      // The file's own comment, left over from the MuPDF removal.
      expect(homepage).not.toContain("There is no PDF engine row with a download");
      // pdf-lib does not do encryption, decryption, permissions or repair — it
      // cannot even parse an AES-256 document (see lib/tools/qpdf.ts).
      expect(homepage).not.toContain("Every PDF page and document operation");
    });

    /*
       The developer hub used to fetch nothing, and both the table and
       /developer-tools said so. /qr-code-reader and /extract-archive ended
       that. Each engine gets the same four checks qpdf gets: the row parses,
       the size matches the artifact copy:wasm stages, it is not filed under
       the free built-in engines, and `handles` says which tools pay for it —
       there are now four rows whose LOADED column is some flavour of "on first
       use", so the name alone no longer identifies who is charged.
    */
    it.each([
      ["zxing-wasm", () => expectedZxingSize, zxingBytes, /qr|barcode|scan/i, "SCAN"],
      ["libarchive", () => expectedLibarchiveSize, libarchiveBytes, /archive|tar|7z|rar/i, "ARCHIVE"],
      ["libmp3lame", () => expectedLibmp3lameSize, libmp3lameBytes, /mp3/i, "MP3"],
      ["libheif", () => expectedLibheifSize, libheifBytes, /heic/i, "HEIC"],
      ["Tesseract", () => expectedTesseractSize, tesseractBytes, /text|ocr|scan/i, "OCR"],
    ] as const)("carries a %s row that quotes the artifact", (name, size, bytes, topic, when) => {
      const row = engineRow(name);
      expect(
        row.test(homepage),
        `no ENGINES row named ${name} in the required { name, handles, size, when } key order`,
      ).toBe(true);
      const [, handles, quoted, loaded] = row.exec(homepage)!;
      expect(quoted, `/${name} is ${bytes} bytes, which is ${size()}`).toBe(size());
      expect(quoted).not.toBe("0 KB");
      expect(loaded).not.toBe("BUILT IN");
      expect(loaded).toContain(when);
      expect(handles.toLowerCase()).toMatch(topic);
    });
  });

  describe("privacy policy, External resources", () => {
    it("names qpdf in the list of fetched libraries", () => {
      expect(privacy).toContain("qpdf");
      expect(privacy).toContain("/qpdf.wasm");
    });

    /*
       WHEN an engine is fetched is a separate claim from WHETHER one is, and
       it used to be pinned somewhere else: the privacy blog post said qpdf
       arrives on the first file read rather than on page load, and this file
       asserted over that post. The post was deleted with the rest of the blog
       on 2026-09-18. The privacy policy makes the same claim in its own words,
       so the assertion moves here rather than being dropped — the timing is the
       load-bearing half of "opening a tool hands nobody else your IP address".
    */
    it("says the engines wait for a file, not for the page", () => {
      /*
         Matched WITH its "None of the …" head, and that is the whole point:
         the bare tail "is fetched when you open the page" is equally a
         substring of the OPPOSITE claim ("each one is fetched when you open
         the page"), so a toContain on it would go green on the sentence this
         exists to forbid. The count is a `\w+` because the number-word moves
         every time an engine is added — the list-length gate below is what
         pins the word itself.
      */
      expect(privacy).toMatch(/None of the \w+ is fetched when you open the page/);
      expect(privacy).toContain("the first time one of those PDF tools actually reads a file");
    });

    it("does not deny that the PDF tools fetch a WebAssembly engine", () => {
      expect(privacy).not.toContain("The PDF tools no longer pull a WebAssembly engine at all");
      // "ships with the page" was the other half of the same false claim: the
      // pdf-lib engine is a separate bundle under /workers/, not page JS.
      expect(privacy).not.toContain("ordinary JavaScript that ships with the page");
    });

    it("keeps the claims that are still true", () => {
      // Same-origin, no third-party CDN, no third-party requests. All three
      // hold with qpdf added: it is copied into public/ by copy:wasm.
      expect(privacy).toContain("rather than a third-party CDN");
      expect(privacy).toContain("makes no third-party requests at all");
      expect(privacy).toContain("10 MB");
    });

    it("names the two developer engines and their served paths", () => {
      expect(privacy).toContain("/zxing_reader.wasm");
      expect(privacy).toContain("/libarchive.wasm");
    });

    it("quotes their exact byte counts, not a rounded figure", () => {
      // The homepage rounds because it is a comparison table. This page is the
      // one a reader checks against DevTools, so it gets the real numbers —
      // read off the same files copy:wasm stages.
      expect(privacy).toContain(zxingBytes.toLocaleString("en-US"));
      expect(privacy).toContain(libarchiveBytes.toLocaleString("en-US"));
    });

    it("discloses that both packages default to a CDN and are overridden", () => {
      /*
         This is the sentence the section's opening promise now rests on. Both
         npm packages resolve their WebAssembly to a public CDN unless told
         otherwise — zxing-wasm has jsDelivr's address in its loader — so
         "every one of those files comes from this domain rather than a
         third-party CDN" is only true because two loaders override it. A
         reader who cannot see that stated has no way to tell the promise from
         a lucky default.
      */
      expect(privacy).toContain("jsDelivr");
      expect(privacy.toLowerCase()).toMatch(/same-origin|this origin|from this domain/);
    });

    it("does not claim the developer tools fetch nothing", () => {
      // The claim /developer-tools carried until this commit, in the words the
      // category file used: it was the hub where "0 KB" was true.
      expect(privacy).not.toContain("no developer tool fetches an engine");
      expect(privacy).not.toContain("the developer tools download nothing");
    });
  });

  /*
     The gate behind the sentence above.

     The privacy page now states that the CDN address "is never contacted and
     never even constructed". That is a claim about code, not about copy, and
     the whole point of this batch's hazard note is that shipping the reader
     unconfigured would have quietly falsified the policy while every other
     test stayed green. So the loaders are scanned: whatever file imports these
     packages must name the same-origin path and must not carry a CDN URL.

     The scan is deliberately design-agnostic — it does not care which file the
     loader lives in — and it fails in both directions: red if no source uses
     the package at all (a vacuous pass), red if one names a foreign origin.
  */
  describe("the self-hosted WebAssembly is really self-hosted", () => {
    const sources = sourceText;

    it("reads the app sources", () => {
      // The positive control: a typo'd directory would make every negative
      // below pass over an empty list.
      expect(sources.length).toBeGreaterThan(100);
      expect(sources.some(([, text]) => text.includes("ffmpeg-core.wasm"))).toBe(true);
    });

    it.each([
      ["zxing-wasm", "zxing_reader.wasm"],
      ["libarchive-wasm", "libarchive.wasm"],
      /*
         tesseract.js is the strongest case for this scan and the one most
         able to regress quietly. It is the only engine here that defaults to
         TWO different public CDNs — one for the WebAssembly core, one for the
         language model — and dropping any of the four overrides does not
         throw: it silently starts fetching from someone else's server and the
         tool goes on working. There is nothing to notice.

         The artifact named is worker.min.js rather than the .wasm on purpose.
         `ocr.ts` never writes the .wasm's filename at all — the core glue
         resolves that itself, against worker.min.js's URL — so requiring the
         binary here would fail the loader that is written correctly.
      */
      ["tesseract", "worker.min.js"],
    ])("loads %s from this origin's own %s", (pkg, artifact) => {
      const users = sources.filter(([, text]) => text.includes(pkg));
      expect(
        users.length,
        `nothing under src/ imports ${pkg}, so this check proves nothing — is the loader written?`,
      ).toBeGreaterThan(0);

      for (const [file, text] of users) {
        // Paired positive: proves the comment-stripping left real code to
        // search, rather than emptying the file and passing on nothing.
        expect(text, `${file} is all comment after stripping`).toContain(pkg);
        expect(text, `${file} names a CDN for ${pkg}`).not.toMatch(/jsdelivr|unpkg/i);
        expect(text, `${file} builds an absolute URL to a .wasm`).not.toMatch(
          /https?:\/\/[^\s"'`]*\.wasm/i,
        );
      }

      expect(
        users.some(([, text]) => text.includes(artifact)),
        `no loader names ${artifact}, the file copy:wasm stages — where is the .wasm coming from?`,
      ).toBe(true);
      expect(
        users.some(([, text]) => text.includes("__NEXT_ROUTER_BASEPATH")),
        `the ${pkg} loader hardcodes its path instead of prefixing __NEXT_ROUTER_BASEPATH, so it breaks the day a basePath comes back`,
      ).toBe(true);
    });
  });

  /*
     THE RULE, AND THE TWO ROWS THAT BROKE IT.

     A row is an engine THIS ORIGIN SERVES AS ITS OWN FILE. `pica` and `utif2`
     were not: `await import("utif2")` in lib/tools/image-convert.ts is the
     same mechanism as `import("bwip-js/generic")` in lib/tools/barcode.ts, and
     bwip-js was excluded on exactly that mechanism while utif2 was rowed at
     "96 KB". One ruler, two verdicts, and the excluded library was 947,409
     bytes against the included one's 96 KB.

     Both directions are asserted. The negative (no bundled library has a row)
     is worthless alone — it passes on an empty table — so it is paired with
     the positive that the served engines are all still rowed.
  */
  describe("only served artifacts get a row", () => {
    const SERVED = ["qpdf", "zxing-wasm", "libarchive", "libheif", "libmp3lame", "FFmpeg WASM", "Tesseract"];
    const BUNDLED_NAMES = ["pica", "utif2", "bwip-js", "svgo", "mammoth", "jszip"];

    it("rows every engine served as its own file", () => {
      for (const name of SERVED) {
        expect(engineRow(name).test(homepage), `no ENGINES row named ${name}`).toBe(true);
      }
    });

    it.each(BUNDLED_NAMES)("gives %s no row, because it is not a served file", (name) => {
      expect(
        engineRow(name).test(homepage),
        `${name} arrives inside a tool's code-split chunk, so a DOWNLOAD figure for it would mean something different from the figure beside it`,
      ).toBe(false);
    });

    it("states the rule where the next editor will read it", () => {
      expect(homepage).toContain("THE RULE THIS COLUMN OBEYS");
      // ...and the framing sentence on the page says the same thing, so the
      // scope a reader is given matches the scope the array keeps.
      expect(homepage).toContain("Every engine this site serves you as its own file");
    });
  });

  /*
     The other half: silence is not an option either.

     /licenses said /barcode-generator "fetches nothing" while it fetched
     947,409 bytes. Dropping the pica and utif2 rows without disclosing the
     bundled libraries somewhere would have fixed the ruler by deleting the
     information, which is the wrong repair.
  */
  describe("bundled libraries are disclosed under the table", () => {
    const BUNDLED_ROW = /\{\s*name:\s*"([^"]+)",\s*size:\s*"([^"]+)",\s*where:\s*"([^"]+)"\s*\}/g;
    const bundled = [...homepage.matchAll(BUNDLED_ROW)].map(([, name, size, where]) => ({
      name,
      size,
      where,
    }));

    it("parses a BUNDLED list with the libraries that cost a real download", () => {
      // Positive control for every case below, and the specific claim the P1
      // was about: bwip-js has to be in here by name.
      expect(bundled.length).toBeGreaterThanOrEqual(4);
      expect(bundled.map((b) => b.name)).toContain("bwip-js");
      expect(bundled.map((b) => b.name)).toEqual(expect.arrayContaining(["svgo", "mammoth"]));
    });

    it.each([
      ["bwip-js", "bwip-js/generic"],
      ["svgo", "svgo/browser"],
      ["mammoth", "mammoth/mammoth.browser.min.js"],
      ["jszip", "jszip"],
    ])("%s is a library this site really imports, not a name on a page", (name, specifier) => {
      expect(bundled.some((b) => b.name === name), `${name} is not in BUNDLED`).toBe(true);
      const importers = sourceText.filter(([, text]) => text.includes(`"${specifier}"`));
      expect(
        importers.length,
        `nothing under src/ imports "${specifier}", so disclosing ${name} discloses fiction`,
      ).toBeGreaterThan(0);
    });

    it("gives every entry a non-zero size and a route it is paid on", () => {
      for (const b of bundled) {
        expect(b.size, `${b.name} has no size`).toMatch(/^[\d.]+ (KB|MB)$/);
        expect(b.size).not.toBe("0 KB");
        expect(b.where, `${b.name} does not say which page pays for it`).toMatch(/^\//);
      }
    });

    it("renders that list on the page rather than leaving it in a constant", () => {
      // A disclosure array nothing reads is the same as no disclosure.
      expect(homepage).toContain("BUNDLED_SENTENCE");
      expect(homepage).toContain("{BUNDLED_SENTENCE}");
      expect(homepage).toContain("BUNDLED, NOT SERVED");
    });
  });

  /*
     /licenses, the page that carried the P1.

     "The barcode generator draws its own symbols in JavaScript through bwip-js
     and fetches nothing." The first half is true and worth saying — no
     WebAssembly reaches that page. The second half was false by 947,409 bytes.
  */
  describe("licences page", () => {
    it("does not claim the barcode generator fetches nothing", () => {
      expect(licenses).not.toContain("through bwip-js and fetches nothing");
      expect(licenses).not.toMatch(/barcode generator[^.]*fetches nothing/);
    });

    it("says what the barcode generator actually costs", () => {
      // The paired positive: the negatives above pass on a page that lost the
      // paragraph entirely.
      expect(licenses).toContain("bwip-js");
      expect(licenses).toContain("947,409 bytes");
      expect(licenses).toContain("925 KB");
    });

    /*
       "…this build exports sixteen archive_read_support_format_* entry points
       — <list> —" presented its list as complete and named fifteen. The
       sixteenth is `archive_read_support_format_all`, the dispatcher. The
       count is checked against the SYMBOLS IN THE BINARY, and the list is
       checked against the count, so neither half can drift alone.
    */
    it("names as many archive readers as it claims, and claims what the binary exports", () => {
      const wasm = readFileSync(LIBARCHIVE_WASM).toString("latin1");
      const symbols = new Set(wasm.match(/archive_read_support_format_[a-z0-9_]+/g) ?? []);
      expect(symbols.size, "no reader symbols found — is this the right .wasm?").toBeGreaterThan(
        10,
      );

      const NUMBER_WORDS: Record<string, number> = {
        thirteen: 13,
        fourteen: 14,
        fifteen: 15,
        sixteen: 16,
        seventeen: 17,
        eighteen: 18,
      };
      const sentence = licenses.match(
        /exports (\w+) archive_read_support_format_\* entry points — ([^—]+) —/,
      );
      expect(sentence, "the archive-reader sentence is not on the page in the shape parsed").not
        .toBeNull();

      const [, word, list] = sentence!;
      expect(
        NUMBER_WORDS[word],
        `"${word}" is not a number this test knows`,
      ).toBe(symbols.size);
      expect(
        list.split(",").length,
        `the page says ${word} readers and then names ${list.split(",").length}: ${list}`,
      ).toBe(symbols.size);
    });
  });

  /*
     The libarchive row credited an engine with three formats it cannot open.

     archive-extract.ts's header, fact 3: `archive_read_support_format_raw` is
     not among the sixteen and the wrapper only exposes `..._format_all`, so a
     bare `hello.txt.gz` traps exactly like a JPEG. A lone .gz is handled by
     the browser's own DecompressionStream (`readGzipMember`) and a bare .xz or
     .bz2 is refused outright by `describeOpenFailure`.
  */
  describe("the libarchive row", () => {
    const handles = () => engineRow("libarchive").exec(homepage)?.[1] ?? "";

    it("reads the row", () => {
      expect(handles().length).toBeGreaterThan(20);
    });

    it("does not credit libarchive with bare GZ, BZ2 and XZ", () => {
      expect(handles()).not.toContain("Opening TAR, GZ, BZ2, XZ");
      expect(handles()).toContain("cannot open a bare");
    });

    it("still credits it with the compressed tars it does open", () => {
      expect(handles()).toMatch(/tar\.gz/);
      expect(handles()).toMatch(/tar\.bz2/);
      expect(handles()).toMatch(/tar\.xz/);
    });

    it("keeps the fact that the binary cannot write", () => {
      expect(handles()).toContain("cannot write an archive");
    });
  });
});
