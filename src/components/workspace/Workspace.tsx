"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { getToolBySlug } from "@/data/tools";
import {
  getWorkspaceTool,
  pipelineByArchetype,
  workspaceTools,
  type WorkspaceFilter,
} from "@/data/workspace";
import { ToolClient } from "@/components/tools/ToolClient";
import { TopBar } from "@/components/workspace/TopBar";
import { ToolRail } from "@/components/workspace/ToolRail";
import { PipelineBar } from "@/components/workspace/PipelineBar";
import { StatusBar } from "@/components/workspace/StatusBar";
import { SCROLL_CLASS, TOOL_SURFACE } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/**
 * The workspace shell — Phase 4: every canvas is the REAL tool.
 *
 * The rail, filters, pipeline strip and status bar stay; the seeded
 * Canvas/Sidebar simulator (fake progress timer, estimated sizes, sample
 * rows) is gone. Whatever you pick mounts the same `*UI.tsx` component the
 * tool's own page renders, through the same `ToolClient` switch — one
 * implementation, two surfaces, never a fork. Each UI ships as its own
 * `next/dynamic` chunk, so tool code loads on selection, not on route load.
 */

const DEFAULT_SLUG = "compress-image";

/*
  The selected tool lives in the URL (`/workspace?tool=slug`) so any state is
  a shareable deep link. Read through useSyncExternalStore — the server
  snapshot is null, so the export prerenders the default tool and the client
  reads the real query after hydration without a setState-in-an-effect.
  `history.replaceState` doesn't fire popstate, so picks notify listeners
  by hand.
*/
const urlListeners = new Set<() => void>();

function subscribeToolParam(onChange: () => void): () => void {
  urlListeners.add(onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    urlListeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function readToolParam(): string | null {
  return new URLSearchParams(window.location.search).get("tool");
}

function writeToolParam(slug: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("tool", slug);
  history.replaceState(null, "", url);
  for (const listener of urlListeners) listener();
}

export function Workspace() {
  const [filter, setFilter] = useState<WorkspaceFilter>("ALL");
  const urlSlug = useSyncExternalStore(subscribeToolParam, readToolParam, () => null);

  // Unknown or absent ?tool= falls back to the default rather than a crash —
  // stale links to renamed tools should still land somewhere useful.
  const slug = urlSlug && getWorkspaceTool(urlSlug) ? urlSlug : DEFAULT_SLUG;
  const ws = getWorkspaceTool(slug) ?? workspaceTools[0];
  const tool = getToolBySlug(ws.slug);

  const pick = useCallback((next: string) => writeToolParam(next), []);

  const shown =
    filter === "ALL" ? workspaceTools : workspaceTools.filter((t) => t.cat === filter);

  return (
    /*
      Height model (doc: `<div style="display:flex;height:770px">` between a
      52px top bar and a 30px status bar). From `lg` the shell takes the
      viewport column its parent bounds and refuses to grow past it, so the
      rail's `overflow-y-auto` finally engages and the status bar stays on
      screen. Below `lg` the columns stack and the minimum is all that
      applies — a phone is meant to scroll.
    */
    <div className="flex min-h-[calc(100vh-58px)] w-full flex-col border-b border-nocturne-divider bg-nocturne-bg lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <TopBar
        category={ws.cat}
        toolName={ws.name}
        filter={filter}
        onFilterChange={setFilter}
      />

      {/* Content caps at the site's 1440 measure so the shell lines up with the navbar. */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col lg:min-h-0 lg:flex-row">
        <ToolRail tools={shown} activeSlug={ws.slug} onPick={pick} />

        {/* A section, not a <main>: the route already opened one in
            app/workspace/page.tsx, and nesting a second left screen readers
            with two unlabelled `main` landmarks. */}
        <section
          aria-label="Tool canvas"
          className="relative flex min-w-0 flex-1 flex-col"
        >
          <PipelineBar
            steps={pipelineByArchetype[ws.kind] ?? []}
            engine={ws.engine}
            accept={ws.accept}
          />

          {/* The canvas — the real, working tool (same backdrop treatment as
              the tool pages). Inset is the doc's `padding:20px 24px`, which
              each archetype pane carries once.

              The doc's main column is `overflow:hidden`; a prototype pane
              always fits, a real tool does not, so the band scrolls instead
              of clipping. That keeps the doc's "every column scrolls inside
              itself" model without losing content, and it is why the
              decoration keeps its own clipper rather than the band taking
              `overflow-hidden` back (Phase 7: that killed the aside's
              `sticky`). No `justify-center` either — the surface stretches. */}
          <div
            className={cn(
              "relative flex min-h-0 flex-1 flex-col bg-nocturne-canvas px-4 py-5 md:px-6 lg:overflow-y-auto",
              SCROLL_CLASS,
            )}
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(233,233,237,.055)_1px,transparent_0)] bg-[length:22px_22px] opacity-50" />
              <div className="absolute -top-[90px] left-[38%] h-[300px] w-[420px] animate-tm-glow rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_30%,transparent)_0%,transparent_70%)] blur-[110px] motion-reduce:animate-none" />
            </div>
            {/*
              Literally the tool pages' surface — the same `TOOL_SURFACE`
              constant, not a second copy of the grid that drifted from it
              (this one was still capped at 1180 and still split at `lg`).
              The tool's fragment is (canvas, <ToolAside>) and `:has()` widens
              to two columns only when the aside is actually rendered, so the
              tool's own aside IS the workspace sidebar.
            */}
            {/* The doc gives every archetype pane `animation:tmRise .3s
                cubic-bezier(.2,.7,.3,1)` on entry. The key sits on the
                animated element, not on `ToolClient`, so the surface itself
                remounts on every rail pick and the rise actually replays —
                keying only the child would have run it once, at page load.
                It still remounts the tool with it: switching tools must
                remount, not reuse, the previous tool's state. */}
            <div
              key={ws.slug}
              data-tool-surface=""
              className={cn(TOOL_SURFACE, "animate-tm-rise motion-reduce:animate-none")}
            >
              {tool ? <ToolClient tool={tool} /> : null}
            </div>
          </div>
        </section>
      </div>

      <StatusBar
        engine={ws.engine}
        index={workspaceTools.indexOf(ws) + 1}
        total={workspaceTools.length}
      />
    </div>
  );
}
