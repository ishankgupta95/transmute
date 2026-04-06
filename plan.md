# Transmute — Utility Tools Web App: Master Project Plan

> **Stack**: Next.js 14 (App Router) · TypeScript · Tailwind CSS · Static Export · GitHub Pages (→ custom domain later)
> **Domain**: `transmute.tools` — purchased only after all phases are complete and quality is verified
> **Design**: Modern, minimal, warm dark theme (not AMOLED) · Responsive mobile-first · SEO-first markup
> **Revenue**: Programmatic ads (AdSense → Ezoic → Mediavine) + optional freemium tier

---

## Phase 0: Foundation & Project Setup

### 0.1 — Hosting & Domain Strategy

> **Domain purchase is deferred.** We develop and test the entire app locally and on GitHub Pages (free `ishankgupta95.github.io/transmute` URL) throughout all phases. The custom domain `transmute.tools` is purchased **only after all phases are complete** and the app passes thorough quality testing. This avoids paying for a domain while the app is still in development.

**During development (Phases 0–8):**
- [ ] Deploy to GitHub Pages at `ishankgupta95.github.io/transmute`
- [ ] Use this as the staging/preview URL for all testing
- [ ] Configure `next.config.ts` with `basePath: '/transmute'` for GitHub Pages subpath
- [ ] Set up GitHub Actions for automatic deployment on push to `main`

**After all phases complete & QA passes (Phase 9):**
- [ ] Purchase `transmute.tools` on GoDaddy (cheap first year)
- [ ] Immediately point GoDaddy nameservers to Cloudflare (free plan)
- [ ] Set up Cloudflare DNS → GitHub Pages (A records + CNAME)
- [ ] Configure custom domain in GitHub Pages settings
- [ ] Add `CNAME` file to repo root with `transmute.tools`
- [ ] Enable "Enforce HTTPS" in GitHub Pages
- [ ] Remove `basePath` from `next.config.ts`, update all canonical URLs
- [ ] After 60 days: transfer registrar from GoDaddy → Cloudflare for at-cost renewals
- [ ] Turn off GoDaddy auto-renewal immediately after purchase

### 0.2 — Repository & Project Init

```bash
# Create the Next.js project
npx create-next-app@latest transmute --typescript --tailwind --app --src-dir --eslint

# Navigate into project
cd transmute

# Install core dependencies
npm install clsx tailwind-merge lucide-react

# Install dev dependencies
npm install -D @tailwindcss/typography prettier eslint-config-prettier

# Initialize git
git init
git remote add origin git@github.com:ishankgupta95/transmute.git
```

- [ ] Use `src/` directory structure with App Router
- [ ] Set `output: 'export'` in `next.config.ts` for full static export
- [ ] Configure `next.config.ts`:

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/transmute",   // For GitHub Pages subpath during development
  images: {
    unoptimized: true,      // Required for static export
  },
  trailingSlash: false,
};

// NOTE: Remove basePath when switching to custom domain (transmute.tools)
export default nextConfig;
```

### 0.3 — Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout (fonts, theme, nav, footer, scripts)
│   ├── page.tsx                # Homepage — hero + tool category grid
│   ├── image-tools/
│   │   └── page.tsx            # Category hub — lists all image tools
│   ├── heic-to-jpg/
│   │   └── page.tsx            # Individual tool page
│   ├── webp-to-jpg/
│   │   └── page.tsx            # Individual tool page
│   ├── compress-image/
│   │   └── page.tsx            # Individual tool page
│   ├── pdf-tools/
│   │   └── page.tsx            # Category hub
│   ├── developer-tools/
│   │   └── page.tsx            # Category hub
│   ├── about/
│   │   └── page.tsx
│   ├── privacy/
│   │   └── page.tsx
│   └── sitemap.ts              # Dynamic sitemap generation
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx
│   │   ├── Footer.tsx
│   │   ├── MobileNav.tsx
│   │   └── Sidebar.tsx         # Category sidebar for tool pages
│   ├── tools/
│   │   ├── DropZone.tsx        # Reusable drag-and-drop file input
│   │   ├── FilePreview.tsx     # Before/after file preview
│   │   ├── ProgressBar.tsx     # Processing progress
│   │   ├── DownloadButton.tsx  # Download result with filename
│   │   ├── BatchUploader.tsx   # Multi-file batch processing
│   │   ├── SettingsPanel.tsx   # Quality, format, size options
│   │   └── ToolPageLayout.tsx  # Shared layout: tool + how-to + FAQ + related tools
│   ├── seo/
│   │   ├── ToolSchema.tsx      # JSON-LD: HowTo + FAQPage + SoftwareApplication
│   │   ├── BreadcrumbSchema.tsx
│   │   └── MetaTags.tsx        # Open Graph, Twitter Card, canonical
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Badge.tsx
│       ├── Tabs.tsx
│       ├── Slider.tsx
│       └── Toast.tsx
├── lib/
│   ├── workers/                # Web Workers for heavy processing
│   │   ├── image-worker.ts
│   │   ├── pdf-worker.ts
│   │   └── audio-worker.ts
│   ├── tools/                  # Core processing logic per tool
│   │   ├── image-convert.ts
│   │   ├── image-compress.ts
│   │   ├── image-resize.ts
│   │   ├── pdf-merge.ts
│   │   ├── pdf-split.ts
│   │   └── json-format.ts
│   ├── seo/
│   │   ├── tool-metadata.ts    # Centralized metadata for all tools
│   │   └── schemas.ts          # JSON-LD schema generators
│   └── utils/
│       ├── file-helpers.ts     # File size formatting, MIME detection
│       ├── download.ts         # Trigger browser download
│       └── cn.ts               # clsx + tailwind-merge utility
├── data/
│   ├── tools.ts                # Master registry of all tools (name, slug, category, description)
│   ├── categories.ts           # Category definitions
│   └── faqs.ts                 # FAQ content per tool (for SEO)
├── hooks/
│   ├── useFileProcessor.ts     # Generic file input → process → output hook
│   ├── useWebWorker.ts         # Hook to offload work to Web Worker
│   └── useDownload.ts          # Hook to trigger file download
├── __tests__/
│   ├── unit/
│   │   ├── lib/
│   │   │   ├── image-convert.test.ts
│   │   │   ├── image-compress.test.ts
│   │   │   ├── pdf-merge.test.ts
│   │   │   ├── json-format.test.ts
│   │   │   └── file-helpers.test.ts
│   │   ├── hooks/
│   │   │   └── useFileProcessor.test.ts
│   │   └── data/
│   │       └── tool-metadata.test.ts
│   ├── integration/
│   │   ├── image-converter-flow.test.ts
│   │   ├── pdf-merge-flow.test.ts
│   │   └── batch-processing.test.ts
│   ├── e2e/
│   │   ├── image-tools.spec.ts
│   │   ├── pdf-tools.spec.ts
│   │   ├── developer-tools.spec.ts
│   │   ├── audio-tools.spec.ts
│   │   ├── navigation.spec.ts
│   │   └── seo-validation.spec.ts
│   └── fixtures/
│       ├── images/              # Sample test files (tiny valid files)
│       │   ├── sample.jpg
│       │   ├── sample.png
│       │   ├── sample.webp
│       │   ├── sample.heic
│       │   ├── sample.svg
│       │   └── corrupt.jpg
│       ├── pdfs/
│       │   ├── single-page.pdf
│       │   ├── multi-page.pdf
│       │   └── corrupt.pdf
│       └── audio/
│           ├── sample.mp3
│           └── sample.wav
└── styles/
    └── globals.css             # Tailwind directives + CSS variables + custom utilities
```

