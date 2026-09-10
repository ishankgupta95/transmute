/**
 * URL decomposition — the WHATWG `URL` parser, plus the parts it normalises
 * away without telling you.
 *
 * Pure functions over strings. No DOM, no dependency, and nothing is fetched:
 * a URL is text here, and parsing it never touches the network.
 *
 * ── What `new URL()` quietly changes ────────────────────────────────────────
 *
 * The browser's parser is not a splitter, it is a normaliser. Handed
 * `HTTP://Example.COM:80/a/../b?x=1`, it returns `http://example.com/b?x=1`:
 * the scheme and host lower-cased, the default port dropped, the dot segments
 * resolved. Handed `https://münchen.de` it returns `https://xn--mnchen-3ya.de`,
 * because that is what goes on the wire — the Unicode spelling exists only in
 * the address bar. Every one of those is correct and every one of them means
 * the string you get back is not the string you typed, so `parseUrl` reports
 * `normalised` and `punycode` rather than presenting the result as your input.
 *
 * ── Percent-encoding ────────────────────────────────────────────────────────
 *
 * Query values are shown raw AND decoded, because the difference is usually
 * the bug. A value that still contains a `%XX` sequence AFTER one decode was
 * encoded twice — the classic redirect-parameter mistake — and that is flagged
 * per value rather than left for the reader to spot.
 *
 * ── Punycode ────────────────────────────────────────────────────────────────
 *
 * There is no built-in Punycode decoder in the browser (`URL` only ever
 * encodes), so RFC 3492's decoder is implemented below. It is ~40 lines and
 * exact; the alternative was to show the `xn--` form alone and call it the
 * hostname, which hides exactly the homograph the user came to look at.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface UrlParts {
  href: string;
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  host: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
}

export interface QueryParam {
  /** Decoded key. Repeats are kept as separate entries, in source order. */
  key: string;
  /** Decoded value. Empty string for `?flag` and for `?flag=`. */
  value: string;
  /** Exactly as it appears between the `?` and the `&`, before decoding. */
  rawKey: string;
  rawValue: string;
  /** The decoded value still holds a `%XX` sequence: it was encoded twice. */
  doubleEncoded: boolean;
  /** The raw text is not valid percent-encoding, so it is shown undecoded. */
  malformed: boolean;
  /** `?flag` with no `=` at all — distinct from `?flag=`. */
  valueless: boolean;
}

export interface HostForms {
  /** What `new URL` produced, and what a DNS lookup will use. */
  ascii: string;
  /** The same host with every `xn--` label decoded back to Unicode. */
  unicode: string;
  /** True when the two differ — i.e. this is an internationalised name. */
  differs: boolean;
}

export type UrlParseResult =
  | {
      ok: true;
      parts: UrlParts;
      params: QueryParam[];
      host: HostForms;
      /** Path split on "/", each segment percent-decoded. Empty for "/". */
      pathSegments: string[];
      /** A base URL was needed and used to resolve a relative reference. */
      usedBase: boolean;
      /** `href` differs from the text that was typed. */
      normalised: boolean;
      /** A username or password is embedded in the URL. */
      hasCredentials: boolean;
      /**
       * True for a scheme with no `//` authority — `mailto:`, `tel:`, `data:`.
       * Their `origin` is the literal string "null" and their whole payload
       * sits in `pathname`, which is worth saying out loud.
       */
      opaquePath: boolean;
    }
  | {
      ok: false;
      /** Plain-English reason, specific wherever the input allows one. */
      reason: string;
      /** A base URL would fix it, so the UI should point at that field. */
      needsBase: boolean;
    };

/* ── Punycode (RFC 3492) ──────────────────────────────────────────────────── */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function basicToDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26; // 0-9
  if (code >= 0x61 && code <= 0x7a) return code - 0x61; // a-z
  if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z
  return BASE;
}

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/**
 * Decode one Punycode string — the part AFTER the `xn--` prefix.
 *
 * Throws on malformed input rather than returning something plausible; the
 * caller keeps the original label when that happens, so a broken `xn--` label
 * is shown exactly as it arrived instead of as a guess.
 */
