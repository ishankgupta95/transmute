"use client";

import { useCallback, useState } from "react";

interface Options {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

function generatePassword(opts: Options): string {
  let chars = "";
  if (opts.uppercase) chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (opts.lowercase) chars += "abcdefghijklmnopqrstuvwxyz";
  if (opts.numbers) chars += "0123456789";
  if (opts.symbols) chars += "!@#$%^&*()_+-=[]{}|;:,.<>?";
  if (!chars) throw new Error("Select at least one character type");

  const arr = new Uint32Array(opts.length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
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
  const [copied, setCopied] = useState<number | null>(null);
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
      navigator.clipboard.writeText(passwords[i]);
      setCopied(i);
      setTimeout(() => setCopied(null), 2000);
    },
    [passwords],
  );

  const strength = passwords.length > 0 ? calcStrength(passwords[0]) : null;

  return (
    <div className="space-y-4">
      {/* Options */}
      <div className="flex flex-wrap items-center justify-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Length:
          <input
            type="range"
            min={8}
            max={128}
            value={options.length}
            onChange={(e) => setOptions((o) => ({ ...o, length: Number(e.target.value) }))}
            className="w-24 accent-accent"
          />
          <span className="w-8 text-text-primary font-mono">{options.length}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {(["uppercase", "lowercase", "numbers", "symbols"] as const).map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
              className="rounded border-border accent-accent"
            />
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </label>
        ))}
        <select
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary"
        >
          {[1, 5, 10, 20].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleGenerate}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Generate
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {/* Strength meter */}
      {strength && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-text-muted">
            <span>Strength</span>
            <span>{strength.label}</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${strength.color}`}
              style={{ width: `${strength.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      {passwords.length > 0 && (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {passwords.map((pw, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border border-border bg-bg-elevated px-3 py-2"
            >
              <code className="text-sm text-text-primary font-mono break-all">{pw}</code>
              <button
                onClick={() => handleCopy(i)}
                className="text-xs text-accent hover:text-accent-hover transition-colors ml-2 shrink-0"
              >
                {copied === i ? "Copied!" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
