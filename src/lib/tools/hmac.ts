/**
 * HMAC, and the one thing built on top of it that this site ships: an HS256 /
 * HS384 / HS512 JWT signer.
 *
 * Pure functions over strings and bytes plus `crypto.subtle`. No DOM, so this
 * runs unchanged in jsdom, in a worker and on the main thread — `HmacGeneratorUI`
 * and `JwtEncoderUI` hold state and copy, nothing else.
 *
 * ── Why the JWT signer lives in a file called hmac.ts ───────────────────────
 *
 * Because that is all it is. A JWT's signature over `HS*` is one HMAC of the
 * ASCII string `base64url(header) + "." + base64url(payload)`. The header, the
 * payload and the dots are not encryption and never were; see `signJwt`.
 *
 * ── Base64 ─────────────────────────────────────────────────────────────────
 *
 * Both encoders here are written from the alphabet rather than wrapped around
 * `btoa`. JWT segments are base64url with NO padding, and "call the padding
 * helper, then strip the `=`" is how a padded byte sneaks into a signing input
 * and produces a token every verifier rejects. Writing the unpadded form
 * directly means there is no padding to strip.
 *
 * ── Reading a claim vs. writing one ────────────────────────────────────────
 *
 * `readClaim` uses `JSON.parse`, which is safe because it only reads.
 * `setClaim` does NOT: it scans the payload text and rewrites one span, so a
 * 64-bit `sub`, a `1.0`, a `1e2` and a duplicate key all survive a click on
 * "expires in 1 hour". `src/lib/tools/json-format.ts` records why that round
 * trip is corruption rather than formatting, and `encodeJwtSegment` reuses its
 * `minifyJson` for the same reason.
 */

import { minifyJson } from "@/lib/tools/json-format";

/* ── Hashes ───────────────────────────────────────────────────────────────── */

export type HmacHash = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

/** The four `crypto.subtle` HMAC hashes, with what each one is actually for. */
export const HMAC_HASHES: readonly {
  id: HmacHash;
  label: string;
  /** Digest length in bits — the output size, not the key size. */
  bits: number;
  note: string;
}[] = [
  {
    id: "SHA-1",
    label: "SHA-1",
    bits: 160,
    note: "Legacy only. SHA-1's collision weakness does not break HMAC-SHA1 — HMAC does not rest on collision resistance — but nothing new should be designed around it.",
  },
  { id: "SHA-256", label: "SHA-256", bits: 256, note: "The default almost every API signs with." },
  { id: "SHA-384", label: "SHA-384", bits: 384, note: "SHA-512 truncated to 384 bits; used where a profile names it." },
  { id: "SHA-512", label: "SHA-512", bits: 512, note: "Longest digest here; faster than SHA-256 on 64-bit CPUs." },
];

/* ── Bytes in ─────────────────────────────────────────────────────────────── */

export type KeyEncoding = "utf-8" | "hex" | "base64";

export const KEY_ENCODINGS: readonly { id: KeyEncoding; label: string }[] = [
  { id: "utf-8", label: "Text" },
  { id: "hex", label: "Hex" },
  { id: "base64", label: "Base64" },
];

/** A key that could not be read as the encoding the user picked. */
export class KeyDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyDecodeError";
  }
}

export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Standard base64, padded. What an API means when it says "base64 signature". */
export function toBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes, B64_STD, true);
}

/**
 * base64url with NO padding — RFC 7515 §2, which is what every JWT segment is.
 *
 * Written from the alphabet on purpose. Producing padded base64 and then
 * translating `+/` and trimming `=` works right up until one of those steps is
 * missed, and a signing input with a stray `=` in it makes a token that this
 * page will happily show and no verifier will accept.
 */
export function toBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes, B64_URL, false);
}

function encodeBase64(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = "";
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += alphabet[(v >> 18) & 63] + alphabet[(v >> 12) & 63] + alphabet[(v >> 6) & 63] + alphabet[v & 63];
  }
  const left = n - i;
  if (left === 1) {
    const v = bytes[i] << 16;
    out += alphabet[(v >> 18) & 63] + alphabet[(v >> 12) & 63] + (pad ? "==" : "");
  } else if (left === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += alphabet[(v >> 18) & 63] + alphabet[(v >> 12) & 63] + alphabet[(v >> 6) & 63] + (pad ? "=" : "");
  }
  return out;
}

