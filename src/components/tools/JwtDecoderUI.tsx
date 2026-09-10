"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
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
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

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
  const { copied, copy } = useCopied();

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
    void copy(JSON.stringify(data, null, 2));
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
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={1}>
          <TextPane
            label="JWT Token"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
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
                /*
                  The doc's status card: `padding:10px 12px;border-radius:8px;
                  border:1px solid rgba(126,224,168,.3);
                  background:rgba(126,224,168,.07)`, text `font:400 12px/1.35`.
                  Was `rounded-lg`, which is 14px in this codebase, at 10% tint.
                */
                className={`rounded-md border px-3 py-2.5 font-body text-xs leading-[1.35] ${
                  result.isExpired
                    ? "border-error/30 bg-error/7 text-error"
                    : "border-success/30 bg-success/7 text-success"
                }`}
              >
                {result.isExpired ? "Token is expired" : "Token is valid"} — Expires: {result.expiresAt}
              </div>
            )}

            <TextPanes>
              <TextPane
                label="Header"
                lines={lineCount(JSON.stringify(result.header, null, 2))}
                size={formatFileSize(
                  new Blob([JSON.stringify(result.header, null, 2)]).size,
                )}
                action={
                  <button
                    onClick={() => copySection(result.header)}
                    className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                  >
                    Copy
                  </button>
                }
              >
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="Decoded header"
                  className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                >
                  {JSON.stringify(result.header, null, 2)}
                </pre>
              </TextPane>

              <TextPane
                tone="out"
                label="Payload"
                lines={lineCount(JSON.stringify(result.payload, null, 2))}
                size={formatFileSize(
                  new Blob([JSON.stringify(result.payload, null, 2)]).size,
                )}
                action={
                  <button
                    onClick={() => copySection(result.payload)}
                    className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                  >
                    Copy
                  </button>
                }
              >
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="Decoded payload"
                  className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                >
                  {JSON.stringify(result.payload, null, 2)}
                </pre>
              </TextPane>
            </TextPanes>

            <TextPanes columns={1}>
              <TextPane label="Signature">
                <code
                  tabIndex={0}
                  role="region"
                  aria-label="Signature"
                  className={cn(TEXT_PANE_BODY, "block break-all text-text-muted", PANE_FOCUS)}
                >
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
