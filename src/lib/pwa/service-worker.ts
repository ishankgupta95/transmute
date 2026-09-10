/// <reference lib="webworker" />
import { ENGINE_CACHE, OWNED_CACHES, SHELL_CACHE, strategyFor } from "./sw-policy";
import {
  encodeSharedName,
  SHARE_TARGET_ACTION,
  SHARE_TARGET_FILE_FIELD,
  SHARED_NAME_HEADER,
  sharedFileKey,
  shareRedirectPath,
} from "./share-target";

/**
 * The service worker. Bundled by scripts/build-workers.mjs to `public/sw.js` —
 * the ORIGIN ROOT rather than `public/workers/`, because a worker's default
 * scope is the directory it is served from and GitHub Pages cannot send the
 * `Service-Worker-Allowed` header that would widen it.
 *
 * Hand-written, not generated: Serwist and next-pwa both require webpack and
 * Next 16 defaults to Turbopack (upgrading/version-16.md:116). The usual
 * `Cache-Control: no-cache` advice for the worker script is unreachable
 * anyway — `headers()` is unsupported under `output: "export"`
 * (static-exports.md:286) — and unnecessary: the spec default
 * `updateViaCache: "imports"` already bypasses the HTTP cache for this script.
 *
 * WHAT THIS FILE DOES NOT DO. It does not decide anything. Every rule lives in
 * sw-policy.ts, which is pure and unit-tested, because none of the code below
 * can be tested at all — jsdom has no ServiceWorkerGlobalScope, no
 * ExtendableEvent and no Cache API. Keep it that way: logic that arrives here
 * is logic that ships unverified.
 */

declare const self: ServiceWorkerGlobalScope;

/**
 * The navigation fallback. Hand-written, self-contained, un-hashed — it has to
 * render when nothing else in the cache does, so it references no chunk, no
 * font and no image. `out/404.html` is the wrong page for this: it is a full
 * Next page whose four stylesheets and script chunks are exactly what is
 * missing when this fires.
 */
const OFFLINE_URL = "/offline.html";

/**
 * The precache, and the reason it is two entries long.
 *
 * It is NOT built by globbing the export. `trailingSlash: false`
 * (next.config.ts:10) makes Next emit `out/merge-pdf.html` alongside an EMPTY
 * `out/merge-pdf/` directory, while the browser requests `/merge-pdf` — so a
 * manifest built from `*.html` filenames lists 171 URLs no navigation ever
 * asks for. Every other class is hashed per build (`/_next/static/**`) and
 * would rot the moment it were written down.
 *
 * So the shell fills in as the user browses (network-first stores what it
 * successfully fetched, cache-first stores the hashed chunks that page
 * needed), and the only things worth having before the first failure are the
 * start URL and the page shown when a navigation has no cached copy at all.
 */
const PRECACHE_URLS: readonly string[] = ["/", OFFLINE_URL];

/**
 * install — take the two-entry shell. No engines: not here, not
 * opportunistically, not while idle. `/ffmpeg-core.wasm` is 32,232,419 bytes
 * and enters storage only through the page's explicit, sized opt-in.
 *
 * `cache: "reload"` on each request because GitHub Pages sends a flat
 * `cache-control: max-age=600` to everything (measured with `curl -I`). A
 * plain fetch here could copy a ten-minute-old response out of the HTTP cache
 * and into the first durable copy this origin has ever had.
 *
 * `addAll` is all-or-nothing: one bad response rejects, install fails, and the
 * worker is discarded rather than activating over a half-shell. That is the
 * failure mode we want — the site works fine with no worker at all.
 *
 * No `skipWaiting()` here. See the message handler.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })));
    })(),
  );
});

/**
 * activate — drop every cache this version does not own, then take control of
 * pages that loaded without a controller.
 *
 * `clients.claim()` is safe in a way `skipWaiting()` is not: it only adopts
 * clients that have NO controller, so nothing is swapped underneath a running
 * page. Without it the first visit runs uncontrolled and caches nothing.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !OWNED_CACHES.includes(name)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Is this response safe to keep?
 *
 * MEASURED: a chunk that no longer exists on GitHub Pages answers
 * `status=404, type=text/html, size=39976` — 40 KB of HTML where JavaScript was
 * expected. Storing that under a hashed `.js` key is the brick this whole
 * design exists to prevent, and `status !== 200` rejects it. The status check
 * also covers 206, which `cache.put` rejects outright, and 3xx.
 *
 * The content-type line covers the one variant the deploy cannot show us: a
 * 200 whose body is HTML, which is what a captive portal or an intercepting
 * proxy answers to any request. Under cache-first that would survive for the
 * life of the build, because the hashed URL never changes.
 */
function isStorable(request: Request, response: Response): boolean {
  if (response.status !== 200) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect") return false;
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (
    (request.destination === "script" || request.destination === "style") &&
    contentType.startsWith("text/html")
  ) {
    return false;
  }
  return true;
}

