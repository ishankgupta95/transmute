"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { tools } from "@/data/tools";
import { getWorkspaceTool } from "@/data/workspace";
import { useIsClient } from "@/hooks/useIsClient";
import { cn } from "@/lib/utils/cn";

/** Any control anywhere can open the palette by dispatching this. */
export const OPEN_SEARCH_EVENT = "transmute:open-search";

export function openSearch() {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

interface Entry {
  slug: string;
  name: string;
  description: string;
  route: string;
  haystack: string;
}

const MAX_RESULTS = 8;

/**
 * `?q=` opens the palette pre-filled. The homepage's `WebSite` schema declares
 * a `SearchAction` pointing at `/?q={search_term_string}`, so this has to work
 * on a cold load from a search engine, not only via ⌘K.
 *
 * Read in the state initialiser rather than from an effect: setState in an
 * effect body is an error in this repo, and `useIsClient` holds the first
 * render at `null` anyway, so the prerendered markup can't disagree with the
 * client. `useSearchParams` would drag a Suspense boundary into the root
 * layout for a value that only ever matters in the browser.
 */
function queryFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
}

export function CommandPalette() {
  const router = useRouter();
  const mounted = useIsClient();
  const [open, setOpen] = useState(() => queryFromUrl() !== "");
  const [query, setQuery] = useState(queryFromUrl);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<Entry[]>(
    () =>
      tools.map((t) => {
        const route = getWorkspaceTool(t.slug)?.route ?? "";
        return {
          slug: t.slug,
          name: t.name,
          description: t.description,
          route,
          haystack:
            `${t.name} ${t.slug} ${route} ${t.keywords.join(" ")}`.toLowerCase(),
        };
      }),
    [],
  );

  // "heic jpg" and "pdf smaller" both work: every token must appear somewhere.
  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return entries.slice(0, MAX_RESULTS);
    return entries
      .filter((e) => tokens.every((tok) => e.haystack.includes(tok)))
      .slice(0, MAX_RESULTS);
  }, [entries, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (slug: string) => {
      close();
      router.push(`/${slug}`);
    },
    [close, router],
  );

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // `mounted` is a dependency because of the `?q=` path: the palette opens on
  // the very first render, but nothing is in the DOM until `useIsClient` flips,
  // so focusing before then would find no input.
  useEffect(() => {
    if (!open || !mounted) return;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, mounted]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-[rgba(15,17,28,.72)] px-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search tools"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] overflow-hidden rounded-lg border border-border bg-bg-primary shadow-[0_0_0_1px_var(--color-nocturne-neutral-800),0_24px_60px_rgba(0,0,0,.6)]"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="flex-none text-text-muted"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (i + 1) % Math.max(results.length, 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(
                  (i) => (i - 1 + results.length) % Math.max(results.length, 1),
                );
              }
              if (e.key === "Enter" && results[active]) go(results[active].slug);
            }}
            placeholder={`Search ${tools.length} tools…`}
            aria-label="Search tools"
            className="h-[52px] w-full bg-transparent font-body text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <kbd className="flex-none rounded-sm border border-border bg-bg-primary px-[7px] py-[5px] font-mono text-[10.5px] leading-none font-medium text-text-secondary">
            ESC
          </kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center font-body text-sm text-text-muted">
            Nothing converts to that. Try a format pair — “heic jpg”.
          </p>
        ) : (
          <ul className="max-h-[52vh] overflow-y-auto py-1.5">
            {results.map((r, i) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.slug)}
                  className={cn(
                    "flex w-full items-center gap-4 px-4 py-2.5 text-left transition-colors duration-150",
                    i === active ? "bg-accent/12" : "bg-transparent",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={cn(
                        "truncate font-body text-sm font-medium",
                        i === active ? "text-accent-200" : "text-text-primary",
                      )}
                    >
                      {r.name}
                    </span>
                    <span className="truncate font-body text-xs text-text-muted">
                      {r.description}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[10.5px] whitespace-nowrap text-accent-300">
                    {r.route}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
