/**
 * ───────────────────────────────────────────────────────────────────────────
 * Reading the codes out of an image, and saying what the payload actually is
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Two halves, deliberately kept apart:
 *
 *   1. `decodeImageCodes` — the DOM half. It decodes the picture with the
 *      browser's own image decoder, hands the pixels to zxing-cpp compiled to
 *      WebAssembly, and returns what was found. Needs `createImageBitmap` and
 *      a canvas, so it cannot be unit-tested under jsdom.
 *
 *   2. everything else in this file — pure string work over a decoded payload:
 *      the WIFI:, MECARD:, vCard, mailto:, tel:, sms:, geo: and otpauth:
 *      grammars, and the named hazards a payload can carry. That half is the
 *      part with the traps in it, and it is the part the unit tests cover.
 *
 * ─── WHY THE ENGINE IS FETCHED FROM THIS ORIGIN, ALWAYS ───────────────────
 *
 * `zxing-wasm@3.1.3` ships a default `locateFile` that resolves the engine to
 * `https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/reader/zxing_reader.wasm`
 * (dist/es/share.js:589). Left alone, opening this page would send the reader's
 * IP address and a timestamp to a third-party CDN — on a site whose entire
 * claim is that the file never leaves the tab, and while /privacy says no
 * request is made to anyone but this origin. That would not be a slow page; it
 * would be a false statement.
 *
 * So the binary is fetched from OUR origin and handed to Emscripten as
 * `wasmBinary`, and `locateFile` is overridden as well. Both, not either:
 * `wasmBinary` alone is sufficient to prevent the fetch (with it set, the glue
 * skips `instantiateStreaming` and reads the bytes it already has —
 * dist/es/reader/index.js:70-77, 56-62, 51-55), but the module still CONSTRUCTS
 * the CDN URL string on the way past, and a URL that exists is a URL something
 * can later be tempted to use. With both overridden, no foreign URL is ever
 * built. Measured in Node with `globalThis.fetch` replaced by a throw: a full
 * decode makes zero network calls.
 *
 * The path mirrors `ffmpeg-loader.ts` and `qpdf.worker.ts`: the artifact is
 * staged into the origin root by `npm run copy:wasm`, and the prefix is read
 * from `__NEXT_ROUTER_BASEPATH` rather than hardcoded, because this site has
 * no basePath today and the few places that need one read that variable.
 */

import { countGifFrames, isAnimatedWebp } from "@/lib/tools/image-frames";

/** Where `copy:wasm` stages `zxing_reader.wasm`. Same origin, never a CDN. */
export const ZXING_WASM_URL = `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/zxing_reader.wasm`;

/**
 * The engine download, in bytes — measured on
 * `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm`, the reader-only
 * build. The `full` build also carries the writer and is not used here.
 */
export const ZXING_WASM_BYTES = 1_093_289;

/*
 * ─── ONE RULER FOR THE DOWNLOAD FIGURE ────────────────────────────────────
 *
 * `ZXING_WASM_BYTES` is the ONLY size any surface quotes for this engine, and
 * the tool page's ADVANCED rail renders it directly. That is not a rounding
 * preference; it is the convention `engine-disclosure.test.ts` argues for and
 * enforces: the homepage ENGINES table quotes the SERVED ARTIFACT, because
 * `copy:wasm` stages exactly one file per engine and that file is the one
 * request a reader can see in the Network tab.
 *
 * The JS glue that instantiates it is deliberately NOT added in. It is bundled
 * into this tool's code-split chunk like every other parsing library on the
 * site (svgo, mammoth, bwip-js, js-yaml — none of which has a row at all), and
 * its shipped size turns on the bundler: 36,516 B by one measurement, 38,227 B
 * minified with esbuild here. A disclosure whose last digit depends on which
 * minifier you asked cannot be pinned to an artifact.
 *
 * This module used to also export `ZXING_GLUE_BYTES` and a
 * `ZXING_FIRST_SCAN_BYTES` sum, and the rail rendered the sum — 1,129,805 B,
 * "1.1 MB" — while the ENGINES row, the developer-tools hub and this page's own
 * FAQ all said 1,093,289 B / "1.0 MB". Two answers to one question, on a site
 * whose pitch is that its numbers are checkable. Both constants are gone so
 * there is nothing left to render the second answer from, and
 * qr-decode.test.ts now reads the hub's own string rather than restating a
 * literal.
 */

/**
 * The picker's list, single-sourced so the registry, the drop zone and the
 * workspace ACCEPTS strip cannot drift. Every one of these is a format the
 * browser's own image decoder handles; the decoder compiled into zxing does
 * NOT read WebP, which is why the pixels go through a canvas first.
 */
export const QR_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp";

/**
 * The largest image we will paint into a canvas before scanning.
 *
 * iOS Safari refuses to back a canvas larger than 16,777,216 device pixels and
 * silently hands back a blank one instead of throwing, which would look exactly
 * like an image with no code in it. Anything above this is scaled down to fit
 * and the page SAYS the picture was scaled and by how much — a downscale is the
 * one thing that can make a small code in a big photo unreadable, so it may not
 * happen quietly. A 12-megapixel phone photo (4032 × 3024) is under this and is
 * scanned at full resolution.
 */
export const MAX_SCAN_PIXELS = 16_777_216;

/* ────────────────────────── the payload grammars ────────────────────────── */

export type PayloadKind =
  | "url"
  | "wifi"
  | "email"
  | "tel"
  | "sms"
  | "geo"
  | "vcard"
  | "mecard"
  | "calendar"
  | "otpauth"
  | "scheme"
  | "text";

export interface PayloadField {
  label: string;
  value: string;
}

/**
 * A named, specific hazard found in THIS payload. Never a generic warning:
 * every entry here was derived from the text, and the message names what was
 * found. An empty list means nothing matched, which is the normal case.
 */
export interface PayloadRisk {
  /** Stable id so the UI can key on it and tests need not match prose. */
  id: string;
  message: string;
}

export interface Payload {
  kind: PayloadKind;
  /** Badge text: "Web link", "Wi-Fi network", "Contact card". */
  label: string;
  fields: PayloadField[];
  risks: PayloadRisk[];
  /** What could not be decoded, named rather than swallowed. */
  notes: string[];
}

