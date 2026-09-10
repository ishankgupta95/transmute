/**
 * Count the network requests this page actually makes, split by origin.
 *
 * WHY THIS EXISTS. The tool status bar read `0 BYTES SENT` — a hard-coded
 * string. It is true, but it is the same shape of claim as the `READY` that was
 * taken off the ENGINE cell two waves ago: a sentence about the machine that
 * nothing on the machine checked. This site's whole argument is that it does
 * not send your file anywhere, and "trust the label on the label" is the
 * weakest possible way to make it. `PerformanceObserver` can just answer.
 *
 * WHAT IS AND IS NOT MEASURABLE, stated precisely, because the honest version
 * of this readout is narrower than the one somebody would want to write:
 *
 *  * A `PerformanceResourceTiming` entry exists for every fetch, XHR, script,
 *    image, stylesheet and worker the page loads. Counting them is exact.
 *  * The ORIGIN of each is exact, so "did anything leave this origin" is
 *    answerable.
 *  * `transferSize` is bytes RECEIVED, not sent, and the API exposes no
 *    request-body size at all. So a readout saying "0 BYTES SENT" cannot be
 *    derived — which is precisely why the old one was hard-coded. This module
 *    counts REQUESTS, and the UI says requests.
 *  * A `sendBeacon` on page unload, a WebSocket, and a request made from inside
 *    a worker do NOT appear in this document's resource timeline. So a zero
 *    here is not a proof of absence in general — it is a statement about what
 *    this document requested. The /privacy page says so and points the reader
 *    at their own DevTools, which is the check that has no such gap.
 *
 * DELIBERATELY NOT MEMOISED ACROSS PAGES: each tool page mounts its own
 * observer at mount and disconnects on unmount, so the number belongs to the
 * page the reader is looking at.
 */

export interface RequestTally {
  /** Requests to this origin — the app's own JS, CSS, fonts and engines. */
  sameOrigin: number;
  /** Requests to any other origin. */
  crossOrigin: number;
  /** Distinct foreign origins seen, in first-contact order. Never a URL. */
  foreignOrigins: string[];
}

export const EMPTY_TALLY: RequestTally = {
  sameOrigin: 0,
  crossOrigin: 0,
  foreignOrigins: [],
};

/**
 * Fold one resource URL into a tally, returning a NEW tally.
 *
 * Pure, so the classification is unit-testable without a browser — which
 * matters, because jsdom implements no `PerformanceObserver` for resources and
 * a rule that lives in the observer callback is a rule that ships unverified.
 * The same split that `sw-policy.ts` exists for.
 *
 * A URL that will not parse is counted as SAME origin. That is the
 * conservative direction for a counter whose job is to notice foreign traffic:
 * it can only ever under-report a scary number, never invent one — and the
 * alternative, treating unparseable as foreign, would put a number on screen
 * that no reader could reconcile with their own DevTools.
 */
export function tallyRequest(tally: RequestTally, url: string, pageOrigin: string): RequestTally {
  let origin: string;
  try {
    origin = new URL(url, pageOrigin).origin;
  } catch {
    return { ...tally, sameOrigin: tally.sameOrigin + 1 };
  }

  if (origin === pageOrigin) {
    return { ...tally, sameOrigin: tally.sameOrigin + 1 };
  }

  return {
    sameOrigin: tally.sameOrigin,
    crossOrigin: tally.crossOrigin + 1,
    foreignOrigins: tally.foreignOrigins.includes(origin)
      ? tally.foreignOrigins
      : [...tally.foreignOrigins, origin],
  };
}

/** Fold a whole list at once — the initial drain of `getEntriesByType`. */
export function tallyAll(urls: readonly string[], pageOrigin: string): RequestTally {
  let tally = EMPTY_TALLY;
  for (const url of urls) tally = tallyRequest(tally, url, pageOrigin);
  return tally;
}

/**
 * The status-bar sentence for a tally.
 *
 * Says REQUESTS, never bytes, for the reason in the header. The cross-origin
 * half is only spoken when it is non-zero: a permanent "0 OFF-ORIGIN" beside
 * every page is noise, whereas a number appearing is the signal.
 */
export function describeTally(tally: RequestTally): string {
  const own = `${tally.sameOrigin} REQUEST${tally.sameOrigin === 1 ? "" : "S"}`;
  if (tally.crossOrigin === 0) return `${own} · NONE OFF-ORIGIN`;
  return `${own} · ${tally.crossOrigin} OFF-ORIGIN`;
}

/**
 * Whether the browser can answer the question at all.
 *
 * Safari shipped `PerformanceObserver` for `resource` long ago, but the check
 * is cheap and a readout that throws is worse than one that is absent.
 */
export function supportsRequestMonitoring(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    typeof performance !== "undefined" &&
    typeof performance.getEntriesByType === "function"
  );
}