### 0.4 — Tailwind & Design System Setup

**Theme direction**: Warm dark — think dark charcoal backgrounds (#1a1a1a to #252525), not pure black. Subtle warm undertones. Sharp accent color (electric teal or amber). Refined minimalism — generous whitespace, precise typography.

**Use the "frontend-design" skill** when building every UI component. Follow these guidelines strictly:
- **Typography**: Use a distinctive Google Font pairing — e.g. **"Satoshi"** (display/headings) + **"General Sans"** (body) or **"Instrument Sans"** + **"DM Sans"**. Avoid Inter, Roboto, Arial.
- **Color palette**: Define as CSS variables in `globals.css`. Dominant dark surface with one sharp accent.
- **Motion**: Subtle entrance animations on tool cards (staggered reveals). Smooth drag-and-drop feedback. Processing spinner with personality.
- **Backgrounds**: Subtle noise texture or dot grid on hero sections. Avoid flat solid backgrounds.

```css
/* globals.css — CSS variable foundation */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Surfaces */
    --bg-primary: #1a1a1e;
    --bg-secondary: #222226;
    --bg-elevated: #2a2a2f;
    --bg-hover: #323237;

    /* Text */
    --text-primary: #e8e8ec;
    --text-secondary: #9a9aa4;
    --text-muted: #6b6b75;

    /* Accent — choose ONE strong accent */
    --accent: #2dd4bf;           /* Electric teal */
    --accent-hover: #14b8a6;
    --accent-muted: rgba(45, 212, 191, 0.15);

    /* Borders */
    --border: #2f2f35;
    --border-hover: #3f3f46;

    /* Feedback */
    --success: #4ade80;
    --error: #f87171;
    --warning: #fbbf24;

    /* Radius */
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 16px;
  }
}
```

- [ ] Import Google Fonts via `next/font/google` in `layout.tsx` (tree-shaken, self-hosted)
- [ ] Set up Tailwind theme extension mapping to CSS variables
- [ ] Build dark theme as the default and only theme (no toggle needed)
- [ ] Create `cn()` utility: `clsx` + `tailwind-merge` combo

### 0.5 — Core UI Components (use "frontend-design" skill)

Build these reusable components first — every tool page depends on them:

- [ ] **`DropZone.tsx`** — Drag-and-drop + click-to-upload. Animated dashed border on hover. File type validation. Shows file name, size, thumbnail after selection. Supports batch (multiple files). Mobile tap-friendly (full-width, large tap target).
- [ ] **`ToolPageLayout.tsx`** — Shared wrapper for every tool page. Sections: Hero (H1 + subtitle) → Tool UI → How-To Steps → FAQ Accordion → Related Tools grid. Responsive: single column on mobile, tool centered on desktop with sidebar.
- [ ] **`Navbar.tsx`** — Logo + category links + hamburger on mobile. Sticky, blurred backdrop.
- [ ] **`Footer.tsx`** — Minimal: about, privacy, categories, GitHub link.
- [ ] **`MobileNav.tsx`** — Full-screen overlay menu with categories and tool search.
- [ ] **`Button.tsx`**, **`Card.tsx`**, **`Badge.tsx`**, **`Toast.tsx`** — Basic primitives.

### 0.6 — Testing Infrastructure

> **Rule: No tool ships without tests.** Every processing function gets unit tests. Every tool page gets an E2E test. Tests run on every push via GitHub Actions.

**Install testing dependencies:**

```bash
# Unit & integration testing
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom

# E2E testing
npm install -D playwright @playwright/test

# Initialize Playwright browsers
npx playwright install --with-deps chromium firefox webkit
```

**Configure Vitest** (`vitest.config.ts`):

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/__tests__/unit/**/*.test.ts",
      "src/__tests__/integration/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/hooks/**"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

**Configure Playwright** (`playwright.config.ts`):

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000/transmute",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

**Add npm scripts** to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:all": "vitest run && playwright test"
  }
}
```

**GitHub Actions CI pipeline** (`.github/workflows/ci.yml`):

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit

  unit-tests:
    runs-on: ubuntu-latest
    needs: lint-and-typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"
      - run: npm ci
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  e2e-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  build-and-deploy:
    runs-on: ubuntu-latest
    needs: [unit-tests, e2e-tests]
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./out
```

> **CI ensures**: lint passes → TypeScript compiles → unit tests pass with 80%+ coverage → E2E tests pass on 3 browsers + 2 mobile viewports → only then does it build and deploy to GitHub Pages.

**Test fixture files:**
- [ ] Create tiny valid sample files for each format (JPEG, PNG, WebP, HEIC, SVG, TIFF, BMP, PDF, MP3, WAV)
- [ ] Create intentionally corrupt files for error-handling tests
- [ ] Keep fixtures small (<50KB each) to keep the repo lightweight

**Three levels of testing applied throughout all phases:**

