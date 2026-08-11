"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  emptyRecentOutputs,
  readRecentOutputs,
  subscribeRecentOutputs,
  type RecentOutput,
} from "@/lib/utils/recent-outputs";
import { getWorkspaceTool } from "@/data/workspace";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { MONO_LABEL } from "@/components/workspace/shared";

/**
 * The docs' "RECENT OUTPUT" rail section — real entries from
 * lib/utils/recent-outputs.ts (recorded by triggerDownload), not seeded rows.
 * Renders nothing until the user has actually saved something.
 *
 * Mounted in both rails: the /workspace ToolRail (pass `onPickTool` so a
 * click selects the tool in place) and the tool pages' sibling-tools nav
 * (entries link to the tool's page).
 */
export function RecentOutputs({ onPickTool }: { onPickTool?: (slug: string) => void }) {
  const outputs = useSyncExternalStore(
    subscribeRecentOutputs,
    readRecentOutputs,
    emptyRecentOutputs,
  );
  if (outputs.length === 0) return null;

  return (
    <div className="border-t border-nocturne-divider px-3 pt-3 pb-3">
      <div className="flex items-baseline justify-between pb-[9px]">
        <span className={MONO_LABEL}>RECENT OUTPUT</span>
        <span className="font-nocturne-mono text-[9.5px] leading-none text-nocturne-neutral-500">
          THIS BROWSER
        </span>
      </div>
      <ul className="flex flex-col gap-px">
        {outputs.map((output, i) => (
          <li key={`${output.at}-${i}`}>
            <RecentEntry output={output} onPickTool={onPickTool} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentEntry({
  output,
  onPickTool,
}: {
  output: RecentOutput;
  onPickTool?: (slug: string) => void;
}) {
  const known = getWorkspaceTool(output.slug);
  const body = (
    <>
      <span className="max-w-[150px] truncate font-nocturne text-[11.5px] leading-[1.3] text-nocturne-neutral-300">
        {output.name}
      </span>
      <span className="font-nocturne-mono text-[9px] leading-none tracking-[0.04em] text-nocturne-neutral-500">
        {formatFileSize(output.bytes)} · {relativeTime(output.at)}
      </span>
    </>
  );
  const className =
    "flex w-full cursor-pointer flex-col items-start gap-[3px] rounded-[7px] p-2 text-left transition-colors duration-150 hover:bg-nocturne-text/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-nocturne-accent";

  // Entries from tools this build no longer knows are shown, not linked.
  if (!known) {
    return <span className={className}>{body}</span>;
  }
  if (onPickTool) {
    return (
      <button type="button" onClick={() => onPickTool(output.slug)} className={className}>
        {body}
      </button>
    );
  }
  return (
    <Link href={`/${output.slug}`} className={className}>
      {body}
    </Link>
  );
}

function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "JUST NOW";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}H AGO`;
  return `${Math.round(hours / 24)}D AGO`;
}
