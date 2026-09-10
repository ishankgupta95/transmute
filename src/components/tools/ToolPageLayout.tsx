import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { FAQ } from "@/data/faqs";
import type { Tool } from "@/data/tools";
import { getToolBySlug, getToolsByCategory, tools } from "@/data/tools";
import { getCategoryBySlug } from "@/data/categories";
import { getPostsLinkingToTool } from "@/data/posts";
import { getWorkspaceTool, pipelineByArchetype } from "@/data/workspace";
import { ToolSchema } from "@/components/seo/ToolSchema";
import { BreadcrumbSchema } from "@/components/seo/BreadcrumbSchema";
import { ToolUsedTracker } from "@/components/tools/ToolUsedTracker";
import { RequestReadout } from "@/components/tools/RequestReadout";
import { CapabilityReadout } from "@/components/tools/CapabilityReadout";
import { RecentOutputs } from "@/components/tools/RecentOutputs";
import { cn } from "@/lib/utils/cn";
import { TOOL_SURFACE } from "@/components/workspace/shared";
import {
  DEFAULT_SURFACE_HEIGHTS,
  toolSurfaceHeights,
} from "@/data/tool-surface-heights";

interface ToolPageLayoutProps {
  tool: Tool;
  children: ReactNode;
  howToSteps: string[];
  faqs: FAQ[];
  aboutText?: string;
}

/**
 * Every horizontal band of the workspace shell. Backgrounds stay full-bleed;
 * the content inside lines up with the navbar, footer and every other page.
 */
const BAND = "mx-auto flex w-full max-w-[1440px]";

const MONO_LABEL =
  "font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted";
/*
  The doc's spec panel is a 250px key/value column beside the h1 — one mono row
  per fact, key left, value right — not the four stacked tiles this used to
  draw across the full measure.
*/
const SPEC_ROW =
  "flex items-center justify-between gap-3 bg-bg-primary px-[13px] py-2.5 font-mono text-[11px] leading-none";
const SPEC_KEY = "flex-none text-text-muted";
const SPEC_VALUE = "min-w-0 truncate text-right text-neutral-300";
const H2 = "m-0 font-display text-xl leading-[1.2] font-medium text-text-primary";
const ROW =
  "flex items-center gap-3.5 border-b border-border py-[13px] transition-[padding-left] duration-200 hover:pl-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The Nocturne signature rule: a hairline that fades to transparent over
 * exactly 48px at each end. The doc draws one between the header and the
 * how-to grid, and one between the how-to grid and the sections below.
 */
const RULE =
  "h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_48px,var(--color-border)_calc(100%-48px),transparent)]";

/** The doc's `220px 1fr` split: the h2 sits in its own left column. */
const DOC_SECTION = "grid gap-4 md:grid-cols-[220px_1fr] md:items-start md:gap-11";

