"use client";

import { useSyncExternalStore } from "react";
import {
  describeTally,
  supportsRequestMonitoring,
  tallyAll,
  tallyRequest,
  type RequestTally,
} from "@/lib/privacy/request-monitor";

/**
 * The status bar's network cell, measured instead of asserted.
 *
 * It replaced the literal string `0 BYTES SENT`. That was true and
 * unfalsifiable — the same objection that took the word READY off the ENGINE
 * cell one wave ago, and the same cure: `CapabilityReadout` renders the
 * machine's own SIMD and thread count rather than the design doc's seeded
 * sample, because "a capability claim we can't verify is a claim we don't make".
 *
 * Two deliberate narrowings, both because the wider claim is not measurable:
 *
 *  * It counts REQUESTS, not bytes sent. `PerformanceResourceTiming` exposes
 *    `transferSize` (bytes RECEIVED) and nothing at all about a request body,
 *    so "0 BYTES SENT" is precisely the sentence this API cannot support.
 *  * A zero means "this document requested nothing off-origin", not "nothing
 *    left this machine": `sendBeacon`, WebSockets and requests made inside a
 *    worker never appear in a document's resource timeline. /privacy states
 *    that limit and points the reader at their own DevTools, which has no such
 *    gap — this readout is an invitation to check, not a substitute for it.
 *
 * ⚠ WHY `useSyncExternalStore` AND NOT `useState` + `useEffect`. The obvious
 * shape — read the timeline in an effect and `setState` — is a HARD ESLint
 * ERROR in this repo (`react-hooks/set-state-in-effect`: "Calling setState
 * synchronously within an effect can trigger cascading renders"). It is also
 * the wrong primitive: the resource timeline is external mutable state that
 * changes without React, which is exactly what this hook is for. The snapshot
 * is cached at module scope so repeated reads return the SAME object reference
 * — returning a fresh object from `getSnapshot` makes React re-render forever.
 */

let cached: RequestTally | null = null;
const listeners = new Set<() => void>();
let observer: PerformanceObserver | null = null;

function getSnapshot(): RequestTally | null {
  if (!supportsRequestMonitoring()) return null;
  if (cached === null) {
    /*
      Drain what already happened. The document's scripts, styles and fonts are
      requested long before React mounts, so an observer alone would report a
      number far smaller than the reader's own Network panel — and a counter
      that disagrees with DevTools is worse than no counter, because this whole
      cell exists to be checked against DevTools.
    */
    cached = tallyAll(
      performance.getEntriesByType("resource").map((entry) => entry.name),
      window.location.origin,
    );
  }
  return cached;
}

/** The static export must not bake the build machine's number into the HTML. */
function getServerSnapshot(): RequestTally | null {
  return null;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  if (!observer && supportsRequestMonitoring()) {
    observer = new PerformanceObserver((list) => {
      const origin = window.location.origin;
      let next = cached ?? getSnapshot();
      if (!next) return;
      for (const entry of list.getEntries()) next = tallyRequest(next, entry.name, origin);
      // One new reference per BATCH, not per entry: loading an engine can
      // deliver dozens of entries in a single callback.
      cached = next;
      for (const listener of listeners) listener();
    });
    observer.observe({ type: "resource", buffered: false });
  }

  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

export function RequestReadout() {
  const tally = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Absent rather than wrong: during the server render, and on a browser that
  // cannot answer the question.
  if (!tally) return null;

  return (
    <span title="Counted on this device from the browser's own resource timeline. Open DevTools › Network to check it yourself.">
      {describeTally(tally)}
    </span>
  );
}
