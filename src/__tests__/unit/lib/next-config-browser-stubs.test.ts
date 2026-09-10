import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import nextConfig from "../../../../next.config";

/*
  ── THE BROWSER STUBS IN next.config.ts ─────────────────────────────────

  `turbopack.resolveAlias` points `fs`, `path` and `crypto` at
  src/lib/empty-module.js under the `browser` condition. That is correct today
  and it is correct for a narrow reason: `libarchive-wasm`'s Emscripten glue
  `require()`s all three from inside `if (ENVIRONMENT_IS_NODE) { … }`, a branch
  a browser never enters, and a bundler resolves those `require()`s anyway.

  It is also a global override. Every browser module in the graph now resolves
  those three specifiers to an empty object, including one that meant it. Next
  would have handed `path` and `crypto` real working polyfills
  (`next/dist/compiled/path-browserify`, `next/dist/compiled/crypto-browserify`
  — the fallback map has no `fs` entry, which is why `fs` was the only build
  error anyone ever saw). A CJS-style `require("path").join` against this stub
  is `undefined`, and throws on the user's first drop rather than in CI.

  Nothing a bundler does can distinguish that from the dead branch this is for.
  So the distinction is drawn here instead, and these are the four things that
  have to stay true for the stubs to be honest. `npm run build` cannot check any
  of them: a stub that has outlived its consumer, or one that is shadowing a
  real import, both build perfectly green.
*/

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "../../../..");

/** The Emscripten glue the stubs exist for. */
const GLUE = join(REPO_ROOT, "node_modules/libarchive-wasm/dist/libarchive.js");

const STUB = "./src/lib/empty-module.js";

/** `{ fs: { browser: "./src/lib/empty-module.js" }, … }` as the config declares it. */
const resolveAlias = (nextConfig.turbopack?.resolveAlias ?? {}) as Record<string, unknown>;

/** Every `require("x")` in the glue, with the 1-based line it sits on. */
function glueRequires(): { specifier: string; line: number; indent: number }[] {
  const lines = readFileSync(GLUE, "utf8").split("\n");
  const found: { specifier: string; line: number; indent: number }[] = [];
  lines.forEach((text, index) => {
    for (const match of text.matchAll(/require\("([^"]+)"\)/g)) {
      found.push({
        specifier: match[1],
        line: index + 1,
        indent: text.length - text.trimStart().length,
      });
    }
  });
  return found;
}

/** Every shipped source file — the browser graph, so tests are not in it. */
function shippedSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
    }
  };
  walk(join(REPO_ROOT, "src"));
  return out;
}

describe("next.config.ts browser stubs", () => {
  it("stubs exactly the specifiers libarchive's glue requires — no more, no fewer", () => {
    /*
      Both directions matter. A specifier in the glue with no alias is the `fs`
      build failure coming back. An alias with no requirer is a stub that has
      outlived its consumer and is now only shadowing whatever asks next —
      which is the case empty-module.js's own closing instruction is about, and
      which had no enforcement at all before this.
    */
    const required = [...new Set(glueRequires().map((entry) => entry.specifier))].sort();

    expect(
      Object.keys(resolveAlias).sort(),
      `libarchive's glue requires [${required.join(", ")}]; next.config.ts stubs [${Object.keys(resolveAlias).sort().join(", ")}]`,
    ).toEqual(required);
  });

  it("keeps every require inside the dead ENVIRONMENT_IS_NODE branch", () => {
    /*
      This is the whole justification for the stub being EMPTY. `fs` and
      `nodePath` are assigned under `if (ENVIRONMENT_IS_NODE) {`, and
      `nodeCrypto` under the same guard inside `initRandomFill`; the browser
      takes neither, so an object with nothing on it is a complete
      implementation. A glue update that moves one of these out into live code
      turns the stub into a lie that only shows up on a user's machine.

      Structural, not clever: the nearest preceding line mentioning the guard
      must be indented LESS than the require, i.e. the require is inside it.
      If a libarchive-wasm upgrade reformats this file, expect a red here and
      re-read the branch rather than deleting the assertion.
    */
    const lines = readFileSync(GLUE, "utf8").split("\n");
    const escaped = glueRequires().filter(({ line, indent }) => {
      for (let above = line - 1; above >= 1; above -= 1) {
        const text = lines[above - 1];
        if (!text.includes("ENVIRONMENT_IS_NODE")) continue;
        return text.length - text.trimStart().length >= indent;
      }
      return true;
    });

    expect(
      escaped.map(({ specifier, line }) => `require("${specifier}") at libarchive.js:${line}`),
      "a stubbed built-in is required outside the Node-only branch, so an empty object is no longer a safe stand-in for it",
    ).toEqual([]);
  });

  it("stubs only under the browser condition, so the Node build keeps the real modules", () => {
    const wrong = Object.entries(resolveAlias)
      .filter(([, value]) => {
        const conditions = value as Record<string, string> | string;
        if (typeof conditions === "string") return true;
        return Object.keys(conditions).join() !== "browser" || conditions.browser !== STUB;
      })
      .map(([specifier]) => specifier);

    expect(
      wrong,
      `each alias must be exactly { browser: "${STUB}" } — a bare string would take node:fs away from the server build too`,
    ).toEqual([]);
  });

  it("shadows nothing that ships: no source under src/ imports a stubbed built-in", () => {
    /*
      The failure this is really guarding. The aliases apply to the whole
      browser graph, so the day a tool genuinely needs `path.join` it silently
      gets `undefined` instead of the polyfill Next would have supplied. Our own
      code is the half that can be checked cheaply and deterministically; a
      dependency doing it is the half that cannot, which is why the comment in
      next.config.ts names the risk out loud instead of pretending it is gone.

      `__tests__` is excluded above on purpose: those run in Node under vitest,
      are never bundled, and `node:fs` there is real. Comments are stripped
      before matching, and the stub itself is skipped, because both quote the
      glue's `require("fs")` verbatim while explaining why it is stubbed —
      matching those would make this assertion permanently red for prose.
    */
    const stubbed = Object.keys(resolveAlias);
    const pattern = new RegExp(
      String.raw`(?:from\s*|require\()\s*["'](?:node:)?(${stubbed.join("|")})["']`,
    );
    const code = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const offenders = shippedSources()
      .filter((file) => relative(REPO_ROOT, file) !== join("src", "lib", "empty-module.js"))
      .map((file) => ({ file, source: code(readFileSync(file, "utf8")) }))
      .filter(({ source }) => pattern.test(source))
      .map(({ file }) => relative(REPO_ROOT, file));

    expect(
      offenders,
      `these ship to the browser and import a specifier next.config.ts aliases to {} — they will get an empty object, not ${stubbed.join("/")}`,
    ).toEqual([]);
  });
});
