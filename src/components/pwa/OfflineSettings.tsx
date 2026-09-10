"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ENGINE_BUNDLES,
  TOOLS_NEEDING_FFMPEG,
  TOOLS_NEEDING_ONLY_SMALL_ENGINES,
  TOOLS_WHERE_FFMPEG_IS_A_FALLBACK,
  TOOLS_WITHOUT_ENGINES,
  TOOLS_WITH_ENGINES,
  addBundle,
  cachedBundleIds,
  clearAllOffline,
  formatEngineBytes,
  removeBundle,
  storageEstimate,
  supportsOffline,
  totalBundleBytes,
  type EngineBundle,
} from "@/lib/pwa/offline";
import { cn } from "@/lib/utils/cn";

/*
  THE OFFLINE SURFACE.

  What this page shows BEFORE anyone presses anything is the whole point of it.
  A "make available offline" switch with no figure beside it is how a site ends
  up pulling 32 MB from someone on a train, and this site's entire pitch is
  that it does nothing behind your back. So every row carries the exact byte
  count of the file it would fetch, on the same ruler the homepage's DOWNLOAD
  column uses, and the page leads with the SHAPE of the choice rather than with
  a list of switches:

    133 of the 179 tools need no engine at all. Of the 46 that do, 14 are
    covered by everything-except-FFmpeg together — a twentieth of the bytes —
    and the other 32 need the 32 MB core.

  Someone who reads that and stores the small half has bought most of the
  value for 5% of the download, and they can only make that trade if they are
  told the shape before they are shown the buttons.

  EVERY STATE WORD ON THIS PAGE IS DERIVED. "Stored" comes from
  `cachedBundleIds()`, which re-reads the Cache API on every call because
  eviction is per-origin, total, and silent. Nothing here is remembered
  between renders, and no boolean about storage is ever written down.
*/

const H2 = "m-0 font-display text-[17px] leading-[1.25] font-medium text-text-primary";
const BODY = "m-0 font-body text-[12.5px] leading-[1.65] text-neutral-400";
const RULE =
  "h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_32px,var(--color-border)_calc(100%-32px),transparent)]";
const EYEBROW =
  "font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-accent-300";
const MONO_META = "font-mono text-[10px] leading-none tracking-[0.06em] text-text-muted";
const BUTTON =
  "rounded-[7px] border px-3 py-2 font-mono text-[10px] leading-none tracking-[0.08em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40";

/** `1,361,547` — the site quotes exact counts on /privacy; so does this. */
const exact = (bytes: number) => bytes.toLocaleString("en-US");

const TOTAL_TOOLS = TOOLS_WITHOUT_ENGINES + TOOLS_WITH_ENGINES;
const FFMPEG = ENGINE_BUNDLES.find((b) => b.id === "ffmpeg") as EngineBundle;
const SMALL_BUNDLES = ENGINE_BUNDLES.filter((b) => b.id !== "ffmpeg");
const SMALL_BYTES = totalBundleBytes(SMALL_BUNDLES);

type RowState =
  | { kind: "idle" }
  | { kind: "working"; fraction: number }
  | { kind: "error"; message: string };

