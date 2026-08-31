"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/utils/clipboard";

/**
 * How long a "Copied" confirmation stays up, in ms. One constant so no two
 * tools disagree — the copy feedback used to reset after 1.5 s on the colour
 * palette, 1.8 s in CopyButton and 2 s everywhere else.
 */
export const COPY_FEEDBACK_MS = 2000;

/**
 * Copy-to-clipboard with its own confirmation timer.
 *
 * `copied` is the key of the last successful copy, or `null`. Tools that copy
 * one thing leave the key alone and read `copied` as a boolean; tools with a
 * list of copyable rows pass the row's key (`useCopied<number>()`) and compare.
 *
 * The timer is cleared on unmount and on a re-copy, which the ~27 hand-rolled
 * versions of this were not: /workspace remounts tools by key, so every stray
 * `setTimeout(() => setCopied(false), 2000)` was a state update queued against
 * a component that could already be gone.
 */
export function useCopied<K = boolean>(resetMs: number = COPY_FEEDBACK_MS) {
  const [copied, setCopied] = useState<K | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (value: string, key: K = true as K): Promise<boolean> => {
      const ok = await copyText(value);
      if (!ok) return false;
      setCopied(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), resetMs);
      return true;
    },
    [resetMs],
  );

  /** Drop the confirmation early — e.g. when the copied value is replaced. */
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCopied(null);
  }, []);

  return { copied, copy, clear };
}
