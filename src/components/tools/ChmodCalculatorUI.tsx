"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";

import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolPresets,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CodeBlock,
  StatStrip,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  CLASSES,
  PERMS,
  PRESETS,
  SPECIALS,
  describeMode,
  describeSpecials,
  hasBit,
  hasSpecial,
  modeFromUmask,
  octalCommand,
  parseOctal,
  parseSymbolic,
  riskNote,
  symbolicCommand,
  toOctal,
  toSymbolic,
  toggleBit,
  toggleSpecial,
  type ClassId,
  type PermId,
} from "@/lib/tools/chmod";

/** The one field box the redesign doc specifies. Copied from SubtitleConverterUI. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const CHECKBOX_CLASS = "size-4 cursor-pointer rounded-sm border-border accent-accent";

const CUSTOM = "custom";

/** Body text for every note in the rail — one class so the drawers stay uniform. */
const NOTE_CLASS = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/** Inline code inside a note. */
const NOTE_CODE = "font-mono text-[10.5px] text-neutral-300";

/**
 * A folded reference note in the rail.
 *
 * Same shape as `ToolAdvanced` in `ToolAside.tsx` — a summary row and a tinted,
 * full-bleed drawer — and used here for the same reason the doc uses it there:
 * this page's explanations are worth having, but the tool surface has a
 * measured height reserved for it before the component mounts (see
 * `src/data/tool-surface-heights.ts`), and five paragraphs of standing prose
 * spend that reservation on blank space the user scrolls past. Folded, each
 * paragraph costs one summary row up front and is one click — and zero network
 * requests — away. Every word stays in the DOM, so nothing is hidden from a
 * crawler either.
 */
function RailNote({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 py-1",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className="font-body text-[10.5px] leading-none text-accent">{summary}</span>
        <span
          aria-hidden="true"
          className="ml-auto font-mono text-[13px] leading-none text-text-muted opacity-60 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className="-mx-4 mt-2 flex animate-tm-drawer flex-col gap-2 border-y border-border bg-text-primary/3 px-4 py-3 motion-reduce:animate-none">
        {children}
      </div>
    </details>
  );
}

/**
 * Which field the user is mid-keystroke in.
 *
 * The same draft/canonical split `TimestampConverterUI` uses, and for the same
 * reason: `75` parses to mode 0o075 and writing the canonical `075` back into
 * the box while somebody is typing `755` moves the caret and eats the third
 * digit. The edited field shows exactly what was typed; the other two show the
 * canonical rendering of the mode.
 */
type Draft = { field: "octal" | "symbolic"; value: string } | null;

