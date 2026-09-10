"use client";

import { useCallback, useMemo, useState } from "react";

import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  StatStrip,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN, MONO_LABEL } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  ALL_STATUSES,
  STANDARD_STATUSES,
  STATUS_CLASSES,
  VENDOR_STATUSES,
  filterStatuses,
  statusClass,
  type StatusClass,
  type StatusCode,
} from "@/lib/tools/http-status";

/** The one field box the redesign doc specifies. Copied from SubtitleConverterUI. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** One colour per class, so the eye finds 4xx before it reads the number. */
const CLASS_TONE: Record<StatusClass, string> = {
  "1xx": "text-neutral-300",
  "2xx": "text-success",
  "3xx": "text-accent-300",
  "4xx": "text-warning",
  "5xx": "text-error",
};

const CLASS_OPTIONS = [
  { value: "all" as const, label: "All" },
  ...STATUS_CLASSES.map((c) => ({ value: c.id, label: c.label })),
];

function StatusRow({ status, vendor }: { status: StatusCode; vendor?: string }) {
  const cls = statusClass(status.code);
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code
          className={cn(
            "font-mono text-[15px] leading-none font-medium",
            cls ? CLASS_TONE[cls] : "text-neutral-300",
          )}
        >
          {status.code}
        </code>
        <span className="font-body text-[12.5px] leading-none font-medium text-neutral-200">
          {status.phrase}
        </span>
        <span className="font-mono text-[10px] leading-none text-text-muted">
          {status.reference}
        </span>
      </div>

      <span className="font-body text-[11.5px] leading-[1.55] text-text-muted">
        {status.summary}
      </span>

      {(status.heuristicallyCacheable || status.methodPreserved || status.deprecated || vendor) && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {vendor && <Chip tone="neutral">{vendor}{" "}only — not a standard</Chip>}
          {status.deprecated && <Chip tone="warn">{status.deprecated}</Chip>}
          {status.heuristicallyCacheable && (
            <Chip tone="ok">Cacheable without explicit freshness headers</Chip>
          )}
          {status.methodPreserved && <Chip tone="neutral">Method: {status.methodPreserved}</Chip>}
        </div>
      )}
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "neutral" }) {
  return (
    <span
      className={cn(
        "rounded-[5px] border px-2 py-1 font-body text-[10.5px] leading-[1.35]",
        tone === "ok" && "border-success/35 bg-success/8 text-success",
        tone === "warn" && "border-warning/35 bg-warning/8 text-warning",
        tone === "neutral" && "border-border bg-text-primary/3 text-text-muted",
      )}
    >
      {children}
    </span>
  );
}

/*
  Reference prose, collapsed.

  This page is a table of 88 codes plus four notes explaining what the table's
  chips mean and what the page deliberately does not do. Rendered open, those
  notes were 416px of the rail — blank reserved space on a phone (see
  `data/tool-surface-heights.ts`: the surface height is reserved before the
  component mounts, so tall means "scroll past nothing"). Not one word was cut:
  each note keeps its own summary row, the summary carries the note's headline
  claim so the honest part is legible without opening anything, and the full
  text stays in the DOM for search. Markup follows `ToolAdvanced` in
  `ToolAside.tsx`, which is the in-house drawer.
*/
function RailNote({
  label,
  gist,
  children,
}: {
  label: string;
  /** The note's claim in two or three words — stays visible while collapsed. */
  gist: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-b border-border px-4 last:border-b-0">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 py-3",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={cn(MONO_LABEL, "text-text-muted")}>{label}</span>
        <span className="font-mono text-[10px] leading-none text-text-muted opacity-60">
          {gist}
        </span>
        <span
          aria-hidden="true"
          className="ml-auto font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          &rsaquo;
        </span>
      </summary>
      <div className="-mx-4 animate-tm-drawer border-t border-border bg-text-primary/3 px-4 py-3.5 font-body text-[10.5px] leading-[1.5] text-text-muted motion-reduce:animate-none">
        {children}
      </div>
    </details>
  );
}