/** Both alphabets decode here — an API that hands you a base64url key is common. */
function base64Value(ch: string): number {
  const std = B64_STD.indexOf(ch);
  if (std !== -1) return std;
  if (ch === "-") return 62;
  if (ch === "_") return 63;
  return -1;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * The key, as the bytes the picker says it is.
 *
 * This is the whole reason the encoding is a control and not an assumption. A
 * 64-character hex key read as text is 64 bytes; read as hex it is 32, and the
 * two produce completely unrelated MACs with no error anywhere to say which
 * one you got.
 */
export function decodeKeyBytes(text: string, encoding: KeyEncoding): Uint8Array {
  if (encoding === "utf-8") return utf8Bytes(text);

  if (encoding === "hex") {
    // `0x` prefixes, and the colon/space groupings openssl and Wireshark print.
    const compact = text.trim().replace(/^0x/i, "").replace(/[\s:-]/g, "");
    if (compact === "") return new Uint8Array(0);
    const bad = compact.match(/[^0-9a-fA-F]/);
    if (bad) {
      throw new KeyDecodeError(
        `"${bad[0]}" is not a hex digit. A hex key is made only of 0-9 and a-f; separators (spaces, colons, dashes) and a leading 0x are ignored.`,
      );
    }
    if (compact.length % 2 !== 0) {
      throw new KeyDecodeError(
        `A hex key needs an even number of digits — two per byte — and this one has ${compact.length}. A digit is probably missing from the start or the end.`,
      );
    }
    const bytes = new Uint8Array(compact.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  const compact = text.replace(/\s/g, "").replace(/=+$/, "");
  if (compact === "") return new Uint8Array(0);
  const bad = compact.match(/[^A-Za-z0-9+/\-_]/);
  if (bad) {
    throw new KeyDecodeError(
      `"${bad[0]}" is not a base64 character. Both alphabets are accepted here — standard (+ /) and URL-safe (- _) — and trailing = padding is optional.`,
    );
  }
  if (compact.length % 4 === 1) {
    throw new KeyDecodeError(
      "This is not a whole number of base64 groups: a group of four characters carries three bytes, and one character is left over. A character is probably missing.",
    );
  }
  const bytes = new Uint8Array(Math.floor((compact.length * 3) / 4));
  let bitBuffer = 0;
  let bitCount = 0;
  let out = 0;
  for (const ch of compact) {
    bitBuffer = (bitBuffer << 6) | base64Value(ch);
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[out++] = (bitBuffer >> bitCount) & 0xff;
    }
  }
  return bytes.subarray(0, out);
}

/**
 * True when text picked as UTF-8 is almost certainly meant to be hex.
 *
 * Deliberately narrow: an even number of hex digits, at least 16 of them, and
 * at least one digit AND one letter, so `deadbeef`-style words and pure decimal
 * PINs do not trip it. The UI turns this into a warning, never into a silent
 * re-interpretation of the key.
 */
export function looksLikeHexKey(text: string): boolean {
  const compact = text.trim();
  if (compact.length < 16 || compact.length % 2 !== 0) return false;
  if (!/^[0-9a-fA-F]+$/.test(compact)) return false;
  return /[0-9]/.test(compact) && /[a-fA-F]/.test(compact);
}

/* ── The MAC itself ───────────────────────────────────────────────────────── */

/**
 * One HMAC. The key is imported non-extractable and for signing only, so
 * nothing downstream of this call can read it back out of the CryptoKey.
 */
export async function hmacDigest(
  hash: HmacHash,
  keyBytes: Uint8Array,
  messageBytes: Uint8Array,
): Promise<Uint8Array> {
  if (keyBytes.length === 0) {
    // Every WebCrypto implementation rejects a zero-length HMAC key, with a
    // DataError that says nothing useful. Say the useful thing here instead.
    throw new KeyDecodeError("An HMAC needs a key of at least one byte. This one is empty.");
  }
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, messageBytes as BufferSource);
  return new Uint8Array(signature);
}

export type MacEncoding = "hex" | "base64" | "base64url";

/**
 * Does a pasted MAC match this digest, and in which spelling?
 *
 * NOT constant-time, and nothing here pretends otherwise: it is a string
 * comparison in a page, for the "why is my webhook 401-ing" case, not a
 * verifier inside a security boundary. A real verifier compares bytes in
 * constant time so that the time it takes to fail does not leak how much of
 * the MAC was right.
 *
 * Hex is compared case-insensitively because hex has no case. Base64 is NOT —
 * `a` and `A` are different base64 characters and a case-folded match there
 * would be a false positive. A `sha256=` style prefix (GitHub, Shopify and
 * friends put one in the header) is stripped before comparing.
 */
export function compareMac(expected: string, digest: Uint8Array): MacEncoding | null {
  const compact = expected
    .trim()
    .replace(/^(?:hmac[-_]?)?sha-?(?:1|224|256|384|512)\s*=\s*/i, "")
    .replace(/\s/g, "");
  if (compact === "") return null;

  if (/^[0-9a-fA-F]+$/.test(compact) && compact.toLowerCase() === toHex(digest)) return "hex";

  const b64 = toBase64(digest);
  if (compact === b64 || compact === b64.replace(/=+$/, "")) return "base64";

  if (compact.replace(/=+$/, "") === toBase64Url(digest)) return "base64url";

  return null;
}

/* ── JWT ──────────────────────────────────────────────────────────────────── */

/**
 * The three algorithms this site will sign.
 *
 * RS*, PS* and ES* are absent by choice, not by omission: they sign with a
 * private key, and a web page that asks you to paste a private key into a text
 * box is a credential-collection pattern regardless of what it does with it.
 * `JwtEncoderUI` says so on the page.
 */
export type JwtAlg = "HS256" | "HS384" | "HS512";

export const JWT_HASH: Record<JwtAlg, HmacHash> = {
  HS256: "SHA-256",
  HS384: "SHA-384",
  HS512: "SHA-512",
};

export const JWT_ALGS: readonly { id: JwtAlg; label: string }[] = [
  { id: "HS256", label: "HS256" },
  { id: "HS384", label: "HS384" },
  { id: "HS512", label: "HS512" },
];

export function isJwtAlg(value: unknown): value is JwtAlg {
  return value === "HS256" || value === "HS384" || value === "HS512";
}

/** Which box the user has to go and fix. */
export type JwtBuildStage = "header" | "payload" | "alg" | "secret";

export class JwtBuildError extends Error {
  readonly stage: JwtBuildStage;
  constructor(message: string, stage: JwtBuildStage) {
    super(message);
    this.name = "JwtBuildError";
    this.stage = stage;
  }
}

export interface JwtSignInput {
  header: string;
  payload: string;
  alg: JwtAlg;
  secret: string;
  secretEncoding: KeyEncoding;
}

export interface JwtSignResult {
  token: string;
  /** The three segments, so the UI can colour them without re-splitting. */
  headerSegment: string;
  payloadSegment: string;
  signatureSegment: string;
  /** Key length actually fed to HMAC — the number that catches a mis-picked encoding. */
  keyBytes: number;
  /**
   * Top-level keys written more than once in the header or payload.
   *
   * They survive into the token byte for byte, because the segments are a
   * whitespace-only rewrite rather than a re-serialisation. Every decoder then
   * keeps only the LAST one, so the token means something different from what
   * the editor appears to say. Counted here so the UI can put it on screen.
   */
  duplicateKeys: string[];
}

/** Minify (losslessly) and base64url one JSON document into a JWT segment. */
export function encodeJwtSegment(jsonText: string): string {
  return toBase64Url(utf8Bytes(minifyJson(jsonText)));
}

function parseObject(text: string, stage: "header" | "payload"): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unparseable";
    throw new JwtBuildError(`The ${stage} is not valid JSON — ${detail}`, stage);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new JwtBuildError(
      `The ${stage} has to be a JSON object — a ${Array.isArray(value) ? "array" : typeof value} cannot carry claims.`,
      stage,
    );
  }
  return value as Record<string, unknown>;
}

