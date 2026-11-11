// @vitest-environment node
//
// No DOM here — this suite only walks the import graph on disk, and the global
// jsdom environment (vitest.config.ts) costs ~300 ms of setup per file. That
// cost is not free to the rest of the suite: it lands during collection,
// concurrently with every other test file, and this repo has at least two
// render-timing tests that fail when starved (see the lazy-evaluation note
// below). Running this one under `node` removes the environment entirely.

import { describe, it, expect } from "vitest";
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tools } from "@/data/tools";
import { toolCopy } from "@/data/tool-copy";

/*
  ── WHY src/data/tool-copy.ts HAS TO STAY OFF THE CLIENT ────────────────

  `aboutText`, `relatedTools` and `titleTag` used to be fields on `Tool`, in
  src/data/tools.ts, alongside the fields the client genuinely needs. All three
  are read only on the server — `aboutText` by src/app/[slug]/page.tsx,
  `relatedTools` by ToolPageLayout, `titleTag` by getToolMetadata — but
  `tools.ts` is imported by `"use client"` modules, `CommandPalette` among them,
  and that component is in the global layout, so it is on EVERY route.

  A `"use client"` import pulls the whole module into the client graph, and no
  bundler can tree-shake individual FIELDS out of object literals in an exported
  array. So every one of those strings shipped to every visitor of every page.
  MEASURED 2026-11-10, before the split: tools.ts was 445 KB of source, of which
  `aboutText` alone was 241.5 KB — 54% — and the homepage's first-load JS was
  1,080 KB raw / 323 KB gzipped, one chunk of which was 381 KB of this registry.

  Moving the three fields into tool-copy.ts fixes that exactly once. Nothing in
  the type system or the build keeps it fixed: a single `import { toolCopy }` in
  a client component — or in anything a client component reaches, however far
  down — silently puts all 275 KB back, and the build stays green. That is what
  this file is for.

  The reachability check below is TRANSITIVE on purpose. Next's rule is about
  the graph, not the direct import: a server-only-looking helper that imports
  tool-copy becomes client code the moment one `"use client"` file imports the
  helper. Checking direct imports only would pass that case.
*/

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../../..");
const SRC = join(REPO_ROOT, "src");

/** The module this test exists to keep out of the client graph. */
const SERVER_ONLY = join(SRC, "data/tool-copy.ts");

/** Fields that moved out of `Tool`; re-adding one undoes the whole split. */
const MOVED_FIELDS = ["aboutText", "relatedTools", "titleTag"] as const;

/*
  EVERYTHING BELOW IS LAZY AND READS AS LITTLE AS IT CAN, deliberately.

  The first version of this file built the whole graph at module scope and read
  all 346 shipped sources in full. That is ~0.3 s of synchronous I/O and regex
  during vitest's COLLECTION phase, running concurrently with every other test
  file — and it was enough to starve a timing-sensitive abort test elsewhere
  (`OfflineSettings.test.tsx > aborts through the signal it handed to
  addBundle`), which then failed about one run in three. MEASURED: 4/4 clean
  runs of the full suite at HEAD, 4/4 clean with a trivial extra test file
  added, but intermittent failures with the eager version of this file — so it
  was the cost, not the change in scheduling order.

  Two things keep it cheap now. `"use client"` detection reads only the first
  512 bytes of each file rather than all of it, and the BFS reads a file in
  full only when it is actually reachable from a client root. Nothing runs
  until a test asks for it.
*/

/** Every shipped source file — the browser graph, so tests are not in it. */
function shippedSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

/**
 * True when `file` opens with a `"use client"` directive.
 *
 * Reads a 512-byte head rather than the file: the directive has to precede
 * every statement, so only leading comments can push it down, and no file here
 * carries half a kilobyte of banner before it.
 */
function hasUseClient(file: string): boolean {
  const buf = Buffer.alloc(512);
  const fd = openSync(file, "r");
  let read: number;
  try {
    read = readSync(fd, buf, 0, 512, 0);
  } finally {
    closeSync(fd);
  }
  const head = buf.subarray(0, read).toString("utf8");
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\s)*["']use client["']/.test(head);
}

/** Every static and dynamic import specifier in `source`. */
function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  // `import … from "x"`, `export … from "x"`, bare `import "x"`, `import("x")`.
  for (const re of [
    /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of source.matchAll(re)) found.push(m[1]);
  }
  return found;
}