/** The same drawer at paragraph scale, for prose that belongs to a control. */
function InlineNote({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-1.5 font-body text-[10.5px] leading-[1.5] text-text-muted",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span
          aria-hidden="true"
          className="font-mono text-[11px] leading-none transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          &rsaquo;
        </span>
        {summary}
      </summary>
      <p className="animate-tm-drawer pt-2 font-body text-[10.5px] leading-[1.5] text-text-muted motion-reduce:animate-none">
        {children}
      </p>
    </details>
  );
}

export function HttpStatusCodesUI() {
  const [query, setQuery] = useState("");
  const [cls, setCls] = useState<StatusClass | "all">("all");
  const [showVendor, setShowVendor] = useState(true);
  const { copied, copy } = useCopied();

  const standard = useMemo(() => filterStatuses(STANDARD_STATUSES, query, cls), [query, cls]);
  const vendor = useMemo(
    () => (showVendor ? filterStatuses(VENDOR_STATUSES, query, cls) : []),
    [query, cls, showVendor],
  );
  const total = standard.length + vendor.length;
  const numericQuery = /^\d+$/.test(query.trim());

  const asText = useMemo(
    () =>
      [...standard, ...vendor]
        .map((s) => `${s.code} ${s.phrase} — ${s.reference}`)
        .join("\n"),
    [standard, vendor],
  );

  const handleCopy = useCallback(() => {
    void copy(asText);
  }, [copy, asText]);

  const handleReset = useCallback(() => {
    setQuery("");
    setCls("all");
    setShowVendor(true);
  }, []);

  return (
    <>
      {/* ── Canvas: search, then the registry ─────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={1}>
          <TextPane
            label={cls === "all" ? "Every HTTP status code" : `${cls} status codes`}
            action={
              <span className="font-mono text-[11px] text-accent-300">
                {total}{" "}OF{" "}{ALL_STATUSES.length}{" "}SHOWN
              </span>
            }
          >
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-3 border-b border-border px-3.5 py-3">
                <label
                  htmlFor="status-search"
                  className="shrink-0 font-body text-[11.5px] leading-none text-text-muted"
                >
                  Search
                </label>
                <input
                  id="status-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="429, gateway, rate limit, RFC 6585…"
                  spellCheck={false}
                  className={cn(FIELD_CLASS, "min-w-0 flex-1")}
                />
              </div>

              {/*
                The list is the product, so no entry is dropped — the scroller
                is bounded instead, and the header above states the real count
                ("N OF 88 SHOWN") so nothing is hidden silently. The ceiling
                rises with the viewport because the whole surface height is
                reserved before this component mounts: 38rem of list on a phone
                is 600px of blank space the reader scrolls past, while on
                desktop it is the table doing its job.
              */}
              <div className="max-h-[28rem] overflow-y-auto md:max-h-[32rem] xl:max-h-[38rem]">
                {total === 0 && (
                  <p className="px-3.5 py-6 font-body text-[12.5px] leading-[1.6] text-text-muted">
                    Nothing matches{" "}
                    <code className="font-mono text-[11.5px] text-neutral-300">{query}</code> in the{" "}
                    {cls === "all" ? "registry" : `${cls} range`}. A bare number is matched as the
                    START of a code and as an RFC number, so{" "}
                    <code className="font-mono text-[11.5px] text-neutral-300">50</code> finds the
                    500s,{" "}
                    <code className="font-mono text-[11.5px] text-neutral-300">6585</code> finds the
                    four codes RFC 6585 defines, and{" "}
                    <code className="font-mono text-[11.5px] text-neutral-300">04</code> finds
                    nothing.
                  </p>
                )}

                {standard.map((status) => (
                  <StatusRow key={status.code} status={status} />
                ))}

                {vendor.length > 0 && (
                  <div className="border-y border-border bg-text-primary/3 px-3.5 py-2.5">
                    <span className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-warning">
                      NOT IN THE IANA REGISTRY — {vendor.length}{" "}VENDOR{" "}
                      {vendor.length === 1 ? "CODE" : "CODES"}
                    </span>
                  </div>
                )}
                {vendor.map((status) => (
                  <StatusRow key={status.code} status={status} vendor={status.source} />
                ))}
              </div>
            </div>
          </TextPane>
        </TextPanes>

        <StatStrip
          stats={[
            { label: "IANA REGISTERED", value: String(STANDARD_STATUSES.length) },
            { label: "VENDOR CODES", value: String(VENDOR_STATUSES.length), tone: "neutral" },
            { label: "MATCHING NOW", value: String(total), tone: "neutral" },
          ]}
        />

        {/*
          Two different rules run, so the footnote says which one is running.
          A bare number is not run as a substring over the prose (see
          `matchesQuery`): it matches a code prefix and an RFC number, so
          asserting the general sentence over a numeric query would describe a
          search the page is not doing.
        */}
        <CanvasFootnote>
          {numericQuery
            ? "A BARE NUMBER MATCHES THE START OF A CODE, AND AN RFC NUMBER"
            : "SEARCH MATCHES THE CODE, THE REASON PHRASE, THE DESCRIPTION AND THE RFC"}
        </CanvasFootnote>
      </div>

      {/* ── Controls ───────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={
              copied
                ? "Copied to clipboard"
                : total === 1
                  ? "Copy this code"
                  : `Copy these ${total} codes`
            }
            onPrimary={handleCopy}
            primaryDisabled={total === 0}
            onReset={handleReset}
            resetLabel="CLEAR FILTERS"
          />
        }
      >
        <ToolAsideSection label="CLASS">
          <ToolChoice label="Status class" value={cls} onChange={setCls} options={CLASS_OPTIONS} />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {cls === "all"
              ? "The first digit is the whole contract: a client that does not recognise 418 is still required to treat it as a 4xx."
              : STATUS_CLASSES.find((c) => c.id === cls)?.blurb}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="NON-STANDARD CODES">
          <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
            <input
              type="checkbox"
              checked={showVendor}
              onChange={(e) => setShowVendor(e.target.checked)}
              className="size-4 rounded-sm border-border accent-accent"
            />
            Include vendor codes
          </label>
          <InlineNote summary="In your logs, in no RFC">
            nginx&rsquo;s 499, Cloudflare&rsquo;s 5xx range, IIS&rsquo;s 440 and LinkedIn&rsquo;s
            999 are in your logs and in no RFC. They are kept in their own group, below a rule and
            labelled with the software that emits them, so the page can be useful about them
            without implying they are HTTP.
          </InlineNote>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Registered", `${standard.length} of ${STANDARD_STATUSES.length}`],
              ["Vendor", `${vendor.length} of ${VENDOR_STATUSES.length}`],
              ["Total shown", String(total)],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Copy hands you one line per visible code —{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">
              code, phrase, reference
            </code>{" "}
            — not the descriptions.
          </span>
        </ToolAsideSection>

        <RailNote label="ABOUT THE CACHEABLE FLAG" gist="12 CODES">
          RFC 9110 §15.1 names exactly twelve codes a cache may reuse with no explicit freshness
          header: 200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414 and 501. Those carry the
          green chip. Nothing here says a response &ldquo;cannot&rdquo; be cached — that is
          decided by <code className="font-mono text-[10.5px] text-neutral-300">Cache-Control</code>{" "}
          and <code className="font-mono text-[10.5px] text-neutral-300">Expires</code>, not by
          the status code. The one to remember is 404: a 404 served during a deploy can be
          cached by an intermediary after the page exists.
        </RailNote>

        <RailNote label="ABOUT THE METHOD CHIP" gist="3XX ONLY">
          Stated on 3xx only, because that is the only class where it is defined. 307 and 308
          forbid changing the method, so a POST stays a POST. 303 requires changing it to GET.
          301 and 302 are the historical mess: the specification permits a user agent to rewrite
          POST to GET and every browser does, which is why an API that moves an endpoint with a
          301 loses its request bodies.
        </RailNote>

        <RailNote label="WHAT THIS PAGE IS NOT" gist="NOT A CHECKER">
          A reference table, not a checker. It does not make a request, resolve a hostname or
          look at a URL — there is nothing to type a site into, and nothing leaves this tab.
          {" "}
          {ALL_STATUSES.length}{" "}codes ship with the page and are searched locally.
        </RailNote>
      </ToolAside>
    </>
  );
}