/**
 * Characters that are in the text but not on the screen: zero-width spaces and
 * joiners, the bidirectional overrides, and a byte-order mark in the middle of
 * a string. A payload that renders as `example.com` and contains U+202E is the
 * oldest trick there is, and a reader that strips them silently is the reason
 * it still works.
 */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** Schemes that do something other than open a page, in ascending unpleasantness. */
const ACTIVE_SCHEMES: Record<string, string> = {
  "javascript:": "runs script in whatever opens it",
  "data:": "carries its own document inline, so nothing about the source is visible",
  "vbscript:": "runs script in whatever opens it",
  "file:": "points at a path on the device, not at a web address",
  "intent:": "asks Android to hand the payload to another installed app",
};

/**
 * Split a `;`-separated, backslash-escaped field list of the kind WIFI: and
 * MECARD: use, into `[key, rawValue]` pairs.
 *
 * The escaping is the whole point. `;` ends a field and `:` ends a key, and
 * both are characters a Wi-Fi network name is entirely entitled to contain, so
 * the grammar backslash-escapes `\ ; , : "` inside a value. This walks the
 * string once rather than splitting on `;` and repairing afterwards, because
 * splitting first has already destroyed the information needed to repair.
 *
 * Values are returned RAW — still escaped, still quoted if they were quoted —
 * because whether a value was quoted is itself a fact the caller reports.
 */
export function splitEscapedFields(body: string): [string, string][] {
  const out: [string, string][] = [];
  let key = "";
  let value = "";
  let seenColon = false;

  const flush = () => {
    if (seenColon || key !== "") out.push([key, value]);
    key = "";
    value = "";
    seenColon = false;
  };

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "\\" && i + 1 < body.length) {
      // Keep the escape intact: unescaping happens after quote-stripping, and
      // doing it here would make `\;` indistinguishable from a real separator
      // one line further down.
      if (seenColon) value += char + body[i + 1];
      else key += char + body[i + 1];
      i++;
      continue;
    }
    if (char === ";") {
      flush();
      continue;
    }
    if (char === ":" && !seenColon) {
      seenColon = true;
      continue;
    }
    if (seenColon) value += char;
    else key += char;
  }
  flush();
  return out;
}

/** Undo one pass of `\`-escaping. Inverse of `escapeWifiValue` in `wifi-qr.ts`. */
export function unescapeValue(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length) {
      out += raw[i + 1];
      i++;
      continue;
    }
    out += raw[i];
  }
  return out;
}

/**
 * `true` when the raw field was wrapped in double quotes.
 *
 * The WIFI: grammar uses quotes to mean "these are characters, not hex digits":
 * a network genuinely called `ABCD` would otherwise be joined as the two bytes
 * AB CD. The quotes are outside the escaping (`wifi-qr.ts` escapes, then
 * wraps), so they are stripped first.
 */
function isQuoted(raw: string): boolean {
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
}

function readField(raw: string): { value: string; quoted: boolean } {
  const quoted = isQuoted(raw);
  return { value: unescapeValue(quoted ? raw.slice(1, -1) : raw), quoted };
}

export interface WifiPayload {
  ssid: string;
  password: string;
  security: string;
  hidden: boolean;
  /** SSID or password arrived double-quoted — read as text, not as hex. */
  quoted: boolean;
  /** Field keys present in the payload that this page does not interpret. */
  extraKeys: string[];
}

/** Parse a `WIFI:T:WPA;S:name;P:pass;H:true;;` payload. `null` if it is not one. */
export function parseWifiPayload(text: string): WifiPayload | null {
  const match = /^WIFI:/i.exec(text);
  if (!match) return null;

  const fields = splitEscapedFields(text.slice(match[0].length));
  const known = new Set(["S", "P", "T", "H"]);
  const out: WifiPayload = {
    ssid: "",
    password: "",
    security: "",
    hidden: false,
    quoted: false,
    extraKeys: [],
  };

  for (const [rawKey, rawValue] of fields) {
    const key = unescapeValue(rawKey).toUpperCase();
    if (key === "") continue;
    if (key === "S") {
      const read = readField(rawValue);
      out.ssid = read.value;
      out.quoted ||= read.quoted;
    } else if (key === "P") {
      const read = readField(rawValue);
      out.password = read.value;
      out.quoted ||= read.quoted;
    } else if (key === "T") {
      out.security = unescapeValue(rawValue);
    } else if (key === "H") {
      out.hidden = unescapeValue(rawValue).toLowerCase() === "true";
    } else if (!known.has(key)) {
      out.extraKeys.push(key);
    }
  }
  return out;
}

/**
 * The field keys the WIFI: grammar actually defines beyond S, P, T and H —
 * the WPA2-Enterprise settings.
 *
 * This set exists so the page can tell two very different situations apart. A
 * key from this list is a payload feature nothing here interprets. A key that
 * is NOT from this list is almost always a symptom: an unescaped `;` inside a
 * network name ends the S field early and turns the rest of the name into a
 * "field" of its own, so `Cafe; Bar` scans perfectly and joins a network
 * called `Cafe`. That is the exact failure `wifi-qr.ts` escapes to prevent,
 * and it is worth naming rather than filing under "unknown field".
 */
const WIFI_EAP_KEYS = new Set(["E", "A", "I", "PH2", "AI"]);

/** Human name for the `T:` value, which is a token, not prose. */
function securityLabel(token: string): string {
  const upper = token.toUpperCase();
  if (upper === "" || upper === "NOPASS") return "Open — no password";
  if (upper === "WPA") return "WPA/WPA2 (WPA)";
  if (upper === "WPA2-EAP") return "WPA2 Enterprise (EAP)";
  if (upper === "SAE") return "WPA3 (SAE)";
  if (upper === "WEP") return "WEP";
  return token;
}

/* ─────────────────────────────── vCard ─────────────────────────────── */

