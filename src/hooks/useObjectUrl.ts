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
    const next = URL.createObjectURL(source);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: URL allocation is a side effect that must be reflected in render-visible state
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [source]);

  return url;
}
