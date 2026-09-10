"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  CanvasFootnote,
  lineCount,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import {
  CANVAS_COLUMN,
  chipClass,
  MONO_LABEL,
  SCROLL_CLASS,
} from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  decodeKeyBytes,
  epochSeconds,
  EXP_PRESETS,
  formatEpochUtc,
  JWT_ALGS,
  JwtBuildError,
  jsonStringLiteral,
  KEY_ENCODINGS,
  readClaim,
  readStringClaim,
  relativeEpoch,
  setClaim,
  signJwt,
  utf8Bytes,
  type JwtAlg,
  type JwtSignInput,
  type JwtSignResult,
  type KeyEncoding,
} from "@/lib/tools/hmac";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/** The one field box the redesign doc specifies — same as SubtitleConverterUI. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** An action chip, drawn like `ToolChoice`'s unselected state. */
const CLAIM_CHIP = chipClass(false, "rounded-[6px] px-2 py-[7px] text-[11.5px]");

/*
  `TEXT_PANE_BODY` floors every pane at 12rem, which is right for a tool whose
  panes are the whole canvas. Here the two editors stack below `md`, so that
  floor reserved eighteen blank lines for nine lines of seeded JSON before the
  UI even mounted. Below `md` they open at the height of the documents they
  hold and grow with typing; from `md` up, where the panes sit side by side and
  the canvas has the room, the full 12rem is back.
*/
const HEADER_BODY = "min-h-[7rem] md:min-h-[12rem]";
const PAYLOAD_BODY = "min-h-[8.5rem] md:min-h-[12rem]";

const RAIL_NOTE = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/*
  ── Two disclosures, both modelled on `ToolAdvanced` in ToolAside.tsx ──────

  This page is mostly prose, and it earned it: a JWT tool that does not say
  "signed, not encrypted", or that lets you sign with a hex secret read as
  text, is the tool people arrive here to escape. But a rail that renders all
  of it at once reserves it as blank space above the fold before the UI has
  even mounted (see scripts/measure-tool-surfaces.mjs) — the page measured
  2374px tall on a 412px screen, the tallest on the site.

  So none of it was cut. `RailNote` keeps the load-bearing SENTENCE on screen
  and folds the paragraph behind it; `RailDrawer` does the same for a whole
  section, with the live values it contains printed on the summary row so the
  drawer never hides a number you might be looking for. Everything stays in
  the DOM, one click and one Ctrl-F away.
*/

/** A note whose headline stays visible and whose paragraph is one click away. */
function RailNote({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-baseline gap-2 rounded-sm",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={RAIL_NOTE}>{summary}</span>
        <span
          aria-hidden="true"
          className="ml-auto font-mono text-[13px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className={cn(RAIL_NOTE, "mt-2 animate-tm-drawer motion-reduce:animate-none")}>
        {children}
      </div>
    </details>
  );
}

/** A whole rail section behind a summary row — `ToolAdvanced`'s shape exactly. */
function RailDrawer({
  label,
  hint,
  children,
}: {
  label: string;
  /** Live values from inside, so the summary states rather than teases. */
  hint: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-b border-border px-4 last:border-b-0">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 py-3",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={cn(MONO_LABEL, "flex-none text-text-muted")}>{label}</span>
        <span className="truncate font-mono text-[10px] leading-none text-text-muted opacity-60">
          {hint}
        </span>
        <span
          aria-hidden="true"
          className="ml-auto flex-none font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className="-mx-4 flex animate-tm-drawer flex-col gap-[9px] border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none">
        {children}
      </div>
    </details>
  );
}

/*
  jwt.io's default token — the same one JwtDecoderUI carries as its
  placeholder, so a round trip between the two pages is visibly a round trip.
  It is NOT from any JOSE RFC, and the copy on this page must not say it is:
  RFC 7515 App. A.1's HS256 example signs a different header and payload with
  a 64-byte key and lands on `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`.
  What is true of `your-256-bit-secret` is the part that matters — it is
  published in every JWT tutorial on the internet — and while the secret is
  still THIS string the canvas says so: a page that shipped a signed-looking
  token under a secret anyone can look up would be lying by omission.
*/
const EXAMPLE_SECRET = "your-256-bit-secret";
/** 19, not 32. Derived rather than typed, so the warning cannot drift. */
const EXAMPLE_SECRET_BYTES = utf8Bytes(EXAMPLE_SECRET).length;
const DEFAULT_HEADER = '{\n  "alg": "HS256",\n  "typ": "JWT"\n}';
const DEFAULT_PAYLOAD =
  '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}';