/** Decode a quoted-printable run to bytes, then read those bytes as UTF-8. */
function decodeQuotedPrintable(input: string): string {
  const bytes: number[] = [];
  // Soft line break: an `=` at end of line means "this line continues".
  const joined = input.replace(/=\r?\n/g, "");
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=" && /^[0-9a-fA-F]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    // Anything not part of an `=XX` escape is already a literal character. It
    // is written back out as UTF-8 so the decoder below sees one byte stream.
    for (const byte of new TextEncoder().encode(joined[i])) bytes.push(byte);
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

/** Undo vCard's own escaping, which is NOT the WIFI: escaping. */
function unescapeVCardValue(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\" || i + 1 >= raw.length) {
      out += raw[i];
      continue;
    }
    const next = raw[i + 1];
    out += next === "n" || next === "N" ? "\n" : next;
    i++;
  }
  return out;
}

export interface VCardProperty {
  name: string;
  params: string[];
  value: string;
}

export interface VCardPayload {
  properties: VCardProperty[];
  /** Properties whose value was quoted-printable and had to be decoded. */
  quotedPrintable: number;
  /** A CHARSET= that was not UTF-8; the bytes were read as UTF-8 anyway. */
  foreignCharsets: string[];
}

/**
 * Parse a vCard into properties.
 *
 * Line folding comes first and is not optional: RFC 6350 wraps long lines at
 * 75 octets and continues them with a leading space, so an unfolded parse
 * chops an email address in half and reports the halves as two properties.
 */
export function parseVCard(text: string): VCardPayload | null {
  if (!/^\s*BEGIN:VCARD/i.test(text)) return null;

  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const properties: VCardProperty[] = [];
  let quotedPrintable = 0;
  const foreignCharsets: string[] = [];

  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const head = line.slice(0, colon);
    let value = line.slice(colon + 1);
    const parts = head.split(";");
    const name = (parts[0] ?? "").replace(/^[^.]*\./, "").toUpperCase();
    if (name === "BEGIN" || name === "END" || name === "VERSION") continue;

    const params = parts.slice(1);
    const upperParams = params.map((p) => p.toUpperCase());
    if (upperParams.some((p) => p.includes("QUOTED-PRINTABLE"))) {
      value = decodeQuotedPrintable(value);
      quotedPrintable++;
    }
    for (const param of params) {
      const charset = /^CHARSET=(.+)$/i.exec(param);
      if (charset && !/^utf-?8$/i.test(charset[1]) && !foreignCharsets.includes(charset[1])) {
        foreignCharsets.push(charset[1]);
      }
    }
    properties.push({
      name,
      params: params.filter((p) => !/^(CHARSET|ENCODING)=/i.test(p)),
      value: unescapeVCardValue(value),
    });
  }
  return { properties, quotedPrintable, foreignCharsets };
}

/** `Lovelace;Ada;;Dr.;` → `Dr. Ada Lovelace`. Structured N, in reading order. */
function joinStructuredName(value: string): string {
  const [family = "", given = "", middle = "", prefix = "", suffix = ""] = value.split(";");
  return [prefix, given, middle, family, suffix].filter((part) => part.trim() !== "").join(" ");
}

/** ADR is seven `;`-separated components; only some are ever filled in. */
function joinAddress(value: string): string {
  return value
    .split(";")
    .filter((part) => part.trim() !== "")
    .join(", ");
}

const VCARD_LABEL: Record<string, string> = {
  FN: "Name",
  N: "Name",
  ORG: "Organisation",
  TITLE: "Job title",
  TEL: "Phone",
  EMAIL: "Email",
  URL: "Website",
  ADR: "Address",
  NOTE: "Note",
  BDAY: "Birthday",
  NICKNAME: "Nickname",
};

/* ───────────────────────────── classification ───────────────────────────── */

/** A `;`-escaped MECARD: contact, the older sibling of vCard. */
export function parseMeCard(text: string): [string, string][] | null {
  const match = /^MECARD:/i.exec(text);
  if (!match) return null;
  return splitEscapedFields(text.slice(match[0].length))
    .filter(([key]) => key.trim() !== "")
    .map(([key, value]) => [unescapeValue(key).toUpperCase(), unescapeValue(value)]);
}

const MECARD_LABEL: Record<string, string> = {
  N: "Name",
  SOUND: "Name reading",
  TEL: "Phone",
  TELAV: "Video phone",
  EMAIL: "Email",
  NOTE: "Note",
  BDAY: "Birthday",
  ADR: "Address",
  URL: "Website",
  NICKNAME: "Nickname",
  ORG: "Organisation",
};

/**
 * Text that is not a URL but that most phone cameras will TREAT as one.
 *
 * `example.com/menu` fails `new URL()` and is still a link the moment a scanner
 * prepends `https://`, which the iOS and Android cameras both do. Saying "plain
 * text" about it would be true of the payload and wrong about the consequence.
 */
export function looksLikeBareHost(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?:[:/?#].*)?$/i.test(
    trimmed,
  );
}

