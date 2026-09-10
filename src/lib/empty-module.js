/**
 * Browser stub for Node-only built-ins that an Emscripten glue file reaches
 * for behind a runtime check it will never take in a browser.
 *
 * `libarchive-wasm`'s glue (node_modules/libarchive-wasm/dist/libarchive.js)
 * contains, inside `if (ENVIRONMENT_IS_NODE) { … }`:
 *
 *     fs = require("fs");
 *     nodePath = require("path");
 *     …
 *     const nodeCrypto = require("crypto");
 *
 * That branch is dead in a browser — `ENVIRONMENT_IS_NODE` is false — but a
 * bundler resolves `require()` STATICALLY, so the specifier has to exist.
 *
 * THE THREE ARE NOT HERE FOR THE SAME REASON, and the earlier version of this
 * comment ran them together. Only `fs` failed to resolve: `Module not found:
 * Can't resolve 'fs'` took down not just /extract-archive but every one of the
 * seven pages compiled in the same pass, because the error poisons the whole
 * compilation rather than the one route. `path` and `crypto` never failed,
 * because Next ships browser polyfills for both (`next/dist/compiled/
 * path-browserify`, `next/dist/compiled/crypto-browserify`) and none for `fs`.
 *
 *   fs      — no polyfill exists. Without the alias the build is RED.
 *   crypto  — a working 364 KB polyfill exists, and would be bundled into the
 *             /extract-archive chunk to serve one `require` in dead code.
 *   path    — the same, for 16 KB.
 *
 * So this file buys a green build for one of them and a smaller chunk for the
 * other two. Ships a few empty bytes, which is exactly right for code that
 * never runs. The Node build is untouched — `resolveAlias`'s `browser` key only
 * applies to the browser condition, so anything server-side that legitimately
 * wants `node:fs` still gets it.
 *
 * WHAT THIS COSTS. The aliases are global under the browser condition, so a
 * dependency added later that really does want `path` in a browser gets this
 * object rather than the shim Next would have given it. `import { join } from
 * "path"` still fails at build time — there is no `join` here to import — but
 * `require("path").join` resolves to `undefined` and throws at first use, in
 * production, on the drop. Nothing in a bundler can tell those apart, so the
 * guard is a test instead: src/__tests__/unit/lib/next-config-browser-stubs.
 * test.ts pins the alias map to the specifiers libarchive's glue requires,
 * asserts each of those requires is still inside the dead `ENVIRONMENT_IS_NODE`
 * branch, and fails if anything shipped under src/ imports one of them for
 * real.
 *
 * This file existed before under the same name and for the same reason: mupdf's
 * glue conditionally imported `module` and `node:fs`. It left when mupdf did
 * (scripts/build-workers.mjs still carries the comment recording that), and it
 * is back now for libarchive. If the last consumer of a stubbed built-in ever
 * leaves, delete its alias rather than leaving a stub that hides a real import
 * — the test above is what makes that instruction enforceable rather than
 * advisory.
 */
/** Named so `import/no-anonymous-default-export` has something to point at. */
const emptyModule = {};

export default emptyModule;

/** mupdf's glue called this; kept so the stub stays drop-in for CJS interop. */
export function createRequire() {
  return () => null;
}
