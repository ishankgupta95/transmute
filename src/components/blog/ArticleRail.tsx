"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

interface Heading {
  id: string;
  text: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Contents and read-progress, both derived from the rendered article rather than
 * from the MDX source — so they stay correct without a build-time plugin.
 */
export function ArticleRail({ targetId }: { targetId: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const article = document.getElementById(targetId);
    if (!article) return;

    const found = [...article.querySelectorAll("h2")].map((h) => {
      if (!h.id) h.id = slugify(h.textContent ?? "");
      return { id: h.id, text: h.textContent ?? "" };
    });
    const onScroll = () => {
      const { top, height } = article.getBoundingClientRect();
      const scrolled = -top + window.innerHeight * 0.5;
      setProgress(Math.min(100, Math.max(0, Math.round((scrolled / height) * 100))));

      // The heading the reader is currently under.
      let current = found[0]?.id ?? "";
      for (const h of found) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= 120) current = h.id;
      }
      setActiveId(current);
    };

    // Deferred so the first paint isn't a synchronous setState inside the effect.
    const raf = requestAnimationFrame(() => {
      setHeadings(found);
      setActiveId(found[0]?.id ?? "");
      onScroll();
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [targetId]);

  if (headings.length === 0) return null;

  return (
    <>
      {/* Read progress — pinned under the site nav. */}
      <div className="sticky top-[58px] z-30 -mx-4 mb-6 flex items-center justify-end gap-3 border-b border-border bg-bg-secondary/90 px-4 py-2.5 backdrop-blur-xl lg:hidden">
        <span className="font-mono text-[10.5px] leading-none text-text-muted">
          {progress}% READ
        </span>
        <span className="block h-[3px] w-[120px] overflow-hidden rounded-sm bg-neutral-800">
          <span
            className="block h-full rounded-sm bg-accent transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </span>
      </div>

      <nav
        aria-label="Contents"
        className="hidden flex-col gap-[11px] lg:sticky lg:top-[74px] lg:flex"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
            CONTENTS
          </span>
          <span className="font-mono text-[10px] leading-none text-text-muted">
            {progress}%
          </span>
        </div>

        <span className="block h-[3px] overflow-hidden rounded-sm bg-neutral-800">
          <span
            className="block h-full rounded-sm bg-accent transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </span>

        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            className={cn(
              "border-l-2 pl-[11px] font-body text-[12.5px] leading-[1.45] transition-colors duration-200 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              h.id === activeId
                ? "border-accent text-accent-200"
                : "border-border text-neutral-400",
            )}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </>
  );
}
