"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";

interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  isExpired: boolean;
  expiresAt: string | null;
}

function decodeJwt(token: string): JwtParts {
  const parts = token.trim().split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT — must have 3 parts separated by dots");

  const base64UrlDecode = (s: string) => {
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    // Decode the bytes as UTF-8 so non-ASCII claim values (names, CJK, emoji)
    // aren't mangled by atob's Latin-1 interpretation.
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  const header = base64UrlDecode(parts[0]);
  const payload = base64UrlDecode(parts[1]);

  let isExpired = false;
  let expiresAt: string | null = null;
  if (typeof payload.exp === "number") {
    const expDate = new Date(payload.exp * 1000);
    expiresAt = expDate.toISOString();
    isExpired = expDate.getTime() < Date.now();
  }

  return { header, payload, signature: parts[2], isExpired, expiresAt };
}

export function JwtDecoderUI() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<JwtParts | null>(null);
  const [error, setError] = useState("");

  const handleDecode = useCallback((text: string) => {
    setInput(text);
    setError("");
    setResult(null);
    if (!text.trim()) return;
    try {
      setResult(decodeJwt(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JWT");
    }
  }, []);

  const copySection = (data: unknown) => {
    copyText(JSON.stringify(data, null, 2));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">JWT Token</label>
        <textarea
          value={input}
          onChange={(e) => handleDecode(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
          rows={4}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      {error && (
        <ErrorMessage message={error} />
      )}

      {result && (
        <div className="space-y-4">
          {/* Expiry warning */}
          {result.expiresAt && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                result.isExpired
                  ? "border-error/30 bg-error/10 text-error"
                  : "border-success/30 bg-success/10 text-success"
              }`}
            >
              {result.isExpired ? "Token is expired" : "Token is valid"} — Expires: {result.expiresAt}
            </div>
          )}

          {/* Header */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-text-secondary">Header</label>
              <button
                onClick={() => copySection(result.header)}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                Copy
              </button>
            </div>
            <pre className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(result.header, null, 2)}
            </pre>
          </div>

          {/* Payload */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-text-secondary">Payload</label>
              <button
                onClick={() => copySection(result.payload)}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                Copy
              </button>
            </div>
            <pre className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          </div>

          {/* Signature */}
          <div>
            <label className="text-sm font-medium text-text-secondary mb-1 block">Signature</label>
            <code className="block rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-muted font-mono break-all">
              {result.signature}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
