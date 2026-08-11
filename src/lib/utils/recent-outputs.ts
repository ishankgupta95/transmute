/**
 * Recent outputs — the design docs' "RECENT OUTPUT" rail section, made real
 * (Phase 4). Every download the user actually saves is recorded here:
 * metadata only (name, size, source tool, when), because blobs don't fit in
 * localStorage — this is a record of what you made, not a re-download cache.
 *
 * Store shape is a plain module so `triggerDownload` (non-React) can write;
 * hooks/useRecentOutputs.ts wraps it for components via useSyncExternalStore.
 */

export interface RecentOutput {
  name: string;
  bytes: number;
  /** Tool slug the output came from (pathname, or ?tool= on /workspace). */
  slug: string;
  /** Epoch ms. */
  at: number;
}

const KEY = "transmute-recent-outputs";
const MAX = 8;

const listeners = new Set<() => void>();

/**
 * Parse cache keyed on the raw string — getSnapshot must return the same
 * reference for unchanged data or useSyncExternalStore loops forever.
 */
let cachedRaw: string | null = null;
let cachedList: RecentOutput[] = [];
const EMPTY: RecentOutput[] = [];

export function readRecentOutputs(): RecentOutput[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY; // storage blocked (private mode) — Recent is best-effort
  }
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedList = Array.isArray(parsed) ? (parsed as RecentOutput[]).slice(0, MAX) : [];
  } catch {
    cachedList = [];
  }
  return cachedList;
}

/** The SSR snapshot — a stable empty list. */
export function emptyRecentOutputs(): RecentOutput[] {
  return EMPTY;
}

export function recordRecentOutput(entry: Omit<RecentOutput, "at">): void {
  try {
    const next = [{ ...entry, at: Date.now() }, ...readRecentOutputs()].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

/** Cross-component (and cross-tab, via the storage event) subscription. */
export function subscribeRecentOutputs(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The tool that produced a download: /slug pages, or ?tool= on /workspace. */
export function currentToolSlug(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("tool");
  if (fromQuery) return fromQuery;
  return window.location.pathname.split("/").filter(Boolean).pop() ?? "";
}