export function ToolPageLayout({
  tool,
  children,
  howToSteps,
  faqs,
  aboutText,
}: ToolPageLayoutProps) {
  const ws = getWorkspaceTool(tool.slug);
  // The tool UI mounts client-side (ssr:false), so below lg the surface has no
  // height until it arrives and everything after it shifts down (live-site CLS
  // 0.397). Reserve each page's measured initial height up front; desktop
  // needs none — the band's flex chain sizes the region before the UI mounts.
  const surface = toolSurfaceHeights[tool.slug] ?? DEFAULT_SURFACE_HEIGHTS;
  const category = getCategoryBySlug(tool.category);
  const siblings = getToolsByCategory(tool.category);
  const pipeline = ws ? (pipelineByArchetype[ws.kind] ?? []) : [];
  const toolIndex = tools.findIndex((t) => t.slug === tool.slug) + 1;

  const relatedTools = tool.relatedTools
    .map((slug) => getToolBySlug(slug))
    .filter((t): t is Tool => t !== undefined);
  const blogPosts = getPostsLinkingToTool(tool.slug);

  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: category?.name ?? tool.category, href: `/${tool.category}` },
    { name: tool.name, href: `/${tool.slug}` },
  ];

  // Rendered twice: the lg sidebar rail, and the collapsed disclosure below it.
  const railLinks = siblings.map((t) => {
    const active = t.slug === tool.slug;
    return (
      <Link
        key={t.slug}
        href={`/${t.slug}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-[9px] rounded-[7px] px-[9px] py-2 transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
          active
            ? "bg-accent/14 text-accent-200"
            : "text-text-muted hover:bg-text-primary/5 hover:text-neutral-300",
        )}
      >
        <span
          className={cn(
            "h-[22px] w-0.5 flex-none rounded-[2px]",
            active ? "bg-accent" : "bg-transparent",
          )}
        />
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="max-w-[170px] truncate font-body text-[12.5px] leading-[1.25] font-medium">
            {t.name}
          </span>
          <span className="font-mono text-[9.5px] leading-none tracking-[0.04em] opacity-[0.62]">
            {getWorkspaceTool(t.slug)?.route}
          </span>
        </span>
      </Link>
    );
  });

  return (
    <main className="flex-1">
      <ToolUsedTracker slug={tool.slug} category={tool.category} />
      <ToolSchema
        toolName={tool.name}
        toolDescription={tool.description}
        toolSlug={tool.slug}
        howToSteps={howToSteps}
        faqs={faqs}
      />
      <BreadcrumbSchema items={breadcrumbs} />

      {/*
        ══ Workspace ═══════════════════════════════════════════
        Roughly viewport-tall: this IS the page, not a card on it. The site
        navbar above is the shell's top bar — the design doc drew one because
        its artboard framed the whole browser window.

        Each band paints its background edge to edge but caps its *content* at
        `max-w-[1440px]`, exactly as Navbar, Footer, the hubs and the homepage
        do — so the shell lines up with the navbar on wide screens instead of
        running past it.
      */}
      <div className="flex flex-col border-b border-border lg:min-h-[calc(100vh-58px)]">
        <div className="border-b border-border bg-nocturne-chrome">
          <div className={cn(BAND, "items-center gap-4 px-4 py-2 md:px-11")}>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-[7px] font-mono text-[11px] leading-none whitespace-nowrap text-text-muted"
            >
              <Link
                href="/"
                className="hidden transition-colors duration-200 hover:text-accent-200 sm:inline"
              >
                HOME
              </Link>
              <span aria-hidden="true" className="hidden opacity-45 sm:inline">
                /
              </span>
              <Link
                href={`/${tool.category}`}
                className="flex-none transition-colors duration-200 hover:text-accent-200"
              >
                {(category?.shortName ?? tool.category).toUpperCase()}
              </Link>
              <span aria-hidden="true" className="opacity-45">
                /
              </span>
              <span className="truncate text-text-primary">{tool.name}</span>
            </nav>

            {/* Repeated verbatim in the status bar, so it is dropped on small screens. */}
            <div className="ml-auto hidden flex-none items-center gap-[7px] lg:flex">
              {/* 2.2.2: a 3.2s infinite blink on all 171 tool pages needs a way
                  out. The navbar's identical dot already carries this
                  (Navbar.tsx), so its absence here was an oversight. */}
              <span className="size-1.5 animate-tm-blink rounded-full bg-success motion-reduce:animate-none" />
              <span className="font-mono text-[10.5px] leading-none tracking-[0.04em] whitespace-nowrap text-text-muted">
                LOCAL · NO UPLOAD
              </span>
            </div>
          </div>
        </div>

        {/*
          Below lg the design's Tablet/Phone screens are canvas-first: no rail,
          no pipeline strip, just the bar and the tool. The rail collapses to a
          one-row disclosure rather than disappearing, so in-category
          navigation survives on touch.
        */}
        <details className="group border-b border-border bg-nocturne-rail lg:hidden">
          <summary className={cn(BAND, "cursor-pointer list-none items-center gap-2.5 px-4 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent")}>
            <span className={MONO_LABEL}>
              ALL {(category?.shortName ?? tool.category).toUpperCase()} TOOLS
            </span>
            <span className="font-mono text-[9.5px] leading-none text-text-muted">
              {siblings.length}
            </span>
            <span
              aria-hidden="true"
              className="ml-auto font-mono text-[11px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
            >
              ▸
            </span>
          </summary>
          <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-px px-2 pb-3 sm:grid-cols-2">
            {railLinks}
          </div>
        </details>

        <div className={cn(BAND, "flex-1 flex-col lg:flex-row")}>
          {/* Sibling tools in this category. */}
          <nav
            aria-label={`Other ${category?.shortName ?? ""} tools`}
            /*
              The cap is load-bearing, not cosmetic. The rail's own content is
              1011px on a 22-tool category, and because it is a flex item in a
              row whose parent only carries a `min-height`, that number set the
              height of the whole shell — so the canvas band measured an
              identical 967px at 1440×900 and 1920×1080 and no preview inside
              it could track the viewport. Capping the rail at the band's own
              height (viewport − navbar − top bar − status bar) hands the row
              back to the canvas and lets the list scroll, which is what its
              `overflow-y-auto` was always meant to do.
            */
            className="hidden flex-none flex-col border-border bg-nocturne-rail lg:flex lg:max-h-[calc(100vh-124px)] lg:w-[214px] lg:border-r"
          >
            <div className="flex items-baseline justify-between px-3 pt-3.5 pb-2">
              <span className={MONO_LABEL}>TOOLS</span>
              <span className="font-mono text-[9.5px] leading-none text-text-muted">
                {siblings.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-px overflow-y-auto px-2 pb-2.5">
              {railLinks}
            </div>
            {/* The doc's RECENT OUTPUT section — real saved downloads,
                hidden until one exists. */}
            <RecentOutputs />
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:px-[18px] lg:h-11 lg:py-0">
              <span className={cn(MONO_LABEL, "hidden lg:mr-1 lg:inline")}>PIPELINE</span>
              {pipeline.map((step, i) => (
                <span
                  key={step}
                  className={cn(
                    "hidden h-6 flex-none items-center rounded-[6px] border px-2.5 font-body text-[11px] leading-none font-medium whitespace-nowrap lg:flex",
                    i === 0
                      ? "border-accent/55 bg-accent/12 text-accent-200"
                      : "border-border text-neutral-400",
                  )}
                >
                  {i > 0 ? `▸ ${step}` : step}
                </span>
              ))}
              <div className="flex min-w-0 items-center gap-3 font-mono text-[10.5px] leading-none text-text-muted lg:ml-auto lg:whitespace-nowrap">
                <span className="flex-none">ENGINE {ws?.engine}</span>
                <span aria-hidden="true" className="flex-none opacity-40">
                  ·
                </span>
                <span className="truncate">ACCEPTS {ws?.accept}</span>
              </div>
            </div>

            {/*
              The canvas — the real, working tool.

              No `overflow-hidden` here: it made this band the scroll port for
              `ToolAside`'s `lg:sticky`, so the control rail scrolled away with
              the page instead of pinning. The decoration below is clipped by
              its own wrapper instead, which is all the property was doing.

              No `justify-center` either: centring an intrinsically-sized
              surface is what left a viewport-tall band mostly empty. The
              surface stretches instead (see `TOOL_SURFACE`).
            */}
            {/* `padding:22px 26px` is the doc's canvas band on every branch —
                and it hands the stage back the 36px of vertical padding the
                previous `lg:py-10` was spending on empty dot-grid. */}
            <div className="relative flex min-h-0 flex-1 flex-col bg-nocturne-canvas px-4 py-6 md:px-[26px] lg:py-[22px]">
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(233,233,237,.055)_1px,transparent_0)] bg-[length:22px_22px] opacity-50" />
                {/* 2.2.2: 9s infinite. Decorative, so reduced motion simply
                    freezes it rather than removing the glow. */}
                <div className="absolute -top-[90px] left-[38%] h-[300px] w-[420px] animate-tm-glow rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_34%,transparent)_0%,transparent_70%)] blur-[110px] motion-reduce:animate-none" />
              </div>
              {/*
                Two columns — canvas + control rail — but only for tools that
                actually render a `ToolAside`. `:has()` keeps the single-column
                width for the ones still holding their controls inline, so the
                migration can land tool by tool.
              */}
              <section
                /*
                 * Marks the tool's OWN interactive surface, as distinct from the
                 * navbar, the FAQ accordion and the related-tools list — all of
                 * which render buttons inside <main>. The all-tools sweep asserts
                 * against this region so "the page has a button somewhere" can
                 * never stand in for "the tool actually mounted".
                 */
                data-tool-surface=""
                /*
                 * WCAG 1.3.1 / 2.4.6. Everything above the fold used to be
                 * heading-less — the rail's title is a <div>, CanvasHeader is a
                 * <span> — so a screen-reader user navigating by heading passed
                 * every control on the page before hearing anything, and the
                 * first heading they hit was the marketing <h1> below the tool.
                 * ExifViewerUI's group headings were left orphaned at h3 with no
                 * h1 or h2 above them for the same reason.
                 *
                 * The name is visually hidden because the design deliberately
                 * has no title over the canvas. `sr-only` is
                 * `position:absolute`, so this is NOT a grid item and cannot
                 * disturb the two-column `TOOL_SURFACE` layout.
                 */
                aria-labelledby="tool-surface-heading"
                style={
                  {
                    "--surface-min-sm": `${surface.sm}px`,
                    "--surface-min-md": `${surface.md}px`,
                  } as CSSProperties
                }
                className={cn(
                  TOOL_SURFACE,
                  "min-h-[var(--surface-min-sm)] md:min-h-[var(--surface-min-md)]",
                )}
              >
                <h2 id="tool-surface-heading" className="sr-only">
                  {tool.name}
                </h2>
                {children}
              </section>
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-nocturne-status">
          <div
            className={cn(
              BAND,
              "min-h-[30px] flex-wrap items-center gap-y-1 px-4 py-1.5 font-mono text-[10px] leading-none tracking-[0.04em] text-text-muted md:px-11 lg:h-[30px] lg:py-0",
            )}
          >
            {/*
              The engine's NAME. It used to be its name plus READY.

              The value is a registry string — workspace.ts: "`engine` names the
              library the tool's lib/ module actually imports" — and nothing on
              this page checks whether that library is anywhere near the device.
              Every engine with a download is fetched on first use, so this cell
              read "WEB AUDIO·LAMEJS·FFMPEG READY" on /wma-to-mp3 while the 32 MB
              core had not been requested at all, and read exactly the same in an
              offline tab with no copy of it stored anywhere.

              The precedent is two cells to the right: CapabilityReadout replaced
              the design doc's seeded "SIMD ✓ · THREADS 8" with this machine's own
              values, because "a capability claim we can't verify is a claim we
              don't make". The name is a fact this file can stand behind and is
              what the PIPELINE strip labels ENGINE 40px above; the readiness was
              the half nothing measured, so the word is gone rather than moved.

              STILL UNDONE: the bar cannot yet say whether the engine is present
              on THIS device. Earning a readiness word needs a Cache API probe and
              a per-tool engine→artifact map, and the map is the hard half — the
              PDF tools' "PDF-LIB" is a ~445 KB bundle under /workers/, not page
              JS, so a "nothing to download" badge derived from this string would
              be a new false claim in place of the old one.
            */}
            <span className="flex items-center gap-1.5">
              <span className="size-[5px] rounded-full bg-accent" />
              {ws?.engine}
            </span>
            <span aria-hidden="true" className="px-3 opacity-30">
              │
            </span>
            <span>
              TOOL {toolIndex} OF {tools.length}
            </span>
            <span className="hidden sm:contents">
              <CapabilityReadout />
            </span>
            <span className="ml-auto flex items-center gap-3.5">
              {/*
                Was the literal string `0 BYTES SENT`. True, and unfalsifiable —
                the same objection that took READY off the ENGINE cell two
                stanzas up. `RequestReadout` counts this document's own resource
                timeline instead, and deliberately says REQUESTS rather than
                bytes, because the API exposes bytes RECEIVED and nothing at all
                about a request body. The narrower sentence is the one the
                measurement can carry.
              */}
              <RequestReadout />
              <span aria-hidden="true" className="hidden opacity-30 sm:inline">
                │
              </span>
              <span className="hidden sm:inline">{tools.length} TOOLS INSTALLED</span>
            </span>
          </div>
        </div>
      </div>

      {/* ══ Below the fold — documentation ══════════════════════ */}
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-14 px-4 pt-14 pb-12 md:px-10">
        {/* h1 + lede on the left, the spec panel beside them at 250px. */}
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-14">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 mb-3 font-display text-[clamp(26px,4.5vw,32px)] leading-[1.15] font-medium tracking-[-0.02em] text-text-primary">
              {tool.h1}
            </h1>
            <p className="m-0 max-w-[600px] font-body text-[15px] leading-[1.65] text-neutral-400">
              {tool.subtitle}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2.5 md:w-[250px] md:flex-none">
            <div className="flex flex-col gap-px overflow-hidden rounded-[9px] border border-border bg-border">
              <div className={SPEC_ROW}>
                <span className={SPEC_KEY}>ENGINE</span>
                <span className={SPEC_VALUE}>{ws?.engine}</span>
              </div>
              <div className={SPEC_ROW}>
                <span className={SPEC_KEY}>ACCEPTS</span>
                <span className={SPEC_VALUE}>{ws?.accept}</span>
              </div>
              <div className={SPEC_ROW}>
                <span className={SPEC_KEY}>MAX SIZE</span>
                {/*
                  Three states, matching DropZone's. "NONE" is an absolute
                  claim and is only printed for tools that can carry it — the
                  ones that never hold the whole input in the tab. A tool with
                  `practicalLimitNote` has a ceiling it does not enforce, so it
                  gets the word and the sentence under the panel; `SPEC_VALUE`
                  is `truncate` inside 250px, so the sentence cannot live in
                  the row itself.
                */}
                <span className={SPEC_VALUE}>
                  {tool.maxSizeMB
                    ? `${tool.maxSizeMB} MB`
                    : tool.practicalLimitNote
                      ? "MEMORY-BOUND"
                      : "NONE"}
                </span>
              </div>
              <div className={SPEC_ROW}>
                <span className={SPEC_KEY}>UPLOAD</span>
                <span className={cn(SPEC_VALUE, "text-success")}>NEVER</span>
              </div>
            </div>
            {!tool.maxSizeMB && tool.practicalLimitNote && (
              <p className="m-0 font-body text-[11.5px] leading-[1.5] text-text-muted">
                {tool.practicalLimitNote}
              </p>
            )}
          </div>
        </div>

        {howToSteps.length > 0 && (
          <>
            <div aria-hidden="true" className={RULE} />
            {/*
              The doc's three-column how-to. Its cells carry a titled headline
              over the body copy; `howToSteps` is a flat `string[]` shared with
              the HowTo structured data, so the title tier waits on a metadata
              change (owner call) — the grid does not.
            */}
            <section className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-[34px]">
              {howToSteps.map((step, i) => (
                <div key={i} className="flex flex-col gap-[9px]">
                  <span className="font-mono text-[11px] leading-none font-medium text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-body text-[13px] leading-[1.6] text-neutral-400">
                    {step}
                  </span>
                </div>
              ))}
            </section>
          </>
        )}

        {(aboutText || faqs.length > 0 || blogPosts.length > 0 || relatedTools.length > 0) && (
          <div aria-hidden="true" className={RULE} />
        )}

        {aboutText && (
          <section className={DOC_SECTION}>
            <h2 className={H2}>About {tool.name}</h2>
            <p className="m-0 max-w-[620px] font-body text-sm leading-[1.75] text-neutral-400">
              {aboutText}
            </p>
          </section>
        )}

        {faqs.length > 0 && (
          <section className={DOC_SECTION}>
            <h2 className={H2}>Questions</h2>
            <div className="flex flex-col">
              {faqs.map((faq, i) => (
                <details key={i} className="group border-b border-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-body text-sm leading-[1.4] font-medium text-text-primary transition-colors duration-200 hover:text-accent-200">
                    {faq.question}
                    <span
                      aria-hidden="true"
                      className="flex-none font-mono text-base leading-none text-text-muted transition-transform duration-200 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="m-0 max-w-[620px] pb-5 font-body text-[13px] leading-[1.65] text-text-muted">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        )}

        {blogPosts.length > 0 && (
          <section className={DOC_SECTION}>
            <h2 className={H2}>From the blog</h2>
            <div className="flex flex-col">
              {blogPosts.map((post) => (
                <Link key={post.slug} href={`/blog/${post.slug}`} className={ROW}>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-body text-[13.5px] leading-[1.3] font-medium text-text-primary">
                      {post.title}
                    </span>
                    <span className="line-clamp-1 font-body text-[11.5px] text-text-muted">
                      {post.description}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[10px] whitespace-nowrap text-text-muted">
                    {post.readingTime} MIN
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {relatedTools.length > 0 && (
          <section className={DOC_SECTION}>
            <h2 className={H2}>Related</h2>
            {/*
              The doc's bordered cards, not underlined rows. The two-line
              description is extra-in-app and SEO-load-bearing, so the card is
              taller than the doc's one-line version — kept deliberately.
            */}
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {relatedTools.map((related) => (
                <Link
                  key={related.slug}
                  href={`/${related.slug}`}
                  className="flex items-center justify-between gap-3 rounded-[9px] border border-border px-[15px] py-3.5 transition-colors duration-200 hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="font-body text-[13.5px] leading-[1.3] text-neutral-300">
                      {related.name}
                    </span>
                    <span className="line-clamp-2 font-body text-[11.5px] leading-[1.45] text-text-muted">
                      {related.description}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[10px] leading-none whitespace-nowrap text-text-muted">
                    {getWorkspaceTool(related.slug)?.route}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