| Level | What it tests | Tool | When to write |
|-------|--------------|------|---------------|
| **Unit** | Processing functions in `src/lib/tools/` — input file → correct output format, size, quality. Utility functions. Schema generators. | Vitest | Same time as the function |
| **Integration** | Full flow in headless environment — file input → processing → blob output. Hook behavior. Batch processing. Error handling. | Vitest + Testing Library | After the processing engine for each category is built |
| **E2E** | Real browser: navigate to tool page → upload file → verify processing → download works. SEO checks: H1 exists, schema present, meta tags correct. Cross-browser. Mobile viewports. | Playwright | After each tool page is functional |

---

## Phase 1: Image Format Converters (Week 1–3)

> **Goal**: Ship 9+ SEO-optimized pages from a single reusable template. Combined target: ~200K monthly search volume.

### 1.1 — Build the Universal Image Converter Engine

- [ ] Create `src/lib/tools/image-convert.ts`:
  - Accept input `File`, target format (`jpeg | png | webp | bmp`), quality (0–1)
  - Use `Canvas API` for all standard conversions: load image → draw to canvas → `canvas.toBlob(format, quality)`
  - For **HEIC input**: install `heic2any` — converts HEIC/HEIF to JPEG/PNG blob, then process normally
  - For **TIFF input**: install `utif` — decode TIFF to RGBA buffer, draw to canvas
  - For **AVIF input**: use native `<img>` decode (Chrome/Firefox support) + canvas re-export; fallback with Squoosh WASM codec
  - For **SVG input**: load into `<img>` with `URL.createObjectURL`, draw to canvas at specified dimensions
  - Return: `{ blob: Blob, fileName: string, originalSize: number, newSize: number }`

- [ ] Create `src/hooks/useFileProcessor.ts`:
  ```ts
  type ProcessorStatus = "idle" | "loading" | "processing" | "done" | "error";

  function useFileProcessor<TOptions>(
    processFn: (file: File, options: TOptions) => Promise<ProcessedResult>
  ): {
    status: ProcessorStatus;
    result: ProcessedResult | null;
    error: string | null;
    process: (file: File, options: TOptions) => void;
    reset: () => void;
  }
  ```

- [ ] Create `src/lib/workers/image-worker.ts` — offload Canvas operations to Web Worker using `OffscreenCanvas` (with fallback to main thread for Safari)

### 1.2 — Build the Reusable Tool Page Template

- [ ] **`ToolPageLayout.tsx`** — The master layout every tool page uses:

  **Section 1 — Hero + Tool**
  - H1 with exact search keyword: "Convert HEIC to JPG Online — Free, No Upload Required"
  - Subtitle: one-line benefit statement
  - `<DropZone>` component front and center
  - Settings panel (quality slider, output format confirmation)
  - Before/After preview with file sizes
  - Download button (prominent, accent-colored)

  **Section 2 — How It Works (3 steps)**
  - Step 1: Upload your file
  - Step 2: Adjust settings (optional)
  - Step 3: Download your converted file
  - ⚡ Triggers `HowTo` schema for rich snippets

  **Section 3 — About This Tool (SEO content)**
  - 200–400 words explaining: What is HEIC? Why convert to JPG? When to use each format?
  - Unique per tool — NOT generic boilerplate
  - Naturally includes keywords without stuffing

  **Section 4 — FAQ Accordion**
  - 4–6 questions per tool, unique and genuinely useful
  - Triggers `FAQPage` schema markup
  - Example: "Is my file uploaded to any server?" → "No, everything runs in your browser"

  **Section 5 — Related Tools**
  - Grid of 4–6 related tool cards with internal links
  - "If you liked HEIC to JPG, you might need: HEIC to PNG, Compress Image, Resize Image"

### 1.3 — SEO Infrastructure

- [ ] **`src/lib/seo/tool-metadata.ts`** — Centralized metadata registry:
  ```ts
  type ToolMeta = {
    slug: string;
    title: string;           // "Convert HEIC to JPG Online — Free | ToolFix"
    description: string;     // Meta description, 150-160 chars
    h1: string;              // "Convert HEIC to JPG Online — Free, No Upload"
    canonical: string;
    category: "image" | "pdf" | "developer" | "audio" | "video";
    keywords: string[];
    faqItems: { q: string; a: string }[];
    howToSteps: { name: string; text: string }[];
    relatedTools: string[];  // slugs
  };
  ```

- [ ] **`src/components/seo/ToolSchema.tsx`** — Generates JSON-LD for each page:
  - `HowTo` schema
  - `FAQPage` schema
  - `SoftwareApplication` schema (type: WebApplication, free, browser-based)
  - `BreadcrumbList` schema