/**
 * Sign a JWT.
 *
 * A JWT is SIGNED, not encrypted. The two segments in front of the signature
 * are base64url — an encoding, not a cipher — so anyone holding the token can
 * read every claim in it without the secret. The secret proves the token was
 * not altered; it does not hide anything.
 */
export async function signJwt(input: JwtSignInput): Promise<JwtSignResult> {
  const header = parseObject(input.header, "header");
  // Validity only — the segment below is built from the SOURCE text, not from
  // this value, so nothing the parse rounded can reach the token.
  parseObject(input.payload, "payload");

  if (!isJwtAlg(header.alg)) {
    throw new JwtBuildError(
      typeof header.alg === "string"
        ? `The header says alg: ${header.alg}, and this page signs HS256, HS384 and HS512 only. RS*, PS* and ES* need an RSA or EC private key, which this tool will not ask you to paste into a web page.`
        : `The header has no "alg" claim. Pick an algorithm in the rail and it is written into the header for you.`,
      "alg",
    );
  }
  if (header.alg !== input.alg) {
    throw new JwtBuildError(
      `The header says alg: ${header.alg} but ${input.alg} is selected. A token whose header names a different algorithm from the one that signed it is rejected by every verifier, so nothing is produced until the two agree.`,
      "alg",
    );
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeKeyBytes(input.secret, input.secretEncoding);
  } catch (err) {
    throw new JwtBuildError(err instanceof Error ? err.message : "Unreadable secret", "secret");
  }
  if (keyBytes.length === 0) {
    throw new JwtBuildError(
      "Enter the signing secret. A JWT with no key behind it is not signed, and this page will not write one that pretends to be.",
      "secret",
    );
  }

  const headerSegment = encodeJwtSegment(input.header);
  const payloadSegment = encodeJwtSegment(input.payload);
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = await hmacDigest(JWT_HASH[input.alg], keyBytes, utf8Bytes(signingInput));
  const signatureSegment = toBase64Url(signature);

  return {
    token: `${signingInput}.${signatureSegment}`,
    headerSegment,
    payloadSegment,
    signatureSegment,
    keyBytes: keyBytes.length,
    duplicateKeys: [...duplicateTopLevelKeys(input.header), ...duplicateTopLevelKeys(input.payload)],
  };
}

