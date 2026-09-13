"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { ToolAside, ToolAsideSection, ToolOutput } from "@/components/tools/ToolAside";
import { CanvasFootnote, TEXT_PANE_BODY, TextPane, TextPanes } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  DEFAULT_COST,
  MAX_COST,
  MIN_COST,
  type BcryptHashResult,
  type VerifyOutcome,
} from "@/lib/tools/bcrypt";

/** Matches the other text panes; see the note in PdfToTextUI for `outline-solid`. */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

const FIELD =
  "w-full rounded-[7px] border border-border bg-transparent px-2.5 py-2 font-mono text-[12.5px] text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function BcryptGeneratorUI() {
  const [password, setPassword] = useState("");
  const [cost, setCost] = useState(DEFAULT_COST);
  const [result, setResult] = useState<BcryptHashResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [checkHash, setCheckHash] = useState("");
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const { copied, copy } = useCopied();

  const run = useCallback(async () => {
    setError(null);
    setResult(null);
    setWorking(true);
    try {
      const { hashPassword } = await import("@/lib/tools/bcrypt");
      setResult(await hashPassword(password, cost));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not hash that");
    } finally {
      setWorking(false);
    }
  }, [cost, password]);

  const check = useCallback(async () => {
    setOutcome(null);
    const { verifyPassword } = await import("@/lib/tools/bcrypt");
    setOutcome(await verifyPassword(password, checkHash));
  }, [checkHash, password]);

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1.5 font-body text-[12.5px] text-neutral-300">
            Password
            {/*
              `type="text"`, deliberately. A password field would hide the one
              thing the user is here to look at, and the value never leaves the
              tab — there is nothing to shoulder-surf that is not already on
              their own screen. Autocomplete is off so a browser never offers
              to remember a value typed into a hashing tool.
            */}
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="correct horse battery staple"
              className={FIELD}
            />
          </label>

          <button
            onClick={() => void run()}
            disabled={working || !password}
            className="self-start rounded-[7px] border border-border px-3 py-2 font-mono text-[10px] tracking-[0.08em] text-accent transition-colors hover:text-accent-hover disabled:opacity-40"
          >
            {working ? "HASHING…" : "GENERATE HASH"}
          </button>
        </div>

        {/*
          A high cost freezes the tab, and saying so beforehand is the honest
          thing — bcrypt is SUPPOSED to be slow, so a spinner implying progress
          would misrepresent what is happening. There is nothing to report
          between rounds.
        */}
        {working && cost >= 13 && (
          <WarningMessage message="bcrypt is deliberately slow, and at this work factor the page will be unresponsive for a second or more. That is the algorithm doing its job, not a hang." />
        )}

        <TextPanes columns={1}>
          <TextPane
            tone="out"
            label="Hash"
            lines={result ? 1 : 0}
            size={result ? `${result.hash.length} B` : "0 B"}
            action={
              result ? (
                <button
                  onClick={() => void copy(result.hash)}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              ) : undefined
            }
          >
            <pre
              tabIndex={0}
              role="region"
              aria-label="Hash"
              className={cn(TEXT_PANE_BODY, PANE_FOCUS, "break-all whitespace-pre-wrap")}
            >
              {result?.hash ?? ""}
            </pre>
          </TextPane>
        </TextPanes>

        {result && (
          <CanvasFootnote>
            {result.parts.version} VERSION · COST {result.parts.cost} · 22-CHAR SALT · TOOK{" "}
            {Math.round(result.elapsedMs)} MS HERE
          </CanvasFootnote>
        )}

        <CanvasFootnote>
          THE SALT IS RANDOM, SO THE SAME PASSWORD HASHES DIFFERENTLY EVERY TIME — THAT IS THE
          POINT, AND BOTH STILL VERIFY
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside>
        <ToolAsideSection label="WORK FACTOR">
          <label className="flex flex-col gap-1.5 font-body text-[12.5px] text-neutral-300">
            <span>Cost {cost}</span>
            <input
              type="range"
              min={MIN_COST}
              max={MAX_COST}
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
              className="accent-accent"
            />
          </label>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Each step DOUBLES the work — for you and for anyone attacking a stolen database. 10 is
            the common framework default, 12 the usual current advice. The ceiling here is{" "}
            {MAX_COST} because beyond it the tab freezes for long enough to look broken.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="CHECK A HASH">
          <input
            type="text"
            value={checkHash}
            onChange={(e) => setCheckHash(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="$2b$12$…"
            aria-label="Existing hash to check against"
            className={FIELD}
          />
          <button
            onClick={() => void check()}
            disabled={!password || !checkHash}
            className="cursor-pointer self-start text-[12px] text-accent hover:text-accent-hover disabled:opacity-40"
          >
            Check against the password above
          </button>
          {outcome && (
            <span
              role="status"
              className={cn(
                "font-mono text-[10.5px] tracking-[0.06em]",
                outcome === "match" ? "text-accent-300" : "text-text-muted",
              )}
            >
              {outcome === "match"
                ? "MATCH — this password produced that hash"
                : outcome === "no-match"
                  ? "NO MATCH — this password did not produce that hash"
                  : "THAT IS NOT A BCRYPT HASH — check what you pasted"}
            </span>
          )}
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Cost", result ? String(result.parts.cost) : "—"],
              ["Took", result ? `${Math.round(result.elapsedMs)} ms` : "—"],
              ["Length", result ? `${result.hash.length} chars` : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A 60-character bcrypt hash carrying its own version, work factor and salt — which is
            why verifying needs nothing but the hash. Nothing you type is sent anywhere, which for
            a page you paste a password into is the whole point.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
