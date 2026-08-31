"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

export interface HubRailSection {
  id: string;
  title: string;
  count: number;
}

/**
 * The hub's "ON THIS PAGE" rail. A client island so `CategoryHubPage` stays a
 * Server Component.
 *
 * It used to hardcode the first section as active, which on a `lg:sticky` rail
 * meant it advertised a position it never updated for the entire scroll. The
 * ≤120px rule is the one `ArticleRail` uses, so both rails now mark the
 * heading the reader is actually under.
 */
export function HubRail({ sections }: { sections: HubRailSection[] }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const onScroll = () => {
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) current = s.id;
      }
      setActiveId(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections]);

  return (
    <div className="flex flex-col gap-[9px]">
      <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
        ON THIS PAGE
      </span>
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={s.id === activeId ? "true" : undefined}
          className={cn(
            "border-l-2 pl-2.5 font-body text-[13px] leading-none transition-colors duration-200 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            s.id === activeId
              ? "border-accent text-accent-200"
              : "border-transparent text-neutral-400",
          )}
        >
          {s.title}{" "}
          <span className="font-mono text-[10.5px] text-text-muted">{s.count}</span>
        </a>
      ))}
    </div>
  );
}
