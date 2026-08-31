"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import {
  ToolActions,
  ToolAside,
  ToolChoice,
  ToolSlider,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, GenList } from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";

interface Options {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

const CLASSES = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()_+-=[]{}|;:,.<>?",
} as const;

/**
 * Uniform random index without modulo bias: `n % len` over a 2³² draw
 * favours the low characters whenever 2³² isn't a multiple of `len` —
 * measurable skew in what is literally a security tool. Rejection sampling
 * redraws the few values above the largest exact multiple instead.
 */
function uniformIndex(len: number): number {
  const limit = Math.floor(0x100000000 / len) * len;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % len;
}

export function generatePassword(opts: Options): string {
  const pools = (Object.keys(CLASSES) as (keyof typeof CLASSES)[]).filter(
    (k) => opts[k],
  );
  if (pools.length === 0) throw new Error("Select at least one character type");
  const all = pools.map((k) => CLASSES[k]).join("");

  // Every selected class appears at least once — a 12-char "with symbols"
  // password that happens to contain none is a claim the checkbox didn't
  // keep. One guaranteed pick per class (as far as length allows), the rest
  // drawn from the combined pool, then shuffled so the guaranteed picks
  // don't sit at the front.
  const out: string[] = [];
  for (const k of pools.slice(0, opts.length)) {
    out.push(CLASSES[k][uniformIndex(CLASSES[k].length)]);
  }
  while (out.length < opts.length) {
    out.push(all[uniformIndex(all.length)]);
  }
  // Fisher–Yates with the same unbiased draws.
  for (let i = out.length - 1; i > 0; i--) {
    const j = uniformIndex(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

function calcStrength(pw: string): { label: string; color: string; pct: number } {
  const len = pw.length;
  let poolSize = 0;
  if (/[a-z]/.test(pw)) poolSize += 26;
  if (/[A-Z]/.test(pw)) poolSize += 26;
  if (/[0-9]/.test(pw)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) poolSize += 30;
  const entropy = len * Math.log2(poolSize || 1);

  if (entropy < 40) return { label: "Weak", color: "bg-error", pct: 25 };
  if (entropy < 60) return { label: "Fair", color: "bg-warning", pct: 50 };
  if (entropy < 80) return { label: "Strong", color: "bg-accent", pct: 75 };
  return { label: "Very Strong", color: "bg-success", pct: 100 };
}

export function PasswordGeneratorUI() {
  const [options, setOptions] = useState<Options>({
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
  });
  const [count, setCount] = useState(1);
  const [passwords, setPasswords] = useState<string[]>([]);
  const { copied, copy } = useCopied<number>();
  const [error, setError] = useState("");

  const handleGenerate = useCallback(() => {
    setError("");
    try {
      setPasswords(Array.from({ length: count }, () => generatePassword(options)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [options, count]);

  const handleCopy = useCallback(
    (i: number) => {
      void copy(passwords[i], i);
    },
    [copy, passwords],
  );

  const strength = passwords.length > 0 ? calcStrength(passwords[0]) : null;

  return (
    <>
      {/* ── Canvas: the doc's numbered value list ──────────── */}
      <div className={CANVAS_COLUMN}>
        {error && <ErrorMessage message={error} />}

        {strength && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-text-muted">
              <span>Strength</span>
              <span>{strength.label}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
              <div
                className={`h-full rounded-full transition-all ${strength.color}`}
                style={{ width: `${strength.pct}%` }}
              />
            </div>
          </div>
        )}

        {passwords.length > 0 ? (
          <>
            <GenList
              rows={passwords.map((pw) => ({ value: pw }))}
              copiedIndex={copied}
              onCopy={(_, i) => handleCopy(i)}
            />
            <CanvasFootnote>
              GENERATED LOCALLY · CRYPTO.GETRANDOMVALUES · NOTHING LOGGED
            </CanvasFootnote>
          </>
        ) : (
          <p className="py-10 text-center font-body text-[12.5px] leading-[1.5] text-text-muted">
            Set the length and character types, then generate.
          </p>
        )}
      </div>

      <ToolAside
        footer={<ToolActions primaryLabel="Generate" onPrimary={handleGenerate} />}
      >
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolSlider
            label="Length"
            display={String(options.length)}
            hint="16 characters or more is the usual advice."
            min={8}
            max={128}
            value={options.length}
            onChange={(length) => {
              setOptions((o) => ({ ...o, length }));
              setPasswords([]); // stale results would misstate the options
            }}
          />

          <ToolControl label="INCLUDE">
            <div className="flex flex-col gap-2">
              {(["uppercase", "lowercase", "numbers", "symbols"] as const).map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300"
                >
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(e) => {
                      setOptions((o) => ({ ...o, [key]: e.target.checked }));
                      setPasswords([]);
                    }}
                    className="size-4 rounded-sm border-border accent-accent"
                  />
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </label>
              ))}
            </div>
          </ToolControl>

          <ToolControl label="HOW MANY">
            <ToolChoice
              label="Number of passwords"
              fill
              value={count}
              onChange={(n) => {
                setCount(n);
                setPasswords([]);
              }}
              options={[1, 5, 10, 20].map((n) => ({ value: n, label: String(n) }))}
            />
          </ToolControl>
        </ToolControlGroup>
      </ToolAside>
    </>
  );
}
