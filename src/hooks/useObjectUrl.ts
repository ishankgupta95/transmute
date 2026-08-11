"use client";

import { useEffect, useState } from "react";

/**
 * Allocates an Object URL for the given Blob/File and revokes it on
 * unmount or when the source changes. Returns `null` while no source
 * is set or after cleanup.
 *
 * The URL is allocated inside `useEffect` (not during render) so React's
 * StrictMode double-invocation cannot leak intermediate URLs.
 */
export function useObjectUrl(source: Blob | File | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clearing URL when source becomes null is the only way to keep state in sync with the input
      setUrl(null);
      return;
    }
    // URL allocation is a side effect that must be reflected in render-visible
    // state; the rule doesn't flag it here because it follows the allocation.
    const next = URL.createObjectURL(source);
    setUrl(next);
    return () => {
      // Deferred: revoking synchronously aborts an <img>/<video> that is
      // still LOADING this URL when the source swaps (or on StrictMode's
      // double-invoke), flashing a broken frame. One second matches the
      // grace triggerDownload gives the same race.
      setTimeout(() => URL.revokeObjectURL(next), 1000);
    };
  }, [source]);

  return url;
}
