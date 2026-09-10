// @vitest-environment node
/**
 * Guards on `scripts/build-workers.mjs`.
 *
 * The defect this file exists for was measured on 2026-09-10: `public/workers`
 * held 29 files / 5,815,816 bytes, of which the transitive closure of the seven
 * entry points reached only 12 files / 527,343 bytes. esbuild's `splitting:
 * true` names shared chunks after a hash of their contents, so every edit to
 * pdf-engine-core.ts wrote a NEW ~430 KB chunk beside the old one — and
 * `output: "export"` copied all 29 into `out/`, so 5,288,473 bytes of dead
 * chunk shipped in every deploy.
 *
 * These tests drive the real build against a temp directory, so they exercise
 * the same functions `npm run copy:wasm` calls rather than a re-implementation
 * of them.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  SERVICE_WORKER_ENTRY,
  SERVICE_WORKER_OUTFILE,
  WORKERS_OUTDIR,
  buildPoolWorkers,
  buildServiceWorker,
  cleanWorkersOutdir,
} from "../../../../scripts/build-workers.mjs";

/** esbuild's `format: "iife"` wrapper, with the optional strict-mode prologue. */
const IIFE_PROLOGUE = /^(?:"use strict";\s*)?\(\(\)\s*=>\s*\{/;

async function tempDir(label: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `transmute-${label}-`));
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
}

