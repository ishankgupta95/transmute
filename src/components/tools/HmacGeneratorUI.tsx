"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  CodeBlock,
  lineCount,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
  type StatCell,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  compareMac,
  decodeKeyBytes,
  hmacDigest,
  HMAC_HASHES,
  KEY_ENCODINGS,
  looksLikeHexKey,
  toBase64,
  toHex,
  utf8Bytes,
  type HmacHash,
  type KeyEncoding,
  type MacEncoding,
} from "@/lib/tools/hmac";

/** The one field box the redesign doc specifies — same as SubtitleConverterUI. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const RAIL_NOTE = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/** One completed digest, tagged with the inputs it was computed from. */
interface Run {
  hash: HmacHash;
  keyId: string;
  message: string;
  digest: Uint8Array | null;
  error: string | null;
}

const MAC_ENCODING_NAME: Record<MacEncoding, string> = {
  hex: "hex",
  base64: "base64",
  base64url: "URL-safe base64",
};

export function HmacGeneratorUI() {
  const [message, setMessage] = useState("");
  const [keyText, setKeyText] = useState("");
  const [keyEncoding, setKeyEncoding] = useState<KeyEncoding>("utf-8");
  const [hash, setHash] = useState<HmacHash>("SHA-256");
  const [expected, setExpected] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const { copied, copy } = useCopied<string>();

  const keyBytes = useMemo(() => {
    try {
      return { bytes: decodeKeyBytes(keyText, keyEncoding), error: null as string | null };
    } catch (err) {
      return {
        bytes: null,
        error: err instanceof Error ? err.message : "This key could not be read.",
      };
    }
  }, [keyText, keyEncoding]);

  /** The key as a stable identity, so a re-render with the same key is one run. */
  const keyId = keyBytes.bytes ? toHex(keyBytes.bytes) : null;

  /*
    `crypto.subtle` is async, so two keystrokes can leave two digests in flight
    and they need not resolve in order. Two guards, and both are needed:
    the cleanup flag drops a superseded run when it lands, and the stored run
    carries the inputs that produced it so a render can tell whether what is in
    state still describes what is in the boxes. Without the second one a MAC
    from the previous key stays on screen for one frame under the new one,
    which on this page is exactly the wrong thing to be wrong about.
  */
  useEffect(() => {
    const key = keyBytes.bytes;
    if (!key || key.length === 0 || !keyId) return;
    let stale = false;
    hmacDigest(hash, key, utf8Bytes(message))
      .then((mac) => {
        if (!stale) setRun({ hash, keyId, message, digest: mac, error: null });
      })
      .catch((err: unknown) => {
        if (!stale) {
          setRun({
            hash,
            keyId,
            message,
            digest: null,
            error: err instanceof Error ? err.message : "This MAC could not be computed.",
          });
        }
      });
    return () => {
      stale = true;
    };
  }, [hash, keyBytes.bytes, keyId, message]);

  const current =
    run && run.hash === hash && run.keyId === keyId && run.message === message ? run : null;
  const digest = current?.digest ?? null;
  const error = keyBytes.error ?? current?.error ?? null;

  const hexOut = digest ? toHex(digest) : "";
  const base64Out = digest ? toBase64(digest) : "";
  const match = digest && expected.trim() ? compareMac(expected, digest) : null;
  const checking = Boolean(digest && expected.trim());

  const hashSpec = HMAC_HASHES.find((h) => h.id === hash);
  const messageBytes = useMemo(() => utf8Bytes(message).length, [message]);

  /*
    The bug this tool exists to diagnose: an API hands you a hex secret, you
    paste it with the encoding left on Text, and every MAC comes out wrong with
    nothing anywhere to say why. Detected, never silently corrected — changing
    the user's key under them would be a worse failure than the one it fixes.
  */
  const hexKeyMisread = keyEncoding === "utf-8" && looksLikeHexKey(keyText);

  const handleCopy = useCallback(
    (value: string, key: string) => {
      void copy(value, key);
    },
    [copy],
  );

  const stats: StatCell[] = [
    { label: "ALGORITHM", value: `HMAC-${hash}` },
    {
      label: "KEY",
      value: `${keyBytes.bytes?.length ?? 0} ${keyBytes.bytes?.length === 1 ? "BYTE" : "BYTES"}`,
      tone: "neutral",
    },
    {
      label: "MESSAGE",
      value: `${messageBytes} ${messageBytes === 1 ? "BYTE" : "BYTES"}`,
      tone: "neutral",
    },
    { label: "DIGEST", value: `${hashSpec?.bits ?? 0} BITS`, tone: "neutral" },
  ];
  if (checking) {
    stats.push({ label: "MATCH", value: match ? "YES" : "NO", tone: match ? "ok" : "neutral" });
  }

  const copyButton = (value: string, key: string) => (
    <button
      onClick={() => handleCopy(value, key)}
      aria-label={copied === key ? `Copied ${key}` : `Copy ${key}`}
      className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
    >
      {copied === key ? "Copied!" : "Copy"}
    </button>
  );

  return (
    <>
      {/* ── Canvas: the message, then its MAC ─────────────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={1}>
          <TextPane
            label="Message"
            lines={lineCount(message)}
            size={`${messageBytes} BYTES`}
          >
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              spellCheck={false}
              placeholder="The exact bytes the MAC covers — a webhook body, a canonical request string, a query."
              aria-label="Message"
              className={TEXT_PANE_BODY}
            />
          </TextPane>
        </TextPanes>

        {error && <ErrorMessage message={error} />}

        {hexKeyMisread && (
          <WarningMessage
            message={`This key is ${keyText.trim().length} hex characters and the encoding is set to Text, so it is being used as ${keyBytes.bytes?.length ?? 0} bytes of those characters rather than the ${keyText.trim().length / 2} bytes they spell out. Both readings produce a valid-looking MAC and only one of them matches what your API computed. Switch the key encoding to Hex if the secret was given to you as hex. Nothing has been changed for you.`}
          />
        )}

        {digest && (
          <>
            <StatStrip stats={stats} />

            <CodeBlock label="Hex" action={copyButton(hexOut, "hex")}>
              {hexOut}
            </CodeBlock>

            <CodeBlock label="Base64" action={copyButton(base64Out, "base64")}>
              {base64Out}
            </CodeBlock>

            {checking && (
              <div
                role="status"
                className={cn(
                  "flex flex-col gap-[5px] rounded-md border px-[13px] py-[11px] font-body text-xs leading-[1.4]",
                  match
                    ? "border-success/30 bg-success/7 text-success"
                    : "border-error/30 bg-error/7 text-error",
                )}
              >
                <span className="font-medium">
                  {match
                    ? `Match — the pasted value is this HMAC-${hash}, written as ${MAC_ENCODING_NAME[match]}.`
                    : `No match — the pasted value is not this HMAC-${hash} in hex, base64 or URL-safe base64.`}
                </span>
                <span className="font-body text-[11.5px] leading-[1.5] text-text-muted">
                  {match
                    ? "Compared as strings, not in constant time. That is fine for finding out why a webhook is failing; a verifier inside a security boundary must compare bytes in constant time so that the time it takes to fail does not leak how much of the MAC was right."
                    : "Before blaming the key: the MAC covers the message bytes exactly, so a trailing newline, CRLF line endings, or a re-serialised JSON body with different spacing all give a different answer. Check the key encoding above too."}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────── */}
      <ToolAside
        footer={
          digest ? (
            <ToolActions
              primaryLabel={copied === "primary" ? "Copied to clipboard" : "Copy hex MAC"}
              onPrimary={() => handleCopy(hexOut, "primary")}
            />
          ) : undefined
        }
      >
        <ToolControlGroup>
          <ToolControl label="ALGORITHM">
            <ToolChoice
              label="Hash algorithm"
              value={hash}
              onChange={setHash}
              options={HMAC_HASHES.map((h) => ({ value: h.id, label: h.label }))}
            />
            <span className={RAIL_NOTE}>{hashSpec?.note}</span>
          </ToolControl>

          <ToolControl label="SECRET KEY">
            <input
              type="text"
              value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="Shared secret"
              aria-label="Secret key"
              className={cn(FIELD_CLASS, "w-full", keyBytes.error && "border-error")}
            />
            <ToolChoice
              label="Key encoding"
              value={keyEncoding}
              onChange={setKeyEncoding}
              options={KEY_ENCODINGS.map((e) => ({ value: e.id, label: e.label }))}
            />
            <span className={RAIL_NOTE}>
              How the characters above become bytes. Text is UTF-8. Hex and Base64 are what an
              API means when it hands you a 64-character secret — read as text that is 64
              bytes, read as hex it is 32, and the two give completely unrelated MACs with no
              error to tell you which one you got. The key stays in this tab; nothing is sent
              anywhere.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="VERIFY">
          <input
            type="text"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="sha256=… or a hex / base64 MAC"
            aria-label="Expected MAC"
            className={cn(FIELD_CLASS, "w-full")}
          />
          <span className={RAIL_NOTE}>
            Paste the MAC the other side sent — the whole{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">X-Hub-Signature-256</code>{" "}
            header value works, since a leading{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">sha256=</code> is
            stripped. Hex is matched case-insensitively; base64 is not, because case is
            significant there. The comparison is an ordinary string compare and is not
            constant-time: this is a page for diagnosing a failing signature, not a verifier
            to copy into a server.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Algorithm", `HMAC-${hash}`],
              ["Key", keyBytes.bytes ? `${keyBytes.bytes.length} bytes` : "unreadable"],
              ["Digest", `${hashSpec?.bits ?? 0} bits`],
              ["Verify", checking ? (match ? "match" : "no match") : "—"],
            ]}
          />
          <span className={RAIL_NOTE}>
            An HMAC proves that whoever produced it held the shared secret and that the
            message has not changed. It does not hide the message, it does not say who sent
            it beyond &ldquo;someone with the key&rdquo;, and it is not a password hash —
            both sides hold the same secret, which is exactly what makes it symmetric.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
