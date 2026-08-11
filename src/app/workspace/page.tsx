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
      <div className="flex w-full flex-col">
        <div className="flex flex-wrap items-baseline gap-3 border-b border-nocturne-divider bg-nocturne-chrome px-4 py-3 md:px-11">
          <span className="flex-none rounded-sm bg-nocturne-accent-900 px-2 py-[5px] font-nocturne-mono text-[10px] leading-none font-semibold tracking-[0.12em] text-nocturne-accent-300">
            EVERY TOOL
          </span>
          <span className="font-nocturne text-[13px] leading-[1.5] text-nocturne-neutral-500">
            All {workspaceToolCount} tools from the registry, live in one shell — drop a
            file and convert it right here. Pick any one in the rail, or filter by category.
          </span>
        </div>

        <Workspace />
      </div>
    </main>
  );
}
