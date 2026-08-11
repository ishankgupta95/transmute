"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { getToolBySlug } from "@/data/tools";
import {
  getWorkspaceTool,
  pipelineByArchetype,
  workspaceTools,
  type WorkspaceFilter,
} from "@/data/workspace";
import { cn } from "@/lib/utils/cn";
import { ToolClient } from "@/components/tools/ToolClient";
import { TopBar } from "@/components/workspace/TopBar";
import { ToolRail } from "@/components/workspace/ToolRail";
import { PipelineBar } from "@/components/workspace/PipelineBar";
import { StatusBar } from "@/components/workspace/StatusBar";

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
    <div className="flex min-h-[calc(100vh-58px)] w-full flex-col border-b border-nocturne-divider bg-nocturne-bg">
      <TopBar
        category={ws.cat}
        toolName={ws.name}
        filter={filter}
        onFilterChange={setFilter}
      />

      {/* Content caps at the site's 1440 measure so the shell lines up with the navbar. */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col lg:flex-row">
        <ToolRail tools={shown} activeSlug={ws.slug} onPick={pick} />

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <PipelineBar
            steps={pipelineByArchetype[ws.kind] ?? []}
            engine={ws.engine}
            accept={ws.accept}
          />

          {/* The canvas — the real, working tool (same backdrop treatment as
              the tool pages). */}
          <div className="relative flex flex-1 flex-col overflow-hidden bg-nocturne-canvas px-4 py-6 md:px-8 lg:justify-center lg:py-10">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(233,233,237,.055)_1px,transparent_0)] bg-[length:22px_22px] opacity-50" />
            <div className="pointer-events-none absolute -top-[90px] left-[38%] h-[300px] w-[420px] animate-tm-glow rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_30%,transparent)_0%,transparent_70%)] blur-[110px]" />
            {/*
              The same canvas + control-rail grid the tool pages use: the
              tool's fragment is (canvas, <ToolAside>), and `:has()` widens
              to two columns only when the aside is actually rendered. The
              tool's own aside IS the workspace sidebar.
            */}
            <div
              className={cn(
                "relative mx-auto grid w-full max-w-[820px] grid-cols-1 items-start gap-5",
                "has-[[data-tool-aside]]:max-w-[1180px]",
                "lg:has-[[data-tool-aside]]:grid-cols-[minmax(0,1fr)_328px] lg:has-[[data-tool-aside]]:gap-7",
              )}
            >
              {/* key: switching tools must remount, not reuse, the previous
                  tool's state. */}
              {tool ? <ToolClient key={ws.slug} tool={tool} /> : null}
            </div>
          </div>
        </main>
      </div>

      <StatusBar
        engine={ws.engine}
        index={workspaceTools.indexOf(ws) + 1}
        total={workspaceTools.length}
      />
    </div>
  );
}