/* ── Claim editing, without a JSON round trip ─────────────────────────────── */

interface Member {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

interface ObjectScan {
  open: number;
  close: number;
  members: Member[];
}

/** Walk a string literal from its opening quote; returns the index after it. */
function skipString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return i;
}

function skipWhitespace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/**
 * The top-level members of a JSON object, as spans in the ORIGINAL text.
 *
 * Only ever called on text `JSON.parse` has already accepted, so this does not
 * need to be a validating parser — it needs to be a faithful one. Nested
 * objects, arrays and strings are skipped whole so a `,` or `}` inside one is
 * never mistaken for the end of a member.
 */
function scanObject(text: string): ObjectScan | null {
  let i = skipWhitespace(text, 0);
  if (text[i] !== "{") return null;
  const open = i;
  i++;
  const members: Member[] = [];

  for (;;) {
    i = skipWhitespace(text, i);
    if (i >= text.length) return null;
    if (text[i] === "}") return { open, close: i, members };
    if (text[i] !== '"') return null;

    const keyStart = i;
    const keyEnd = skipString(text, i);
    let key: string;
    try {
      key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    } catch {
      return null;
    }

    i = skipWhitespace(text, keyEnd);
    if (text[i] !== ":") return null;
    i = skipWhitespace(text, i + 1);

    const valueStart = i;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i = skipString(text, i);
        continue;
      }
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) break;
      i++;
    }
    let valueEnd = i;
    while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1])) valueEnd--;
    members.push({ key, keyStart, valueStart, valueEnd });

    i = skipWhitespace(text, i);
    if (text[i] === ",") {
      i++;
      continue;
    }
    if (text[i] === "}") return { open, close: i, members };
    return null;
  }
}

/** Top-level keys written more than once, in first-seen order, deduplicated. */
export function duplicateTopLevelKeys(objectText: string): string[] {
  const scan = scanObject(objectText);
  if (!scan) return [];
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const m of scan.members) {
    if (seen.has(m.key)) {
      if (!dupes.includes(m.key)) dupes.push(m.key);
    } else {
      seen.add(m.key);
    }
  }
  return dupes;
}

/** A JSON string literal, escaped as JSON requires. */
export function jsonStringLiteral(value: string): string {
  return JSON.stringify(value);
}

/**
 * Read one top-level claim. `JSON.parse` is fine here — reading cannot corrupt
 * anything, and the caller wants the parsed value, not the source bytes.
 * Returns `undefined` for an absent claim or for text that is not an object.
 */
