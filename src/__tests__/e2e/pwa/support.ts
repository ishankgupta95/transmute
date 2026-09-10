import { expect, type BrowserContext, type Page } from "@playwright/test";

import { ENGINE_CACHE, OWNED_CACHES, SHELL_CACHE, isEngineUrl } from "@/lib/pwa/sw-policy";

/**
 * Shared machinery for the PWA project. Mirrors the conversion suite's
 * `support.ts`: helpers only, no tests, and the filename deliberately does not
 * match Playwright's `**\/*.spec.ts` so it is never collected.
 *
 * ONE RULE HOLDS THIS FILE UP. Nothing here re-states a fact the shipped code
 * already owns. The engine list comes from `isEngineUrl` — the very predicate
 * the worker routes on — and the cache names come from `sw-policy.ts`. A spec
 * that carried its own copy of "which URLs are engines" would keep passing on
 * the day someone added a ninth engine and forgot the worker, which is the one
 * day it needs to fail.
 */

export { ENGINE_CACHE, OWNED_CACHES, SHELL_CACHE };

/** One entry the browser is actually holding, flattened for assertions. */
export interface CacheEntry {
  cache: string;
  /** Path only — every strategy in `sw-policy.ts` decides on the path. */
  path: string;
  /** The query string, if any. `?retry=N` is the one that occurs in practice. */
  search: string;
}

/**
 * Wait until a worker is ACTIVATED for this page, and report what it is.
 *
 * `navigator.serviceWorker.ready` is the right starting point — it resolves
 * only once there is an active registration whose scope covers the page — but
 * it is NOT sufficient on its own, and this was measured rather than reasoned
 * about: sampling `registration.active.state` the instant `ready` resolves
 * returned `"activating"`, not `"activated"`, on the very first run of this
 * harness. `ready` resolves as soon as a worker reaches the active SLOT, while
 * the `activate` handler's `waitUntil` is still running — and this worker's
 * activate does real asynchronous work (`caches.keys()`, the prune, then
 * `clients.claim()`). So the state is awaited through `statechange` rather
 * than sampled.
 *
 * `"redundant"` also ends the wait, deliberately: a worker that died during
 * activation must fail the assertion loudly instead of hanging until the
 * project timeout and reading as "slow".
 */
export async function activeWorker(
  page: Page,
): Promise<{ state: string | null; scope: string; scriptURL: string | null }> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (worker && worker.state !== "activated" && worker.state !== "redundant") {
      await new Promise<void>((resolve) => {
        const settled = () => {
          if (worker.state === "activated" || worker.state === "redundant") {
            worker.removeEventListener("statechange", settled);
            resolve();
          }
        };
        worker.addEventListener("statechange", settled);
        // The state can reach its destination between the check above and the
        // listener being attached; re-reading once closes that window.
        settled();
      });
    }
    return {
      state: registration.active?.state ?? null,
      scope: registration.scope,
      scriptURL: registration.active?.scriptURL ?? null,
    };
  });
}

/**
 * Wait until the worker is CONTROLLING this page.
 *
 * Distinct from the above, and both matter. A worker can be activated while
 * the page that registered it stays uncontrolled — that is the default, and
 * it is why `service-worker.ts` calls `clients.claim()`. Until a controller
 * exists the worker sees none of the page's requests, so every cache
 * assertion in this project has to wait for this and not merely for "ready".
 */
