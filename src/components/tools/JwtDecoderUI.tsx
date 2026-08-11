"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { cn } from "@/lib/utils/cn";

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
  const [copied, setCopied] = useState(false);

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
    copyText(JSON.stringify(data, null, 2)).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  };

  // The rail's readout pulls the two claims people actually scan for.
  const alg = typeof result?.header.alg === "string" ? result.header.alg : "—";
  const typ = typeof result?.header.typ === "string" ? result.header.typ : "—";
  const expiryLabel = !result
    ? "—"
    : result.expiresAt === null
      ? "none"
      : result.isExpired
        ? "expired"
        : "valid";

  return (
    <>
      {/* ── Canvas: the token, then its decoded halves ─────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={1}>
          <TextPane label="JWT Token" lines={lineCount(input)}>
            <textarea
              value={input}
              onChange={(e) => handleDecode(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
              aria-label="JWT token"
              className={TEXT_PANE_BODY}
            />
          </TextPane>
        </TextPanes>

        {error && (
          <ErrorMessage message={error} />
        )}

        {result && (
          <>
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

            <TextPanes>
              <TextPane
                label="Header"
                lines={lineCount(JSON.stringify(result.header, null, 2))}
                action={
                  <button
                    onClick={() => copySection(result.header)}
                    className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                  >
                    Copy
                  </button>
                }
              >
                <pre className={TEXT_PANE_BODY}>{JSON.stringify(result.header, null, 2)}</pre>
              </TextPane>

              <TextPane
                tone="out"
                label="Payload"
                lines={lineCount(JSON.stringify(result.payload, null, 2))}
                action={
                  <button
                    onClick={() => copySection(result.payload)}
                    className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                  >
                    Copy
                  </button>
                }
              >
                <pre className={TEXT_PANE_BODY}>{JSON.stringify(result.payload, null, 2)}</pre>
              </TextPane>
            </TextPanes>

            <TextPanes columns={1}>
              <TextPane label="Signature">
                <code className={cn(TEXT_PANE_BODY, "block break-all text-text-muted")}>
                  {result.signature}
                </code>
              </TextPane>
            </TextPanes>
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          result ? (
            <ToolActions
              primaryLabel={copied ? "Copied to clipboard" : "Copy payload"}
              onPrimary={() => copySection(result.payload)}
            />
          ) : undefined
        }
      >
        <ToolAsideSection label="CLAIMS">
          <ToolOutput
            rows={[
              ["Algorithm", alg],
              ["Type", typ],
              ["Claims", result ? String(Object.keys(result.payload).length) : "—"],
              ["Expiry", expiryLabel],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Decoding only — the signature is never verified, so never trust an unverified token.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