export function readClaim(objectText: string, key: string): unknown {
  try {
    const value = JSON.parse(objectText);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * How a string-valued claim should be offered as a text field.
 *
 * `editable: false` means the claim is there but is not a string — an `aud`
 * array, most often — and overwriting it from a one-line box would silently
 * throw away the other audiences. The UI disables the field and says so.
 */
export function readStringClaim(
  objectText: string,
  key: string,
): { text: string; editable: boolean } {
  const value = readClaim(objectText, key);
  if (value === undefined) return { text: "", editable: true };
  if (typeof value === "string") return { text: value, editable: true };
  return { text: JSON.stringify(value), editable: false };
}

/**
 * Set (or, with `literal: null`, remove) one top-level claim, rewriting ONE
 * span of the source text and copying everything else byte for byte.
 *
 * `JSON.parse(text)` + set + `JSON.stringify` would be four lines instead of
 * these forty, and it would also rewrite every other literal in the document:
 * a 64-bit `sub` loses its last three digits, `1.0` becomes `1`, `1e2` becomes
 * `100`, and a duplicate key vanishes. Clicking "issued at now" must not do
 * any of that. Returns the text unchanged when it is not a JSON object.
 */
export function setClaim(objectText: string, key: string, literal: string | null): string {
  const scan = scanObject(objectText);
  if (!scan) return objectText;
  const existing = scan.members.find((m) => m.key === key);

  if (literal === null) {
    if (!existing) return objectText;
    const index = scan.members.indexOf(existing);
    if (scan.members.length === 1) {
      return objectText.slice(0, scan.open + 1) + objectText.slice(scan.close);
    }
    if (index === scan.members.length - 1) {
      // Last member: swallow the comma that used to precede it.
      const previous = scan.members[index - 1];
      return objectText.slice(0, previous.valueEnd) + objectText.slice(existing.valueEnd);
    }
    const next = scan.members[index + 1];
    return objectText.slice(0, existing.keyStart) + objectText.slice(next.keyStart);
  }

  if (existing) {
    return objectText.slice(0, existing.valueStart) + literal + objectText.slice(existing.valueEnd);
  }

  const entry = `"${key}": ${literal}`;

  if (scan.members.length === 0) {
    const inside = objectText.slice(scan.open + 1, scan.close);
    if (inside.includes("\n")) {
      return `${objectText.slice(0, scan.open + 1)}\n  ${entry}\n${objectText.slice(scan.close)}`;
    }
    return `${objectText.slice(0, scan.open + 1)}${entry}${objectText.slice(scan.close)}`;
  }

  const last = scan.members[scan.members.length - 1];
  let leadStart = last.keyStart;
  while (leadStart > 0 && /\s/.test(objectText[leadStart - 1])) leadStart--;
  const lead = objectText.slice(leadStart, last.keyStart);
  const separator = lead.includes("\n") ? lead : " ";
  return `${objectText.slice(0, last.valueEnd)},${separator}${entry}${objectText.slice(last.valueEnd)}`;
}

/* ── Time claims ──────────────────────────────────────────────────────────── */

/** `iat`, `nbf` and `exp` are seconds since the epoch (RFC 7519 §2), not ms. */
export function epochSeconds(atMs: number): number {
  return Math.floor(atMs / 1000);
}

export const EXP_PRESETS: readonly { id: string; label: string; seconds: number }[] = [
  { id: "15m", label: "15 min", seconds: 15 * 60 },
  { id: "1h", label: "1 hour", seconds: 60 * 60 },
  { id: "24h", label: "24 hours", seconds: 24 * 60 * 60 },
  { id: "7d", label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { id: "30d", label: "30 days", seconds: 30 * 24 * 60 * 60 },
];

/** `2026-09-05 14:22:03 UTC`, or null when the claim is not a usable instant. */
export function formatEpochUtc(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

const RELATIVE_UNITS: readonly [number, string][] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
  [1, "second"],
];

/**
 * "in 1 hour" / "3 days ago" / "now". Floors rather than rounds, so an hour and
 * fifty minutes reads as "in 1 hour" — the same convention every timestamp in
 * every log reader uses.
 */
export function relativeEpoch(seconds: number, nowMs: number): string {
  const deltaSeconds = seconds - nowMs / 1000;
  const magnitude = Math.abs(deltaSeconds);
  if (magnitude < 1) return "now";
  for (const [size, name] of RELATIVE_UNITS) {
    if (magnitude < size) continue;
    const count = Math.floor(magnitude / size);
    const unit = count === 1 ? name : `${name}s`;
    return deltaSeconds > 0 ? `in ${count} ${unit}` : `${count} ${unit} ago`;
  }
  return "now";
}
