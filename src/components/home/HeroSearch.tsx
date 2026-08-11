"use client";

import { useEffect, useState } from "react";
import { SearchTrigger } from "@/components/layout/SearchTrigger";
import { usePrefersReducedMotion } from "@/hooks/useIsClient";

/** The shapes people actually type: what they have, then what they want. */
const QUERIES = ["heic jpg", "pdf smaller", "mp4 gif", "wav mp3", "json csv", "favicon"];

const TICK_MS = 190;

export function HeroSearch() {
  // Reduced motion gets a query to read, not one being typed at them.
  const reduced = usePrefersReducedMotion();
  const [typed, setTyped] = useState("");
  const [qi, setQi] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setTyped((prev) => {
        const target = QUERIES[qi];
        if (prev.length < target.length) return target.slice(0, prev.length + 1);
        if (prev.length === target.length) return `${prev} `;
        setQi((n) => (n + 1) % QUERIES.length);
        return "";
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [qi, reduced]);

  const display = reduced ? QUERIES[0] : typed.trimEnd();

  return (
    <div>
      <SearchTrigger size="field">
        <span className="inline-flex items-center">
          {display || "Search tools…"}
          {!reduced && (
            <span className="ml-px animate-tm-blink border-l-[1.5px] border-accent">
              &nbsp;
            </span>
          )}
        </span>
      </SearchTrigger>
      <p className="m-0 mt-3 max-w-[520px] font-body text-[12.5px] leading-[1.6] text-text-muted">
        Type what you have and what you want — “heic jpg”, “pdf smaller”, “mp4 gif”. The
        tool opens with your file already in it.
      </p>
    </div>
  );
}