export function OfflineSettings() {
  /**
   * `null` means "not read yet" and renders as neither stored nor missing.
   * Collapsing it to an empty Set would make every row say NOT STORED for one
   * frame — a wrong claim, briefly, which is still a wrong claim.
   */
  const [cached, setCached] = useState<Set<EngineBundle["id"]> | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [controlled, setControlled] = useState<boolean | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [confirmingClear, setConfirmingClear] = useState(false);
  const aborts = useRef(new Map<string, AbortController>());

  const refresh = useCallback(async () => {
    const ok = supportsOffline();
    setSupported(ok);
    setControlled(
      typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker.controller !== null
        : false,
    );
    setCached(ok ? await cachedBundleIds() : new Set());
    setEstimate(await storageEstimate());
  }, []);

  useEffect(() => {
    // Not called synchronously: the read is async, so nothing sets state in
    // the effect body itself.
    void refresh();
  }, [refresh]);

  const setRow = useCallback((id: string, state: RowState) => {
    setRows((prev) => ({ ...prev, [id]: state }));
  }, []);

  const keep = useCallback(
    async (bundle: EngineBundle) => {
      const controller = new AbortController();
      aborts.current.set(bundle.id, controller);
      setRow(bundle.id, { kind: "working", fraction: 0 });
      try {
        await addBundle(
          bundle.id,
          (fraction) => setRow(bundle.id, { kind: "working", fraction }),
          controller.signal,
        );
        setRow(bundle.id, { kind: "idle" });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setRow(bundle.id, {
          kind: "error",
          // Cancelling is a decision, not a fault, and it says what the
          // cancel actually did — nothing was kept.
          message: aborted
            ? "Cancelled. Nothing was kept."
            : `Could not store it: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        aborts.current.delete(bundle.id);
        // Re-derive rather than assume the write landed: this is the only
        // thing on the page allowed to decide whether a bundle is present.
        await refresh();
      }
    },
    [refresh, setRow],
  );

  const drop = useCallback(
    async (bundle: EngineBundle) => {
      setRow(bundle.id, { kind: "working", fraction: 1 });
      try {
        await removeBundle(bundle.id);
        setRow(bundle.id, { kind: "idle" });
      } catch (err) {
        setRow(bundle.id, {
          kind: "error",
          message: `Could not remove it: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        await refresh();
      }
    },
    [refresh, setRow],
  );

  const clearEverything = useCallback(async () => {
    setConfirmingClear(false);
    await clearAllOffline();
    setRows({});
    await refresh();
  }, [refresh]);

  const storedCount = cached?.size ?? 0;
  const storedBytes = ENGINE_BUNDLES.filter((b) => cached?.has(b.id)).reduce(
    (sum, b) => sum + b.bytes,
    0,
  );

  return (
    <div className="flex flex-col gap-6.5">
      <div className="flex flex-wrap items-baseline justify-between gap-5">
        <h1 className="m-0 font-display text-[clamp(28px,5vw,36px)] leading-[1.14] font-medium tracking-[-0.028em] text-text-primary">
          Offline access
        </h1>
        <span className={cn(MONO_META, "whitespace-nowrap")}>{TOTAL_TOOLS} TOOLS</span>
      </div>

      <p className="m-0 font-body text-[15px] leading-[1.75] text-neutral-300">
        Transmute keeps a copy of its own code — the HTML, scripts, styles and fonts that draw a
        page — so a page opens without waiting on the network. The engines are deliberately not
        part of that copy. None of them is ever fetched in the background, and none is stored
        unless you ask for it here, by name, with its size in front of you.
      </p>

      {/* ── The shape of the choice ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[11px] border border-border bg-border sm:grid-cols-3">
        <Stat
          label="NEED NO ENGINE"
          value={`${TOOLS_WITHOUT_ENGINES} tools`}
          meta="0 bytes — the page is enough"
        />
        <Stat
          label="EVERYTHING EXCEPT FFMPEG"
          value={`${TOOLS_NEEDING_ONLY_SMALL_ENGINES} tools`}
          meta={`${formatEngineBytes(SMALL_BYTES)} · ${exact(SMALL_BYTES)} bytes`}
        />
        <Stat
          label="FFMPEG ALONE"
          value={`${TOOLS_NEEDING_FFMPEG} tools`}
          meta={`${formatEngineBytes(FFMPEG.bytes)} · ${exact(FFMPEG.bytes)} bytes`}
        />
      </div>

      <p className={BODY}>
        Seven of the eight engines below add up to {formatEngineBytes(SMALL_BYTES)} between them
        and cover {TOOLS_NEEDING_ONLY_SMALL_ENGINES} tools. FFmpeg is the eighth, and on its own it
        is {formatEngineBytes(FFMPEG.bytes)} for {TOOLS_NEEDING_FFMPEG} — a twentieth of the bytes
        for a third of the tools, which is worth knowing before you choose.
      </p>

      {supported === false && (
        <Note tone="warn">
          This browser cannot store an offline copy. Either the Cache API is unavailable — it needs
          a secure context — or service workers are turned off. Everything on this site still
          works; it just needs the network the first time it reaches for an engine.
        </Note>
      )}

      {supported === true && controlled === false && (
        <Note tone="warn">
          No service worker is in control of this tab yet. Anything you store below is kept, but
          nothing will serve it back until a worker takes over — which happens on your next visit.
        </Note>
      )}

      <div className={RULE} />

      {/* ── The engines ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h2 className={H2}>Engines</h2>
          <span className={EYEBROW}>{ENGINE_BUNDLES.length} FILES THIS ORIGIN SERVES</span>
        </div>
        <p className={BODY}>
          Each row is a file this site serves as its own file, and the figure beside it is that
          file&rsquo;s byte count — the number your browser&rsquo;s network panel will show. Storing
          one fetches it once, now, instead of the first time a tool needs it.
        </p>

        <ul className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-[11px] border border-border bg-border p-0">
          {ENGINE_BUNDLES.map((bundle) => (
            <EngineRow
              key={bundle.id}
              bundle={bundle}
              stored={cached?.has(bundle.id) ?? null}
              state={rows[bundle.id] ?? { kind: "idle" }}
              disabled={supported === false}
              onKeep={() => void keep(bundle)}
              onDrop={() => void drop(bundle)}
              onCancel={() => aborts.current.get(bundle.id)?.abort()}
            />
          ))}
        </ul>
      </section>

      {/* ── The caveat that cannot be a badge ───────────────────────────── */}
      <Note tone="info">
        <strong className="font-medium text-neutral-200">
          For {TOOLS_WHERE_FFMPEG_IS_A_FALLBACK} audio tools, FFmpeg is decided per file.
        </strong>{" "}
        Those tools hand your file to the browser&rsquo;s own audio decoder first, and only reach
        for the {formatEngineBytes(FFMPEG.bytes)} core if that decoder refuses it. Which files get
        refused differs between Safari, Chrome and Firefox, and between versions of each. So they
        are neither &ldquo;works offline&rdquo; nor &ldquo;doesn&rsquo;t&rdquo; — an m4a that one
        browser opens on its own is an m4a another sends to FFmpeg. Storing the core is what makes
        the answer the same every time.
      </Note>

      <div className={RULE} />

      {/* ── Storage, and the way out ────────────────────────────────────── */}
      <section className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h2 className={H2}>Storage</h2>
          <span className={EYEBROW}>ON THIS DEVICE, IN THIS BROWSER</span>
        </div>

        <div aria-live="polite" className="flex flex-col gap-2">
          <p className={cn(BODY, "font-mono text-[11px] text-neutral-300")}>
            {cached === null
              ? "Reading what is stored…"
              : storedCount === 0
                ? "No engine is stored. Every tool here works; the ones that need an engine will fetch it when you use them."
                : `${storedCount} of ${ENGINE_BUNDLES.length} engines stored · ${formatEngineBytes(storedBytes)} · ${exact(storedBytes)} bytes`}
          </p>
          {estimate && (
            <p className={cn(BODY, "font-mono text-[11px]")}>
              Your browser reports {formatEngineBytes(estimate.usage)} used of{" "}
              {formatEngineBytes(estimate.quota)} granted to this site. That figure is the
              browser&rsquo;s, covers everything this origin holds, and is deliberately rounded —
              it will not match the sum above.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => (confirmingClear ? void clearEverything() : setConfirmingClear(true))}
            disabled={supported === false}
            className={cn(
              BUTTON,
              confirmingClear
                ? "border-error text-error hover:bg-error/10"
                : "border-border text-text-muted hover:text-text-primary",
            )}
          >
            {confirmingClear ? "YES — REMOVE EVERYTHING" : "REMOVE EVERYTHING STORED"}
          </button>
          {confirmingClear && (
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              className={cn(BUTTON, "border-border text-text-muted hover:text-text-primary")}
            >
              CANCEL
            </button>
          )}
        </div>

        <p className={BODY}>
          That removes both caches this site owns: every engine you stored, and the copy of the
          site&rsquo;s own pages. It does not touch{" "}
          <span className="font-mono text-[11px] text-neutral-300">transmute-recent-outputs</span>,
          the single localStorage key that remembers the names of your last eight downloads — that
          is a different thing in a different store, and clearing site data in your browser is what
          removes it. It also leaves the service worker registered, so your next visit will keep
          the two pages it precaches: the home page and the offline notice. No engine comes back
          without you asking again.
        </p>
      </section>

      <div className={RULE} />

      {/* ── What this does not promise ──────────────────────────────────── */}
      <section className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h2 className={H2}>What offline does not cover</h2>
          <span className={EYEBROW}>THE HONEST EDGES</span>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {[
            "A tool's own code arrives as a chunk of JavaScript that is cached the first time you open that tool's page. Store every engine here and a page you have never visited will still want the network once.",
            "Browsers evict storage as a whole, not in pieces, and they do it without telling the page. What is stored today may be gone tomorrow — which is why this page re-reads rather than remembering, and why a tool never claims an engine it has not checked for.",
            "This is per browser, per device, per profile. Storing FFmpeg here does nothing for your phone, and nothing for a private window.",
            `${TOOLS_WITHOUT_ENGINES} of the ${TOTAL_TOOLS} tools reach no engine at all — they run on Canvas, Web Audio, WebCodecs and ordinary JavaScript. There is nothing to store for them and nothing missing when you are offline.`,
            "A page served from the cache is the page as it was when you last loaded it. Pages are always fetched from the network first and only fall back to a stored copy when the network genuinely fails, so a stale one can only appear when you are actually offline.",
          ].map((line) => (
            <li key={line.slice(0, 32)} className={cn(BODY, "flex gap-2.5")}>
              <span aria-hidden="true" className="flex-none pt-[7px] text-text-muted">
                <span className="block size-[3px] rounded-full bg-current" />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="flex flex-col gap-[7px] bg-bg-primary px-[18px] py-4">
      <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted">
        {label}
      </span>
      <span className="font-display text-[19px] leading-none font-medium text-text-primary">
        {value}
      </span>
      <span className="font-mono text-[10px] leading-[1.5] text-text-muted">{meta}</span>
    </div>
  );
}

function Note({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-[11px] border p-[18px] font-body text-[12.5px] leading-[1.65]",
        tone === "warn"
          ? "border-[rgba(224,163,106,.32)] bg-[rgba(224,163,106,.06)] text-neutral-300"
          : "border-border bg-bg-secondary text-neutral-400",
      )}
    >
      {children}
    </div>
  );
}

function EngineRow({
  bundle,
  stored,
  state,
  disabled,
  onKeep,
  onDrop,
  onCancel,
}: {
  bundle: EngineBundle;
  /** `null` until the Cache API has actually been read. */
  stored: boolean | null;
  state: RowState;
  disabled: boolean;
  onKeep: () => void;
  onDrop: () => void;
  onCancel: () => void;
}) {
  const working = state.kind === "working";
  return (
    <li className="flex flex-col gap-3 bg-bg-primary px-[18px] py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="font-display text-[13.5px] leading-[1.3] font-medium text-neutral-200">
              {bundle.label}
            </span>
            <span className={MONO_META}>
              {formatEngineBytes(bundle.bytes)} · {exact(bundle.bytes)} BYTES ·{" "}
              {bundle.toolCount === 1 ? "1 TOOL" : `${bundle.toolCount} TOOLS`}
            </span>
          </div>
          <p className="m-0 font-body text-[11.5px] leading-[1.55] text-text-muted">
            {bundle.handles}
          </p>
          <p className="m-0 font-mono text-[10px] leading-[1.5] break-all text-neutral-700">
            {bundle.urls.join("  ")}
          </p>
        </div>

        <div className="flex flex-none items-center gap-2.5">
          <span
            className={cn(
              "font-mono text-[9.5px] leading-none tracking-[0.1em]",
              stored ? "text-success" : "text-text-muted",
            )}
          >
            {stored === null ? "CHECKING" : stored ? "STORED" : "NOT STORED"}
          </span>
          {working ? (
            <button
              type="button"
              onClick={onCancel}
              className={`${BUTTON} border-border text-text-muted hover:text-text-primary`}
            >
              CANCEL
            </button>
          ) : stored ? (
            <button
              type="button"
              onClick={onDrop}
              disabled={disabled}
              className={`${BUTTON} border-border text-text-muted hover:text-text-primary`}
            >
              REMOVE
            </button>
          ) : (
            <button
              type="button"
              onClick={onKeep}
              disabled={disabled || stored === null}
              className={`${BUTTON} border-accent bg-accent/10 text-accent-200 hover:bg-accent/20`}
            >
              {/* The size is IN the button. Consent to an unnamed download is
                  not consent, and this is the last surface before the fetch. */}
              KEEP OFFLINE · {formatEngineBytes(bundle.bytes)}
            </button>
          )}
        </div>
      </div>

      {working && (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={`Storing ${bundle.label}`}
            aria-valuenow={Math.round(state.fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-[3px] flex-1 overflow-hidden rounded-full bg-bg-secondary"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.round(state.fraction * 100)}%` }}
            />
          </div>
          <span className={MONO_META}>{Math.round(state.fraction * 100)}%</span>
        </div>
      )}

      {state.kind === "error" && (
        <p className="m-0 font-mono text-[10.5px] leading-[1.5] text-warning">{state.message}</p>
      )}
    </li>
  );
}
