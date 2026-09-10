/**
 * The Wi-Fi QR payload — built, escaped and checked.
 *
 * The format is the one ZXing defined and every phone camera now implements:
 *
 *     WIFI:T:WPA;S:<ssid>;P:<password>;H:<true|false>;;
 *
 * It is a field list, not JSON, and the separators are ordinary printable
 * characters that a network name is perfectly entitled to contain. That is the
 * whole reason this module exists: an SSID of `Cafe; Bar` written straight into
 * the payload ends the S field early and hands the reader a network called
 * `Cafe` plus a junk field called ` Bar`. Escaping is not a nicety here, it is
 * the difference between a code that joins the network and one that fails in a
 * way nobody can debug from a photograph of a square.
 *
 * DOM-free on purpose: the UI imports it, and the unit tests are the real gate
 * because a rendered QR code cannot be read back under jsdom.
 */

export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface WifiConfig {
  ssid: string;
  password: string;
  security: WifiSecurity;
  /** The network does not broadcast its name; the client must be told to look. */
  hidden: boolean;
}

/**
 * The five characters that must be backslash-escaped inside S and P.
 *
 * `;` ends a field and `:` ends a key, so both are structural. `,` is reserved
 * by the MECARD grammar this borrows from. `"` is reserved because a quoted
 * value is how the format says "this is text, not hex" (see `encodeWifiField`).
 * `\` has to be escaped first-class or an SSID containing a backslash produces
 * an escape sequence the reader never sees coming — which is why this is one
 * pass over the string with a callback rather than five chained `replace`
 * calls, where escaping `;` would then have its own backslash escaped again.
 */
const RESERVED = /[\\;,:"]/g;

export function escapeWifiValue(value: string): string {
  return value.replace(RESERVED, (char) => `\\${char}`);
}

/** True for a non-empty string of nothing but hex digits. */
export function looksHexadecimal(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value);
}

/**
 * One S or P value, ready to drop into the payload.
 *
 * A value that is entirely hex digits is wrapped in double quotes, because the
 * format lets a reader treat a bare hex run as the byte-wise spelling of the
 * value rather than as its literal text. A network genuinely called `ABCD`
 * would otherwise be joined as the four bytes AB CD — a two-character name that
 * matches nothing on air. The quotes say "these are characters".
 */
export function encodeWifiField(value: string): string {
  const escaped = escapeWifiValue(value);
  return looksHexadecimal(value) ? `"${escaped}"` : escaped;
}

/** UTF-8 byte length — what 802.11's 32-octet SSID limit is actually counted in. */
export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The payload string, exactly as it is encoded into the code.
 *
 * `P` is always emitted, and is always EMPTY for an open network: the password
 * box keeps its text while you flip the security chips, and writing that text
 * into a `T:nopass` payload would put a password nobody asked for into a code
 * whose whole point is that there is no password.
 */
export function buildWifiPayload(config: WifiConfig): string {
  const password = config.security === "nopass" ? "" : config.password;
  const fields = [
    `T:${config.security}`,
    `S:${encodeWifiField(config.ssid)}`,
    `P:${encodeWifiField(password)}`,
    `H:${config.hidden ? "true" : "false"}`,
  ];
  return `WIFI:${fields.join(";")};;`;
}

export interface WifiIssue {
  /** `error` blocks generation; `warning` is a disclosure, not a veto. */
  level: "error" | "warning";
  /** Stable id, so the UI can key on it and the tests need not match prose. */
  id: string;
  message: string;
}

/** WPA-PSK passphrase bounds, from IEEE 802.11i. */
const WPA_MIN = 8;
const WPA_MAX = 63;
/** A raw 256-bit pre-shared key, written as hex, is the other legal WPA form. */
const WPA_RAW_PSK = 64;
/** WEP keys are 40-bit or 104-bit: 5 or 13 characters, or 10 or 26 hex digits. */
const WEP_TEXT = [5, 13];
const WEP_HEX = [10, 26];

/**
 * Everything wrong, or merely surprising, about this configuration.
 *
 * These are checks against the standards, not against the QR encoder — a code
 * for an impossible network encodes and scans perfectly and then fails to join,
 * which is the failure mode with the least information in it.
 */
