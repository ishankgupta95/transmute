# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # Dev server (auto-copies mupdf WASM to public/)
npm run build        # Static export to ./out (also copies mupdf WASM)
npm run lint         # ESLint (flat config, v9)
npm test             # Vitest unit/integration tests (single run)
npm run test:watch   # Vitest in watch mode
npm run test:coverage # Vitest with V8 coverage (80% threshold)
npm run test:e2e     # Playwright E2E (requires dev server running)
npm run test:all     # Unit + E2E sequentially
```

## Architecture

**Transmute** is a browser-based file conversion toolkit. All processing happens client-side (no server). Deployed as a static export to GitHub Pages at `/transmute`.

### Stack
- Next.js 16.2.2 (App Router, `output: "export"`), React 19, TypeScript (strict)
- Tailwind CSS 4 with custom dark theme via CSS variables in `globals.css`
- Heavy WASM usage: FFmpeg.wasm (video/audio), MuPDF (PDF), WebCodecs (H.264 encoding)

### Key directories
- `src/data/tools.ts` — Central registry of 40+ tool definitions (slug, metadata, category)
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
- **FFmpeg.wasm** — Singleton loaded via `lib/tools/ffmpeg-loader.ts`. Fetches ~25 MB from unpkg CDN on first use. Single-threaded build only (multi-threaded causes pthread deadlocks).
- **Video compression** — Uses WebCodecs API (`VideoEncoder`) + `mp4-muxer`, not FFmpeg. See `lib/tools/video-compress.ts`.
- **Audio** — `AudioContext.decodeAudioData()` for decoding; `lamejs` for MP3 encoding.
- **PDF** — MuPDF WASM (~10 MB, copied to `public/` at build time), `pdf-lib` for manipulation, `pdfjs-dist` for rendering.

### Styling rules
- `globals.css` uses `@theme` for CSS variables. Do not add custom CSS rules — use Tailwind utility classes only.
- Use `cn()` from `lib/utils/cn.ts` (clsx + tailwind-merge) for conditional classes.

### Static generation
- All tool pages use `generateStaticParams()` from the tools registry.
- `basePath: "/transmute"` in `next.config.ts` (GitHub Pages). URLs must account for this.

### Testing
- **Unit tests** in `src/__tests__/unit/` — jsdom environment, globals enabled.
- **E2E tests** in `src/__tests__/e2e/` — Playwright across 5 browser configs (desktop + mobile).
- Path alias `@/*` resolves to `src/*` in both test configs.