function invisibleRisk(text: string): PayloadRisk | null {
  const found = text.match(INVISIBLE);
  if (!found) return null;
  const codes = [...new Set(found.map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`))];
  return {
    id: "invisible-characters",
    message: `This payload contains ${found.length} character${found.length === 1 ? "" : "s"} that take up no space on screen (${codes.join(", ")}). They are legal, and they are also how a payload is made to read as one thing and mean another — a right-to-left override can display a name backwards. The text above is shown exactly as decoded.`,
  };
}

/** Hazards derivable from a parsed http/https URL and its raw text. */
export function describeUrlRisks(url: URL, raw: string): PayloadRisk[] {
  const risks: PayloadRisk[] = [];

  if (url.username !== "") {
    risks.push({
      id: "url-credentials",
      message: `This link carries "${url.username}${url.password ? ":…" : ""}@" in front of the host, so the part that looks like the destination is a username and the real host is ${url.hostname}. That is the standard way of making a link read as one site and go to another.`,
    });
  }
  const puny = url.hostname.split(".").filter((label) => label.startsWith("xn--"));
  if (puny.length > 0) {
    risks.push({
      id: "url-punycode",
      message: `The host name is punycode: ${puny.join(", ")}. That is how a name with non-Latin letters is written in ASCII, and it is also how a lookalike domain is built — Cyrillic а and Latin a are different characters that draw the same.`,
    });
  }
  if (url.port !== "") {
    risks.push({
      id: "url-port",
      message: `This link names a non-default port (${url.port}). Nothing is wrong with that, but a normal web address does not usually need one.`,
    });
  }
  if (url.protocol === "http:") {
    risks.push({
      id: "url-insecure",
      message: "This is http, not https, so anything typed into the page it opens travels unencrypted.",
    });
  }
  const invisible = invisibleRisk(raw);
  if (invisible) risks.push(invisible);
  return risks;
}

function urlFields(url: URL): PayloadField[] {
  const fields: PayloadField[] = [
    { label: "Scheme", value: url.protocol.replace(":", "") },
    { label: "Host", value: url.hostname },
  ];
  if (url.port !== "") fields.push({ label: "Port", value: url.port });
  if (url.pathname !== "" && url.pathname !== "/") fields.push({ label: "Path", value: url.pathname });
  for (const [key, value] of url.searchParams) {
    fields.push({ label: `Query · ${key}`, value });
  }
  if (url.hash !== "") fields.push({ label: "Fragment", value: url.hash.slice(1) });
  return fields;
}

function tryUrl(text: string): URL | null {
  try {
    return new URL(text.trim());
  } catch {
    return null;
  }
}

/**
 * `decodeURIComponent` over one component of a payload, which may not be
 * allowed to take down the scan.
 *
 * `new URL()` happily accepts an opaque path containing a bare per-cent sign,
 * and real payloads carry them: `mailto:100%discount@example.com` is a
 * marketing address, `geo:%E0%A4` is a truncated escape, and `sms:%` is a typo
 * somebody still printed on a poster. `decodeURIComponent` throws `URIError:
 * URI malformed` on every one of those. Until this existed, that URIError left
 * `classifyPayload` and travelled all the way out through `toSymbols` and
 * `decodeImageCodes` to the page's only catch, which rendered it as the error
 * for the whole image: "URI malformed", no CODES FOUND, no payload, no
 * download — for a symbol the engine had read perfectly. If the picture held
 * five codes and only the third had the stray per-cent, all five were lost.
 *
 * The raw text was already read successfully, so the failure mode of a
 * PRETTIFIER can only ever be "show the raw text", never "this image has no
 * code in it". On a malformed escape the component is returned exactly as
 * written and `decoded` is false, so the caller can say so on the page rather
 * than pretending the decode was clean.
 */
export function safeDecodeComponent(component: string): { value: string; decoded: boolean } {
  try {
    return { value: decodeURIComponent(component), decoded: true };
  } catch {
    return { value: component, decoded: false };
  }
}

/** The note that discloses a `safeDecodeComponent` fallback, or null. */
function undecodedNote(decoded: boolean, what: string): string | null {
  if (decoded) return null;
  return `The ${what} in this payload contains a per-cent sign that is not a valid %XX escape, so it is shown exactly as it was written rather than decoded. The raw text below is unchanged either way.`;
}

/**
 * What this payload is, what is in it, and what is worth knowing about it.
 *
 * Every branch is driven off the text — nothing here is a guess dressed as a
 * fact, and `kind: "text"` with no fields is a perfectly ordinary answer.
 */
export function classifyPayload(text: string): Payload {
  const notes: string[] = [];
  const risks: PayloadRisk[] = [];

  const wifi = parseWifiPayload(text);
  if (wifi) {
    const fields: PayloadField[] = [
      { label: "Network (SSID)", value: wifi.ssid === "" ? "(empty)" : wifi.ssid },
      { label: "Security", value: securityLabel(wifi.security) },
      { label: "Password", value: wifi.password === "" ? "(none)" : wifi.password },
      { label: "Hidden network", value: wifi.hidden ? "yes" : "no" },
    ];
    if (wifi.password !== "") {
      risks.push({
        id: "wifi-password",
        message: `The Wi-Fi password is stored in this code as plain text and is printed above, in full. A code like this one is readable by anyone who can photograph it, so treat the square itself as the password.`,
      });
    }
    if (wifi.quoted) {
      notes.push(
        "A value in this payload was double-quoted, which the format uses to say the characters are literal text rather than the hex spelling of bytes. The quotes are not part of the value.",
      );
    }
    const eapKeys = wifi.extraKeys.filter((key) => WIFI_EAP_KEYS.has(key));
    const strayKeys = wifi.extraKeys.filter((key) => !WIFI_EAP_KEYS.has(key));
    if (eapKeys.length > 0) {
      notes.push(
        `This payload also carries ${eapKeys.length} WPA2-Enterprise field${eapKeys.length === 1 ? "" : "s"} this page does not interpret (${eapKeys.join(", ")}). They are in the raw text above.`,
      );
    }
    if (strayKeys.length > 0) {
      risks.push({
        id: "wifi-unescaped",
        message: `This payload contains ${strayKeys.length} field key the format does not define (${strayKeys.map((key) => `"${key}"`).join(", ")}). The usual cause is a semicolon inside the network name or the password that was never backslash-escaped: an unescaped ";" ends the field, so a network called "Cafe; Bar" encodes as a perfectly scannable code for a network called "Cafe". The name shown above may therefore be a truncated one — compare it against the raw text.`,
      });
    }
    const invisible = invisibleRisk(text);
    if (invisible) risks.push(invisible);
    return { kind: "wifi", label: "Wi-Fi network", fields, risks, notes };
  }

  const vcard = parseVCard(text);
  if (vcard) {
    const fields: PayloadField[] = [];
    let unlabelled = 0;
    for (const property of vcard.properties) {
      const label = VCARD_LABEL[property.name];
      if (!label) {
        unlabelled++;
        continue;
      }
      const value =
        property.name === "N"
          ? joinStructuredName(property.value)
          : property.name === "ADR"
            ? joinAddress(property.value)
            : property.value;
      if (value.trim() === "") continue;
      const type = property.params.find((p) => /^TYPE=/i.test(p))?.slice(5);
      fields.push({ label: type ? `${label} (${type.toLowerCase()})` : label, value });
    }
    if (unlabelled > 0) {
      notes.push(
        `${unlabelled} further vCard propert${unlabelled === 1 ? "y is" : "ies are"} in this card and not shown above — photos, revision stamps and vendor X- extensions. All of them are in the raw text.`,
      );
    }
    if (vcard.quotedPrintable > 0) {
      notes.push(
        `${vcard.quotedPrintable} propert${vcard.quotedPrintable === 1 ? "y was" : "ies were"} quoted-printable encoded and ${vcard.quotedPrintable === 1 ? "has" : "have"} been decoded here; the raw text below still shows the =XX escapes.`,
      );
    }
    if (vcard.foreignCharsets.length > 0) {
      notes.push(
        `This card declares CHARSET=${vcard.foreignCharsets.join(", ")}. The bytes were read as UTF-8 regardless, because a QR code carries no encoding of its own beyond what the card claims, so accented characters may be wrong.`,
      );
    }
    const invisible = invisibleRisk(text);
    if (invisible) risks.push(invisible);
    return { kind: "vcard", label: "Contact card (vCard)", fields, risks, notes };
  }

  const mecard = parseMeCard(text);
  if (mecard) {
    const fields: PayloadField[] = [];
    const unknown: string[] = [];
    for (const [key, value] of mecard) {
      if (value.trim() === "") continue;
      const label = MECARD_LABEL[key];
      if (label) fields.push({ label, value: key === "N" ? value.split(",").reverse().join(" ").trim() : value });
      else unknown.push(key);
    }
    if (unknown.length > 0) {
      notes.push(`${unknown.length} MECARD field${unknown.length === 1 ? "" : "s"} were not recognised (${unknown.join(", ")}).`);
    }
    const invisible = invisibleRisk(text);
    if (invisible) risks.push(invisible);
    return { kind: "mecard", label: "Contact card (MECARD)", fields, risks, notes };
  }

  if (/^\s*BEGIN:(VCALENDAR|VEVENT)/i.test(text)) {
    const fields: PayloadField[] = [];
    for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const name = line.slice(0, colon).split(";")[0].toUpperCase();
      const label = { SUMMARY: "Event", DTSTART: "Starts", DTEND: "Ends", LOCATION: "Location", DESCRIPTION: "Description" }[
        name
      ];
      if (label) fields.push({ label, value: unescapeVCardValue(line.slice(colon + 1)) });
    }
    notes.push(
      "Calendar times are shown exactly as written in the payload. A trailing Z means UTC; without one, the time is in whatever zone the event was created in, and this page does not convert it.",
    );
    const invisible = invisibleRisk(text);
    if (invisible) risks.push(invisible);
    return { kind: "calendar", label: "Calendar event", fields, risks, notes };
  }

  const url = tryUrl(text);
  if (url) {
    if (url.protocol === "http:" || url.protocol === "https:") {
      return {
        kind: "url",
        label: "Web link",
        fields: urlFields(url),
        risks: describeUrlRisks(url, text),
        notes,
      };
    }
    if (url.protocol === "mailto:") {
      // The site the whole `safeDecodeComponent` guard was written for, and
      // the last one still calling `decodeURIComponent` bare: `%` is legal in
      // a local part, so `mailto:100%discount@example.com` threw `URIError:
      // URI malformed` here. Originally that took down the whole image;
      // `describePayload`'s catch had since narrowed it to a quieter wrong
      // answer — the address fell through to "Plain text" with no To field and
      // the note "could not be broken into labelled fields (URI malformed)",
      // telling the reader a perfectly good email code was unparseable. The
      // catch is the backstop; decoding safely here is the actual answer.
      const address = safeDecodeComponent(url.pathname);
      const note = undecodedNote(address.decoded, "address");
      if (note) notes.push(note);
      const fields: PayloadField[] = [{ label: "To", value: address.value }];
      for (const [key, value] of url.searchParams) fields.push({ label: key, value });
      const invisible = invisibleRisk(text);
      if (invisible) risks.push(invisible);
      return { kind: "email", label: "Email address", fields, risks, notes };
    }
    if (url.protocol === "tel:") {
      const number = safeDecodeComponent(url.pathname);
      const note = undecodedNote(number.decoded, "number");
      if (note) notes.push(note);
      const invisible = invisibleRisk(text);
      if (invisible) risks.push(invisible);
      return {
        kind: "tel",
        label: "Phone number",
        fields: [{ label: "Number", value: number.value }],
        risks,
        notes,
      };
    }
    if (url.protocol === "sms:" || url.protocol === "smsto:") {
      // `SMSTO:` puts the message after a second colon; `sms:` puts it in ?body=.
      const path = safeDecodeComponent(url.pathname);
      const note = undecodedNote(path.decoded, "number");
      if (note) notes.push(note);
      const [number, ...rest] = path.value.split(":");
      const fields: PayloadField[] = [{ label: "Number", value: number }];
      const body = rest.join(":") || url.searchParams.get("body") || "";
      if (body !== "") fields.push({ label: "Message", value: body });
      const invisible = invisibleRisk(text);
      if (invisible) risks.push(invisible);
      return { kind: "sms", label: "Text message", fields, risks, notes };
    }
    if (url.protocol === "geo:") {
      const path = safeDecodeComponent(url.pathname);
      const note = undecodedNote(path.decoded, "coordinates");
      if (note) notes.push(note);
      const [coords = "", ...params] = path.value.split(";");
      const [lat = "", lon = "", alt] = coords.split(",");
      const fields: PayloadField[] = [
        { label: "Latitude", value: lat },
        { label: "Longitude", value: lon },
      ];
      if (alt) fields.push({ label: "Altitude", value: alt });
      for (const param of params) if (param !== "") fields.push({ label: "Parameter", value: param });
      const query = url.searchParams.get("q");
      if (query) fields.push({ label: "Query", value: query });
      const invisible = invisibleRisk(text);
      if (invisible) risks.push(invisible);
      return { kind: "geo", label: "Map location", fields, risks, notes };
    }
    if (url.protocol === "otpauth:") {
      const account = safeDecodeComponent(url.pathname.replace(/^\//, ""));
      const note = undecodedNote(account.decoded, "account label");
      if (note) notes.push(note);
      const fields: PayloadField[] = [
        { label: "Type", value: url.hostname },
        { label: "Account", value: account.value },
      ];
      for (const [key, value] of url.searchParams) {
        fields.push({ label: key, value: key.toLowerCase() === "secret" ? "(hidden — see the raw text)" : value });
      }
      risks.push({
        id: "otp-secret",
        message:
          "This is a two-factor enrolment code. Its secret= parameter is the shared key for every future six-digit code, so anyone who reads this square can generate them forever. The secret is masked in the fields above and is still present, in full, in the raw text.",
      });
      const invisible = invisibleRisk(text);
      if (invisible) risks.push(invisible);
      return { kind: "otpauth", label: "Two-factor enrolment", fields, risks, notes };
    }

    const active = ACTIVE_SCHEMES[url.protocol];
    if (active) {
      risks.push({
        id: "active-scheme",
        message: `This payload is a ${url.protocol} URI, which ${active}. It is printed as text here and this page will not open it.`,
      });
    }
    const invisible = invisibleRisk(text);
    if (invisible) risks.push(invisible);
    return {
      kind: "scheme",
      label: `${url.protocol.replace(":", "")} URI`,
      fields: [{ label: "Scheme", value: url.protocol.replace(":", "") }],
      risks,
      notes,
    };
  }

  if (looksLikeBareHost(text)) {
    risks.push({
      id: "bare-host",
      message: `This payload has no scheme, so it is not strictly a link — but "${text.trim()}" is shaped like a host name, and phone cameras add https:// and offer to open it. Read it as a link.`,
    });
  }
  const invisible = invisibleRisk(text);
  if (invisible) risks.push(invisible);
  return { kind: "text", label: "Plain text", fields: [], risks, notes };
}

/* ───────────────────── images that hold more than one frame ───────────────────── */

/**
 * What the sniff found. `frames` is the real count for a GIF and null for a
 * WebP, whose container declares that it animates without putting a frame
 * count anywhere cheap to read — so the WebP sentence does not quote one
 * rather than quoting a guess.
 */
export interface AnimationInfo {
  format: "GIF" | "WebP";
  frames: number | null;
}

/**
 * Walk every image descriptor rather than stopping at two: `countGifFrames`
 * caps by default because its other callers only need "more than one", and a
 * capped count printed as a frame count would be a lie about a 30-frame GIF.
 */
const ALL_FRAMES = Number.POSITIVE_INFINITY;

/**
 * Is this an animated image, and how many frames does it have?
 *
 * Pure, over the encoded bytes. The sniffing itself is `image-frames.ts`,
 * which the conversion pipelines already use for their "only the first frame
 * was kept" notices — the same magic-number walk, reused rather than rewritten,
 * so a GIF that warns on /gif-to-png cannot fail to warn here.
 */
export function detectAnimation(bytes: Uint8Array): AnimationInfo | null {
  if (isAnimatedWebp(bytes)) return { format: "WebP", frames: null };
  const frames = countGifFrames(bytes, ALL_FRAMES);
  return frames >= 2 ? { format: "GIF", frames } : null;
}

/**
 * The same sniff over a dropped file, reading the whole buffer only when the
 * first 16 bytes carry a GIF or RIFF/WEBP magic — a 20 MB still JPEG is never
 * read past its prefix. Magic bytes decide, not the name: an animated GIF
 * saved as `ticket.png` still has to warn.
 *
 * Never throws. A file that cannot be read here is one the decoder is about to
 * fail on anyway, and losing a scan to a failed *disclosure* would be the same
 * mistake `toSymbols` guards against.
 */
export async function sniffAnimation(file: Blob): Promise<AnimationInfo | null> {
  try {
    const prefix = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const magic = (offset: number, tag: string) =>
      [...tag].every((char, i) => prefix[offset + i] === char.charCodeAt(0));
    const looksAnimatable =
      magic(0, "GIF87a") || magic(0, "GIF89a") || (magic(0, "RIFF") && magic(8, "WEBP"));
    if (!looksAnimatable) return null;
    return detectAnimation(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * The sentence that discloses the frames that were not scanned.
 *
 * `createImageBitmap` returns an animation's DEFAULT IMAGE — frame one — and
 * this page accepts .gif and .webp and says so on the drop zone. Before this
 * existed, an animated ticket whose code appears after a title card scanned to
 * nothing and the page named four causes, all of them wrong, while the real
 * one was never offered.
 */
export function describeAnimation(animation: AnimationInfo): string {
  const opening =
    animation.frames !== null && animation.frames >= 2
      ? `This is an animated ${animation.format} of ${animation.frames} frames, and the browser decoded only the first of them`
      : `This is an animated ${animation.format}, and the browser decoded only its first frame`;
  return `${opening} — that one frame is all that was scanned. A code appearing anywhere later in the animation is not in the pixels searched here, so save the frame the code is on and scan that instead.`;
}

/* ─────────────────────────── the engine wiring ─────────────────────────── */

/** Which symbologies to search for. The choice is worth real seconds — see below. */
export type ScanScope = "qr" | "all";

/**
 * `formats` for each scope.
 *
 * MEASURED on a synthetic 12.2-megapixel photo (4032 × 3024) with one small QR
 * code in it, five runs, median, Node 24 on Apple silicon:
 *
 *     QR only          193 ms
 *     every format   2 890 ms
 *
 * and at 3.0 megapixels, 34 ms against 506 ms. The cost is not the QR search;
 * it is the other forty-odd symbologies, several of which sweep the image line
 * by line. That 15x is why this page defaults to QR and says what the other
 * setting costs, rather than quietly searching for Codabar in your photo of a
 * poster. The elapsed time of the actual run is reported on screen, so nobody
 * has to take the numbers above on trust.
 */
const SCOPE_FORMATS: Record<ScanScope, string[]> = {
  qr: ["QRCode", "MicroQRCode", "RMQRCode"],
  all: [],
};

export interface ScanOptions {
  scope?: ScanScope;
  /** zxing's morphological-closing pass. Helps a blurred photo, costs time. */
  denoise?: boolean;
}

export interface DecodedSymbol {
  /** 1-based, in the order zxing returned them. */
  index: number;
  /** The decoded payload, exactly as decoded. Never linkified. */
  text: string;
  /** Human format name, e.g. "QR Code", "Data Matrix", "EAN-13". */
  format: string;
  /** zxing's own content classification: Text, Binary, GS1, ISO15434… */
  contentType: string;
  /** Bytes in the symbol before any text decoding. */
  byteLength: number;
  /** Error-correction level, where the symbology has one. */
  ecLevel: string;
  /** Degrees; a code photographed sideways reads with a non-zero value. */
  orientation: number;
  mirrored: boolean;
  /** The symbol was light-on-dark and had to be inverted to read. */
  inverted: boolean;
  /** Part `index` of `size` in a structured-append sequence, or null. */
  sequence: { index: number; size: number } | null;
  payload: Payload;
}

export interface ScanResult {
  symbols: DecodedSymbol[];
  /** Pixel size of the image as the browser decoded it. */
  sourceWidth: number;
  sourceHeight: number;
  /** Pixel size actually scanned — smaller only when the canvas cap bit. */
  scannedWidth: number;
  scannedHeight: number;
  /** Wall-clock time inside the engine, milliseconds, this run. */
  elapsedMs: number;
  scope: ScanScope;
  /** Whether THIS run used the denoising pass, so the read-outs need not guess. */
  denoised: boolean;
  /**
   * Set when the dropped file is a multi-frame image, of which exactly one
   * frame was scanned. Null for a still image and for anything that cannot
   * animate.
   */
  animation: AnimationInfo | null;
}

/** The subset of zxing's `ReadResult` this page reads. */
export interface RawReadResult {
  isValid: boolean;
  error: string;
  format: string;
  text: string;
  bytes: Uint8Array;
  contentType: string;
  ecLevel: string;
  orientation: number;
  isMirrored: boolean;
  isInverted: boolean;
  sequenceSize: number;
  sequenceIndex: number;
}

interface ZxingReader {
  readBarcodes: (input: ImageData, options: Record<string, unknown>) => Promise<RawReadResult[]>;
  formatToLabel: (format: string) => string | undefined;
}

/**
 * Turn zxing's raw results into the symbols the page counts.
 *
 * The filter is the load-bearing line. An image zxing cannot decode at all
 * does NOT come back as an empty array — it comes back as ONE entry with
 * `isValid: false`, an empty `format` and `error: "Failed to load image from
 * memory"` (verified against the 3.1.3 reader build). Passing that through
 * would make every unreadable file report "1 code found" and then print an
 * empty payload, which is the worst of both answers. Dropping it here is what
 * makes `symbols.length` on the page mean what it says.
 *
 * The try/catch around `classifyPayload` is the second load-bearing line, and
 * it is here because the first version of this file did not have it. A bare
 * per-cent sign in a `mailto:` threw out of `decodeURIComponent`, out of
 * `classifyPayload`, out of this loop and out of `decodeImageCodes`, and the
 * page reported the whole image as unscannable — including the four other
 * codes in it that had already been read. `safeDecodeComponent` fixes that
 * particular throw at source; this catch is the rule the throw broke. The
 * describing half may not cost the reading half its results, so a payload that
 * cannot be broken into fields is shown as the plain text it already is, with
 * the reason named.
 */
/**
 * `classifyPayload`, but a thrown describer degrades to the raw text.
 *
 * `classify` is injectable for one reason: a catch nothing can enter is a
 * comment, not a guard. The seam lets the test throw from the describer on
 * purpose and assert the symbol survives — which is the whole rule this
 * function exists to enforce.
 */
export function describePayload(
  text: string,
  classify: (payload: string) => Payload = classifyPayload,
): Payload {
  try {
    return classify(text);
  } catch (error) {
    return {
      kind: "text",
      label: "Plain text",
      fields: [],
      risks: [],
      notes: [
        `This payload could not be broken into labelled fields (${error instanceof Error ? error.message : String(error)}), so it is shown as plain text. The symbol itself was read without error and the payload above is exactly what it holds.`,
      ],
    };
  }
}

export function toSymbols(
  results: readonly RawReadResult[],
  formatToLabel: (format: string) => string | undefined,
): DecodedSymbol[] {
  const symbols: DecodedSymbol[] = [];
  for (const result of results) {
    if (!result.isValid || result.format === "" || result.format === "None") continue;
    symbols.push({
      index: symbols.length + 1,
      text: result.text,
      format: formatToLabel(result.format) ?? result.format,
      contentType: result.contentType,
      byteLength: result.bytes.length,
      ecLevel: result.ecLevel,
      orientation: result.orientation,
      mirrored: result.isMirrored,
      inverted: result.isInverted,
      sequence:
        result.sequenceSize > 0
          ? { index: result.sequenceIndex + 1, size: result.sequenceSize }
          : null,
      payload: describePayload(result.text),
    });
  }
  return symbols;
}

let readerPromise: Promise<ZxingReader> | null = null;

/**
 * Load the engine, once, from this origin.
 *
 * `prepareZXingModule` caches the module against the overrides object by
 * shallow equality, and `readBarcodes` then re-reads whatever overrides were
 * cached last. That is exactly why this is memoised rather than called per
 * scan: a second call with a freshly-fetched `wasmBinary` would fail the
 * equality check and instantiate a second 1.0 MB module. A failed load clears
 * the memo so a retry can actually retry.
 */
export async function loadQrReader(): Promise<ZxingReader> {
  if (!readerPromise) {
    readerPromise = (async (): Promise<ZxingReader> => {
      const [module, response] = await Promise.all([
        import("zxing-wasm/reader"),
        fetch(ZXING_WASM_URL),
      ]);
      if (!response.ok) {
        throw new Error(
          `The barcode engine could not be loaded from this site (${response.status} on ${ZXING_WASM_URL}).`,
        );
      }
      const wasmBinary = await response.arrayBuffer();
      await module.prepareZXingModule({
        overrides: {
          wasmBinary,
          // Belt and braces: with `wasmBinary` set the glue never fetches, but
          // the default `locateFile` would still BUILD a jsDelivr URL on the
          // way past. Overridden, no foreign URL exists to be used by mistake.
          locateFile: () => ZXING_WASM_URL,
        },
        fireImmediately: true,
      });
      return {
        readBarcodes: module.readBarcodes as unknown as ZxingReader["readBarcodes"],
        formatToLabel: module.formatToLabel,
      };
    })().catch((error: unknown) => {
      readerPromise = null;
      throw error;
    });
  }
  return readerPromise;
}

/**
 * Paint the image onto a canvas and read the pixels back.
 *
 * The browser's own decoder is used rather than the one compiled into the wasm
 * (zxing bundles stb_image, which handles PNG, JPEG, GIF and BMP and NOT WebP).
 * Going through a canvas means every format the browser can display works, and
 * it is also the only way to learn the real pixel dimensions, which is what the
 * downscale disclosure is derived from.
 */
async function toImageData(file: Blob): Promise<{
  data: ImageData;
  sourceWidth: number;
  sourceHeight: number;
}> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "This browser could not decode that image. A file with an image extension but another format inside it fails here, and so does an SVG, which has no fixed pixel size to scan.",
    );
  }
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const pixels = sourceWidth * sourceHeight;
  const scale = pixels > MAX_SCAN_PIXELS ? Math.sqrt(MAX_SCAN_PIXELS / pixels) : 1;
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("This browser would not give the page a 2D canvas, which is what reads the pixels.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { data: context.getImageData(0, 0, width, height), sourceWidth, sourceHeight };
}

/** Read every code in one image. Throws only when the image itself is unreadable. */
export async function decodeImageCodes(file: Blob, options: ScanOptions = {}): Promise<ScanResult> {
  const scope = options.scope ?? "qr";
  const denoised = options.denoise ?? false;
  const [reader, image, animation] = await Promise.all([
    loadQrReader(),
    toImageData(file),
    sniffAnimation(file),
  ]);

  const started = performance.now();
  const results = await reader.readBarcodes(image.data, {
    formats: SCOPE_FORMATS[scope],
    // 0 removes the cap entirely; the default of 255 would also be plenty, but
    // an explicit "no limit" is what the multi-symbol claim on the page rests on.
    maxNumberOfSymbols: 0,
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDenoise: denoised,
    returnErrors: false,
  });
  const elapsedMs = performance.now() - started;

  return {
    symbols: toSymbols(results, reader.formatToLabel),
    sourceWidth: image.sourceWidth,
    sourceHeight: image.sourceHeight,
    scannedWidth: image.data.width,
    scannedHeight: image.data.height,
    elapsedMs,
    scope,
    denoised,
    animation,
  };
}

/* ────────────────────────────── read-outs ────────────────────────────── */

/** The one-line answer, derived from the run rather than asserted. */
export function summariseScan(result: ScanResult): string {
  const count = result.symbols.length;
  const formats = [...new Set(result.symbols.map((s) => s.format))];
  const scaled = result.scannedWidth !== result.sourceWidth;
  const size = scaled
    ? `${result.sourceWidth} × ${result.sourceHeight}, scanned at ${result.scannedWidth} × ${result.scannedHeight}`
    : `${result.sourceWidth} × ${result.sourceHeight}`;

  if (count === 0) {
    return `No code was found in this ${size} image after ${formatElapsed(result.elapsedMs)}.`;
  }
  return `${count} code${count === 1 ? "" : "s"} found in this ${size} image in ${formatElapsed(result.elapsedMs)} — ${formats.join(", ")}.`;
}

/**
 * What to say when the engine found nothing — every clause derived from THIS
 * run, and ordered by how likely each cause is for THIS file.
 *
 * It lives here rather than inline in the component for two reasons. The
 * component was building it from its own `scope`/`denoise` state rather than
 * from the result, which is the state a re-scan has already moved on from; and
 * the animated-image clause has to come FIRST when it applies. A page that
 * lists four causes, all of them wrong, while the real one is "only frame one
 * of your animation was scanned" sends the reader to re-run the same failure
 * with denoising turned on.
 */
export function describeEmptyScan(result: ScanResult): string {
  const searched =
    result.scope === "qr" ? "QR, Micro QR and rMQR codes" : "every symbology zxing reads";
  const clauses = [
    `Nothing was found in this ${result.scannedWidth} × ${result.scannedHeight} image after ${formatElapsed(result.elapsedMs)} of searching for ${searched}.`,
  ];
  if (result.animation) clauses.push(describeAnimation(result.animation));
  if (result.scope === "qr") {
    clauses.push(
      "If the code is a striped barcode rather than a square, switch SCAN FOR to Every format.",
    );
  }
  if (!result.denoised) {
    clauses.push("If the photo is blurred or shot at an angle, turn on the extra denoising pass.");
  }
  clauses.push(
    "Otherwise the usual causes are a code cropped at the edge, no white margin around it, or a photo of a screen where the pixel grid has beaten against the camera's.",
  );
  return clauses.join(" ");
}

/** Milliseconds under a second, seconds above it. Never "0 s" for real work. */
export function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The parts of a structured-append sequence present in this image, and whether
 * the set is complete. A QR payload too long for one symbol is split across
 * several, and reading three of four is a different result from reading three.
 */
export function describeSequences(symbols: readonly DecodedSymbol[]): string[] {
  const bySize = new Map<number, Set<number>>();
  for (const symbol of symbols) {
    if (!symbol.sequence) continue;
    const seen = bySize.get(symbol.sequence.size) ?? new Set<number>();
    seen.add(symbol.sequence.index);
    bySize.set(symbol.sequence.size, seen);
  }
  const out: string[] = [];
  for (const [size, seen] of bySize) {
    const missing: number[] = [];
    for (let part = 1; part <= size; part++) if (!seen.has(part)) missing.push(part);
    out.push(
      missing.length === 0
        ? `All ${size} parts of a structured-append sequence are here. Joining them in order gives the original payload; this page does not join them for you.`
        : `This image holds ${seen.size} of the ${size} parts of a structured-append sequence — part${missing.length === 1 ? "" : "s"} ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing, so what you see is a fragment of the real payload.`,
    );
  }
  return out;
}

/** One .txt of everything read, in symbol order, for the download. */
export function scanToText(result: ScanResult): string {
  if (result.symbols.length === 0) return "";
  return result.symbols
    .map((symbol) => `# ${symbol.index}. ${symbol.format} · ${symbol.payload.label}\n${symbol.text}`)
    .join("\n\n");
}
