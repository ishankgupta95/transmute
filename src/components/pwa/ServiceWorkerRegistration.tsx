"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Registers `public/sw.js`, and — the half that needs more care than the
 * registration — asks before it lets a new version take over.
 *
 * PRODUCTION BUILDS ONLY, for two unrelated reasons that happen to agree.
 *
 * The first is a shipped test. The default e2e suite and the conversion suite
 * both run against `next dev` (playwright.config.ts: `webServer.command` is
 * `npm run dev`), and `src/__tests__/e2e/conversion/video.spec.ts:120` stalls
 * the FFmpeg core deliberately with `page.route("**\/ffmpeg-core.wasm")`.
 * Playwright's own typings say a route "will not intercept requests
 * intercepted by Service Worker" — so a worker registered in dev would make
 * that request invisible to the test and the assertion it guards would stop
 * meaning anything.
 *
 * The second is that a cache should never see HMR. The dev overlay, the
 * module graph and the `_next/static/chunks` hashes all churn per keystroke,
 * and every one of them would land in a cache built for a static export.
 *
 * `process.env.NODE_ENV` is INLINED by the compiler, so in a dev build this is
 * not a runtime check that fails — the whole body below folds away.
 */

/** The one message the worker handles. service-worker.ts ignores everything else. */
const SKIP_WAITING = { type: "SKIP_WAITING" } as const;

/**
 * The gate, extracted so it can be tested rather than reasoned about.
 *
 * `nodeEnv` is passed in because a test cannot re-inline a compiler constant,
 * and the caller reads `process.env.NODE_ENV` at the one site where the
 * compiler will fold it.
 */
export function shouldRegisterServiceWorker(nodeEnv: string | undefined): boolean {
  if (nodeEnv !== "production") return false;
  if (typeof navigator === "undefined") return false;
  return "serviceWorker" in navigator;
}

/**
 * The banner. Separated from the effect so its copy and its two controls can
 * be rendered and asserted without a Service Worker registration in sight.
 *
 * It says "when you're ready" because it means it: the reload is the user's,
 * and the reason is the next comment down.
 */
export function UpdateBanner({
  onApply,
  onDismiss,
  applying,
}: {
  onApply: () => void;
  onDismiss: () => void;
  applying: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-[9000] mx-auto flex max-w-[520px] flex-col gap-2.5 rounded-[11px] border border-border bg-bg-secondary p-[15px] shadow-[0_10px_30px_rgba(0,0,0,.45)] sm:flex-row sm:items-center sm:gap-4"
    >
      <p className="m-0 flex-1 font-body text-[12.5px] leading-[1.55] text-neutral-300">
        A new version of Transmute is ready.{" "}
        <span className="text-text-muted">
          It takes effect on reload — finish anything you have running first.
        </span>
      </p>
      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-[7px] border border-border px-3 py-1.5 font-mono text-[10px] leading-none tracking-[0.08em] text-text-muted transition-colors duration-200 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          NOT NOW
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={applying}
          className="rounded-[7px] border border-accent bg-accent/10 px-3 py-1.5 font-mono text-[10px] leading-none tracking-[0.08em] text-accent-200 transition-colors duration-200 hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {applying ? "RELOADING…" : "RELOAD NOW"}
        </button>
      </div>
    </div>
  );
}

export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!shouldRegisterServiceWorker(process.env.NODE_ENV)) return;

    let live = true;
    const container = navigator.serviceWorker;

    /**
     * A worker that reaches "installed" while a controller already exists is
     * an UPDATE sitting behind the running one. With no controller it is the
     * very first install, and there is nothing to tell anybody: nothing was
     * replaced.
     */
    const announce = (worker: ServiceWorker | null | undefined) => {
      if (live && worker) setWaiting(worker);
    };

    const register = async () => {
      try {
        const registration = await container.register("/sw.js");
        if (!live) return;
        // A previous visit may have left one waiting already; `updatefound`
        // fires once, and it fired before this page existed. The controller
        // check is the same one the `statechange` path makes and for the same
        // reason: with nothing in control there is nothing to replace, so
        // there is no update to announce — and `controllerchange` would never
        // fire for an uncontrolled page, leaving the RELOAD button waiting on
        // an event that is not coming.
        if (container.controller) announce(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && container.controller) {
              announce(registration.waiting ?? installing);
            }
          });
        });
      } catch {
        // A failed registration must cost the visitor nothing. The site works
        // exactly as it did before this file existed when there is no worker.
      }
    };

    /*
      AFTER LOAD, NEVER BEFORE. Registration itself is cheap, but install
      immediately fetches `/` and `/offline.html` with `cache: "reload"`, and
      those two requests compete with the ones drawing the page the visitor is
      looking at. Nothing here is worth a millisecond of first paint.
    */
    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      live = false;
      window.removeEventListener("load", register);
    };
  }, []);

  /**
   * THE UPDATE, and why it is a button rather than a `skipWaiting()` on
   * install.
   *
   * Activating a new worker calls `clients.claim()`, and the page's standard
   * response to `controllerchange` is to reload. On most sites that is a
   * flicker. Here a tab may be four minutes into a video conversion, holding a
   * loaded 32 MB FFmpeg instance and a pool of module workers, with the user's
   * only copy of the file living in that tab's memory. A reload destroys the
   * run and the output with it.
   *
   * So the worker waits, the page asks, and the reload is a thing the visitor
   * did. `{ once: true }` on the listener because `controllerchange` can fire
   * more than once and a second `reload()` mid-navigation is a loop.
   */
  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    setApplying(true);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.location.reload();
      },
      { once: true },
    );
    waiting.postMessage(SKIP_WAITING);
  }, [waiting]);

  const dismiss = useCallback(() => setWaiting(null), []);

  if (!waiting) return null;
  return <UpdateBanner onApply={applyUpdate} onDismiss={dismiss} applying={applying} />;
}
