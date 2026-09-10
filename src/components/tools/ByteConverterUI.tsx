"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";

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
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { CANVAS_COLUMN, MONO_LABEL } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  LINK_SPEEDS,
  ONE_TB_IN_GIB,
  UNITS,
  convertAll,
  exactBits,
  exactBytes,
  formatDuration,
  groupDigits,
  parseAmount,
  rat,
  toBits,
  transferSeconds,
  unitById,
  type Rat,
  type Unit,
} from "@/lib/tools/bytes";

/** The one field box the redesign doc specifies. Copied from SubtitleConverterUI. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const FAMILY_HEADINGS: { family: Unit["family"]; label: string }[] = [
  { family: "bits", label: "BITS — WHAT A LINK SPEED IS QUOTED IN" },
  { family: "decimal", label: "BYTES, DECIMAL — POWERS OF 1000 (SI)" },
  { family: "binary", label: "BYTES, BINARY — POWERS OF 1024 (IEC)" },
];

const DEFAULT_UNIT = "MB";
const DEFAULT_AMOUNT = "1";

/**
 * The page's reference notes, collapsed into one drawer.
 *
 * Every paragraph in here is load-bearing and none of it is cut or softened:
 * the factor of eight between a link speed in bits and a file size in bytes,
 * what the ROUNDED badge on a canvas row means, why the byte count is counted
 * in BigInt rather than a double, where the "missing" 7% of a 1 TB drive went,
 * and which operating systems quote which family. What it is NOT is a control
 * — it is prose about arithmetic the page has already done — and it was
 * rendering roughly 500px of itself above the fold.
 *
 * That is not free: tool UIs mount with `ssr: false`, so `ToolPageLayout`
 * reserves each page's MEASURED initial height up front to stop the layout
 * shifting (see `src/data/tool-surface-heights.ts`). Tall opening copy is
 * therefore literal blank space the reader scrolls past before the tool
 * exists. Collapsed, the same words cost one summary row, stay in the DOM for
 * search engines, and are one click away.
 *
 * Same shape as `ToolAdvanced` in `ToolAside.tsx`: a `<details>` whose summary
 * is a section row and whose drawer is the full-bleed tinted band (which is
 * what the negative inline margin buys, the sections carrying their own px-4).
 */
