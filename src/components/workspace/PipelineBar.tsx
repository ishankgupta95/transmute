import { cn } from "@/lib/utils/cn";

interface PipelineBarProps {
  steps: string[];
  engine: string;
  accept: string;
}

export function PipelineBar({ steps, engine, accept }: PipelineBarProps) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-nocturne-divider px-[18px] py-2 lg:h-10 lg:flex-nowrap lg:py-0">
      <span className="flex-none font-nocturne-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-nocturne-neutral-500">
        PIPELINE
      </span>

      {steps.map((label, i) => (
        <span
          key={label}
          className={cn(
            "flex h-[23px] flex-none items-center rounded-md border px-2.5 font-nocturne text-[11px] leading-none font-medium whitespace-nowrap",
            i === 0
              ? "border-nocturne-accent/55 bg-nocturne-accent/12 text-nocturne-accent-200"
              : "border-nocturne-divider bg-transparent text-nocturne-neutral-400",
          )}
        >
          {i > 0 ? `▸ ${label}` : label}
        </span>
      ))}

      <span className="flex h-[23px] flex-none items-center rounded-md border border-dashed border-nocturne-neutral-700 px-[9px] font-nocturne text-[11px] leading-none whitespace-nowrap text-nocturne-neutral-500">
        + step
      </span>

      <div className="flex items-center gap-[11px] font-nocturne-mono text-[10.5px] leading-none whitespace-nowrap text-nocturne-neutral-500 lg:ml-auto">
        <span>ENGINE {engine}</span>
        <span className="opacity-40">·</span>
        <span>ACCEPTS {accept}</span>
      </div>
    </div>
  );
}