/** A specifier to a file on disk, or null for a package / unresolvable path. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null; // a node_modules package — not ours to walk
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // next candidate
    }
  }
  return null;
}

/** Resolved imports of one file, read on first use and remembered. */
const importCache = new Map<string, string[]>();
function importsOf(file: string): string[] {
  const cached = importCache.get(file);
  if (cached) return cached;
  const resolved = [
    ...new Set(
      importSpecifiers(readFileSync(file, "utf8"))
        .map((s) => resolveSpecifier(file, s))
        .filter((s): s is string => s !== null),
    ),
  ];
  importCache.set(file, resolved);
  return resolved;
}

interface Graph {
  files: string[];
  clientRoots: string[];
  /** Reachable file → the client-root-first chain that reaches it. */
  pathTo: Map<string, string[]>;
}

let graph: Graph | null = null;

/**
 * BFS the client graph, recording how each file was reached so a failure can
 * print the actual chain rather than just naming the offender. Computed once,
 * on the first test that needs it.
 */
function clientGraph(): Graph {
  if (graph) return graph;
  const files = shippedSources();
  const clientRoots = files.filter(hasUseClient);
  const pathTo = new Map<string, string[]>();
  const queue: string[] = [];
  for (const root of clientRoots) {
    if (pathTo.has(root)) continue;
    pathTo.set(root, [root]);
    queue.push(root);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of importsOf(current)) {
      if (pathTo.has(next)) continue;
      pathTo.set(next, [...pathTo.get(current)!, next]);
      queue.push(next);
    }
  }
  graph = { files, clientRoots, pathTo };
  return graph;
}

describe("tool-copy.ts stays server-only", () => {
  it("the walker found the graph it is supposed to check", () => {
    // A resolver that silently stops resolving would make every other
    // assertion here vacuously true. Pin that it reached a real graph.
    const { files, clientRoots } = clientGraph();
    expect(files.length, "no shipped sources found").toBeGreaterThan(200);
    expect(clientRoots.length, 'no "use client" modules found').toBeGreaterThan(20);
    expect(files, "tool-copy.ts is not in the walk").toContain(SERVER_ONLY);
    // The known client root that caused this split in the first place.
    const palette = join(SRC, "components/layout/CommandPalette.tsx");
    expect(clientRoots, "CommandPalette is no longer a client root").toContain(palette);
    expect(
      importsOf(palette),
      "CommandPalette no longer imports the registry — re-check this test's premise",
    ).toContain(join(SRC, "data/tools.ts"));
  });

  it("is not reachable from any client component", () => {
    const chain = clientGraph().pathTo.get(SERVER_ONLY);
    expect(
      chain?.map((f) => relative(REPO_ROOT, f)) ?? null,
      "tool-copy.ts reached the client bundle; the chain above shows how. " +
        "Read that file's header before changing either end of it.",
    ).toBeNull();
  });

  it("keeps the moved fields out of the client-side registry", () => {
    const registry = readFileSync(join(SRC, "data/tools.ts"), "utf8");
    for (const field of MOVED_FIELDS) {
      expect(
        registry.includes(field),
        `${field} is back in tools.ts, which ships to the client`,
      ).toBe(false);
    }
  });
});

describe("tool-copy.ts covers the registry exactly", () => {
  it("every tool has a copy entry", () => {
    const missing = tools.filter((t) => !toolCopy[t.slug]).map((t) => t.slug);
    expect(missing, "tools with no tool-copy entry").toEqual([]);
  });

  it("every copy entry has a tool", () => {
    const slugs = new Set(tools.map((t) => t.slug));
    const orphans = Object.keys(toolCopy).filter((slug) => !slugs.has(slug));
    expect(orphans, "tool-copy entries with no registry entry").toEqual([]);
  });

  it("entries are in registry order, so the two files diff against each other", () => {
    expect(Object.keys(toolCopy)).toEqual(tools.map((t) => t.slug));
  });

  it("no entry is empty", () => {
    const empty = Object.entries(toolCopy)
      .filter(([, c]) => c.aboutText.trim().length === 0)
      .map(([slug]) => slug);
    expect(empty, "tools with blank aboutText").toEqual([]);
  });
});