function ReferenceNotes({
  notes,
}: {
  notes: readonly { label: string; body: ReactNode }[];
}) {
  return (
    <details className="group border-b border-border px-4 last:border-b-0">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 py-3",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={cn(MONO_LABEL, "text-text-muted")}>HOW THESE NUMBERS WORK</span>
        <span className="font-mono text-[10px] leading-none text-text-muted opacity-60">
          {notes.length} NOTES
        </span>
        <span
          aria-hidden="true"
          className="ml-auto font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className="-mx-4 flex animate-tm-drawer flex-col gap-3.5 border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none">
        {notes.map((note) => (
          <div key={note.label} className="flex flex-col gap-1.5">
            <span className={cn(MONO_LABEL, "text-text-muted")}>{note.label}</span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {note.body}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function ByteConverterUI() {
  /*
    One canonical value — an amount and the unit it was typed in — plus a
    draft, so the row being typed into shows exactly the keystrokes while the
    other fifteen show the canonical conversion. Without the draft, typing
    `1.` into a row rewrites it to `1` and the decimal point is gone before
    the next keystroke lands. Same split TimestampConverterUI uses.
  */
  const [amountText, setAmountText] = useState(DEFAULT_AMOUNT);
  const [unitId, setUnitId] = useState(DEFAULT_UNIT);
  const [draft, setDraft] = useState<{ unitId: string; value: string } | null>(null);
  const [speedId, setSpeedId] = useState(LINK_SPEEDS[3].id);
  const [precision, setPrecision] = useState(6);
  const { copied, copy } = useCopied<string>();

  const unit = unitById(unitId) ?? UNITS[0];
  const parsed = useMemo(() => parseAmount(amountText), [amountText]);

  const bits: Rat | null = useMemo(
    () => (parsed ? toBits(parsed, unit) : null),
    [parsed, unit],
  );

  const rows = useMemo(
    () => (bits ? convertAll(bits, precision) : null),
    [bits, precision],
  );

  const bytes = bits ? exactBytes(bits) : null;
  const wholeBits = bits ? exactBits(bits) : null;

  const speed = LINK_SPEEDS.find((s) => s.id === speedId) ?? LINK_SPEEDS[0];
  const seconds = bits ? transferSeconds(bits, speed.bps) : null;

  const handleRowChange = useCallback((id: string, value: string) => {
    setDraft({ unitId: id, value });
    if (parseAmount(value) !== null) {
      setAmountText(value);
      setUnitId(id);
    }
  }, []);

  const handleReset = useCallback(() => {
    setDraft(null);
    setAmountText(DEFAULT_AMOUNT);
    setUnitId(DEFAULT_UNIT);
    setPrecision(6);
  }, []);

  const exactLine = bytes !== null ? `${groupDigits(bytes)} bytes` : null;

  const handleCopyExact = useCallback(() => {
    if (bytes !== null) void copy(bytes.toString(), "exact");
  }, [bytes, copy]);

  /*
    Two different states, because a row being retyped is not a row with a
    mistake in it. Backspacing a field to empty is the normal way to replace a
    number, so it raises no error — but while the field disagrees with the
    other fifteen rows, NOTHING may hand back the old answer: the primary
    is held shut and the footnote says which value the rows are still showing.
    Otherwise "Copy the exact byte count" copies a number that is on no field
    on screen.
  */
  const draftInvalid = draft !== null && parseAmount(draft.value) === null;
  const brokenDraft =
    draft !== null && draft.value.trim() !== "" && parseAmount(draft.value) === null
      ? draft.value
      : null;

  /*
    Word for word the copy that used to open five separate rail sections; only
    the container changed. Each label keeps its old section heading as a prefix
    so the note is still findable by the name it had.
  */
  const referenceNotes: readonly { label: string; body: ReactNode }[] = [
    {
      label: "TRANSFER TIME — BITS VS BYTES",
      body: (
        <>
          Link speeds are quoted in BITS per second and file sizes in BYTES, so the division has a
          factor of eight in it that is the single commonest mistake here: 100 MB over a
          100 Mbit/s line is{" "}
          {formatDuration(
            transferSeconds(
              toBits(rat(BigInt(100), BigInt(1)), unitById("MB")!),
              BigInt(100_000_000),
            ),
          )}
          , not one. This is the arithmetic only — it ignores TCP overhead, protocol handshakes and
          the fact that almost nothing sustains its rated speed, so treat it as a floor.
        </>
      ),
    },
    {
      label: "DIGITS SHOWN — WHAT ROUNDED MEANS",
      body: (
        <>
          Display only. A row whose value has more digits than are shown is marked{" "}
          <span className="font-mono text-[10px] text-warning">ROUNDED</span> — every conversion is
          computed exactly in whole-number arithmetic first, and the rounding happens on the way to
          the screen.
        </>
      ),
    },
    {
      label: "OUTPUT — WHY BIGINT",
      body: (
        <>
          A JavaScript number holds every integer up to 9,007,199,254,740,991 and silently rounds
          above it — which is 9.007 PB, well inside the range this page is asked about. Everything
          here is computed in BigInt, so the byte count above is the value and not the nearest
          double to it.
        </>
      ),
    },
    {
      label: "WHY YOUR 1 TB DRIVE IS SMALLER",
      body: (
        <>
          It is not. A drive sold as 1 TB holds 10¹² bytes, exactly as the box says. Your operating
          system then divides by 2³⁰ and prints the result — {ONE_TB_IN_GIB.shown.text} — which is{" "}
          {ONE_TB_IN_GIB.percent?.text}% below the 1000 you expected. Nothing is missing; two
          different units are wearing similar names. Both numbers on this page are computed from
          the unit table above, not typed in.
        </>
      ),
    },
    {
      label: "WHICH UNIT DOES WHAT",
      body: (
        <>
          Drive and network vendors use the decimal units, and so does macOS since 10.6. Linux
          tools, Windows Explorer and most memory sizes are binary — Windows compounds it by
          printing the binary value under the decimal name. RAM is genuinely binary, because
          address lines come in powers of two. A byte is 8 bits in every one of them.
        </>
      ),
    },
  ];

  return (
    <>
      {/* ── Canvas: every unit at once ────────────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={1}>
          <TextPane
            label="The same size in every unit"
            action={
              <span className="font-mono text-[11px] text-accent-300">
                {exactLine ?? "not a whole byte"}
              </span>
            }
          >
            <div className="flex flex-col">
              {FAMILY_HEADINGS.map((group) => (
                <div key={group.family} className="flex flex-col">
                  <div className="border-y border-border bg-text-primary/3 px-3.5 py-2 first:border-t-0">
                    <span className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-text-muted">
                      {group.label}
                    </span>
                  </div>
                  {UNITS.filter((u) => u.family === group.family).map((u) => {
                    const row = rows?.find((r) => r.unit.id === u.id);
                    const isDraft = draft?.unitId === u.id;
                    const value = isDraft
                      ? draft.value
                      : u.id === unitId
                        ? amountText
                        : (row?.formatted.text ?? "");
                    return (
                      <div
                        key={u.id}
                        className={cn(
                          "flex items-center gap-3 border-b border-border px-3.5 py-2.5",
                          u.id === unitId && !isDraft && "bg-accent/5",
                        )}
                      >
                        <label
                          htmlFor={`byte-${u.id}`}
                          className="w-14 shrink-0 font-mono text-[11.5px] leading-none text-text-muted"
                        >
                          {u.label}
                        </label>
                        <input
                          id={`byte-${u.id}`}
                          type="text"
                          inputMode="decimal"
                          spellCheck={false}
                          value={value}
                          onChange={(e) => handleRowChange(u.id, e.target.value)}
                          onBlur={() => setDraft(null)}
                          aria-label={u.name}
                          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] leading-none text-neutral-200 placeholder:text-text-muted focus:outline-none"
                        />
                        {row && !row.formatted.exact && u.id !== unitId && (
                          <span
                            title="Rounded for display — the value has more digits than are shown"
                            className="flex-none font-mono text-[10px] leading-none text-warning"
                          >
                            ROUNDED
                          </span>
                        )}
                        <button
                          onClick={() => void copy(value, u.id)}
                          aria-label={
                            copied === u.id ? `Copied the ${u.name} value` : `Copy the ${u.name} value`
                          }
                          className="flex-none cursor-pointer font-body text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
                        >
                          {copied === u.id ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </TextPane>
        </TextPanes>

        {brokenDraft !== null && (
          <ErrorMessage
            message={`"${brokenDraft}" is not a number this can convert. Use digits with an optional decimal point (1.5), scientific notation (1e9), or grouped thousands (1,234,567) — a lone comma like "1,5" is refused rather than guessed at, because it means one and a half in some places and nothing anywhere else.`}
          />
        )}

        <StatStrip
          stats={[
            {
              label: "EXACT BYTES",
              value: bytes !== null ? groupDigits(bytes) : "not a whole byte",
            },
            {
              label: "EXACT BITS",
              value: wholeBits !== null ? groupDigits(wholeBits) : "fractional",
              tone: "neutral",
            },
            {
              label: `AT ${speed.label.toUpperCase()}`,
              value: seconds ? formatDuration(seconds) : "—",
              tone: "neutral",
            },
          ]}
        />

        <CanvasFootnote>
          {draftInvalid
            ? `THE ROWS ABOVE STILL SHOW THE LAST VALUE THAT PARSED — ${amountText} ${unit.label}`
            : bytes !== null
              ? "EXACT — COUNTED IN BIGINT, NOT ROUNDED THROUGH A DOUBLE"
              : "THIS VALUE IS NOT A WHOLE NUMBER OF BYTES, SO NO EXACT BYTE COUNT IS CLAIMED"}
        </CanvasFootnote>
      </div>

      {/* ── Controls ───────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={copied === "exact" ? "Copied to clipboard" : "Copy the exact byte count"}
            onPrimary={handleCopyExact}
            primaryDisabled={bytes === null || draftInvalid}
            onReset={handleReset}
            resetLabel="RESET"
          />
        }
      >
        <ToolAsideSection label="TRANSFER TIME">
          <select
            value={speedId}
            onChange={(e) => setSpeedId(e.target.value)}
            aria-label="Link speed"
            className={cn(FIELD_CLASS, "w-full")}
          >
            {LINK_SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </ToolAsideSection>

        <ToolAsideSection label="DIGITS SHOWN">
          <ToolChoice
            label="Significant digits"
            value={precision}
            onChange={setPrecision}
            options={[
              { value: 4, label: "4" },
              { value: 6, label: "6" },
              { value: 10, label: "10" },
              { value: 20, label: "20" },
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Read as", parsed ? `${amountText} ${unit.label}` : "—"],
              ["Exact bytes", bytes !== null ? groupDigits(bytes) : "not a whole byte"],
              [
                "Bytes fit a double",
                bytes === null
                  ? "—"
                  : bytes <= BigInt(Number.MAX_SAFE_INTEGER)
                    ? "Yes"
                    : "No — needs BigInt",
              ],
            ]}
          />
        </ToolAsideSection>

        <ReferenceNotes notes={referenceNotes} />
      </ToolAside>
    </>
  );
}