- [ ] **`src/app/sitemap.ts`** — Auto-generates sitemap.xml from tool registry:
  ```ts
  export default function sitemap(): MetadataRoute.Sitemap {
    const tools = getAllTools();
    return [
      { url: "https://yourdomain.com", lastModified: new Date(), priority: 1.0 },
      ...tools.map((tool) => ({
        url: `https://yourdomain.com/${tool.slug}`,
        lastModified: new Date(),
        priority: 0.8,
      })),
    ];
  }
  ```

- [ ] **`robots.txt`** — Allow all crawlers, point to sitemap
- [ ] Each tool page exports `generateMetadata()` with: title, description, openGraph, twitter, alternates (canonical)
- [ ] Semantic HTML: proper heading hierarchy (`h1` > `h2` > `h3`), `<main>`, `<article>`, `<section>`, `<nav>`
- [ ] Breadcrumbs on every tool page: Home > Image Tools > HEIC to JPG

### 1.4 — Build Individual Tool Pages

Each page is thin — it imports the shared layout and passes tool-specific config:

- [ ] `/heic-to-jpg` — HEIC → JPEG (uses `heic2any`)
- [ ] `/webp-to-jpg` — WebP → JPEG (Canvas API)
- [ ] `/webp-to-png` — WebP → PNG (Canvas API)
- [ ] `/png-to-jpg` — PNG → JPEG (Canvas API)
- [ ] `/jpg-to-png` — JPEG → PNG (Canvas API)
- [ ] `/jpg-to-webp` — JPEG → WebP (Canvas API)
- [ ] `/png-to-webp` — PNG → WebP (Canvas API)
- [ ] `/svg-to-png` — SVG → PNG (img + Canvas, with dimension input)
- [ ] `/avif-to-jpg` — AVIF → JPEG (native decode + Canvas)
- [ ] `/bmp-to-jpg` — BMP → JPEG (Canvas API)
- [ ] `/tiff-to-jpg` — TIFF → JPEG (`utif` + Canvas)

Each page needs: unique H1, unique meta description, unique 200-word about section, unique FAQ (4–6 items), related tools.

### 1.5 — Category Hub Page

- [ ] `/image-tools` — Lists all image tools as cards in a responsive grid
  - Each card: tool icon, name, one-line description, link
  - Brief intro paragraph about browser-based image tools (SEO text)
  - Breadcrumb: Home > Image Tools

### 1.6 — Testing (Image Converters)

**Unit tests** (`src/__tests__/unit/lib/image-convert.test.ts`):
- [ ] Test each conversion pair: HEIC→JPG, WebP→JPG, WebP→PNG, PNG→JPG, JPG→PNG, SVG→PNG, AVIF→JPG, BMP→JPG, TIFF→JPG
- [ ] Test with valid sample files → verify output blob has correct MIME type
- [ ] Test output quality setting: quality 0.5 produces smaller blob than quality 1.0
- [ ] Test with corrupt/invalid files → verify graceful error (not crash)
- [ ] Test with unsupported file types → verify clear error message
- [ ] Test with zero-byte file → verify error handling
- [ ] Test file name generation: `photo.heic` → `photo.jpg`

**Unit tests** (`src/__tests__/unit/data/tool-metadata.test.ts`):
- [ ] Every tool in registry has: non-empty title, description under 160 chars, valid slug, at least 4 FAQ items
- [ ] No duplicate slugs in tool registry
- [ ] All `relatedTools` slugs reference existing tools

**Integration tests** (`src/__tests__/integration/image-converter-flow.test.ts`):
- [ ] Full hook lifecycle: idle → loading → processing → done
- [ ] `useFileProcessor` returns correct blob and metadata
- [ ] Reset function clears state properly
- [ ] Processing can be re-triggered after completion

**E2E tests** (`src/__tests__/e2e/image-tools.spec.ts`):
- [ ] Navigate to `/heic-to-jpg` → page loads, H1 visible, DropZone visible
- [ ] Upload a sample HEIC file → processing starts → download button appears
- [ ] Click download → file downloads with `.jpg` extension
- [ ] Verify SEO: H1 exists, JSON-LD schema present in page source, meta description exists
- [ ] Test on mobile viewport (375px): DropZone is full-width, tap-to-upload works
- [ ] Test `/image-tools` hub: all tool cards render, links work

---

## Phase 2: Image Utilities (Week 4–6)

### 2.1 — Image Compressor

- [ ] Install `browser-image-compression`
- [ ] Build `/compress-image` page:
  - Quality slider (1–100)
  - **Target file size** input: "Compress to __ KB" (key differentiator)
  - Before/after size comparison with percentage saved
  - Batch mode: compress multiple images at once
- [ ] Create long-tail variant pages (can be same component with different defaults):
  - `/compress-image-to-100kb`
  - `/compress-image-to-200kb`
  - `/compress-image-to-1mb`
  - Each with unique SEO content targeting "compress image to 100kb online"

### 2.2 — Image Resizer

- [ ] Install `pica` (high-quality resizing with Lanczos3)
- [ ] Build `/resize-image` page:
  - Width × Height input with lock aspect ratio toggle
  - **Preset buttons** (key differentiator): "Instagram Post (1080×1080)", "Instagram Story (1080×1920)", "Twitter Header (1500×500)", "LinkedIn Banner (1584×396)", "Passport Photo (2×2 in)", "YouTube Thumbnail (1280×720)"
  - Percentage-based resize option (50%, 75%, 150%, 200%)

### 2.3 — Image Cropper

- [ ] Install `cropperjs`
- [ ] Build `/crop-image` page:
  - Interactive crop area with handles
  - Aspect ratio presets: Free, 1:1, 4:3, 16:9, 3:2
  - Rotation slider

### 2.4 — EXIF Data Viewer & Remover

- [ ] Install `exif-js`
- [ ] Build `/exif-viewer` page:
  - Display all EXIF metadata in a clean table: camera, lens, GPS, date, etc.
  - "Remove EXIF & Download" button — re-export via Canvas (strips all metadata)
  - Privacy angle in SEO content

### 2.5 — Additional Image Tools

- [ ] `/image-to-base64` — FileReader + copy-to-clipboard
- [ ] `/png-to-ico` — Canvas + ICO binary encoding for favicon generation
- [ ] `/favicon-generator` — Upload image → generate 16×16, 32×32, 48×48, 180×180 (Apple Touch), 192×192 & 512×512 (PWA) + download as zip
- [ ] `/image-color-palette` — Canvas `getImageData` → color quantization → show dominant colors with hex codes

### 2.6 — Testing (Image Utilities)

**Unit tests:**
- [ ] `image-compress.test.ts`: Compression reduces file size. Target-size compression outputs blob ≤ target. Quality slider affects output.
- [ ] `image-resize.test.ts`: Output dimensions match specified width×height. Aspect ratio lock works. Preset dimensions are correct.
- [ ] Favicon generator outputs correct number of sizes in zip

**Integration tests:**
- [ ] Batch compression: 5 files processed → 5 results returned with correct metadata
- [ ] Compress-to-target-size converges within 3 iterations

**E2E tests:**
- [ ] `/compress-image`: upload → adjust quality slider → download → verify smaller file
- [ ] `/resize-image`: upload → select Instagram preset → verify dimensions in preview
- [ ] `/crop-image`: upload → drag crop handles → download cropped image
- [ ] `/exif-viewer`: upload JPEG with EXIF → verify metadata table renders → click remove → download clean file
- [ ] Mobile: all tools usable at 375px width, sliders/inputs are thumb-friendly

---

## Phase 3: Developer Tools (Week 7–9)

> **Goal**: Target high-CPM developer audience. All tools are trivially client-side with zero dependencies.

### 3.1 — Text/Data Formatters

- [ ] `/json-formatter` — Paste JSON → format/validate → syntax highlighted output with line numbers. Copy button. Minify toggle. Tree view toggle.
- [ ] `/json-to-csv` — Parse JSON array → generate CSV with headers → download
- [ ] `/csv-to-json` — PapaParse → format as JSON array → copy/download
- [ ] `/sql-formatter` — Install `sql-formatter` → paste SQL → formatted output
- [ ] `/markdown-to-html` — Install `marked` → live preview side-by-side
- [ ] `/html-to-markdown` — Install `turndown` → paste HTML → get clean markdown
- [ ] `/xml-formatter` — Native DOMParser → pretty-print

### 3.2 — Encoders/Decoders

- [ ] `/base64-encode-decode` — Text ↔ Base64, with file (image) to Base64 option
- [ ] `/url-encode-decode` — `encodeURIComponent` / `decodeURIComponent`
- [ ] `/jwt-decoder` — Split JWT → decode header + payload → display JSON + expiry check
- [ ] `/html-entity-encode-decode` — Encode/decode HTML entities

### 3.3 — Generators

- [ ] `/uuid-generator` — Generate v4 (random) and v7 (time-based) UUIDs. Bulk generate (10, 50, 100). Copy button.
- [ ] `/password-generator` — Web Crypto API. Length slider, character type toggles, strength meter, bulk generate.
- [ ] `/hash-generator` — Input text → SHA-1, SHA-256, SHA-512 (Web Crypto API) + MD5 (`js-md5`). File hashing too.
- [ ] `/lorem-ipsum-generator` — Paragraphs, sentences, or words. Copy button.
- [ ] `/qr-code-generator` — Install `qr-code-styling`. Text/URL input → styled QR code with logo upload, color customization → download PNG/SVG.

### 3.4 — CSS Tools

- [ ] `/color-picker` — HSL/RGB/HEX converter + visual picker + palette generator
- [ ] `/css-gradient-generator` — Visual linear/radial gradient builder → copy CSS code
- [ ] `/box-shadow-generator` — Visual shadow builder with multiple layers → copy CSS

### 3.5 — Other Dev Utilities

- [ ] `/regex-tester` — Input regex + test string → highlight matches + capture groups + explanation
- [ ] `/cron-expression-generator` — Visual builder → cron string + human-readable description + next 5 run times
- [ ] `/timestamp-converter` — Unix ↔ ISO 8601 ↔ human-readable. "Now" button. Timezone selector.
- [ ] `/text-diff` — Install `jsdiff` → paste two texts → inline or side-by-side diff view
- [ ] `/text-case-converter` — UPPERCASE, lowercase, Title Case, camelCase, snake_case, kebab-case, PascalCase
- [ ] `/word-counter` — Character count, word count, sentence count, paragraph count, reading time estimate

### 3.6 — Testing (Developer Tools)

**Unit tests:**
- [ ] JSON formatter: valid JSON formats correctly, invalid JSON returns clear error, minify produces single line
- [ ] Base64: encode then decode returns original string. Binary data round-trips correctly.
- [ ] JWT decoder: valid JWT decodes header + payload. Expired token flagged. Malformed token shows error.
- [ ] UUID generator: v4 matches UUID regex, bulk generate returns correct count, no duplicates in 1000 generations
- [ ] Hash generator: SHA-256 of known input matches expected hash
- [ ] URL encode/decode: special characters (&, =, ?, #, spaces) round-trip correctly
- [ ] Cron expression: `0 9 * * 1` → "At 9:00 AM every Monday"
- [ ] Text case converter: all 7 case transformations produce correct output

**E2E tests:**
- [ ] `/json-formatter`: paste invalid JSON → error shown. Paste valid JSON → formatted output with syntax highlighting.
- [ ] `/password-generator`: toggle options → generated password matches criteria → copy button works
- [ ] `/regex-tester`: enter regex → enter test string → matches highlighted
- [ ] `/qr-code-generator`: enter URL → QR code renders → download button works
- [ ] All dev tools: verify copy-to-clipboard button works (Playwright clipboard API)

---

## Phase 4: PDF Tools (Week 10–14)

### 4.1 — Core PDF Engine

- [ ] Install `pdf-lib` (pure JS, zero native deps, works client-side)
- [ ] Install `pdfjs-dist` (Mozilla's PDF.js for rendering/previewing)
- [ ] Create `src/lib/tools/pdf-engine.ts` — shared utilities:
  - Load PDF from File
  - Get page count
  - Render page to Canvas (for preview thumbnails)
  - Merge multiple PDFs
  - Split PDF by page ranges
  - Remove/reorder pages

### 4.2 — PDF Tool Pages

- [ ] `/merge-pdf` — Drag-and-drop multiple PDFs → reorder → merge → download. Show page count per file. Thumbnail previews.
- [ ] `/split-pdf` — Upload PDF → show page thumbnails → select pages or enter ranges → split into separate files or one file with selected pages.
- [ ] `/compress-pdf` — Reduce image quality within PDF, remove metadata. (pdf-lib + Canvas re-compression of embedded images)
- [ ] `/pdf-to-jpg` — PDF.js renders each page to Canvas → export as JPG/PNG. Download as ZIP for multi-page.
- [ ] `/images-to-pdf` — Upload multiple images → reorder → set page size (A4, Letter, fit-to-image) → combine into PDF.
- [ ] `/rotate-pdf` — Select pages → rotate 90/180/270° → download.
- [ ] `/add-page-numbers` — Upload PDF → choose position (top/bottom, left/center/right) → add numbers → download.
- [ ] `/pdf-page-reorder` — Drag-and-drop page thumbnails to reorder → save.

### 4.3 — Category Hub

- [ ] `/pdf-tools` — Grid of all PDF tools, intro paragraph, breadcrumbs

### 4.4 — Testing (PDF Tools)

**Unit tests** (`src/__tests__/unit/lib/pdf-engine.test.ts`):
- [ ] Load valid PDF → returns correct page count
- [ ] Merge 3 PDFs → output has sum of all pages
- [ ] Split 10-page PDF by range "3-5" → output has 3 pages
- [ ] Rotate page → page rotation metadata updated correctly
- [ ] Add page numbers → text drawn at correct position on each page
- [ ] Load corrupt PDF → graceful error, not crash
- [ ] Images-to-PDF: 5 images → 5-page PDF with correct dimensions

**Integration tests:**
- [ ] Full merge flow: 3 files → merge → download → verify valid PDF with correct page count
- [ ] Split + re-merge: split a PDF then merge the parts → result matches original page count
- [ ] Large PDF handling: test with a 50-page PDF → verify no timeout or memory crash

**E2E tests:**
- [ ] `/merge-pdf`: upload 3 PDFs → reorder via drag → merge → download → verify file is valid PDF
- [ ] `/split-pdf`: upload multi-page PDF → page thumbnails render → select range → download
- [ ] `/pdf-to-jpg`: upload PDF → page previews render → download ZIP with correct number of images
- [ ] `/images-to-pdf`: upload 5 images → reorder → download PDF
- [ ] Mobile: drag-and-drop fallback works for file reordering on touch devices

---

## Phase 5: Audio Tools (Week 15–18)

### 5.1 — Audio Engine Setup

- [ ] Create audio processing utilities using **Web Audio API**:
  - Decode audio file to `AudioBuffer` (supports MP3, WAV, OGG, M4A, FLAC natively)
  - Encode to WAV (`audiobuffer-to-wav` package)
  - Encode to MP3 (`lamejs` package)
- [ ] Create `src/lib/workers/audio-worker.ts` for background encoding

### 5.2 — Audio Tool Pages

- [ ] `/audio-trimmer` — Upload audio → waveform visualization (Canvas) → drag start/end handles → preview selection → export trimmed audio. Format: MP3 or WAV.
- [ ] `/mp3-to-wav` — Upload MP3 → decode with Web Audio API → encode to WAV → download.
- [ ] `/wav-to-mp3` — Upload WAV → decode → encode with lamejs → download. Bitrate selector (128/192/256/320 kbps).
- [ ] `/m4a-to-mp3` — Same pipeline as WAV to MP3 (browser decodes M4A natively).
- [ ] `/merge-audio` — Upload multiple audio files → arrange order → concatenate AudioBuffers → export.
- [ ] `/audio-tools` — Category hub page.

### 5.3 — Testing (Audio Tools)

**Unit tests:**
- [ ] MP3 decode → AudioBuffer: verify sample rate, channel count, duration
- [ ] WAV encoding: AudioBuffer → WAV blob with correct RIFF header
- [ ] MP3 encoding via lamejs: AudioBuffer → MP3 blob with correct bitrate
- [ ] Audio trim: trimming 10s audio at 2s–5s → output duration ≈ 3s
- [ ] Merge: two 5s AudioBuffers → merged AudioBuffer duration ≈ 10s
- [ ] Error handling: corrupt audio file → graceful error

**E2E tests:**
- [ ] `/audio-trimmer`: upload MP3 → waveform renders → drag handles → preview plays trimmed section → download
- [ ] `/wav-to-mp3`: upload WAV → select bitrate → download MP3 → verify file plays
- [ ] `/mp3-to-wav`: upload MP3 → download WAV → verify file size is larger (uncompressed)
- [ ] `/merge-audio`: upload 2 files → reorder → merge → download → verify duration is sum

---

## Phase 6: Video Tools (Week 19–24)

### 6.1 — FFmpeg.wasm Setup

- [ ] Install `@ffmpeg/ffmpeg` and `@ffmpeg/core`
- [ ] Create lazy-loading wrapper — only load the ~22MB WASM binary when user navigates to a video tool
- [ ] Handle `SharedArrayBuffer` requirement:
  - Add COOP/COEP headers in Cloudflare `_headers` file
  - Test that ad scripts still work with these headers
  - Fallback: use single-threaded FFmpeg.wasm if headers conflict with ads
- [ ] Create `src/lib/workers/video-worker.ts`
- [ ] Set file size limit: 100MB client-side (show warning for larger files)

### 6.2 — Video Tool Pages

- [ ] `/video-to-gif` — Upload video → select start/end time → frame rate → GIF width → convert → download. Preview GIF before download.
- [ ] `/video-trimmer` — Upload video → visual timeline → drag start/end → export trimmed clip (same format).
- [ ] `/mp4-to-mp3` — Extract audio track from MP4 → download as MP3.
- [ ] `/webm-to-mp4` — Common need for screen recordings → transcode → download.
- [ ] `/compress-video` — Reduce bitrate/resolution → download. Presets: "for WhatsApp", "for Email", "for Web".
- [ ] `/screen-recorder` — `navigator.mediaDevices.getDisplayMedia()` + `MediaRecorder` API. Record screen → save as WebM/MP4. No extension needed.
- [ ] `/video-tools` — Category hub page.

### 6.3 — Testing (Video Tools)

**Unit tests:**
- [ ] FFmpeg.wasm lazy loader: verify WASM binary loads on demand, not on page load
- [ ] File size validation: files >100MB rejected with user-friendly message
- [ ] Video-to-GIF: verify output is valid GIF with frames
- [ ] MP4-to-MP3: verify output is valid MP3 (audio extracted, no video stream)

**Integration tests:**
- [ ] Full FFmpeg pipeline: load WASM → process video → receive output blob → clean up memory
- [ ] SharedArrayBuffer detection: verify graceful fallback to single-threaded mode when headers missing
- [ ] Memory management: processing a 50MB video doesn't crash the tab on 4GB RAM device

**E2E tests:**
- [ ] `/video-to-gif`: upload short MP4 → set start/end → convert → GIF preview renders → download
- [ ] `/video-trimmer`: upload video → drag timeline handles → export → downloaded clip is shorter than original
- [ ] `/mp4-to-mp3`: upload MP4 → download → verify MP3 file plays audio
- [ ] `/screen-recorder`: permission prompt appears → record 3s → stop → preview plays → download works
- [ ] COOP/COEP headers: verify video tools work AND ad scripts still load (no conflicts)
- [ ] Mobile: video tools show "use Wi-Fi recommended" warning for WASM download on mobile data

---

## Phase 7: SEO & Content Optimization (Ongoing from Week 1)

### 7.1 — Technical SEO

- [ ] `sitemap.xml` — Auto-generated from tool registry via `src/app/sitemap.ts`
- [ ] `robots.txt` — Allow all, point to sitemap
- [ ] Submit sitemap to Google Search Console and Bing Webmaster Tools
- [ ] Canonical URLs on every page
- [ ] Open Graph + Twitter Card meta tags on every page
- [ ] Structured data on every tool page: `HowTo`, `FAQPage`, `SoftwareApplication`, `BreadcrumbList`
- [ ] `<html lang="en">` attribute
- [ ] Semantic HTML: `<main>`, `<article>`, `<section>`, `<nav>`, `<header>`, `<footer>`
- [ ] Heading hierarchy: exactly one `<h1>` per page matching primary keyword
- [ ] Image alt tags on all images (tool icons, screenshots, etc.)

### 7.2 — Page Speed Optimization

- [ ] Target **95+ Lighthouse score** on all pages
- [ ] Static export = no server-side rendering overhead
- [ ] Lazy-load tool-specific heavy libraries (heic2any, FFmpeg.wasm, pdf-lib) — only import when user interacts
- [ ] Use `next/font` for font loading (zero layout shift)
- [ ] Optimize images: use WebP format, lazy-load below-fold images
- [ ] Minimize JS bundle per page — each tool page should only load its own processing code
- [ ] Preconnect to ad network domains in `<head>`

### 7.3 — Content Strategy

- [ ] Write **unique 200–400 word** "About This Tool" content for every tool page
- [ ] Write **4–6 unique FAQ items** per tool — answer real questions people search for
- [ ] Add a **blog** section (`/blog`) for long-form SEO content:
  - "HEIC vs JPG: Which Format Should You Use?"
  - "How to Compress Images Without Losing Quality"
  - "The Complete Guide to Modern Image Formats (WebP, AVIF, JPEG XL)"
  - "10 Free Browser-Based Developer Tools You Didn't Know Existed"
  - Each blog post internally links to relevant tool pages

### 7.4 — Internal Linking

- [ ] Every tool page links to 4–6 related tools in a "Related Tools" section
- [ ] Category hub pages link to ALL tools in that category
- [ ] Homepage links to all category hubs + featured tools
- [ ] Blog posts link to relevant tool pages
- [ ] Breadcrumbs on every page: Home > Category > Tool
- [ ] Footer contains links to all categories

---

## Phase 8: Monetization Setup

### 8.1 — Ad Integration

- [ ] Apply for **Google AdSense** (no traffic minimum)
- [ ] Ad placement strategy:
  - **Banner ad** below the tool (after download, before How-To section) — highest visibility
  - **Sidebar ad** on desktop (visible while tool loads/processes)
  - **In-content ad** between FAQ items (mobile)
  - **NO ads above the tool itself** — user experience first
- [ ] Create an `<AdSlot>` component that conditionally renders based on:
  - Whether ad script has loaded
  - Screen size (different ad sizes for mobile vs desktop)
  - Whether user has ad-blocker (gracefully degrade — don't nag)
- [ ] Set up ads.txt file at root

### 8.2 — Freemium Tier (Month 6+)

- [ ] Free tier limits:
  - 5 batch files per session
  - Standard quality compression
  - Basic video tools (30-second clips max)
- [ ] Premium ($5/month or $39/year):
  - Unlimited batch processing
  - Maximum quality settings
  - No ads
  - Priority processing (Web Worker allocation)
  - Extended video file size (500MB)
- [ ] Use Lemon Squeezy or Paddle for payment (easy integration, handles Indian tax compliance)

### 8.3 — Analytics

- [ ] Set up **Google Analytics 4** (free)
- [ ] Track events: tool_used, file_processed, file_downloaded, ad_impression
- [ ] Set up **Google Search Console** — monitor keyword rankings, click-through rates
- [ ] Monthly review: which tools get traffic? Which keywords are ranking? Where to double down?

---

## Phase 9: Quality Assurance, Domain Purchase & Launch

> **The domain `transmute.tools` is purchased only in this phase — after ALL tool phases are complete and you are fully satisfied with quality.**

### 9.1 — Thorough QA Testing (before buying domain)

> By this point, every phase already has unit, integration, and E2E tests written alongside the code (see Phase 0.6 and testing sections in Phases 1–6). This final QA pass is about running the **full suite end-to-end**, manual testing on real devices, and catching anything automated tests miss.

**Automated test gate — ALL must pass before proceeding to 9.2:**
- [ ] `npm run test:coverage` — all unit + integration tests pass, 80%+ coverage on `src/lib/` and `src/hooks/`
- [ ] `npm run test:e2e` — all Playwright E2E tests pass on Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari
- [ ] `npm run build` — static export completes with zero errors and zero warnings
- [ ] `npm run lint` — zero ESLint errors
- [ ] `npx tsc --noEmit` — zero TypeScript errors

**Manual functional testing (every tool):**
- [ ] Test each tool with valid input files — verify correct output
- [ ] Test with edge cases: very large files (50MB+), very small files (1KB), corrupt files, wrong file types
- [ ] Test batch processing: 10+ files at once
- [ ] Test file type validation: uploading a .txt to an image tool should show a clear error
- [ ] Verify download works correctly: right filename, right format, right content
- [ ] Test processing cancellation mid-way
- [ ] Test rapid re-uploads without page refresh

**Cross-browser testing:**
- [ ] Chrome (latest) — primary target
- [ ] Firefox (latest)
- [ ] Safari (latest) — especially important, OffscreenCanvas and some codecs behave differently
- [ ] Edge (latest)
- [ ] Samsung Internet (top Android browser in India)

**Mobile testing (real devices, not just dev tools):**
- [ ] iPhone Safari — test file upload via camera roll and Files app
- [ ] Android Chrome — test on a mid-range phone (budget processor, 4GB RAM)
- [ ] Verify touch targets are large enough (min 44×44px)
- [ ] Test drag-and-drop fallback (mobile doesn't support drag-and-drop — tap-to-upload must work)
- [ ] Verify no horizontal scroll on any page at 320px width
- [ ] Test landscape orientation

**Performance testing:**
- [ ] Lighthouse audit every tool page: target Performance 95+, Accessibility 95+, SEO 100
- [ ] Test processing speed on a budget Android device — ensure Web Workers prevent UI freeze
- [ ] Verify lazy loading: FFmpeg.wasm only loads on video tool pages, pdf-lib only on PDF pages
- [ ] Check total JS bundle size per page — keep under 200KB initial load (excluding lazy chunks)

**SEO validation:**
- [ ] Validate JSON-LD schemas with Google's Rich Results Test for every tool page
- [ ] Check every page has: unique H1, unique meta description (150–160 chars), canonical URL
- [ ] Verify sitemap.xml lists all pages
- [ ] Run Screaming Frog or similar crawler to check for broken links, missing titles, duplicate content
- [ ] Test Open Graph previews (paste URL in Twitter, LinkedIn, WhatsApp — check preview card)

**Visual QA:**
- [ ] Check dark theme consistency across all pages — no white flashes, no mismatched backgrounds
- [ ] Verify font loading: no FOUT (flash of unstyled text), fallback fonts match sizes
- [ ] Check all animations are smooth (60fps) and respect `prefers-reduced-motion`
- [ ] Screenshot every page at 375px, 768px, 1024px, 1440px and review

**Accessibility:**
- [ ] Keyboard navigation: Tab through every tool page, verify all interactive elements are reachable
- [ ] Screen reader: test with VoiceOver (Mac/iOS) — verify file upload, processing status, and download are announced
- [ ] Color contrast: all text meets WCAG AA (4.5:1 minimum)
- [ ] Focus indicators visible on all interactive elements

### 9.2 — Domain Purchase & DNS Setup (only after 9.1 passes)

- [ ] Purchase `transmute.tools` on GoDaddy
- [ ] **Immediately** turn off auto-renewal on GoDaddy
- [ ] Change GoDaddy nameservers to Cloudflare (add domain to Cloudflare free plan)
- [ ] In Cloudflare DNS, add records pointing to GitHub Pages:
  ```
  Type    Name    Value
  A       @       185.199.108.153
  A       @       185.199.109.153
  A       @       185.199.110.153
  A       @       185.199.111.153
  CNAME   www     ishankgupta95.github.io
  ```
- [ ] In GitHub repo: Settings → Pages → Custom domain → `transmute.tools`
- [ ] Add `CNAME` file in repo root containing `transmute.tools`
- [ ] Enable "Enforce HTTPS" in GitHub Pages settings
- [ ] **Update codebase for custom domain:**
  - [ ] Remove `basePath: '/transmute'` from `next.config.ts`
  - [ ] Update all canonical URLs from GitHub Pages URL to `https://transmute.tools`
  - [ ] Update `sitemap.ts` base URL
  - [ ] Update Open Graph URLs
  - [ ] Update `robots.txt` sitemap URL
