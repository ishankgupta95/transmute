import { CapabilityReadout } from "@/components/tools/CapabilityReadout";

interface StatusBarProps {
  engine: string;
  index: number;
  total: number;
}

export function StatusBar({ engine, index, total }: StatusBarProps) {
  return (
    /* Background runs edge to edge; the content stops at the site's measure. */
    <div className="border-t border-nocturne-divider bg-nocturne-status">
      {/* Segment visibility mirrors the tool page's status bar exactly
          (ToolPageLayout): below `sm` the phone bar is minimal — engine and
          tool index only — so the capability readout, the dividers and the
          installed count all drop out rather than wrapping onto three lines. */}
      <div className="mx-auto flex min-h-[30px] w-full max-w-[1440px] flex-wrap items-center gap-y-1 px-4 py-1.5 font-nocturne-mono text-[10px] leading-none tracking-[0.04em] text-nocturne-neutral-500 lg:h-[30px] lg:flex-nowrap lg:py-0">
        <span className="flex items-center gap-1.5">
          <span className="size-[5px] rounded-full bg-nocturne-accent" />
          {engine} READY
        </span>
        <span aria-hidden="true" className="px-3 opacity-30">
          │
        </span>
        <span>
          TOOL {index} OF {total}
        </span>
        <span className="hidden sm:contents">
          <CapabilityReadout />
        </span>
        <span className="flex items-center gap-3.5 lg:ml-auto">
          <span>0 BYTES SENT</span>
          <span aria-hidden="true" className="hidden opacity-30 sm:inline">
            │
          </span>
          <span className="hidden sm:inline">{total} TOOLS INSTALLED</span>
        </span>
      </div>
    </div>
  );
}
