import { describe, expect, it } from "vitest";
import {
  buildWifiPayload,
  checkWifiConfig,
  encodeWifiField,
  escapeWifiValue,
  hasBlockingIssue,
  looksHexadecimal,
  utf8Length,
  type WifiConfig,
} from "@/lib/tools/wifi-qr";

/*
  wifi-qr.ts is pure string work, so these tests are the actual gate on the
  tool rather than a proxy for one: a rendered QR code cannot be decoded back
  under jsdom, so the payload string is the only place the escaping can be
  checked at all. Every fixture below is a network name or passphrase that
  breaks a naive implementation, not a happy path.
*/

const config = (over: Partial<WifiConfig> = {}): WifiConfig => ({
  ssid: "Home",
  password: "hunter22",
  security: "WPA",
  hidden: false,
  ...over,
});

/** Pull one field's raw value back out of a payload, for readability. */
const field = (payload: string, key: "T" | "S" | "P" | "H") =>
  payload.match(new RegExp(`(?:^WIFI:|;)${key}:((?:\\\\.|[^;\\\\])*)`))?.[1] ?? null;

describe("escapeWifiValue", () => {
  it("escapes each of the five reserved characters", () => {
    expect(escapeWifiValue(";")).toBe("\\;");
    expect(escapeWifiValue(",")).toBe("\\,");
    expect(escapeWifiValue(":")).toBe("\\:");
    expect(escapeWifiValue('"')).toBe('\\"');
    expect(escapeWifiValue("\\")).toBe("\\\\");
  });

  it("escapes a backslash once, not twice", () => {
    // The chained-replace bug: escape `;` first and its new backslash gets
    // escaped by the `\` pass, producing `\\;` — a literal backslash followed
    // by a field terminator, which is worse than not escaping at all.
    expect(escapeWifiValue("a\\;b")).toBe("a\\\\\\;b");
  });

  it("is the ZXing wiki's own worked example", () => {
    // SSID literally `"foo;bar\baz"`, double quotes included.
    expect(escapeWifiValue('"foo;bar\\baz"')).toBe('\\"foo\\;bar\\\\baz\\"');
  });

  it("leaves ordinary text, spaces and emoji alone", () => {
    expect(escapeWifiValue("The Coffee Bar ☕")).toBe("The Coffee Bar ☕");
  });
});

describe("looksHexadecimal / encodeWifiField", () => {
  it("treats an all-hex string as hex and anything else as text", () => {
    expect(looksHexadecimal("ABCD")).toBe(true);
    expect(looksHexadecimal("deadbeef")).toBe(true);
    expect(looksHexadecimal("ABCG")).toBe(false);
    expect(looksHexadecimal("AB CD")).toBe(false);
    expect(looksHexadecimal("")).toBe(false);
  });

  it("wraps an all-hex value in double quotes", () => {
    expect(encodeWifiField("ABCD")).toBe('"ABCD"');
    expect(encodeWifiField("1234567890")).toBe('"1234567890"');
  });

  it("does not quote a value that merely contains hex digits", () => {
    expect(encodeWifiField("Cafe 1234")).toBe("Cafe 1234");
  });

  it("returns the empty string untouched, so an open network gets `P:`", () => {
    expect(encodeWifiField("")).toBe("");
  });
});

describe("buildWifiPayload", () => {
  it("writes the four fields in order and closes with two semicolons", () => {
    expect(buildWifiPayload(config())).toBe("WIFI:T:WPA;S:Home;P:hunter22;H:false;;");
  });

  it("marks a hidden network", () => {
    expect(buildWifiPayload(config({ hidden: true }))).toBe(
      "WIFI:T:WPA;S:Home;P:hunter22;H:true;;",
    );
  });

  it("keeps a semicolon in the SSID inside the S field", () => {
    const payload = buildWifiPayload(config({ ssid: "Cafe; Bar" }));
    expect(payload).toBe("WIFI:T:WPA;S:Cafe\\; Bar;P:hunter22;H:false;;");
    expect(field(payload, "S")).toBe("Cafe\\; Bar");
    // The failure this prevents: an unescaped `;` ends S early, and the reader
    // joins a network called "Cafe".
    expect(field(payload, "S")).not.toBe("Cafe");
  });

  it("escapes a colon in the passphrase", () => {
    const payload = buildWifiPayload(config({ password: "a:b" }));
    expect(payload).toContain("P:a\\:b;");
  });

  it("quotes an SSID that is entirely hex digits", () => {
    expect(buildWifiPayload(config({ ssid: "ABCD" }))).toBe(
      'WIFI:T:WPA;S:"ABCD";P:hunter22;H:false;;',
    );
  });

  it("quotes an all-hex passphrase too", () => {
    // Same ambiguity, worse consequence: a hex-decoded passphrase does not
    // fail visibly, it just never authenticates.
    expect(buildWifiPayload(config({ password: "12345678" }))).toContain('P:"12345678";');
  });

  it("leaves P empty for an open network even when the box still has text", () => {
    const payload = buildWifiPayload(config({ security: "nopass", password: "leftover" }));
    expect(payload).toBe("WIFI:T:nopass;S:Home;P:;H:false;;");
    expect(payload).not.toContain("leftover");
  });

  it("carries WEP through as its own type", () => {
    expect(buildWifiPayload(config({ security: "WEP", password: "sesam" }))).toBe(
      "WIFI:T:WEP;S:Home;P:sesam;H:false;;",
    );
  });
});