export function punycodeDecode(input: string): string {
  const output: number[] = [];
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;

  const lastDelim = input.lastIndexOf("-");
  if (lastDelim > 0) {
    for (let j = 0; j < lastDelim; j++) {
      const c = input.charCodeAt(j);
      if (c >= 0x80) throw new Error("non-basic code point");
      output.push(c);
    }
  }

  let index = lastDelim > 0 ? lastDelim + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error("truncated");
      const digit = basicToDigit(input.charCodeAt(index++));
      if (digit >= BASE) throw new Error("bad digit");
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (w > 0x7fffffff) throw new Error("overflow");
    }
    const out = output.length + 1;
    bias = adapt(i - oldi, out, oldi === 0);
    n += Math.floor(i / out);
    i %= out;
    if (n > 0x10ffff) throw new Error("overflow");
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** Every `xn--` label in a host decoded; anything else passed straight through. */
export function toUnicodeHost(host: string): string {
  if (!host || !/xn--/i.test(host)) return host;
  return host
    .split(".")
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      try {
        return punycodeDecode(label.slice(4));
      } catch {
        return label;
      }
    })
    .join(".");
}

/* ── Percent-decoding ─────────────────────────────────────────────────────── */

/**
 * `URLSearchParams`-compatible decode: `+` is a space, then percent-decoding.
 *
 * Returns the raw text unchanged and `malformed: true` for a sequence
 * `decodeURIComponent` refuses (`%`, `%zz`, a lone surrogate byte), rather
 * than throwing or silently dropping the parameter.
 */
export function decodeQueryComponent(raw: string): { value: string; malformed: boolean } {
  try {
    return { value: decodeURIComponent(raw.replace(/\+/g, "%20")), malformed: false };
  } catch {
    return { value: raw, malformed: true };
  }
}

/** Decode a path segment. `+` is NOT a space in a path — only in a query. */
function decodePathSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** A decoded value that still carries a percent sequence was encoded twice. */
function looksDoubleEncoded(decoded: string): boolean {
  return /%[0-9a-f]{2}/i.test(decoded);
}

/* ── Query parsing ────────────────────────────────────────────────────────── */

/**
 * The query string as an ordered list, repeats intact.
 *
 * `URLSearchParams` is the reference for the DECODING rules, and this walks
 * the raw string itself for the same pairs so both forms are available. It
 * matches `URLSearchParams` on the awkward cases: a leading `?` is ignored, an
 * empty pair (`?a=1&&b=2`) is skipped entirely, and a pair with no `=` yields
 * an empty value.
 *
 * Repeats are NOT collapsed. `?tag=a&tag=b` is two rows, because a server that
 * reads only the first and a server that reads only the last will disagree
 * about this URL, and a table showing one row hides that.
 */
export function parseQuery(search: string): QueryParam[] {
  const body = search.startsWith("?") ? search.slice(1) : search;
  if (!body) return [];
  const out: QueryParam[] = [];
  for (const pair of body.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    const key = decodeQueryComponent(rawKey);
    const value = decodeQueryComponent(rawValue);
    out.push({
      key: key.value,
      value: value.value,
      rawKey,
      rawValue,
      doubleEncoded: !value.malformed && rawValue.length > 0 && looksDoubleEncoded(value.value),
      malformed: key.malformed || value.malformed,
      valueless: eq === -1,
    });
  }
  return out;
}

/**
 * Rebuild a URL with an edited parameter list.
 *
 * Encoding is `URLSearchParams`', not a byte-for-byte replay of what came in:
 * a space comes back as `+`, and a character the original left literal may be
 * escaped. The result is an equivalent URL, not the same string, and the UI
 * says so wherever it offers this.
 */
export function rebuildWithParams(
  href: string,
  params: readonly { key: string; value: string; valueless?: boolean }[],
): string {
  const url = new URL(href);
  const kept = params.filter((p) => p.key !== "" || p.value !== "");
  if (kept.length === 0) {
    url.search = "";
    return url.href;
  }
  const search = new URLSearchParams();
  for (const p of kept) search.append(p.key, p.value);
  url.search = search.toString();
  return url.href;
}

/* ── Failure classification ───────────────────────────────────────────────── */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Why `new URL` said no, in words, with the fix where there is one.
 *
 * The engine's own message is "Invalid URL" in every browser and says nothing,
 * so the common shapes are recognised here first and the engine's text is only
 * the fallback.
 */
