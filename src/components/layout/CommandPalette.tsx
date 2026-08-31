"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { tools } from "@/data/tools";
import { getWorkspaceTool } from "@/data/workspace";
import { useIsClient } from "@/hooks/useIsClient";
import { cn } from "@/lib/utils/cn";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

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

/*
  12, not 8: broad-but-obvious queries ("pdf", "image") matched more tools than
  the list showed and silently dropped the rest. The list already scrolls
  (`max-h-[52vh] overflow-y-auto`), and anything still cut is announced by the
  count row under it.
*/
const MAX_RESULTS = 12;

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
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  const entries = useMemo<Entry[]>(
    () =>
      tools.map((t) => {
        const route = getWorkspaceTool(t.slug)?.route ?? "";
        return {
          slug: t.slug,
          name: t.name,
          description: t.description,
          route,
          // `description` is indexed too — without it "pdf smaller", a query
          // the hero types on a loop, matched nothing.
          haystack:
            `${t.name} ${t.slug} ${route} ${t.keywords.join(" ")} ${t.description}`.toLowerCase(),
        };
      }),
    [],
  );

  /*
    "heic jpg" and "pdf smaller" both work: every token must appear somewhere.
    The matches are then ranked — exact name, name prefix, slug hit, everything
    else — because a wider haystack means an incidental description hit could
    otherwise outrank the tool the user actually named. `Array#sort` is stable,
    so registry order survives inside each tier.
  */
  const { results, total } = useMemo(() => {
    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    const all =
      tokens.length === 0
        ? entries
        : entries.filter((e) => tokens.every((tok) => e.haystack.includes(tok)));
    const rank = (e: Entry) => {
      const n = e.name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      return e.slug.includes(q) ? 2 : 3;
    };
    const sorted = tokens.length === 0 ? all : [...all].sort((a, b) => rank(a) - rank(b));
    return { results: sorted.slice(0, MAX_RESULTS), total: all.length };
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
    // Counted, not written directly: the phone nav drawer can be open behind
    // this and must keep its own lock when the palette closes.
    lockScroll();
    inputRef.current?.focus();
    return () => unlockScroll();
  }, [open, mounted]);

  // The list scrolls, so the arrow-key highlight has to be scrolled with it —
  // otherwise the selection walks off the bottom invisibly.
  useEffect(() => {
    rowRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center bg-[rgba(10,11,18,.72)] px-4 pt-[12vh] backdrop-blur-[3px]"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search tools"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[600px] overflow-hidden rounded-[12px] bg-bg-elevated shadow-[0_0_0_1px_var(--color-nocturne-neutral-700),0_30px_70px_rgba(0,0,0,.6)]"
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
            /*
              Arrow keys move a highlight while focus stays in the input, so
              the selection only exists for assistive tech if it is published
              as a combobox + activedescendant. `aria-controls` is dropped when
              the list isn't rendered — it must not point at a missing id.
            */
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={results.length > 0 ? "cmd-results" : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              results[active] ? `cmd-opt-${results[active].slug}` : undefined
            }
            className="h-[52px] w-full bg-transparent font-body text-[15px] text-text-primary caret-accent placeholder:text-text-muted focus:outline-none"
          />
          <span className="sr-only" aria-live="polite">
            {total} results
          </span>
          <kbd className="flex-none rounded-sm border border-border bg-bg-primary px-[7px] py-[5px] font-mono text-[10.5px] leading-none font-medium text-text-secondary">
            ESC
          </kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center font-body text-sm text-text-muted">
            Nothing converts to that. Try a format pair — “heic jpg”.
          </p>
        ) : (
          <ul
            id="cmd-results"
            role="listbox"
            aria-label="Tools"
            className="max-h-[52vh] overflow-y-auto py-1.5"
          >
            {results.map((r, i) => (
              <li
                key={r.slug}
                role="presentation"
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
              >
                <button
                  type="button"
                  id={`cmd-opt-${r.slug}`}
                  role="option"
                  aria-selected={i === active}
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

        {/* Never let the list just stop: say how much was cut. */}
        {total > results.length && (
          <p className="m-0 border-t border-border px-4 py-2 text-center font-mono text-[10.5px] text-text-muted">
            SHOWING {results.length} OF {total} — KEEP TYPING
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
