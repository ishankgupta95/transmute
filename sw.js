"use strict";
(() => {
  // src/lib/pwa/sw-policy.ts
  var SHELL_CACHE = "transmute-shell-v1";
  var ENGINE_CACHE = "transmute-engines-v1";
  var OWNED_CACHES = [SHELL_CACHE, ENGINE_CACHE];
  var ENGINE_FILES = [
    "/ffmpeg-core.js",
    "/ffmpeg-core.wasm",
    "/qpdf.js",
    "/qpdf.wasm",
    "/zxing_reader.wasm",
    "/libarchive.wasm",
    "/squoosh_oxipng_bg.wasm"
  ];
  var ENGINE_DIRS = ["/vendor/", "/fonts/print/", "/tesseract/"];
  function isEngineUrl(url, origin) {
    if (url.origin !== origin) return false;
    if (ENGINE_FILES.includes(url.pathname)) return true;
    return ENGINE_DIRS.some((dir) => url.pathname.startsWith(dir));
  }
  function strategyFor(url, facts, origin) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return "network-only";
    if (url.origin !== origin) return "network-only";
    if (facts.method !== "GET") return "network-only";
    if (facts.mode === "navigate" || facts.destination === "document") return "network-first";
    if (url.pathname.endsWith(".txt")) return "network-first";
    if (isEngineUrl(url, origin)) return "engine";
    if (url.pathname.startsWith("/_next/static/")) return "cache-first";
    return "network-first";
  }

  // src/lib/pwa/share-target.ts
  var SHARE_TARGET_ACTION = "/open";
  var SHARE_TARGET_FILE_FIELD = "files";
  var SHARE_TARGET_PARAM = "shared";
  var SHARED_PREFIX = "/_shared/";
  var SHARED_NAME_HEADER = "x-shared-name";
  function sharedFileKey(id, index) {
    return `${SHARED_PREFIX}${id}/${index}`;
  }
  function shareRedirectPath(id) {
    return `${SHARE_TARGET_ACTION}?${SHARE_TARGET_PARAM}=${encodeURIComponent(id)}`;
  }
  function encodeSharedName(name) {
    return encodeURIComponent(name);
  }

  // src/lib/pwa/service-worker.ts
  var OFFLINE_URL = "/offline.html";
  var PRECACHE_URLS = ["/", OFFLINE_URL];
  self.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })));
      })()
    );
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => !OWNED_CACHES.includes(name)).map((name) => caches.delete(name))
        );
        await self.clients.claim();
      })()
    );
  });
  function isStorable(request, response) {
    if (response.status !== 200) return false;
    if (response.type === "opaque" || response.type === "opaqueredirect") return false;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if ((request.destination === "script" || request.destination === "style") && contentType.startsWith("text/html")) {
      return false;
    }
    return true;
  }
  async function cacheFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (isStorable(request, response)) {
      void cache.put(request, response.clone()).catch(() => {
      });
    }
    return response;
  }
  async function networkFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const response = await fetch(request);
      if (isStorable(request, response)) {
        const copy = response.clone();
        void cache.put(request, copy).catch(() => {
        });
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
  async function engineFromCacheOnly(request) {
    const cache = await caches.open(ENGINE_CACHE);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(request);
  }
  async function stashShare(request) {
    const id = crypto.randomUUID();
    try {
      const files = (await request.formData()).getAll(SHARE_TARGET_FILE_FIELD).filter((value) => value instanceof File);
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        files.map(
          (file, index) => cache.put(
            new Request(sharedFileKey(id, index)),
            new Response(file, {
              headers: {
                "content-type": file.type || "application/octet-stream",
                // A filename may hold anything; a header may not. The shared
                // module owns the encoding so the page decodes it the same way.
                [SHARED_NAME_HEADER]: encodeSharedName(file.name)
              }
            })
          )
        )
      );
    } catch {
    }
    return Response.redirect(
      new URL(shareRedirectPath(id), self.location.origin).href,
      303
    );
  }
  self.addEventListener("fetch", (event) => {
    const { request } = event;
    const shareUrl = new URL(request.url);
    if (request.method === "POST" && shareUrl.origin === self.location.origin && shareUrl.pathname === SHARE_TARGET_ACTION) {
      event.respondWith(stashShare(request));
      return;
    }
    switch (strategyFor(new URL(request.url), request, self.location.origin)) {
      case "network-only":
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
  self.addEventListener("message", (event) => {
    const data = event.data;
    if (data && data.type === "SKIP_WAITING") {
      void self.skipWaiting();
    }
  });
})();