- [ ] Deploy updated build to GitHub Pages
- [ ] Verify site loads correctly on `https://transmute.tools`
- [ ] Verify HTTPS works (green padlock)
- [ ] Verify `www.transmute.tools` redirects to `transmute.tools` (or vice versa — pick one, be consistent)

### 9.3 — Post-Launch Setup

- [ ] Submit sitemap to Google Search Console
- [ ] Submit site to Bing Webmaster Tools
- [ ] Set up Google Analytics 4
- [ ] Apply for Google AdSense
- [ ] Set up ads.txt file at root
- [ ] Request indexing for top 10 highest-priority tool pages in Search Console

### 9.4 — Launch Promotion

- [ ] Submit to Product Hunt
- [ ] Post on Reddit: r/webdev, r/InternetIsBeautiful, r/SideProject, r/reactjs
- [ ] Post on Hacker News (Show HN)
- [ ] Share on Twitter/X with demo GIFs
- [ ] Submit to tool directories: AlternativeTo, ToolsForCreators, SaaSHub
- [ ] Write a Dev.to / Hashnode article: "I Built 70+ Browser-Based Tools with Zero Server Costs"

### 9.5 — Domain Transfer (60 days after purchase)

- [ ] Unlock domain on GoDaddy
- [ ] Get transfer authorization code from GoDaddy
- [ ] Initiate transfer on Cloudflare Registrar (costs one year's renewal, extends registration by a year)
- [ ] Verify transfer completes (3–5 days)
- [ ] Confirm DNS still points correctly after transfer

### 9.6 — Ongoing Growth

- [ ] Add 2–3 new tools per month
- [ ] Monitor Search Console for "impressions but low clicks" → optimize title/description
- [ ] Monitor Search Console for "queries you're appearing for" → create tools targeting those exact queries
- [ ] Build backlinks: contribute to "best free online tools" listicles, write guest posts
- [ ] Consider multi-language support (Spanish, Portuguese, Hindi) for Phase 2 growth
- [ ] Upgrade ad network as traffic grows: AdSense → Ezoic → Mediavine

---

## Dependency Cheat Sheet

```bash
# Core
next react react-dom typescript tailwindcss

# UI utilities
clsx tailwind-merge lucide-react

# Image processing
heic2any                    # HEIC → JPEG/PNG
pica                        # High-quality image resizing
cropperjs                   # Interactive image cropping
browser-image-compression   # Smart image compression
utif                        # TIFF decoding
exif-js                     # EXIF metadata reading
qr-code-styling             # QR code generation

# PDF processing
pdf-lib                     # PDF manipulation (merge, split, edit)
pdfjs-dist                  # PDF rendering/viewing
jspdf                       # PDF generation from scratch

# Audio processing
lamejs                      # MP3 encoding in browser
audiobuffer-to-wav          # WAV encoding

# Video processing
@ffmpeg/ffmpeg              # Video transcoding/trimming
@ffmpeg/core                # FFmpeg WASM core

# Developer tools
sql-formatter               # SQL formatting
marked                      # Markdown → HTML
turndown                    # HTML → Markdown
jsdiff                      # Text diffing
js-md5                      # MD5 hashing
papaparse                   # CSV parsing

# Testing
vitest                      # Unit & integration test runner
@testing-library/react      # React component testing
@testing-library/jest-dom   # DOM assertion matchers
@testing-library/user-event # Simulate user interactions
jsdom                       # Browser environment for Vitest
playwright                  # E2E browser testing
@playwright/test            # Playwright test runner
```

---

## Timeline Summary

| Phase | Scope | Duration | Pages Added |
|-------|-------|----------|-------------|
| Phase 0 | Foundation & design system | Week 1 | 0 (infrastructure) |
| Phase 1 | Image format converters | Week 1–3 | ~12 pages |
| Phase 2 | Image utilities | Week 4–6 | ~10 pages |
| Phase 3 | Developer tools | Week 7–9 | ~25 pages |
| Phase 4 | PDF tools | Week 10–14 | ~10 pages |
| Phase 5 | Audio tools | Week 15–18 | ~7 pages |
| Phase 6 | Video tools | Week 19–24 | ~8 pages |
| Phase 7 | SEO optimization | Ongoing | Blog posts |
| Phase 8 | Monetization setup | Month 5+ | — |
| Phase 9 | **QA → Buy `transmute.tools` → Launch** | Month 6–7 | — |
| **Total** | | **~7 months** | **70+ tool pages** |

> **Key milestone**: Domain is purchased ONLY at Phase 9 after thorough QA.
> During Phases 0–8, the app runs on GitHub Pages at `ishankgupta95.github.io/transmute`.