import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True once hydrated, false during SSR — without a setState-in-effect, which
 * triggers a cascading render. Use to gate portals and anything that reads
 * `navigator` or `document`.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

const APPLE = /Mac|iPhone|iPad|iPod/;

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. Stable on the server. */
export function useShortcutLabel(): string {
  return useSyncExternalStore(
    subscribe,
    () => (APPLE.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "⌘K",
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Tracks the reduced-motion preference, and reacts if the user changes it. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