function classifyFailure(
  input: string,
  engineMessage: string,
): Extract<UrlParseResult, { ok: false }> {
  const text = input.trim();

  if (!text) return { ok: false, reason: "There is nothing to parse yet.", needsBase: false };

  if (text.startsWith("//")) {
    return {
      ok: false,
      reason:
        "This is a scheme-relative reference: it starts with // and borrows its scheme from whatever page it appears on. Give a base URL below and it resolves.",
      needsBase: true,
    };
  }

  if (text.startsWith("/")) {
    return {
      ok: false,
      reason:
        "This is an absolute path, not a URL — it has no scheme and no host. Give a base URL below and it resolves against that host.",
      needsBase: true,
    };
  }

  if (!SCHEME.test(text)) {
    return {
      ok: false,
      reason:
        "No scheme. A URL has to start with something like https:// — without one this is a relative reference, so either add the scheme or give a base URL below.",
      needsBase: true,
    };
  }

  // It has a scheme, so the trouble is in the authority.
  const afterScheme = text.replace(SCHEME, "");
  if (/^\/\//.test(afterScheme)) {
    const authority = afterScheme.slice(2).split(/[/?#]/)[0];
    const hostPart = authority.includes("@")
      ? authority.slice(authority.lastIndexOf("@") + 1)
      : authority;

    if (!hostPart) {
      return { ok: false, reason: "This names a scheme but no host — there is nothing after the //.", needsBase: false };
    }
    if (/\s/.test(hostPart)) {
      return { ok: false, reason: "There is a space in the host name. Hosts cannot contain spaces.", needsBase: false };
    }
    if (hostPart.startsWith("[") && !hostPart.includes("]")) {
      return { ok: false, reason: "An IPv6 host opens with [ and never closes it.", needsBase: false };
    }
    const port = hostPart.startsWith("[")
      ? hostPart.slice(hostPart.indexOf("]") + 1).replace(/^:/, "")
      : hostPart.includes(":")
        ? hostPart.slice(hostPart.indexOf(":") + 1)
        : "";
    if (port && !/^\d+$/.test(port)) {
      return { ok: false, reason: `The port "${port}" is not a number.`, needsBase: false };
    }
    if (port && Number(port) > 65535) {
      return { ok: false, reason: `Port ${port} is above 65535, which is the highest there is.`, needsBase: false };
    }
  }

  return {
    ok: false,
    reason: `This browser's URL parser rejected it${engineMessage ? ` — ${engineMessage}` : ""}.`,
    needsBase: false,
  };
}

/* ── The parse ────────────────────────────────────────────────────────────── */

/**
 * Decompose a URL, optionally against a base.
 *
 * Nothing here is requested, resolved by DNS, or sent anywhere: `new URL` is a
 * string operation, and this module has no network access of any kind.
 */
export function parseUrl(input: string, base?: string): UrlParseResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "There is nothing to parse yet.", needsBase: false };

  const baseText = base?.trim() ?? "";
  if (baseText) {
    try {
      new URL(baseText);
    } catch {
      return {
        ok: false,
        reason: "The base URL is not a URL itself. It needs a scheme and a host, like https://example.com.",
        needsBase: true,
      };
    }
  }

  let url: URL;
  let usedBase = false;
  try {
    url = new URL(text);
  } catch (first) {
    if (!baseText) {
      return classifyFailure(text, first instanceof Error ? first.message : "");
    }
    try {
      url = new URL(text, baseText);
      usedBase = true;
    } catch (second) {
      return classifyFailure(text, second instanceof Error ? second.message : "");
    }
  }

  const parts: UrlParts = {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    host: url.host,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
  };

  const unicode = toUnicodeHost(url.hostname);
  const pathSegments = url.pathname
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodePathSegment);

  return {
    ok: true,
    parts,
    params: parseQuery(url.search),
    host: { ascii: url.hostname, unicode, differs: unicode !== url.hostname },
    pathSegments,
    usedBase,
    normalised: url.href !== text,
    hasCredentials: url.username !== "" || url.password !== "",
    // A URL with no authority never gained a "//" — `mailto:`, `tel:`, `data:`.
    opaquePath: url.hostname === "" && !url.href.startsWith(`${url.protocol}//`),
  };
}