export async function waitForController(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/**
 * Load a page and wait until the worker is in control of it.
 *
 * The reload is not superstition. Registration happens on `load`
 * (ServiceWorkerRegistration.tsx defers it so install's two fetches do not
 * compete with first paint), so on the very first visit the document and its
 * chunks were fetched BEFORE any worker existed and none of them passed
 * through `fetch`. The second load is the first one the worker sees, and it is
 * what puts the shell in the cache — which is the state every assertion here
 * is about.
 */
export async function loadUnderWorker(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForController(page);
  const response = await page.reload();
  await waitForController(page);

  /*
    THE STATUS IS CHECKED, and it is not defensive noise — it closes a hole a
    mutation walked straight through.

    Deleting the static server's `<path>.html` resolution (the step every tool
    page navigation takes) left this whole project GREEN: `out/404.html` is a
    real Next page, so it registers the worker, caches a shell and holds no
    engine, and every assertion downstream went on passing while the specs were
    quietly exercising the 404 page. GitHub Pages answers an unknown path with
    that page and a 404 status, so the status is the one thing that
    distinguishes them.
  */
  expect(response?.status(), `${path} did not resolve to a page`).toBe(200);
}

/**
 * Cut the network — and MEAN it, for the service worker as well as the page.
 *
 * ⚠ MEASURED TRAP, and the reason this is a function rather than a bare
 * `context.setOffline(true)`.
 *
 * `setOffline` is idempotent on Playwright's side: calling it with `true` when
 * it already believes the context is offline sends nothing to the browser. And
 * a `page.goto` performed while offline leaves the SERVICE WORKER's network
 * context online again, even though the page's own requests stay cut. The two
 * together are silent: the second offline navigation in a test is served from
 * the network while the test believes it proved a cache hit.
 *
 * Measured on Playwright 1.59.1 / Chromium 147.0.7727.15, 5 runs per variant,
 * counting requests that reached the static server after `setOffline(true)`:
 *
 *   setOffline(true) → goto → goto                 network leaked 5 of 5
 *   setOffline(true) → goto → setOffline(true) →…  network leaked 5 of 5
 *   setOffline(true) → goto → false→true → goto    network leaked 0 of 5
 *   setOffline(true) → fetch → goto                network leaked 0 of 5
 *
 * So the toggle goes through `false`, which forces the command to be re-sent.
 * The window where the network is genuinely up lasts one round trip and no
 * request is in flight across it, because nothing in these specs fetches
 * except when driven.
 */
export async function goOffline(context: BrowserContext): Promise<void> {
  await context.setOffline(false);
  await context.setOffline(true);
}

/**
 * Prove the network is actually down before claiming anything was served
 * without it.
 *
 * Without this, every offline assertion in the project is one silent
 * `setOffline` regression away from passing against a live server — which is
 * the failure mode the table above documents. The probe path is one nothing
 * can have cached: it is not an engine, not `/_next/static/`, and has never
 * been requested, so `strategyFor` sends it to `network-first`, the fetch
 * throws, the cache lookup misses, and — because it is not a navigation — the
 * worker answers `Response.error()`, which rejects the caller's `fetch`.
 *
 * With a live server the same request resolves (404, from `out/404.html`), so
 * resolve-vs-reject cleanly separates the two states.
 */
export async function expectNetworkIsDown(page: Page): Promise<void> {
  const probe = await page.evaluate(async () => {
    try {
      const response = await fetch(`/_offline-probe/${Math.random().toString(36).slice(2)}`);
      return `resolved ${response.status}`;
    } catch {
      return "rejected";
    }
  });
  expect(probe, "the network must be genuinely down for an offline claim to mean anything").toBe(
    "rejected",
  );
}

/** Everything in every cache this origin holds, whoever put it there. */
export async function cacheInventory(page: Page): Promise<CacheEntry[]> {
  return page.evaluate(async () => {
    const entries: { cache: string; path: string; search: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        entries.push({ cache: name, path: url.pathname, search: url.search });
      }
    }
    return entries;
  });
}

/**
 * The engine test, borrowed from the worker rather than restated.
 *
 * `isEngineUrl` is the function `strategyFor` calls, so "is this an engine?"
 * means here exactly what it means in `public/sw.js`. The origin is
 * synthesised because the predicate compares `url.origin` to the one it is
 * given and the harness' port is not interesting to the answer.
 */
export function isEnginePath(path: string): boolean {
  const origin = "https://transmute.tools";
  return isEngineUrl(new URL(path, origin), origin);
}

/**
 * Assert the inventory holds a live shell and NO engine.
 *
 * TWO-SIDED ON PURPOSE. "No engine is cached" passes trivially in a browser
 * where nothing cached at all — a worker that failed to install, a context
 * with storage disabled, a spec that navigated before the controller existed.
 * Pairing it with "the shell IS cached" is what makes the negative half
 * evidence rather than an absence of evidence.
 */
export function expectShellWithoutEngines(entries: CacheEntry[]): void {
  const shell = entries.filter((entry) => entry.cache === SHELL_CACHE);
  expect(
    shell.map((entry) => entry.path),
    "the shell cache must hold the precached navigation fallback",
  ).toContain("/offline.html");
  expect(
    shell.some((entry) => entry.path.startsWith("/_next/static/")),
    "the shell cache must hold at least one hashed chunk — otherwise the negative half below proves nothing",
  ).toBe(true);

  const engines = entries.filter((entry) => isEnginePath(entry.path));
  expect(
    engines,
    "no engine binary may be in ANY cache without an explicit opt-in",
  ).toEqual([]);
}