/**
 * Content-hashed assets under `/_next/static/`. A changed file is a changed
 * URL, so a hit is never stale and a deploy can never invalidate one.
 *
 * A miss goes to the network, and a network failure on a miss is left to
 * reject: `respondWith` turns that into the same network error the page would
 * have got with no worker installed, which is the truth — that chunk is not
 * here.
 */
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (isStorable(request, response)) {
    void cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/**
 * Pages, `.txt` RSC payloads, `/workers/*.js`, the manifest, the icons.
 *
 * The network always wins when it ANSWERS — including when it answers 404, so
 * a page that was deleted stays deleted instead of being resurrected out of
 * cache. Only a thrown fetch (no network at all) reaches the fallback, and a
 * cached page can therefore never outvote the live one.
 *
 * `ignoreSearch` on the fallback because a query string never changes which
 * bytes this static export serves: tool pages carry UI state in the query, and
 * the metadata icons carry their content hash there
 * (`/favicon.ico?favicon.0rz3~2f6ok0.f.ico`, from the built index.html). The
 * engine cache — the one place a query is a retry counter — is a different
 * cache and is never written here.
 */
async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (isStorable(request, response)) {
      // Not awaited: a cache write must not delay the page, and a quota
      // rejection must not turn a good response into a failed one.
      const copy = response.clone();
      void cache.put(request, copy).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === "navigate" || request.destination === "document") {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    return Response.error();
  }
}

/**
 * THE RULE THE WHOLE FEATURE RESTS ON.
 *
 * An engine binary is served from the engine cache IF IT IS ALREADY THERE, and
 * otherwise goes straight to the network WITHOUT BEING ADDED. There is no
 * `cache.put` in this function and there must never be one: the only writer of
 * ENGINE_CACHE is the page's explicit, sized opt-in. A worker that quietly
 * populated it on first use would pull 32 MB behind the user's back on a site
 * whose entire pitch is that it does nothing behind your back.
 *
 * `ignoreSearch` because every loader retries with `?retry=N` — a failed
 * dynamic import is remembered in the realm's module map and a same-URL retry
 * never reaches the network (audio-pcm.ts:52-57). `/qpdf.js?retry=1` must hit
 * the copy stored as `/qpdf.js`.
 */
async function engineFromCacheOnly(request: Request): Promise<Response> {
  const cache = await caches.open(ENGINE_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  return fetch(request);
}

/**
 * The Web Share Target POST.
 *
 * This site has no server, so the ONLY thing that can answer a share is this
 * worker. The OS posts a multipart form here; we stash the files under
 * `/_shared/<uuid>/<i>` keys and redirect to a normal GET the page can read
 * them back from. The redirect is 303 so the browser turns the POST into a GET
 * — a reload of the landing page must not re-submit anything.
 *
 * A `catch` that swallows and still redirects is deliberate: arriving at a page
 * that says nothing was shared is a recoverable disappointment, while a failed
 * navigation out of the OS share sheet is a dead end with no back button.
 */
async function stashShare(request: Request): Promise<Response> {
  const id = crypto.randomUUID();
  try {
    const files = (await request.formData())
      .getAll(SHARE_TARGET_FILE_FIELD)
      .filter((value): value is File => value instanceof File);
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(
      files.map((file, index) =>
        cache.put(
          new Request(sharedFileKey(id, index)),
          new Response(file, {
            headers: {
              "content-type": file.type || "application/octet-stream",
              // A filename may hold anything; a header may not. The shared
              // module owns the encoding so the page decodes it the same way.
              [SHARED_NAME_HEADER]: encodeSharedName(file.name),
            },
          }),
        ),
      ),
    );
  } catch {
    // Fall through to the redirect: see the docblock.
  }
  return Response.redirect(
    new URL(shareRedirectPath(id), self.location.origin).href,
    303,
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // BEFORE the switch, because `strategyFor` sends every non-GET to
  // "network-only" — which is right for all of them except this one, and on a
  // host with no server "network-only" for a POST means a 405 out of the share
  // sheet.
  const shareUrl = new URL(request.url);
  if (
    request.method === "POST" &&
    shareUrl.origin === self.location.origin &&
    shareUrl.pathname === SHARE_TARGET_ACTION
  ) {
    event.respondWith(stashShare(request));
    return;
  }

  // A `Request` satisfies RequestFacts structurally; the decision reads three
  // fields and nothing else, which is what makes it testable in jsdom.
  switch (strategyFor(new URL(request.url), request, self.location.origin)) {
    case "network-only":
      // Deliberately no respondWith: the browser does exactly what it would do
      // if no worker were installed.
      return;
    case "cache-first":
      event.respondWith(cacheFirst(request));
      return;
    case "engine":
      event.respondWith(engineFromCacheOnly(request));
      return;
    case "network-first":
      event.respondWith(networkFirst(request));
  }
});

/**
 * The update flow — and the reason `skipWaiting()` is NOT called on install.
 *
 * A new worker installs and then waits. Calling `skipWaiting()` unconditionally
 * would activate it immediately and `clients.claim()` would take over every
 * open tab, which is hostile here in a way it is not on an ordinary site: a tab
 * may be minutes into a video conversion holding a loaded 32 MB FFmpeg instance
 * and a pool of module workers, and the page's usual response to a controller
 * change is to reload. That reload destroys the run and the file the user
 * dropped is gone.
 *
 * So the page decides. It is the only party that knows whether anything is in
 * flight; when it says now, we go.
 */
self.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown } | null | undefined;
  if (data && data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