export function checkWifiConfig(config: WifiConfig): WifiIssue[] {
  const issues: WifiIssue[] = [];
  const { ssid, security, hidden } = config;
  const password = security === "nopass" ? "" : config.password;

  if (ssid === "") {
    issues.push({
      level: "error",
      id: "ssid-empty",
      message: "Enter the network name. Without an SSID the code encodes nothing a device can join.",
    });
  } else {
    const bytes = utf8Length(ssid);
    if (bytes > 32) {
      issues.push({
        level: "error",
        id: "ssid-too-long",
        message: `An SSID is capped at 32 bytes by 802.11 and this one is ${bytes}. Accented and non-Latin characters cost two to four bytes each, so a name that looks short can still be over.`,
      });
    }
    if (ssid !== ssid.trim()) {
      issues.push({
        level: "warning",
        id: "ssid-whitespace",
        message:
          "This network name starts or ends with a space. That is legal, and it is encoded exactly as typed — but it is also the commonest way a code ends up pointing at a network that does not exist.",
      });
    }
    if (looksHexadecimal(ssid)) {
      issues.push({
        level: "warning",
        id: "ssid-hex-quoted",
        message: `The name ${ssid} is all hex digits, so it is written into the payload in double quotes. Without them a reader is entitled to decode it as raw bytes instead of as text. A few very old scanners do not understand the quotes and will show them as part of the name.`,
      });
    }
  }

  if (security === "WPA") {
    if (password === "") {
      issues.push({
        level: "error",
        id: "wpa-no-password",
        message: "WPA and WPA2 require a passphrase. Set the security to Open if the network has none.",
      });
    } else if (password.length === WPA_RAW_PSK && looksHexadecimal(password)) {
      issues.push({
        level: "warning",
        id: "wpa-raw-psk",
        message:
          "That is 64 hex digits, which is a raw 256-bit pre-shared key rather than a passphrase. It is a legal WPA credential, but a good many phones will type it in as if it were a passphrase and fail to join.",
      });
    } else if (password.length < WPA_MIN || password.length > WPA_MAX) {
      issues.push({
        level: "warning",
        id: "wpa-length",
        message: `A WPA passphrase is ${WPA_MIN} to ${WPA_MAX} characters, or exactly ${WPA_RAW_PSK} hex digits, and this one is ${password.length}. The code will still encode it; no access point will accept it.`,
      });
    }
    if (password !== "" && /[^\x20-\x7e]/.test(password)) {
      issues.push({
        level: "warning",
        id: "password-non-ascii",
        message:
          "This passphrase contains characters outside printable ASCII. WPA is defined over ASCII 32 to 126, so whether it works depends on how the access point and the joining device each happen to encode it — the two often disagree.",
      });
    }
  }

  if (security === "WEP") {
    issues.push({
      level: "warning",
      id: "wep-broken",
      message:
        "WEP is broken — its keys can be recovered from a few minutes of captured traffic, and it has been deprecated since 2004. It is here because old hardware is real, not because it protects anything.",
    });
    /*
      Either form is legal, and the two overlap: `abcde` is five printable
      characters AND five hex digits, so a key of that length has to pass on
      the text rule even though it fails the hex one. Testing only the form the
      key "looks like" rejected a perfectly good 5-character WEP key.
    */
    const ok =
      WEP_TEXT.includes(password.length) ||
      (looksHexadecimal(password) && WEP_HEX.includes(password.length));
    if (!ok) {
      issues.push({
        level: "warning",
        id: "wep-length",
        message: `A WEP key is 5 or 13 characters, or 10 or 26 hex digits, and this one is ${password.length}. Nothing will join with it.`,
      });
    }
  }

  if (security === "nopass" && config.password !== "") {
    issues.push({
      level: "warning",
      id: "nopass-password-dropped",
      message:
        "Security is set to Open, so the password box is ignored entirely — the payload below carries an empty P field and the code contains no password at all.",
    });
  }

  if (hidden) {
    issues.push({
      level: "warning",
      id: "hidden-flag",
      message:
        "The hidden flag tells the device to probe for this name rather than wait to hear it. Set it on a network that does broadcast and some Android builds refuse the join outright, so only tick it if the SSID really is suppressed.",
    });
  }

  return issues;
}

/** Convenience for the UI: does anything here stop the code being generated? */
export function hasBlockingIssue(issues: readonly WifiIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}