describe("utf8Length", () => {
  it("counts bytes, not characters — which is what 802.11 caps", () => {
    expect(utf8Length("Home")).toBe(4);
    expect(utf8Length("Café")).toBe(5);
    expect(utf8Length("☕")).toBe(3);
    expect(utf8Length("🏠")).toBe(4);
  });
});

describe("checkWifiConfig", () => {
  const ids = (c: WifiConfig) => checkWifiConfig(c).map((i) => i.id);

  it("says nothing about a clean WPA network", () => {
    expect(checkWifiConfig(config())).toEqual([]);
  });

  it("blocks an empty SSID", () => {
    const issues = checkWifiConfig(config({ ssid: "" }));
    expect(issues.map((i) => i.id)).toContain("ssid-empty");
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("blocks an SSID over 32 BYTES, not over 32 characters", () => {
    // 17 coffee cups is 17 characters and 51 bytes: a name that looks well
    // inside the limit and cannot exist.
    const ssid = "☕".repeat(17);
    expect(ssid.length).toBe(17);
    const issues = checkWifiConfig(config({ ssid }));
    expect(issues.map((i) => i.id)).toContain("ssid-too-long");
    expect(issues.find((i) => i.id === "ssid-too-long")?.message).toContain("51");
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("accepts a 32-byte SSID", () => {
    expect(ids(config({ ssid: "x".repeat(32) }))).not.toContain("ssid-too-long");
  });

  it("flags leading and trailing whitespace without blocking", () => {
    const issues = checkWifiConfig(config({ ssid: "Home " }));
    expect(issues.map((i) => i.id)).toEqual(["ssid-whitespace"]);
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("explains the quotes when the SSID is all hex", () => {
    expect(ids(config({ ssid: "ABCD" }))).toContain("ssid-hex-quoted");
  });

  it("blocks WPA with no passphrase", () => {
    const issues = checkWifiConfig(config({ password: "" }));
    expect(issues.map((i) => i.id)).toContain("wpa-no-password");
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("flags a WPA passphrase outside 8–63 characters", () => {
    expect(ids(config({ password: "short" }))).toContain("wpa-length");
    expect(ids(config({ password: "x".repeat(64) }))).toContain("wpa-length");
    expect(ids(config({ password: "x".repeat(63) }))).not.toContain("wpa-length");
    expect(ids(config({ password: "12345678" }))).not.toContain("wpa-length");
  });

  it("recognises a 64-hex raw PSK instead of calling it too long", () => {
    const psk = "a".repeat(64);
    expect(ids(config({ password: psk }))).toEqual(["wpa-raw-psk"]);
  });

  it("flags a non-ASCII passphrase", () => {
    expect(ids(config({ password: "passwörd" }))).toContain("password-non-ascii");
  });

  it("always says WEP is broken, and checks its key lengths", () => {
    expect(ids(config({ security: "WEP", password: "sesam" }))).toEqual(["wep-broken"]);
    expect(ids(config({ security: "WEP", password: "0123456789" }))).toEqual(["wep-broken"]);
    // `abcde` is five printable characters AND five hex digits. The text rule
    // makes it legal; testing only the hex rule would have rejected it.
    expect(ids(config({ security: "WEP", password: "abcde" }))).toEqual(["wep-broken"]);
    expect(ids(config({ security: "WEP", password: "abcdef" }))).toEqual([
      "wep-broken",
      "wep-length",
    ]);
    expect(hasBlockingIssue(checkWifiConfig(config({ security: "WEP", password: "abc" })))).toBe(
      false,
    );
  });

  it("does not apply WPA rules to an open network", () => {
    expect(ids(config({ security: "nopass", password: "" }))).toEqual([]);
  });

  it("says the password is dropped when the network is open", () => {
    expect(ids(config({ security: "nopass", password: "hunter22" }))).toEqual([
      "nopass-password-dropped",
    ]);
  });

  it("warns about the hidden flag", () => {
    expect(ids(config({ hidden: true }))).toEqual(["hidden-flag"]);
  });
});
