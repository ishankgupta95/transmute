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
      <div className="mx-auto flex min-h-[30px] w-full max-w-[1440px] flex-wrap items-center gap-y-1 px-4 py-1.5 font-nocturne-mono text-[10px] leading-none tracking-[0.04em] text-nocturne-neutral-500 lg:h-[30px] lg:flex-nowrap lg:py-0">
        <span className="flex items-center gap-1.5">
          <span className="size-[5px] rounded-full bg-nocturne-accent" />
          {engine} READY
        </span>
        <span className="px-3 opacity-30">│</span>
        <span>
          TOOL {index} OF {total}
        </span>
        <CapabilityReadout />
        <span className="flex items-center gap-3.5 lg:ml-auto">
          <span>0 BYTES SENT</span>
          <span className="opacity-30">│</span>
          <span>{total} TOOLS INSTALLED</span>
        </span>
      </div>
    </div>
  );
}