/** The three claims that are an instant, and the three that are a string. */
const TIME_CLAIMS = ["iat", "nbf", "exp"] as const;

/*
  Display-only clock reads, at module scope.

  A relative expiry readout ("in 1 hour") is time-dependent by definition, and
  this is how the codebase already does it — `RecentOutputs.relativeTime` and
  `CronExpressionGeneratorUI.getNextRuns` read the clock the same way for the
  same reason. Nothing here reaches the token: the claim buttons stamp their
  value inside the click handler, and the token is signed from the payload text.
*/
function describeInstant(value: unknown): { utc: string | null; relative: string | null } {
  const utc = formatEpochUtc(value);
  if (typeof value !== "number" || !utc) return { utc: null, relative: null };
  return { utc, relative: relativeEpoch(value, Date.now()) };
}

function isPastInstant(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value * 1000 < Date.now();
}

/** The epoch second to stamp into a claim, read at the moment of the click. */
function nowSeconds(): number {
  return epochSeconds(Date.now());
}

const STRING_CLAIMS: readonly { key: string; label: string; hint: string }[] = [
  { key: "sub", label: "sub", hint: "Subject — who the token is about." },
  { key: "iss", label: "iss", hint: "Issuer — who signed it." },
  { key: "aud", label: "aud", hint: "Audience — who should accept it." },
];

/**
 * One finished signing run, carrying the inputs it was computed FROM.
 *
 * The inputs are the whole point — see `current` below.
 */
interface JwtRun extends JwtSignInput {
  signed: JwtSignResult | null;
  error: string | null;
}

