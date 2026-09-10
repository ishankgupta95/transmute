/**
 * The share-target hand-off: the constants and key grammar BOTH ends of it
 * need, and nothing that only one end needs.
 *
 * PURE and DOM-FREE for exactly the reason sw-policy.ts is — the service
 * worker is the only code on this origin that can read the POST, and jsdom has
 * no ServiceWorkerGlobalScope to test it in. No `self`, no `caches`, no
 * `process`, and deliberately no `@/data/tools` import: the registry is 3,479
 * lines and has no business inside a service-worker bundle. The half that does
 * need the registry lives in open-with.ts.
 *
 * WHY A HAND-OFF EXISTS AT ALL
 *
 * `share_target` with `method: "post"` is serviced by a server everywhere else
 * on the web. There is no server here — `output: "export"` on GitHub Pages —
 * so the POST is answered by the service worker's `fetch` handler. That worker
 * cannot simply give the files to the landing page, because at the moment the
 * POST arrives the page it is about to open DOES NOT EXIST: the user tapped
 * "Transmute" in a share sheet and no client of this origin is running. So the
 * files have to be written somewhere the page can read after the redirect.
 *
 * WHY THE CACHE API AND NOT THE OTHER TWO
 *
 * - `postMessage` to a client loses outright. The common case IS the app not
 *   being open; `clients.matchAll()` at that instant returns nothing, and the
 *   client that will render the page has not been created yet. A courier with
 *   no recipient is not a design, it is a dropped file.
 * - IndexedDB would work and preserves `File` objects whole through the
 *   structured clone, name and type included. It loses on surface area: the
 *   worker already opens `SHELL_CACHE` and imports one pure module; an IDB
 *   helper is a second import, an upgrade path, and a request/transaction
 *   dance in a file that (see service-worker.ts) is deliberately kept free of
 *   anything untestable. The Cache API costs the worker one `cache.put`.
 * - The Cache API wins on a third count that matters more than either: the
 *   page can read it WITHOUT going through `fetch`, so the worker's own
 *   routing never sees these keys. A `fetch("/_shared/…")` would be classified
 *   `"network-first"` by `strategyFor` (it is a same-origin GET that is not an
 *   engine and not under `/_next/static/`), go to the network, and be answered
 *   by GitHub Pages with a 404 — which is why the page below is specified to
 *   read `caches.open(SHELL_CACHE).match(key)` directly and never to fetch it.
 *
 * The cost of the Cache API is the one thing this module then has to answer
 * for: bytes the user brought are, briefly, in browser storage. So the read is
 * a TAKE — `shared-intake.ts` deletes every stashed key as it reads, including
 * the ones from a share that was never opened — and the stash exists for the
 * length of one navigation rather than for the length of a session.
 *
 * Written in SHELL_CACHE rather than a third cache of its own because
 * `OWNED_CACHES` (sw-policy.ts) is the complete list of caches this site may
 * own and `activate` deletes anything not on it. A `transmute-shared-v1` would
 * be dropped by the next worker activation — silently, and precisely at the
 * moment a user updated the app mid-share.
 */

/**
 * The URL the share sheet POSTs to, and the page the OS opens for a handled
 * file. ONE route serves both: a share and an "Open with" are the same event
 * from the page's point of view — files arrived from outside the tab — and the
 * only difference is which browser API delivers them.
 */
export const SHARE_TARGET_ACTION = "/open";

/** The multipart field name; must match `share_target.params.files[].name`. */
export const SHARE_TARGET_FILE_FIELD = "files";

/** `/open?shared=<id>` — how the redirect tells the page a stash is waiting. */
export const SHARE_TARGET_PARAM = "shared";

/**
 * The synthetic key space. Not a route: nothing is ever served from here, and
 * `next.config.ts` exports no such path — the leading underscore keeps it
 * clear of the 171 tool slugs, and `/_shared/` rather than `/_next/`-adjacent
 * so a reader can tell the two apart at a glance.
 */
export const SHARED_PREFIX = "/_shared/";

/**
 * The original filename, `encodeURIComponent`'d. It cannot be stored raw: HTTP
 * header values are latin-1, and the first shared photo named `Ünterlagen.pdf`
 * would throw inside `new Response(…, { headers })` and lose the whole share.
 */
export const SHARED_NAME_HEADER = "x-shared-name";

/** `/_shared/<id>/<index>` — the index is what preserves the order a user
 *  picked files in, which is load-bearing for the merge tools. `cache.keys()`
 *  is insertion-ordered per spec, but an explicit index means the reader never
 *  has to depend on that. */
export function sharedFileKey(id: string, index: number): string {
  return `${SHARED_PREFIX}${id}/${index}`;
}

/**
 * The `?shared=` value arrives from the URL bar and is therefore attacker-
 * chosen: anyone can send someone `/open?shared=../../`. Nothing downstream
 * builds a filesystem path out of it — the reader compares parsed ids for
 * equality and nothing else — but it is also never allowed to become one, so
 * the shape is pinned to what `crypto.randomUUID()` emits and everything else
 * is refused before it reaches a cache lookup.
 */
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isShareId(value: string | null | undefined): value is string {
  return typeof value === "string" && SHARE_ID.test(value);
}

/** The 303 target. Relative on purpose — the worker resolves it against its
 *  own script URL, which is the origin root (public/sw.js). */
export function shareRedirectPath(id: string): string {
  return `${SHARE_TARGET_ACTION}?${SHARE_TARGET_PARAM}=${encodeURIComponent(id)}`;
}

/**
 * The inverse of `sharedFileKey`, over a pathname. Returns null for anything
 * that is not a stash key — including a well-formed prefix with a junk id,
 * because the reader uses this to decide what to DELETE and a lax parse there
 * would sweep keys that are not ours.
 */
export function parseSharedKey(pathname: string): { id: string; index: number } | null {
  if (!pathname.startsWith(SHARED_PREFIX)) return null;
  const rest = pathname.slice(SHARED_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const id = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  if (!isShareId(id)) return null;
  // `/^\d+$/` rather than parseInt: "0abc" must not read as index 0, and a
  // key with a further path segment is not one of ours.
  if (!/^\d+$/.test(tail)) return null;
  return { id, index: Number(tail) };
}

export function encodeSharedName(name: string): string {
  return encodeURIComponent(name);
}

/**
 * Names come back through a header a user's own file named, so a malformed
 * percent-escape is a real possibility and must not throw where it would take
 * the whole share down with it. The fallback is deliberately boring rather
 * than empty — a card headed "" reads as a bug.
 */
export function decodeSharedName(raw: string | null | undefined): string {
  if (!raw) return "shared-file";
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.trim() === "" ? "shared-file" : decoded;
  } catch {
    return "shared-file";
  }
}