export function ChmodCalculatorUI() {
  const [mode, setMode] = useState(0o644);
  const [kind, setKind] = useState<"file" | "directory">("file");
  const [target, setTarget] = useState("file");
  const [preset, setPreset] = useState<string>("644");
  const [draft, setDraft] = useState<Draft>(null);
  const { copied, copy } = useCopied<string>();

  const octalShort = toOctal(mode);
  const octalFull = toOctal(mode, true);
  const symbolic = toSymbolic(mode);
  const commandTarget = target.trim() || (kind === "directory" ? "directory" : "file");
  const octalCmd = octalCommand(mode, commandTarget);
  const symbolicCmd = symbolicCommand(mode, commandTarget);

  /* Any hand edit drops the preset chip — a lit chip over a hand-built mode
     would claim the mode came from the preset. */
  const apply = useCallback((next: number, from: string = CUSTOM) => {
    setMode(next);
    setPreset(from);
  }, []);

  const handleOctal = useCallback(
    (value: string) => {
      setDraft({ field: "octal", value });
      const parsed = parseOctal(value);
      if (parsed !== null) apply(parsed);
    },
    [apply],
  );

  const handleSymbolic = useCallback(
    (value: string) => {
      setDraft({ field: "symbolic", value });
      const parsed = parseSymbolic(value);
      if (parsed !== null) apply(parsed);
    },
    [apply],
  );

  const handlePreset = useCallback((id: string) => {
    const found = PRESETS.find((p) => p.label === id);
    if (!found) return;
    setDraft(null);
    setMode(found.mode);
    setPreset(id);
  }, []);

  const handleReset = useCallback(() => {
    setDraft(null);
    setMode(0o644);
    setPreset("644");
    setTarget("file");
  }, []);

  const octalValue = draft?.field === "octal" ? draft.value : octalShort;
  const symbolicValue = draft?.field === "symbolic" ? draft.value : symbolic;
  const octalBad = draft?.field === "octal" && parseOctal(draft.value) === null;
  const symbolicBad = draft?.field === "symbolic" && parseSymbolic(draft.value) === null;

  const sentences = useMemo(() => describeMode(mode, kind), [mode, kind]);
  const specialNotes = useMemo(() => describeSpecials(mode, kind), [mode, kind]);
  const risk = useMemo(() => riskNote(mode), [mode]);
  const umask = useMemo(() => umaskFor(mode, kind), [mode, kind]);

  const presetChips = useMemo(
    () => PRESETS.map((p) => ({ id: p.label, label: p.label, note: p.note })),
    [],
  );

  return (
    <>
      {/* ── Canvas: the grid, the two fields, and the commands ───────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={1}>
          <TextPane
            label={kind === "directory" ? "Directory permissions" : "File permissions"}
            action={
              <span className="font-mono text-[11px] text-accent-300">{octalShort}</span>
            }
          >
            <div className="flex flex-col">
              {/* Two typed views of the same twelve bits. */}
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-3.5 py-3">
                <label
                  htmlFor="chmod-octal"
                  className="w-20 shrink-0 font-body text-[11.5px] leading-none text-text-muted"
                >
                  Octal
                </label>
                <input
                  id="chmod-octal"
                  type="text"
                  inputMode="numeric"
                  value={octalValue}
                  onChange={(e) => handleOctal(e.target.value)}
                  onBlur={() => setDraft(null)}
                  aria-invalid={octalBad || undefined}
                  className={cn(FIELD_CLASS, "w-28", octalBad && "border-error")}
                />
                <label
                  htmlFor="chmod-symbolic"
                  className="shrink-0 font-body text-[11.5px] leading-none text-text-muted"
                >
                  Symbolic
                </label>
                <input
                  id="chmod-symbolic"
                  type="text"
                  spellCheck={false}
                  value={symbolicValue}
                  onChange={(e) => handleSymbolic(e.target.value)}
                  onBlur={() => setDraft(null)}
                  aria-invalid={symbolicBad || undefined}
                  className={cn(FIELD_CLASS, "w-36", symbolicBad && "border-error")}
                />
              </div>

              {/* The 3×3 grid. Header row, then one row per class. */}
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.75rem)] items-center gap-y-1 px-3.5 py-3">
                <span className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-text-muted">
                  WHO
                </span>
                {PERMS.map((perm) => (
                  <span
                    key={perm.id}
                    className="text-center font-mono text-[9.5px] leading-none tracking-[0.12em] text-text-muted"
                  >
                    {perm.label.toUpperCase()}
                  </span>
                ))}

                {CLASSES.map((cls) => (
                  <Row
                    key={cls.id}
                    label={cls.label}
                    letter={cls.letter}
                    mode={mode}
                    clsId={cls.id}
                    onToggle={(perm) => apply(toggleBit(mode, cls.id, perm))}
                  />
                ))}
              </div>

              {/* Special bits, kept apart because they are not part of the grid. */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-3.5 py-3">
                <span className="font-mono text-[9.5px] leading-none tracking-[0.12em] text-text-muted">
                  SPECIAL
                </span>
                {SPECIALS.map((special) => (
                  <label
                    key={special.id}
                    className="flex cursor-pointer items-center gap-2 font-body text-[12.5px] leading-none text-neutral-300"
                  >
                    <input
                      type="checkbox"
                      checked={hasSpecial(mode, special.id)}
                      onChange={() => apply(toggleSpecial(mode, special.id))}
                      className={CHECKBOX_CLASS}
                    />
                    {special.label}
                  </label>
                ))}
              </div>

              {/* Derived from the mode above it, and re-worded for the target
                  kind — the execute column means two different things. */}
              <div className="flex flex-col gap-1.5 border-t border-border px-3.5 py-3">
                {sentences.map((sentence) => (
                  <span
                    key={sentence}
                    className="font-body text-[11.5px] leading-[1.55] text-neutral-300"
                  >
                    {sentence}
                  </span>
                ))}
              </div>
            </div>
          </TextPane>
        </TextPanes>

        <StatStrip
          stats={[
            { label: "OCTAL", value: octalShort },
            { label: "SYMBOLIC", value: symbolic, tone: "neutral" },
            {
              label: "SPECIAL BITS",
              value:
                SPECIALS.filter((s) => hasSpecial(mode, s.id))
                  .map((s) => s.label)
                  .join(" + ") || "none",
              tone: "neutral",
            },
          ]}
        />

        {risk && <WarningMessage message={risk} />}
        {specialNotes.map((note) => (
          <WarningMessage key={note} message={note} />
        ))}

        <CodeBlock
          label="Absolute form"
          action={
            <button
              onClick={() => void copy(octalCmd, "octal")}
              aria-label={copied === "octal" ? "Copied the octal command" : "Copy the octal command"}
              className="cursor-pointer font-body text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
            >
              {copied === "octal" ? "Copied!" : "Copy"}
            </button>
          }
        >
          {octalCmd}
        </CodeBlock>

        <CodeBlock
          label="Symbolic form"
          action={
            <button
              onClick={() => void copy(symbolicCmd, "symbolic")}
              aria-label={
                copied === "symbolic" ? "Copied the symbolic command" : "Copy the symbolic command"
              }
              className="cursor-pointer font-body text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
            >
              {copied === "symbolic" ? "Copied!" : "Copy"}
            </button>
          }
        >
          {symbolicCmd}
        </CodeBlock>

        <CanvasFootnote>
          TICK A BOX, TYPE AN OCTAL, OR TYPE A SYMBOLIC STRING — ALL THREE STAY IN STEP
        </CanvasFootnote>
      </div>

      {/* ── Controls ───────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={copied === "octal" ? "Copied to clipboard" : "Copy chmod command"}
            onPrimary={() => void copy(octalCmd, "octal")}
            onReset={handleReset}
            resetLabel="RESET TO 644"
          />
        }
      >
        <ToolAsideSection label="APPLIES TO">
          <ToolChoice
            label="What the mode is for"
            value={kind}
            onChange={(next) => {
              setKind(next);
              setTarget((current) =>
                current === "file" || current === "directory"
                  ? next === "directory"
                    ? "directory"
                    : "file"
                  : current,
              );
            }}
            options={[
              { value: "file" as const, label: "A file" },
              { value: "directory" as const, label: "A directory" },
            ]}
          />
          <RailNote summary="What execute means on each">
            <span className={NOTE_CLASS}>
              This changes the wording, not the arithmetic. The execute bit is one bit either way
              — on a file it means &ldquo;run this&rdquo;, on a directory it means &ldquo;enter
              this&rdquo;, and confusing the two is why a directory with 644 looks readable and
              refuses to open anything inside it.
            </span>
          </RailNote>
        </ToolAsideSection>

        <ToolAsideSection label="PATH IN THE COMMAND">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="file"
            aria-label="Path in the command"
            spellCheck={false}
            className={cn(FIELD_CLASS, "w-full")}
          />
          <RailNote summary="What this page does with it">
            <span className={NOTE_CLASS}>
              Only ever pasted into the two commands above. Nothing on this page reads a path,
              opens a file, or runs anything — it is a calculator, and the shell is still yours.
            </span>
          </RailNote>
        </ToolAsideSection>

        <ToolPresets presets={presetChips} active={preset} onSelect={handlePreset} />

        <ToolAsideSection label="OUTPUT">
          {/* Only what the canvas does not already print. The octal and the
              symbolic string are live in the two fields, in the pane header and
              in the stat strip above — a fourth and fifth copy of them down here
              bought nothing and cost two rows of reserved height. */}
          <ToolOutput
            rows={[
              ["Four-digit", octalFull],
              ["From umask", umask ?? "—"],
            ]}
          />
          <RailNote summary="What the umask row means">
            <span className={NOTE_CLASS}>
              {umask
                ? `Setting umask ${umask} makes every new ${kind === "directory" ? "directory" : "file"} come out at ${octalShort} without a chmod.`
                : "No umask produces this mode. A umask only ever clears bits, starting from 666 for a new file and 777 for a new directory, so it can neither add a file's execute bit nor set any of the three special bits."}
            </span>
          </RailNote>
        </ToolAsideSection>

        <ToolAsideSection label="READING THE SYMBOLIC STRING">
          <RailNote summary="Why a capital S or T appears">
            <span className={NOTE_CLASS}>
              A capital <code className={NOTE_CODE}>S</code> or{" "}
              <code className={NOTE_CODE}>T</code> in the symbolic string is not a different
              spelling — it means the special bit is set and the matching execute bit is not, so
              the bit is stored and inert. <code className={NOTE_CODE}>4755</code> reads{" "}
              <code className={NOTE_CODE}>rwsr-xr-x</code>;{" "}
              <code className={NOTE_CODE}>4644</code> reads{" "}
              <code className={NOTE_CODE}>rwSr--r--</code>. Typing either one into the symbolic box
              above ticks exactly the boxes it implies.
            </span>
          </RailNote>
          <RailNote summary="Why setuid splits the clauses">
            <span className={NOTE_CLASS}>
              With no special bit set, the symbolic command merges classes that match —{" "}
              <code className={NOTE_CODE}>u=rwx,go=rx</code>. With one set it writes all three out
              separately, because an <code className={NOTE_CODE}>s</code> attached to a merged{" "}
              <code className={NOTE_CODE}>ug=</code> would set setuid and setgid together. Sticky
              is emitted as a trailing <code className={NOTE_CODE}>+t</code> with no who-list,
              because POSIX gives <code className={NOTE_CODE}>t</code> effect only for{" "}
              <code className={NOTE_CODE}>a</code> or an omitted who-list, and BSD chmod silently
              ignores <code className={NOTE_CODE}>o+t</code>.
            </span>
          </RailNote>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

/** One class row of the 3×3 grid. */
function Row({
  label,
  letter,
  mode,
  clsId,
  onToggle,
}: {
  label: string;
  letter: string;
  mode: number;
  clsId: ClassId;
  onToggle: (perm: PermId) => void;
}) {
  return (
    <>
      <span className="font-body text-[12.5px] leading-none text-neutral-300">
        {label}{" "}
        <code className="font-mono text-[10.5px] text-text-muted">({letter})</code>
      </span>
      {PERMS.map((perm) => (
        <span key={perm.id} className="flex justify-center py-1.5">
          <input
            type="checkbox"
            checked={hasBit(mode, clsId, perm.id)}
            onChange={() => onToggle(perm.id)}
            aria-label={`${label} ${perm.label.toLowerCase()}`}
            className={CHECKBOX_CLASS}
          />
        </span>
      ))}
    </>
  );
}

/**
 * The umask that would produce this mode, or `null` when none can.
 *
 * A umask is subtractive from 666 (files) or 777 (directories), so any mode
 * with a bit the base does not have — a file's execute bit, or any special bit
 * — is unreachable, and this returns null rather than printing a mask that
 * would produce something else.
 */
function umaskFor(mode: number, kind: "file" | "directory"): string | null {
  const base = kind === "file" ? 0o666 : 0o777;
  const perms = mode & 0o777;
  if ((mode & 0o7000) !== 0) return null;
  if ((perms & ~base) !== 0) return null;
  const mask = base & ~perms & 0o777;
  return modeFromUmask(mask, kind) === perms ? mask.toString(8).padStart(3, "0") : null;
}