export function JwtEncoderUI() {
  const [header, setHeader] = useState(DEFAULT_HEADER);
  const [payload, setPayload] = useState(DEFAULT_PAYLOAD);
  const [alg, setAlg] = useState<JwtAlg>("HS256");
  const [secret, setSecret] = useState(EXAMPLE_SECRET);
  const [secretEncoding, setSecretEncoding] = useState<KeyEncoding>("utf-8");
  const [run, setRun] = useState<JwtRun | null>(null);
  const { copied, copy } = useCopied<string>();

  /*
    Signing is async (`crypto.subtle`), so a fast typist can have three runs in
    flight at once and they do not necessarily resolve in order. The cleanup
    flag drops every result but the newest run's.
  */
  useEffect(() => {
    let stale = false;
    const inputs: JwtSignInput = { header, payload, alg, secret, secretEncoding };
    signJwt(inputs)
      .then((signed) => {
        if (!stale) setRun({ ...inputs, signed, error: null });
      })
      .catch((err: unknown) => {
        if (stale) return;
        setRun({
          ...inputs,
          signed: null,
          error:
            err instanceof JwtBuildError || err instanceof Error
              ? err.message
              : "This token could not be signed.",
        });
      });
    return () => {
      stale = true;
    };
  }, [header, payload, alg, secret, secretEncoding]);

  /*
    The run is only shown while it is still a run of what is in the boxes.
    Signing is a promise, so without this the token from the PREVIOUS secret
    stays on screen — labelled "Signed token", with a live Copy button over it
    — beside a rail already printing the NEW key length. Copy it in that window
    and you have handed someone a token no verifier holding the new secret will
    accept. `HmacGeneratorUI` guards its MAC the same way, for the same reason.
  */
  const current =
    run &&
    run.header === header &&
    run.payload === payload &&
    run.alg === alg &&
    run.secret === secret &&
    run.secretEncoding === secretEncoding
      ? run
      : null;
  const result = current?.signed ?? null;
  const error = current?.error ?? null;

  /** Key length, shown whether or not the token built — it is the diagnostic. */
  const keyBytes = useMemo(() => {
    try {
      return decodeKeyBytes(secret, secretEncoding).length;
    } catch {
      return null;
    }
  }, [secret, secretEncoding]);

  const payloadValid = useMemo(() => {
    try {
      const value: unknown = JSON.parse(payload);
      return value !== null && typeof value === "object" && !Array.isArray(value);
    } catch {
      return false;
    }
  }, [payload]);

  /** The same predicate `handleAlg` applies, so the rail note and the picker
   *  cannot disagree about whether a click would land. */
  const headerWritable = useMemo(
    () => readClaim(setClaim(header, "alg", jsonStringLiteral(alg)), "alg") === alg,
    [header, alg],
  );

  const handleAlg = useCallback(
    (next: JwtAlg) => {
      // The header is the source of truth a verifier reads, so the picker
      // writes into it rather than sitting beside it and disagreeing. When the
      // header is mid-edit and unparseable, `setClaim` drops the write and
      // returns the text as it was — advancing the picker anyway left the two
      // disagreeing and made the page report an alg mismatch it had caused
      // itself. So neither moves until both can.
      const rewritten = setClaim(header, "alg", jsonStringLiteral(next));
      if (readClaim(rewritten, "alg") !== next) return;
      setAlg(next);
      setHeader(rewritten);
    },
    [header],
  );

  const applyClaim = useCallback((key: string, literal: string | null) => {
    setPayload((current) => setClaim(current, key, literal));
  }, []);

  const handleCopy = useCallback(
    (value: string, key: string) => {
      void copy(value, key);
    },
    [copy],
  );

  /** Every time claim currently in the payload, read back and made legible. */
  const timeReadouts = TIME_CLAIMS.map((key) => {
    const raw = readClaim(payload, key);
    return { key, raw, ...describeInstant(raw) };
  });

  const expired = isPastInstant(readClaim(payload, "exp"));
  const expCell = timeReadouts.find((r) => r.key === "exp");
  /*
    Three states, not two. `exp` absent is one thing; `exp` present but not a
    number of seconds — quoted, as a shell template or a config file hands it
    to you, or a millisecond value past the end of Date's range — is another,
    and calling that "NO EXP" asserts the opposite of what the token carries.
  */
  const expMissing = expCell?.raw === undefined;
  const expUnusable = !expMissing && !expCell?.relative;
  /** Read off the value that is actually there, rather than guessed at. */
  const expUnusableDetail =
    typeof expCell?.raw === "number"
      ? "a number, but outside the range a date can be read from — beyond 8,640,000,000,000 seconds either side of 1970 there is no instant to show, and NaN and Infinity land here too"
      : `a ${expCell?.raw === null ? "null" : Array.isArray(expCell?.raw) ? "array" : typeof expCell?.raw}, and exp is a number of seconds since 1970`;

  const token = result?.token ?? "";
  const stillExampleSecret = secret === EXAMPLE_SECRET;

  /*
    Summary rows for the two folded sections. Both state live values rather
    than naming the drawer: a collapsed section that hid the key length would
    be hiding the one number this page exists to show you.
  */
  const claimsSet = STRING_CLAIMS.filter(
    (claim) => readClaim(payload, claim.key) !== undefined,
  ).length;
  const registeredHint = `SUB · ISS · AUD — ${claimsSet} SET`;
  const outputHint = `${alg} · ${keyBytes === null ? "KEY UNREADABLE" : `${keyBytes}-BYTE KEY`}`;

  return (
    <>
      {/* ── Canvas: the two documents, then the token they sign into ── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={2}>
          <TextPane
            label="Header"
            lines={lineCount(header)}
            size={`${header.length} CHARS`}
          >
            <textarea
              value={header}
              onChange={(e) => setHeader(e.target.value)}
              spellCheck={false}
              aria-label="JWT header JSON"
              className={cn(TEXT_PANE_BODY, HEADER_BODY)}
            />
          </TextPane>
          <TextPane
            label="Payload"
            lines={lineCount(payload)}
            size={`${payload.length} CHARS`}
          >
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              spellCheck={false}
              aria-label="JWT payload JSON"
              className={cn(TEXT_PANE_BODY, PAYLOAD_BODY)}
            />
          </TextPane>
        </TextPanes>

        {error && <ErrorMessage message={error} />}

        {result && result.duplicateKeys.length > 0 && (
          <WarningMessage
            message={`${result.duplicateKeys.length === 1 ? "The key" : "The keys"} ${result.duplicateKeys.map((k) => `"${k}"`).join(", ")} ${result.duplicateKeys.length === 1 ? "is" : "are"} written more than once. Both copies are encoded into the token exactly as you typed them, because the segments are a whitespace-only rewrite of your text rather than a re-serialisation — but every decoder keeps only the last one, so the token means something different from what this editor appears to say.`}
          />
        )}

        {expired && (
          <WarningMessage
            message={`The exp claim is ${expCell?.relative ?? "in the past"} — ${expCell?.utc}. This token is already expired and every verifier that checks exp will reject it. Set a new expiry in the rail, or delete the claim.`}
          />
        )}

        {expUnusable && (
          <WarningMessage
            message={`The exp claim is ${JSON.stringify(expCell?.raw)} — ${expUnusableDetail}. This token does carry an expiry, so it is not the "no exp" it would otherwise look like: a verifier that checks exp either rejects it outright or reads a nonsense instant out of it. Set the expiry from the rail, or delete the claim.`}
          />
        )}

        {stillExampleSecret && (
          <WarningMessage
            message={`This token is signed with "${EXAMPLE_SECRET}" — the placeholder jwt.io's debugger ships with, and ${EXAMPLE_SECRET_BYTES} bytes of text (${EXAMPLE_SECRET_BYTES * 8} bits) whatever the name says. It appears in no JWT RFC — it is printed on this page and in every JWT tutorial on the internet, so anyone can forge a token that verifies against it. Replace it with your own secret before the signature means anything.`}
          />
        )}

        {result && (
          <>
            <TextPanes columns={1}>
              <TextPane
                tone="out"
                label="Signed token"
                lines={1}
                size={`${token.length} CHARS`}
                action={
                  <button
                    onClick={() => handleCopy(token, "token")}
                    aria-label={copied === "token" ? "Copied token" : "Copy token"}
                    className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                  >
                    {copied === "token" ? "Copied!" : "Copy"}
                  </button>
                }
              >
                {/* A token is a few wrapped lines, never nine — `min-h-0`
                    drops the editor floor so the pane fits the string it
                    actually holds instead of padding it out with dead space. */}
                <pre
                  tabIndex={0}
                  role="region"
                  className={cn(TEXT_PANE_BODY, "min-h-0 break-all", PANE_FOCUS)}
                  aria-label="Signed JWT"
                >
                  <span className="text-accent-300">{result.headerSegment}</span>
                  <span className="text-text-muted">.</span>
                  <span className="text-success">{result.payloadSegment}</span>
                  <span className="text-text-muted">.</span>
                  <span className="text-neutral-300">{result.signatureSegment}</span>
                </pre>
              </TextPane>
            </TextPanes>

            {/* Legend, strip and footnote are one readout about the token
                above them, so they sit on one tighter rhythm rather than three
                14px canvas gaps. */}
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {[
                  { label: "HEADER", tone: "text-accent-300" },
                  { label: "PAYLOAD", tone: "text-success" },
                  { label: "SIGNATURE", tone: "text-neutral-300" },
                ].map((part) => (
                  <span
                    key={part.label}
                    className="flex items-center gap-[6px] font-mono text-[10px] leading-none tracking-[0.12em] text-text-muted"
                  >
                    <span aria-hidden="true" className={cn("text-[13px] leading-none", part.tone)}>
                      ■
                    </span>
                    {part.label}
                  </span>
                ))}
              </div>

              {/*
                Three cells, not four. `StatStrip` breaks 4 onto two rows on a
                phone, and the cell that paid for that second row was ALGORITHM
                — which the header pane prints as `"alg"` two panes up, the
                picker shows as the lit chip, and the rail's OUTPUT row states
                as `HS256 · 19-BYTE KEY` without being opened. The signature
                length and the expiry are stated nowhere else on the canvas, so
                those are the ones that stay.
              */}
              <StatStrip
                stats={[
                  {
                    label: "SECRET",
                    value: `${result.keyBytes} ${result.keyBytes === 1 ? "BYTE" : "BYTES"}`,
                    tone: "neutral",
                  },
                  {
                    label: "SIGNATURE",
                    value: `${result.signatureSegment.length} CHARS`,
                    tone: "neutral",
                  },
                  {
                    label: "EXPIRES",
                    // Green means "has an expiry, and it is still in the
                    // future". A missing expiry and an unreadable one are both
                    // states this page's own copy treats as worth flagging, so
                    // neither gets the colour it uses for a healthy result.
                    value: expMissing
                      ? "NO EXP"
                      : (expCell?.relative?.toUpperCase() ?? "UNREADABLE"),
                    tone: expMissing || expUnusable || expired ? "neutral" : "ok",
                  },
                ]}
              />

              <CanvasFootnote>
                THE FIRST TWO SEGMENTS ARE BASE64URL, NOT ENCRYPTION — ANYONE HOLDING THIS
                TOKEN CAN READ EVERY CLAIM IN IT WITHOUT THE SECRET
              </CanvasFootnote>
            </div>
          </>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────── */}
      <ToolAside
        footer={
          result ? (
            <ToolActions
              primaryLabel={copied === "primary" ? "Copied to clipboard" : "Copy token"}
              onPrimary={() => handleCopy(token, "primary")}
            />
          ) : undefined
        }
      >
        <ToolControlGroup>
          <ToolControl label="ALGORITHM">
            <ToolChoice
              label="Signing algorithm"
              value={alg}
              onChange={handleAlg}
              options={JWT_ALGS.map((a) => ({ value: a.id, label: a.label }))}
            />
            {!headerWritable && (
              <span className={RAIL_NOTE}>
                The header pane is not valid JSON right now, so the picker cannot write{" "}
                <code className="font-mono text-[10.5px] text-neutral-300">alg</code> into it
                — and it will not move on its own while it cannot, because the two disagreeing
                is exactly what makes this page refuse to sign. Fix the header pane and it
                works again.
              </span>
            )}
            <RailNote summary="HMAC only — why RS256 and ES256 are absent">
              RS256, PS256 and ES256 sign with an RSA or EC private key, and this site will
              not ask you to paste a private key into a web page — so those are absent by
              choice rather than missing. Picking one here writes it into the{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">alg</code> claim in
              the header pane.
            </RailNote>
          </ToolControl>

          <ToolControl label="SIGNING SECRET">
            <input
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="your-256-bit-secret"
              aria-label="Signing secret"
              className={cn(FIELD_CLASS, "w-full")}
            />
            <ToolChoice
              label="Secret encoding"
              value={secretEncoding}
              onChange={setSecretEncoding}
              options={KEY_ENCODINGS.map((e) => ({ value: e.id, label: e.label }))}
            />
            {/* The byte count is the diagnostic the FAQ tells people to compare
                against their library, so it stays on the summary row itself. */}
            <RailNote
              summary={
                keyBytes === null
                  ? "That secret cannot be read as the encoding selected above."
                  : `${keyBytes} ${keyBytes === 1 ? "byte" : "bytes"} of key material — why that matters`
              }
            >
              A secret handed to you as hex or base64 must be decoded before it is used, and
              reading it as text instead silently produces a signature nothing will verify.
              The secret is used by this tab and by nothing else: it is never sent anywhere,
              and the token is only as strong as the secret behind it.
            </RailNote>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="TIME CLAIMS">
          {payloadValid ? (
            <>
              <div className="flex flex-wrap gap-[5px]">
                <button type="button" className={CLAIM_CHIP} onClick={() => applyClaim("iat", String(nowSeconds()))}>
                  iat = now
                </button>
                <button type="button" className={CLAIM_CHIP} onClick={() => applyClaim("nbf", String(nowSeconds()))}>
                  nbf = now
                </button>
              </div>
              <span className={RAIL_NOTE}>Expire this token in:</span>
              {/*
                Six chips wrap onto two rows on a phone. `ToolPresets` already
                solved that the way the redesign doc draws it — one row that
                scrolls below `sm`, wrapping again once there is width for it —
                and every chip is still here, in the DOM and in tab order.
              */}
              <div
                className={cn(
                  "flex gap-[5px] overflow-x-auto sm:flex-wrap sm:overflow-visible",
                  SCROLL_CLASS,
                )}
                role="group"
                aria-label="Expiry preset"
              >
                {EXP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn(CLAIM_CHIP, "flex-none")}
                    onClick={() => applyClaim("exp", String(nowSeconds() + preset.seconds))}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={cn(CLAIM_CHIP, "flex-none")}
                  onClick={() => applyClaim("exp", null)}
                >
                  no exp
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {timeReadouts.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-baseline justify-between gap-2 font-mono text-[10.5px] leading-[1.5] text-text-muted"
                  >
                    <span className="flex-none text-neutral-300">{row.key}</span>
                    <span className="truncate text-right">
                      {row.raw === undefined
                        ? "not set"
                        : row.utc
                          ? `${row.utc} · ${row.relative}`
                          : "not a usable instant"}
                    </span>
                  </div>
                ))}
              </div>
              <RailNote summary="Seconds since 1970, not milliseconds — why that bites">
                Milliseconds are the single commonest way to write a token that expires in
                the year 56000. The values above are computed from this device&rsquo;s clock
                at the moment you click; nothing keeps them up to date afterwards.
              </RailNote>
            </>
          ) : (
            <span className={RAIL_NOTE}>
              The payload is not valid JSON right now, so the claim helpers are switched off
              rather than rewriting text they cannot read. Fix the payload pane and they come
              back.
            </span>
          )}
        </ToolAsideSection>

        <RailDrawer label="REGISTERED CLAIMS" hint={registeredHint}>
          {STRING_CLAIMS.map((claim) => {
            const state = readStringClaim(payload, claim.key);
            return (
              <div key={claim.key} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`claim-${claim.key}`}
                  className="font-body text-[12.5px] leading-[1.2] text-neutral-300"
                >
                  {claim.label} — {claim.hint}
                </label>
                <input
                  id={`claim-${claim.key}`}
                  type="text"
                  value={state.text}
                  disabled={!state.editable || !payloadValid}
                  onChange={(e) =>
                    applyClaim(
                      claim.key,
                      e.target.value === "" ? null : jsonStringLiteral(e.target.value),
                    )
                  }
                  className={cn(FIELD_CLASS, "w-full disabled:opacity-45")}
                />
                {!state.editable && (
                  <span className={RAIL_NOTE}>
                    This claim is not a plain string in the payload — an array of audiences,
                    most often. Editing it from a one-line box would throw the rest away, so
                    it is edited in the payload pane instead.
                  </span>
                )}
              </div>
            );
          })}
          <span className={RAIL_NOTE}>
            Clearing a field deletes the claim. Every edit rewrites one span of the payload
            text and copies the rest byte for byte, so a 64-bit id, a{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">1.0</code> and a
            duplicate key all survive being edited around.
          </span>
        </RailDrawer>

        {/* The four rows here are the same four facts the canvas stat strip
            prints under the token, so the strip is the copy that stays open and
            this one folds — with the algorithm and the key length, the two the
            FAQ sends people to the rail for, still on the summary row. */}
        <RailDrawer label="OUTPUT" hint={outputHint}>
          <ToolOutput
            rows={[
              ["Algorithm", alg],
              ["Key length", keyBytes === null ? "unreadable" : `${keyBytes} bytes`],
              ["Token", token ? `${token.length} chars` : "—"],
              ["Signature", result ? `${result.signatureSegment.length} chars` : "—"],
            ]}
          />
          <span className={RAIL_NOTE}>
            A JWT is signed, not encrypted. The header and the payload are base64url —
            reversible by anyone, with no key — so a token is safe to hand to a client only
            if you would be happy for the client to read every claim in it. Put nothing
            secret in the payload.
          </span>
        </RailDrawer>
      </ToolAside>
    </>
  );
}
