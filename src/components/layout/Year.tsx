"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * The current year, read in the browser.
 *
 * The site is `output: "export"` — a `new Date().getFullYear()` in a Server
 * Component is evaluated once at build time and shipped as a literal into all
 * 85 routes, so the footer's copyright would sit at the build's year until
 * someone happened to redeploy. The server snapshot has to be a fixed string
 * or SSR and hydration disagree; it is only what a JS-less reader sees before
 * the client corrects it.
 */
export function Year() {
  return (
    <>
      {useSyncExternalStore(
        subscribe,
        () => String(new Date().getFullYear()),
        () => "2026",
      )}
    </>
  );
}
