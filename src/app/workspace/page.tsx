import type { Metadata } from "next";
import { workspaceToolCount } from "@/data/workspace";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = {
  title: "Workspace — every Transmute tool in one shell",
  description:
    "A single workspace for all Transmute tools: pick one in the rail and convert real files without leaving the page. Everything runs on your device.",
  // Real tools since Phase 4, but still a second surface for all 67 of them —
  // pure duplicate content against the tool pages, so it stays out of the
  // index. (Revisit only with a canonical strategy in hand — plan.md.)
  robots: { index: false, follow: true },
};

export default function WorkspacePage() {
  return (
    <main className="flex-1">
      {/* The shell is chrome-first by design, so the page's one heading is
          visually hidden — but it has to exist: heading navigation found
          nothing at all on the route that hosts every tool. */}
      <h1 className="sr-only">Workspace — every Transmute tool in one shell</h1>
      {/*
        The doc's shell is one screen tall — a 52px top bar, a `height:770px`
        band whose three columns each scroll inside themselves, and a 30px
        status bar that is therefore always visible. From `lg` up the caption
        and the shell share a single viewport-height column so that holds
        here too; below `lg` the shell stacks and the page scrolls as before.
      */}
      <div className="flex w-full flex-col lg:h-[calc(100vh-58px)] lg:overflow-hidden">
        {/* The caption sits on the bare page ground in the doc — no fill, no
            rule. Painting it `nocturne-chrome` above the top bar (which is
            the same mix) read as one double-height bar. */}
        <div className="flex flex-none flex-wrap items-baseline gap-3 px-4 py-3 md:px-11">
          <span className="flex-none rounded-sm bg-nocturne-accent-900 px-2 py-[5px] font-nocturne-mono text-[10px] leading-none font-semibold tracking-[0.12em] text-nocturne-accent-300">
            EVERY TOOL
          </span>
          <span className="font-nocturne text-[13px] leading-[1.5] text-nocturne-neutral-500">
            All {workspaceToolCount} tools from the registry, live in one shell — drop a
            file and convert it right here. Pick any one in the rail — or filter by category.
          </span>
        </div>

        <Workspace />
      </div>
    </main>
  );
}
