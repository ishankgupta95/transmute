/**
 * The page half of the share-target hand-off: read the files the service
 * worker stashed for one navigation, and leave nothing behind.
 *
 * This module touches `caches` and therefore cannot live in share-target.ts,
 * which the worker imports and which must stay DOM-free. It is still testable
 * — the Cache API is small enough to stub, and every branch below is stubbed
 * in shared-intake.test.ts.
 */

import {
  SHARED_NAME_HEADER,
  decodeSharedName,
  isShareId,
  parseSharedKey,
} from "./share-target";
import { SHELL_CACHE } from "./sw-policy";

/**
 * TAKE, not read.
 *
 * Every key under `/_shared/` is deleted, including the ones belonging to
 * some OTHER id — a share the user started and never opened, a second share
 * that raced this one, a stash written by a build before this one. That sweep
 * is the whole reason this is a "take": `/privacy` says the only things this
 * site keeps in browser storage are one localStorage key and a copy of the
 * site's own code, and a shared file that outlived its navigation would make
 * that false for as long as it sat there.
 *
 * Returns the requested id's files in the order they were shared. Everything
 * that can go wrong — no Cache API at all (a browser without it, or a page in
 * a non-secure context), a junk `?shared=` from the URL bar, a body that will
 * not read back — returns an empty list rather than throwing, because the
 * caller's fallback is a perfectly good file picker.
 *
 * Deliberately NOT `fetch("/_shared/…")`: `strategyFor` would classify that as
 * a plain same-origin GET, send it to GitHub Pages, and get a 404 back. The
 * page reads the cache directly, so the worker's routing never sees these keys
 * at all.
 */
export async function takeSharedFiles(id: string | null | undefined): Promise<File[]> {
  if (typeof caches === "undefined") return [];

  let cache: Cache;
  try {
    cache = await caches.open(SHELL_CACHE);
  } catch {
    return [];
  }

  let keys: readonly Request[];
  try {
    keys = await cache.keys();
  } catch {
    return [];
  }

  const wanted: { request: Request; index: number }[] = [];
  const stale: Request[] = [];

  for (const request of keys) {
    let parsed: ReturnType<typeof parseSharedKey> = null;
    try {
      parsed = parseSharedKey(new URL(request.url).pathname);
    } catch {
      // A key whose URL will not parse is not one we wrote; leave it alone.
      continue;
    }
    if (!parsed) continue;
    if (isShareId(id) && parsed.id === id) wanted.push({ request, index: parsed.index });
    else stale.push(request);
  }

  // Index order, not insertion order: the merge tools care which file was
  // first, and `cache.keys()` ordering is not something worth depending on.
  wanted.sort((a, b) => a.index - b.index);

  const files: File[] = [];
  for (const { request } of wanted) {
    let response: Response | undefined;
    try {
      response = await cache.match(request);
    } catch {
      response = undefined;
    }
    // Deleted BEFORE the body is read, and whether or not the body reads: a
    // courier that keeps a copy when the hand-off fails is a courier that
    // stored your file.
    await cache.delete(request).catch(() => false);
    if (!response) continue;
    try {
      const blob = await response.blob();
      files.push(
        new File([blob], decodeSharedName(response.headers.get(SHARED_NAME_HEADER)), {
          type: response.headers.get("content-type") ?? "",
        }),
      );
    } catch {
      // One unreadable body does not cost the user the other files.
    }
  }

  for (const request of stale) {
    await cache.delete(request).catch(() => false);
  }

  return files;
}
