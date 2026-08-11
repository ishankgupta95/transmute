"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * GA4 saw exactly one pageview per session: the gtag config snippet fires on
 * the initial document, and App Router navigations never load a new one.
 * This watches the pathname and reports each client-side navigation as a
 * page_view. The first render is skipped — the config call already counted
 * it; double-firing would inflate the landing page.
 *
 * (usePathname only — useSearchParams would force a Suspense boundary at
 * prerender; the search string is read off `location` at fire time instead.)
 */
export function AnalyticsPageviews() {
  const pathname = usePathname();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const gtag = (window as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag !== "function") return;
    gtag("event", "page_view", {
      page_path: pathname + window.location.search,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname]);

  return null;
}