describe("buildPoolWorkers", () => {
  it("does not carry a previous build's content-hashed chunk into the next one", async () => {
    const outdir = await tempDir("pool");

    await buildPoolWorkers({ outdir });
    const first = await listFiles(outdir);
    expect(first).toContain("pdf.worker.js");

    // Exactly what an edit to pdf-engine-core.ts used to leave behind: a chunk
    // named for content that no entry point reaches any more.
    const orphan = "pdf-engine-core-ORPHAN01.js";
    await fs.writeFile(path.join(outdir, orphan), "export const stale = 1;\n");
    expect(await listFiles(outdir)).toContain(orphan);

    await buildPoolWorkers({ outdir });
    const second = await listFiles(outdir);

    expect(second).not.toContain(orphan);
    // A rebuild is exactly a rebuild: same file set, nothing accumulated.
    expect(second).toEqual(first);

    await fs.rm(outdir, { recursive: true, force: true });
  }, 30_000);

  it("emits only files the seven entry points actually reach", async () => {
    const outdir = await tempDir("closure");
    await buildPoolWorkers({ outdir });

    const files = await listFiles(outdir);
    // Follow every relative specifier out of the seven entry points; static
    // `from "./x.js"` and pdf.worker's dynamic `import("./x.js")` alike.
    const entries = [
      "image.worker.js",
      "audio-encode.worker.js",
      "pdf.worker.js",
      "pdf-image.worker.js",
      "qpdf.worker.js",
      "regex.worker.js",
      "hash.worker.js",
    ];
    const reached = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const name = queue.shift()!;
      if (reached.has(name)) continue;
      reached.add(name);
      const source = await fs.readFile(path.join(outdir, name), "utf8");
      for (const match of source.matchAll(/["'`](\.\/[^"'`]+\.js)["'`]/g)) {
        queue.push(path.basename(match[1]));
      }
    }

    expect(files.filter((f) => !reached.has(f))).toEqual([]);

    await fs.rm(outdir, { recursive: true, force: true });
  }, 30_000);
});

describe("cleanWorkersOutdir", () => {
  it("cannot reach the service worker, which ships one level up at the origin root", async () => {
    // The structural half: `public/sw.js` is not inside `public/workers`, and
    // the clean never walks out of the directory it is given.
    expect(path.dirname(SERVICE_WORKER_OUTFILE)).not.toBe(WORKERS_OUTDIR);
    expect(path.relative(WORKERS_OUTDIR, SERVICE_WORKER_OUTFILE).startsWith("..")).toBe(true);

    // The behavioural half: a sibling `sw.js` beside the outdir survives.
    const parent = await tempDir("root");
    const outdir = path.join(parent, "workers");
    await fs.mkdir(outdir);
    const sw = path.join(parent, "sw.js");
    await fs.writeFile(sw, "self.addEventListener('install', () => {});\n");
    await fs.writeFile(path.join(outdir, "hash.worker.js"), "// stale\n");

    await cleanWorkersOutdir(outdir);

    expect(await listFiles(outdir)).toEqual([]);
    await expect(fs.readFile(sw, "utf8")).resolves.toContain("addEventListener");

    await fs.rm(parent, { recursive: true, force: true });
  });

  it("removes only the top-level .js this script emits, never a subtree or a foreign file", async () => {
    const outdir = await tempDir("scope");
    await fs.mkdir(path.join(outdir, "nested"));
    await fs.writeFile(path.join(outdir, "nested", "keep.js"), "// nested\n");
    await fs.writeFile(path.join(outdir, "README.txt"), "not ours\n");
    await fs.writeFile(path.join(outdir, "chunk-AAAA1111.js"), "// ours\n");
    await fs.writeFile(path.join(outdir, "chunk-AAAA1111.js.map"), "{}\n");

    const { removed } = await cleanWorkersOutdir(outdir);

    expect(removed.sort()).toEqual(["chunk-AAAA1111.js", "chunk-AAAA1111.js.map"]);
    expect(await listFiles(outdir)).toEqual(["README.txt"]);
    await expect(fs.readFile(path.join(outdir, "nested", "keep.js"), "utf8")).resolves.toContain(
      "nested",
    );

    await fs.rm(outdir, { recursive: true, force: true });
  });

  it("is a no-op on a directory that does not exist yet (first clone)", async () => {
    const parent = await tempDir("absent");
    await expect(cleanWorkersOutdir(path.join(parent, "workers"))).resolves.toEqual({
      removed: [],
      bytes: 0,
    });
    await fs.rm(parent, { recursive: true, force: true });
  });
});

describe("buildServiceWorker", () => {
  it("skips without throwing when the source has not been written yet", async () => {
    const dir = await tempDir("sw-absent");
    const outfile = path.join(dir, "sw.js");

    await expect(
      buildServiceWorker({ entry: path.join(dir, "service-worker.ts"), outfile }),
    ).resolves.toBe("skipped");
    await expect(fs.access(outfile)).rejects.toThrow();

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("bundles to a classic-worker script, resolving @/ the same way the pool workers do", async () => {
    const dir = await tempDir("sw-present");
    const entry = path.join(dir, "service-worker.ts");
    const outfile = path.join(dir, "sw.js");
    await fs.writeFile(
      entry,
      [
        'import { abortError } from "@/lib/utils/abort";',
        "self.addEventListener('install', () => { void abortError; });",
        "",
      ].join("\n"),
    );

    await expect(buildServiceWorker({ entry, outfile })).resolves.toBe("built");

    const bundled = await fs.readFile(outfile, "utf8");
    // The `@/` alias was applied and the import inlined — a bare specifier left
    // in a classic worker would throw on registration.
    expect(bundled).toContain("The operation was aborted.");
    expect(bundled).not.toMatch(/^\s*(import|export)\s/m);
    // Wrapped as an IIFE, not an ES module: `navigator.serviceWorker.register()`
    // defaults to `{ type: "classic" }`, and a classic worker cannot be ESM.
    // (esbuild prefixes a `"use strict";` prologue for some inputs.)
    expect(bundled).toMatch(IIFE_PROLOGUE);
    // Unminified on purpose: this app is closed-source, so the shipped /sw.js
    // is the only copy an auditor of the /privacy claims can read. A minified
    // esbuild bundle is one or two lines; this one keeps its structure.
    expect(bundled.trimEnd().split("\n").length).toBeGreaterThan(4);

    await fs.rm(dir, { recursive: true, force: true });
  }, 30_000);

  it("bundles the real src/lib/pwa/service-worker.ts the same way, once it exists", async () => {
    const present = await fs
      .access(SERVICE_WORKER_ENTRY)
      .then(() => true)
      .catch(() => false);
    // Deliberately skipped rather than failed while P2's source is unwritten —
    // `buildServiceWorker`'s own guard is covered by the test above.
    if (!present) return;

    const dir = await tempDir("sw-real");
    const outfile = path.join(dir, "sw.js");
    await expect(buildServiceWorker({ entry: SERVICE_WORKER_ENTRY, outfile })).resolves.toBe(
      "built",
    );

    const bundled = await fs.readFile(outfile, "utf8");
    expect(bundled).toMatch(IIFE_PROLOGUE);
    // A bare specifier surviving into the shipped worker would throw at
    // registration and leave the site with no service worker at all.
    expect(bundled).not.toMatch(/^\s*(import|export)\s/m);

    await fs.rm(dir, { recursive: true, force: true });
  }, 30_000);
});
