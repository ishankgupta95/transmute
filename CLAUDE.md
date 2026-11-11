# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # Dev server (auto-copies the FFmpeg core + vendored libs to public/)
npm run build        # Static export to ./out (same copy step)
npm run lint         # ESLint (flat config, v9)
npm test             # Vitest unit/integration tests (single run)
npm run test:watch   # Vitest in watch mode
npm run test:coverage # Vitest with V8 coverage (floor: statements 82 / branches 76 / functions 83 / lines 83; actual ~86 / 81 / 87 / 88 as of 2026-11-11)
npm run test:e2e     # Playwright E2E (requires dev server running)
npm run test:e2e:conversion # Real conversions in Chromium, CONTENT-checked (~1.5 min). Runs on `git push` (.husky/pre-push)
npm run test:e2e:real # Opt-in: your own files from ./real-files (gitignored) or TRANSMUTE_REAL_FILES=<dir>
npm run test:all     # Unit + E2E sequentially
```

Gates: pre-commit runs lint + tsc + unit coverage; pre-push runs the conversion suite. CI runs NO tests
(build + deploy only), so `git push --no-verify` ships unchecked.

Conversion tests must check that the output is the RIGHT content, not merely a valid file: use the
helpers in `src/__tests__/e2e/conversion/fidelity.ts` (pixels, video frames, audio tones/levels, PDF
pages, GIF frames). Any new helper or threshold must be proven in `fidelity.spec.ts` to FAIL on a
deliberately broken output.

Browser support: Chromium-based browsers only (decided 2026-11-11). Every e2e project is Chromium; there
is no WebKit/Safari run. Comments in specs describing WebKit measurements are history, not a live gate.

## Architecture

**Transmute** is a browser-based file conversion toolkit. All processing happens client-side (no server). Deployed as a static export to GitHub Pages at the apex domain `transmute.tools` (no basePath).

### Stack
- Next.js 16.2.2 (App Router, `output: "export"`), React 19, TypeScript (strict)
- Tailwind CSS 4 with custom dark theme via CSS variables in `globals.css`
- Heavy WASM usage: FFmpeg.wasm (video/audio), WebCodecs (H.264 encoding). PDF is pure JS — there is no PDF WASM engine any more.

### Key directories
- `src/data/tools.ts` — Central registry of 190 tool definitions (slug, metadata, category).
  **Client-reachable**: `CommandPalette` is in the global layout and imports it, so this
  module ships on every route. Keep it to fields the client actually reads.
- `src/data/tool-copy.ts` — The server-only half of each entry: `aboutText`, `relatedTools`,
  `titleTag`. Split out of `tools.ts` because a field can't be tree-shaken out of an object
  literal, so 265 KB of prose was shipping to every visitor of every page. Do not import it
  from a `"use client"` module, or from anything one reaches —
  `src/__tests__/unit/data/server-only-copy.test.ts` walks the import graph and fails if you do.
- `src/data/categories.ts` — 5 categories: image, pdf, audio, video, developer
- `src/lib/tools/` — Pure processing logic (no React), one file per tool
- `src/components/tools/` — Tool UI components
- `src/hooks/useFileProcessor.ts` — Generic file processing hook used by most tools

### Component pattern for tools

Each tool follows a three-layer pattern to handle the Server/Client Component boundary:

1. **`[slug]/page.tsx`** — Server Component. Resolves tool from slug, renders `ToolPageLayout` + `*Client`.
2. **`*Client.tsx`** — Thin `"use client"` wrapper. Required because Server Component pages cannot use `"use client"` directly.
3. **`*UI.tsx`** — `"use client"` component with actual state, event handlers, and processing logic. Dynamically imports processing functions from `lib/tools/`.

### Media processing
- **FFmpeg.wasm** — Singleton loaded via `lib/tools/ffmpeg-loader.ts`. The core is **self-hosted, never a CDN**: `npm run copy:wasm` copies `ffmpeg-core.js`/`ffmpeg-core.wasm` (~31 MB, from the `@ffmpeg/core` devDependency) into `public/` on dev and build; the copies are gitignored, and the conversion suite's `forbidCdnCore` check fails the run on any CDN regression. Single-threaded build only (multi-threaded causes pthread deadlocks).
- **Video compression** — Uses WebCodecs API (`VideoEncoder`) + `mp4-muxer`, not FFmpeg. See `lib/tools/video-compress.ts`.
- **Audio** — `AudioContext.decodeAudioData()` for decoding; **libmp3lame** (LAME 3.100, our own single-threaded SIMD wasm build — `scripts/build-libmp3lame-wasm.sh`, sources in `vendor/libmp3lame/`) for MP3 encoding. It replaced the pure-JS `lamejs` on 2026-11-11 and is 4.3x faster with byte-identical output (measured in Chromium; see that directory's README). It is **not bundled**: `copy:wasm` stages `libmp3lame.js` + `libmp3lame.wasm` into `public/vendor/` and `lib/tools/audio-pcm.ts` loads the glue with a runtime `import()` of that same-origin URL, which resolves the `.wasm` beside it. The bridge keeps LAME's state in one file-scope `gfp`, so encodes are serialised through a module-level queue — one instance cannot carry two. The HEIC decoder is vendored the same way but **NOT loaded the same way**: `copy:wasm` copies libheif-js to `public/vendor/libheif.js` + `libheif.wasm`, and `lib/tools/image-convert.ts` loads the glue with a CLASSIC `<script>` TAG and hands it the `.wasm` itself. A runtime `import()` does not work for it — its UMD leaves an empty namespace and sets no global (measured; heic2any, which it replaced on 2026-09-12, had a global branch and could be imported). Both are LGPL and staying unbundled is what keeps them replaceable; do not let a bundler inline either one back in — read the load-bearing comments in those two files before touching the specifier.
- **PDF** — `pdf-lib` (MIT, pure JS) for every document and page operation: merge, split, rotate, reorder, page numbers, compress, images→PDF. `pdfjs-dist` for rendering (thumbnails, PDF→image). MuPDF is **gone** — it was AGPL and the repo is closed-source, so it was removed rather than licensed; do not reintroduce it. That also removed a 10 MB WASM download from every PDF page.

### Styling rules
- `globals.css` uses `@theme` for CSS variables. Do not add custom CSS rules — use Tailwind utility classes only.
- Use `cn()` from `lib/utils/cn.ts` (clsx + tailwind-merge) for conditional classes.

### Static generation
- All tool pages use `generateStaticParams()` from the tools registry.
- **No basePath.** The site deploys to the apex domain `transmute.tools` (`public/CNAME`);
  the old `basePath: "/transmute"` is gone. The few places that need a base prefix read
  `process.env.__NEXT_ROUTER_BASEPATH` (currently "") rather than hardcoding one.

### Testing
- **Unit tests** in `src/__tests__/unit/` — jsdom environment, globals enabled.
- **E2E tests** in `src/__tests__/e2e/` — Playwright across 5 browser configs (desktop + mobile).
- Path alias `@/*` resolves to `src/*` in both test configs.
