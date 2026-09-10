import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyPayload,
  describeAnimation,
  describePayload,
  describeEmptyScan,
  describeSequences,
  detectAnimation,
  describeUrlRisks,
  formatElapsed,
  looksLikeBareHost,
  parseMeCard,
  parseVCard,
  parseWifiPayload,
  scanToText,
  sniffAnimation,
  splitEscapedFields,
  safeDecodeComponent,
  toSymbols,
  summariseScan,
  unescapeValue,
  MAX_SCAN_PIXELS,
  ZXING_WASM_BYTES,
  ZXING_WASM_URL,
  type DecodedSymbol,
  type RawReadResult,
  type ScanResult,
} from "@/lib/tools/qr-decode";
import { buildWifiPayload } from "@/lib/tools/wifi-qr";
import { categories } from "@/data/categories";

/*
  The engine half of qr-decode.ts needs `createImageBitmap`, a canvas and a
  1.0 MB WebAssembly module, none of which exist under jsdom — so what is
  tested here is the half where the bugs are: the field grammars, the escaping,
  and the claims the page makes about a payload. The decode path itself is
  covered by the all-tools sweep (a UI that throws on mount fails it) and by the
  conversion suite's self-hosting guard.
*/

const SOURCE = readFileSync(join(process.cwd(), "src/lib/tools/qr-decode.ts"), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the engine is never fetched from a CDN", () => {
  /*
    zxing-wasm's default `locateFile` resolves the engine to
    fastly.jsdelivr.net. Shipping that unchanged would send every visitor's IP
    to a third party from a page that says nothing leaves the tab. These three
    assertions are the unit-level half of that guard; the e2e half watches the
    real network.
  */
  it("reads its own source", () => {
    // Positive control: a negative search passes identically on an empty read.
    expect(SOURCE).toContain("prepareZXingModule");
    expect(stripComments(SOURCE).length).toBeGreaterThan(2000);
  });

  it("serves the wasm from this origin", () => {
    expect(ZXING_WASM_URL).toBe("/zxing_reader.wasm");
    expect(ZXING_WASM_URL.startsWith("/")).toBe(true);
    expect(ZXING_WASM_URL.startsWith("//")).toBe(false);
  });

  it("names no foreign origin anywhere in its code", () => {
    const code = stripComments(SOURCE);
    // `\S` after the slashes: the tool's own copy says the words "https://"
    // when it explains what a phone camera does to a scheme-less payload, and
    // that sentence is not a fetch. A real URL literal has a host after it.
    expect(code).not.toMatch(/https?:\/\/\S/);
    expect(code).not.toMatch(/jsdelivr|unpkg|cdn\./i);
  });

  it("overrides BOTH wasmBinary and locateFile", () => {
    const code = stripComments(SOURCE);
    expect(code).toMatch(/wasmBinary/);
    expect(code).toMatch(/locateFile:\s*\(\)\s*=>\s*ZXING_WASM_URL/);
  });

  it("states the measured engine size and canvas ceiling", () => {
    expect(ZXING_WASM_BYTES).toBe(1_093_289);
    expect(MAX_SCAN_PIXELS).toBe(16_777_216);
  });

  it("quotes the same engine download the developer-tools hub does", () => {
    /*
      This test used to assert `ZXING_FIRST_SCAN_BYTES === 1_129_805` and that
      it rounds to "1.1", under the title "quotes the same first-scan download
      the hub does" — while the hub shipped "0–1.0 MB". It could not fail,
      because it never read the hub: it restated a literal and checked the
      arithmetic of the constant against itself. The rail said 1.1 MB, the
      hub said 1.0 MB, the ENGINES row said 1.0 MB and this page's own FAQ
      said 1,093,289 bytes, and every one of those surfaces was green.

      So this reads the OTHER surface. `category-hub-claims.test.tsx` already
      pins the hub to the homepage ENGINES row; this pins the tool page's rail
      to the hub, which closes the loop the two guards left open.
    */
    const rail = `${(ZXING_WASM_BYTES / 1024 / 1024).toFixed(1)} MB`;
    expect(rail).toBe("1.0 MB");

    const hub = categories.find((category) => category.slug === "developer-tools");
    expect(hub, "the developer-tools hub is the surface this figure is shared with").toBeDefined();
    expect(hub!.download).toBe(`0–${rail}`);
  });

  it("renders the rail's download row from the served artifact, not a sum", () => {
    // The bug was arithmetic in the component: `ZXING_FIRST_SCAN_BYTES`, the
    // wasm plus its code-split JS glue, printed as "1.1 MB". The glue's size
    // turns on the bundler and cannot be pinned to an artifact, which is the
    // reason engine-disclosure.test.ts gives for the site's served-artifact
    // convention. There is no longer a constant to render the other answer
    // from, and this asserts the row is built from the one that is left.
    const railRow = readFileSync(
      join(process.cwd(), "src/components/tools/QrCodeReaderUI.tsx"),
      "utf8",
    );
    expect(railRow).toContain('["Engine download", `${(ZXING_WASM_BYTES / 1024 / 1024).toFixed(1)} MB');
    expect(stripComments(railRow)).not.toContain("FIRST_SCAN");
    expect(stripComments(railRow)).not.toContain("GLUE");
  });
});

describe("the reader UI never turns a payload into a link", () => {
  /*
    The load-bearing product decision on this page, pinned as a source scan
    because the assertion has to survive a component refactor: a QR code from
    a poster is an anonymous instruction, and the difference between a reader
    and a one-tap phishing funnel is whether the decoded URL is rendered as an
    anchor. There is no honest reason for this component to contain one.
  */
  const UI = readFileSync(join(process.cwd(), "src/components/tools/QrCodeReaderUI.tsx"), "utf8");

  it("reads its own source", () => {
    // Positive control, as above: this search must be looking at real code.
    expect(UI).toContain("decodeImageCodes");
    expect(UI).toContain("QrCodeReaderUI");
  });

  it("renders no anchor, no href and no navigation", () => {
    const code = stripComments(UI);
    expect(code).not.toMatch(/<a[\s/>]/);
    expect(code).not.toMatch(/href\s*=/);
    expect(code).not.toMatch(/window\.open|location\.(assign|replace|href)/);
  });
});

describe("splitEscapedFields", () => {
  it("splits a plain field list", () => {
    expect(splitEscapedFields("T:WPA;S:cafe;P:hunter2;H:true;")).toEqual([
      ["T", "WPA"],
      ["S", "cafe"],
      ["P", "hunter2"],
      ["H", "true"],
    ]);
  });

  it("does not split on an escaped semicolon", () => {
    // The whole reason this walks the string instead of calling .split(";").
    expect(splitEscapedFields("S:My\\;Net;P:x;")).toEqual([
      ["S", "My\\;Net"],
      ["P", "x"],
    ]);
  });

  it("keeps an escaped colon inside the value rather than starting a new key", () => {
    expect(splitEscapedFields("P:a\\:b;")).toEqual([["P", "a\\:b"]]);
  });

  it("treats only the FIRST unescaped colon as the key separator", () => {
    expect(splitEscapedFields("NOTE:10:30 sharp;")).toEqual([["NOTE", "10:30 sharp"]]);
  });

  it("keeps a trailing backslash instead of eating the terminator", () => {
    expect(splitEscapedFields("S:x\\")).toEqual([["S", "x\\"]]);
  });
});

describe("unescapeValue", () => {
  it("undoes one pass of escaping", () => {
    expect(unescapeValue("My\\;Net")).toBe("My;Net");
    expect(unescapeValue("a\\\\b")).toBe("a\\b");
    expect(unescapeValue("a\\:b\\,c\\\"d")).toBe('a:b,c"d');
  });

  it("leaves an unpaired trailing backslash alone", () => {
    expect(unescapeValue("x\\")).toBe("x\\");
  });
});

describe("parseWifiPayload is the exact inverse of the wifi-qr-code builder", () => {
  /*
    The sibling page BUILDS these payloads. If the two ever disagree about
    escaping, one of them is producing codes the other cannot read — and the
    failure is invisible, because a wrongly-escaped payload still scans, it just
    names a different network.
  */
  const cases = [
    { ssid: "cafe", password: "hunter2", security: "WPA" as const, hidden: false },
    { ssid: "Cafe; Bar", password: "p;a:s,s", security: "WPA" as const, hidden: true },
    { ssid: "back\\slash", password: 'quote"here', security: "WEP" as const, hidden: false },
    { ssid: "ABCD", password: "0123456789", security: "WPA" as const, hidden: false },
    { ssid: "café ☕", password: "", security: "nopass" as const, hidden: false },
  ];

  for (const config of cases) {
    it(`round-trips ${JSON.stringify(config.ssid)}`, () => {
      const parsed = parseWifiPayload(buildWifiPayload(config));
      expect(parsed).not.toBeNull();
      expect(parsed!.ssid).toBe(config.ssid);
      expect(parsed!.password).toBe(config.security === "nopass" ? "" : config.password);
      expect(parsed!.security).toBe(config.security);
      expect(parsed!.hidden).toBe(config.hidden);
    });
  }

  it("strips the quotes the builder adds to an accidentally-hex name", () => {
    // "cafe" is four hex digits. A reader that did not strip the quotes would
    // report the network as `"cafe"`, which matches nothing on air.
    const parsed = parseWifiPayload(buildWifiPayload({ ssid: "cafe", password: "x", security: "WPA", hidden: false }));
    expect(parsed!.quoted).toBe(true);
    expect(parsed!.ssid).toBe("cafe");
  });

  it("does not claim quoting for a name with a non-hex letter in it", () => {
    const parsed = parseWifiPayload(
      buildWifiPayload({ ssid: "office wifi", password: "hunter2", security: "WPA", hidden: false }),
    );
    expect(parsed!.quoted).toBe(false);
  });

  it("collects the enterprise fields it does not interpret", () => {
    const parsed = parseWifiPayload("WIFI:T:WPA2-EAP;S:corp;P:pw;E:PEAP;A:anon;PH2:MSCHAPV2;;");
    expect(parsed!.extraKeys).toEqual(["E", "A", "PH2"]);
  });

  it("returns null for anything that is not a WIFI payload", () => {
    expect(parseWifiPayload("https://example.com")).toBeNull();
    expect(parseWifiPayload("WIFIsomething")).toBeNull();
  });

  it("accepts the lower-case prefix real-world encoders emit", () => {
    expect(parseWifiPayload("wifi:T:WPA;S:x;;")?.ssid).toBe("x");
  });
});

describe("parseVCard", () => {
  it("unfolds continuation lines before splitting", () => {
    const card = "BEGIN:VCARD\r\nVERSION:3.0\r\nEMAIL:someone.with.a.very.long\r\n .address@example.com\r\nEND:VCARD";
    const parsed = parseVCard(card)!;
    expect(parsed.properties).toHaveLength(1);
    expect(parsed.properties[0].value).toBe("someone.with.a.very.long.address@example.com");
  });

  it("decodes quoted-printable values and counts them", () => {
    const card =
      "BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ada=20Lovel=C3=A1ce\nEND:VCARD";
    const parsed = parseVCard(card)!;
    expect(parsed.quotedPrintable).toBe(1);
    expect(parsed.properties[0].value).toBe("Ada Loveláce");
  });

  it("reports a declared charset that is not UTF-8", () => {
    const card = "BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=SHIFT_JIS:x\nEND:VCARD";
    expect(parseVCard(card)!.foreignCharsets).toEqual(["SHIFT_JIS"]);
  });

  it("does not report UTF-8 as foreign", () => {
    const card = "BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:x\nEND:VCARD";
    expect(parseVCard(card)!.foreignCharsets).toEqual([]);
  });

  it("undoes vCard escaping, where \\n is a newline and \\, is a comma", () => {
    const card = "BEGIN:VCARD\nVERSION:3.0\nNOTE:line one\\nline two\\, still two\nEND:VCARD";
    expect(parseVCard(card)!.properties[0].value).toBe("line one\nline two, still two");
  });

  it("strips a group prefix from the property name", () => {
    const card = "BEGIN:VCARD\nVERSION:3.0\nitem1.TEL:+15550000\nEND:VCARD";
    expect(parseVCard(card)!.properties[0].name).toBe("TEL");
  });

  it("returns null for text that is not a vCard", () => {
    expect(parseVCard("BEGIN:VEVENT\nEND:VEVENT")).toBeNull();
  });
});

describe("parseMeCard", () => {
  it("reads the older contact grammar with the same escaping", () => {
    expect(parseMeCard("MECARD:N:Doe,John;TEL:+15551234;EMAIL:j\\;d@example.com;;")).toEqual([
      ["N", "Doe,John"],
      ["TEL", "+15551234"],
      ["EMAIL", "j;d@example.com"],
    ]);
  });

  it("returns null for a vCard", () => {
    expect(parseMeCard("BEGIN:VCARD\nEND:VCARD")).toBeNull();
  });
});

describe("looksLikeBareHost", () => {
  it("recognises what a phone camera would turn into a link", () => {
    expect(looksLikeBareHost("example.com")).toBe(true);
    expect(looksLikeBareHost("example.com/menu?x=1")).toBe(true);
    expect(looksLikeBareHost("sub.domain.co.uk")).toBe(true);
  });

  it("does not fire on prose, on a real URL, or on a version number", () => {
    expect(looksLikeBareHost("see you at 6")).toBe(false);
    expect(looksLikeBareHost("https://example.com")).toBe(false);
    expect(looksLikeBareHost("1.2.3")).toBe(false);
    expect(looksLikeBareHost("")).toBe(false);
  });
});

describe("describeUrlRisks", () => {
  const ids = (raw: string) => describeUrlRisks(new URL(raw), raw).map((r) => r.id);

  it("finds nothing wrong with an ordinary https link", () => {
    expect(ids("https://example.com/menu")).toEqual([]);
  });

  it("names embedded credentials and the real host", () => {
    const risks = describeUrlRisks(
      new URL("https://paypal.com@evil.example/login"),
      "https://paypal.com@evil.example/login",
    );
    expect(risks.map((r) => r.id)).toContain("url-credentials");
    expect(risks.find((r) => r.id === "url-credentials")!.message).toContain("evil.example");
  });

  it("names punycode labels", () => {
    const risks = describeUrlRisks(new URL("https://xn--80ak6aa92e.com/"), "https://xn--80ak6aa92e.com/");
    expect(risks.map((r) => r.id)).toContain("url-punycode");
    expect(risks.find((r) => r.id === "url-punycode")!.message).toContain("xn--80ak6aa92e");
  });

  it("reports http and a non-default port", () => {
    expect(ids("http://example.com:8443/x")).toEqual(["url-port", "url-insecure"]);
  });

  it("counts invisible characters and names their code points", () => {
    const raw = "https://example.com/‮gnp.exe";
    const risk = describeUrlRisks(new URL(raw), raw).find((r) => r.id === "invisible-characters")!;
    expect(risk).toBeDefined();
    expect(risk.message).toContain("U+202E");
  });
});

describe("classifyPayload", () => {
  it("reads a Wi-Fi payload and says the password is in the code", () => {
    const payload = classifyPayload("WIFI:T:WPA;S:cafe;P:hunter2;H:false;;");
    expect(payload.kind).toBe("wifi");
    expect(payload.fields).toContainEqual({ label: "Password", value: "hunter2" });
    expect(payload.risks.map((r) => r.id)).toContain("wifi-password");
  });

  it("calls a stray field key what it almost always is: an unescaped semicolon", () => {
    /*
      The real-world failure this whole grammar exists to prevent. `Cafe; Bar`
      written into a payload without escaping the semicolon produces a code
      that scans perfectly and joins a network called `Cafe`, and the leftover
      ` Bar` arrives here as a field key. Filing that under "unknown field"
      would hide the one thing the reader needs to know.
    */
    const payload = classifyPayload("WIFI:T:WPA;S:Cafe; Bar;P:hunter2;H:true;;");
    expect(payload.fields).toContainEqual({ label: "Network (SSID)", value: "Cafe" });
    const risk = payload.risks.find((r) => r.id === "wifi-unescaped");
    expect(risk).toBeDefined();
    expect(risk!.message).toContain('" BAR"');
    expect(payload.notes.join(" ")).not.toContain("Enterprise");
  });

  it("calls a real enterprise field a real enterprise field", () => {
    const payload = classifyPayload("WIFI:T:WPA2-EAP;S:corp;P:pw;E:PEAP;PH2:MSCHAPV2;;");
    expect(payload.risks.map((r) => r.id)).not.toContain("wifi-unescaped");
    expect(payload.notes.join(" ")).toContain("WPA2-Enterprise");
    expect(payload.notes.join(" ")).toContain("E, PH2");
  });

  it("does not warn about a password on an open network", () => {
    const payload = classifyPayload("WIFI:T:nopass;S:guest;P:;H:false;;");
    expect(payload.risks.map((r) => r.id)).not.toContain("wifi-password");
    expect(payload.fields).toContainEqual({ label: "Security", value: "Open — no password" });
  });

  it("decomposes a web link into scheme, host, path and query", () => {
    const payload = classifyPayload("https://example.com/a/b?token=abc#frag");
    expect(payload.kind).toBe("url");
    expect(payload.label).toBe("Web link");
    expect(payload.fields).toContainEqual({ label: "Host", value: "example.com" });
    expect(payload.fields).toContainEqual({ label: "Query · token", value: "abc" });
    expect(payload.fields).toContainEqual({ label: "Fragment", value: "frag" });
  });

  it("masks an otpauth secret in the fields and says why", () => {
    const payload = classifyPayload("otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME");
    expect(payload.kind).toBe("otpauth");
    expect(payload.fields).toContainEqual({ label: "secret", value: "(hidden — see the raw text)" });
    expect(payload.fields.some((f) => f.value.includes("JBSWY3DPEHPK3PXP"))).toBe(false);
    expect(payload.risks.map((r) => r.id)).toContain("otp-secret");
  });

  it("flags an active scheme rather than describing it as a link", () => {
    const payload = classifyPayload("javascript:alert(1)");
    expect(payload.kind).toBe("scheme");
    expect(payload.risks.map((r) => r.id)).toContain("active-scheme");
  });

  it("reads mailto, tel, sms and geo", () => {
    expect(classifyPayload("mailto:a@b.com?subject=Hi").kind).toBe("email");
    expect(classifyPayload("tel:+15551234567").fields).toContainEqual({
      label: "Number",
      value: "+15551234567",
    });
    expect(classifyPayload("SMSTO:+15551234:hello there").fields).toContainEqual({
      label: "Message",
      value: "hello there",
    });
    const geo = classifyPayload("geo:37.7749,-122.4194");
    expect(geo.kind).toBe("geo");
    expect(geo.fields).toContainEqual({ label: "Latitude", value: "37.7749" });
  });

  it("reads a vCard into labelled fields", () => {
    const payload = classifyPayload(
      "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nTEL;TYPE=CELL:+15551234\nEMAIL:ada@example.com\nEND:VCARD",
    );
    expect(payload.kind).toBe("vcard");
    expect(payload.fields).toContainEqual({ label: "Name", value: "Ada Lovelace" });
    expect(payload.fields).toContainEqual({ label: "Phone (cell)", value: "+15551234" });
  });

  it("calls a scheme-less host what a scanner will make of it", () => {
    const payload = classifyPayload("example.com/menu");
    expect(payload.kind).toBe("text");
    expect(payload.risks.map((r) => r.id)).toContain("bare-host");
  });

  it("leaves ordinary text as text with no invented findings", () => {
    const payload = classifyPayload("Table 14");
    expect(payload.kind).toBe("text");
    expect(payload.fields).toEqual([]);
    expect(payload.risks).toEqual([]);
    expect(payload.notes).toEqual([]);
  });
});

describe("toSymbols", () => {
  /*
    The shapes below were captured from the real zxing-wasm 3.1.3 reader in a
    Node probe, not invented: a good QR read, and the ONE-ENTRY sentinel an
    undecodable image comes back as. The second is the reason this function
    exists — it is not an empty array, and passing it through would make an
    unreadable file report "1 code found".
  */
  const good: RawReadResult = {
    isValid: true,
    error: "",
    format: "QRCode",
    text: "https://example.com/login?token=abc",
    bytes: new Uint8Array(35),
    contentType: "Text",
    ecLevel: "M",
    orientation: 0,
    isMirrored: false,
    isInverted: false,
    sequenceSize: -1,
    sequenceIndex: -1,
  };
  const sentinel: RawReadResult = {
    ...good,
    isValid: false,
    error: "Failed to load image from memory",
    format: "",
    text: "",
    bytes: new Uint8Array(0),
    ecLevel: "",
    sequenceSize: 0,
    sequenceIndex: 0,
  };
  const label = (format: string) => (format === "QRCode" ? "QR Code" : undefined);

  it("drops the undecodable-image sentinel instead of counting it as a code", () => {
    expect(toSymbols([sentinel], label)).toEqual([]);
  });

  it("drops a result whose format came back as None", () => {
    expect(toSymbols([{ ...good, format: "None" }], label)).toEqual([]);
  });

  it("keeps a real read and numbers it from 1", () => {
    const [symbol] = toSymbols([good], label);
    expect(symbol.index).toBe(1);
    expect(symbol.format).toBe("QR Code");
    expect(symbol.byteLength).toBe(35);
    expect(symbol.payload.kind).toBe("url");
    expect(symbol.sequence).toBeNull();
  });

  it("falls back to the raw format name when there is no label for it", () => {
    expect(toSymbols([{ ...good, format: "Frobnicator" }], label)[0].format).toBe("Frobnicator");
  });

  it("renumbers around a dropped entry rather than leaving a gap", () => {
    const symbols = toSymbols([good, sentinel, { ...good, text: "second" }], label);
    expect(symbols.map((s) => s.index)).toEqual([1, 2]);
  });

  it("converts a 0-based structured-append index to a 1-based part number", () => {
    const [symbol] = toSymbols([{ ...good, sequenceSize: 3, sequenceIndex: 0 }], label);
    expect(symbol.sequence).toEqual({ index: 1, size: 3 });
  });
});

describe("read-outs derived from a run", () => {
  const symbol = (over: Partial<DecodedSymbol> = {}): DecodedSymbol => ({
    index: 1,
    text: "https://example.com",
    format: "QR Code",
    contentType: "Text",
    byteLength: 19,
    ecLevel: "M",
    orientation: 0,
    mirrored: false,
    inverted: false,
    sequence: null,
    payload: classifyPayload("https://example.com"),
    ...over,
  });
  const result = (over: Partial<ScanResult> = {}): ScanResult => ({
    symbols: [symbol()],
    sourceWidth: 800,
    sourceHeight: 600,
    scannedWidth: 800,
    scannedHeight: 600,
    elapsedMs: 42,
    scope: "qr",
    denoised: false,
    animation: null,
    ...over,
  });

  it("formats elapsed time without ever printing a bogus zero", () => {
    expect(formatElapsed(0.2)).toBe("1 ms");
    expect(formatElapsed(42)).toBe("42 ms");
    expect(formatElapsed(2890)).toBe("2.9 s");
  });

  it("says how many codes, at what size, in how long", () => {
    expect(summariseScan(result())).toBe(
      "1 code found in this 800 × 600 image in 42 ms — QR Code.",
    );
  });

  it("discloses a downscale in the same sentence", () => {
    expect(summariseScan(result({ sourceWidth: 6000, sourceHeight: 4000, scannedWidth: 5017, scannedHeight: 3344 }))).toContain(
      "6000 × 4000, scanned at 5017 × 3344",
    );
  });

  it("says nothing was found rather than reporting an empty success", () => {
    expect(summariseScan(result({ symbols: [] }))).toBe(
      "No code was found in this 800 × 600 image after 42 ms.",
    );
  });

  it("reports a complete structured-append set", () => {
    const parts = [
      symbol({ sequence: { index: 1, size: 2 } }),
      symbol({ sequence: { index: 2, size: 2 } }),
    ];
    expect(describeSequences(parts)[0]).toContain("All 2 parts");
  });

  it("names the missing parts of an incomplete sequence", () => {
    const parts = [symbol({ sequence: { index: 1, size: 3 } })];
    const described = describeSequences(parts)[0];
    expect(described).toContain("1 of the 3 parts");
    expect(described).toContain("2, 3");
  });

  it("says nothing about sequences when there are none", () => {
    expect(describeSequences([symbol()])).toEqual([]);
  });

  it("writes one labelled block per symbol for the download", () => {
    const text = scanToText(result({ symbols: [symbol(), symbol({ index: 2, text: "hello", format: "Aztec", payload: classifyPayload("hello") })] }));
    expect(text).toBe(
      "# 1. QR Code · Web link\nhttps://example.com\n\n# 2. Aztec · Plain text\nhello",
    );
  });

  it("writes nothing when nothing was read", () => {
    expect(scanToText(result({ symbols: [] }))).toBe("");
  });
});


describe("a per-cent sign in a structured payload never costs the read", () => {
  /*
    THE BUG, exactly as it shipped: `classifyPayload` called
    `decodeURIComponent(url.pathname)` unguarded at five sites. `new URL()`
    accepts an opaque path holding a bare "%", and `decodeURIComponent` throws
    `URIError: URI malformed` on it. Nothing between there and the page caught
    it, so `mailto:100%discount@example.com` — a real marketing address —
    surfaced as an ErrorMessage reading "URI malformed", with no CODES FOUND,
    no payload and no download, for a symbol the engine had decoded perfectly.

    The rule this pins: a PRETTIFIER may fail, but its failure mode is "show
    the raw text", never "this image has no code in it".
  */
  const stray = [
    ["mailto:", "mailto:100%discount@example.com", "100%discount@example.com"],
    ["tel:", "tel:+1%ZZ", "+1%ZZ"],
    ["sms:", "sms:%", "%"],
    ["smsto:", "SMSTO:5551234%:call me", "5551234%"],
    ["geo:", "geo:%E0%A4%A", "%E0%A4%A"],
    ["otpauth:", "otpauth://totp/a%b?secret=JBSWY3DPEHPK3PXP", "a%b"],
  ] as const;

  for (const [scheme, text, shown] of stray) {
    it(`reads a ${scheme} payload with a bare per-cent instead of throwing`, () => {
      const payload = classifyPayload(text);
      expect(payload.fields.some((field) => field.value.includes(shown))).toBe(true);
      expect(payload.notes.join(" ")).toContain("not a valid %XX escape");
    });
  }

  it("still decodes a VALID escape rather than printing it raw", () => {
    // The guard must not become "never decode": the reason these sites decode
    // at all is that %20 and %40 are how a real mailto: carries a space or an @.
    const payload = classifyPayload("mailto:a%40example.com?subject=Hi");
    expect(payload.fields).toContainEqual({ label: "To", value: "a@example.com" });
    expect(payload.notes).toEqual([]);
  });

  it("does not lose four good codes because the third has a stray per-cent", () => {
    /*
      The widest part of the defect: `toSymbols` aborted mid-loop, so one bad
      payload in a picture of five codes lost all five and the page still said
      nothing was scanned.
    */
    const one = (text: string): RawReadResult => ({
      isValid: true,
      error: "",
      format: "QRCode",
      text,
      bytes: new TextEncoder().encode(text),
      contentType: "Text",
      ecLevel: "M",
      orientation: 0,
      isMirrored: false,
      isInverted: false,
      sequenceSize: -1,
      sequenceIndex: -1,
    });
    const symbols = toSymbols(
      ["one", "two", "mailto:100%discount@example.com", "four", "five"].map(one),
      (format) => format,
    );
    expect(symbols).toHaveLength(5);
    expect(symbols.map((symbol) => symbol.text)).toContain("five");
  });

  it("degrades a describer that throws to the raw text rather than losing the symbol", () => {
    /*
      Belt and braces over the fix above, and the rule it broke: whatever a
      future grammar does, the half that DESCRIBES a payload may not cost the
      half that READ it. The describer is injected here so the throw is real —
      a catch nothing can enter would be a comment, not a guard.
    */
    const payload = describePayload("https://example.com", () => {
      throw new Error("URI malformed");
    });
    expect(payload.kind).toBe("text");
    expect(payload.fields).toEqual([]);
    expect(payload.notes.join(" ")).toContain("URI malformed");
    expect(payload.notes.join(" ")).toContain("read without error");
  });

  it("safeDecodeComponent reports which answer it gave", () => {
    expect(safeDecodeComponent("a%40b")).toEqual({ value: "a@b", decoded: true });
    expect(safeDecodeComponent("100%discount")).toEqual({ value: "100%discount", decoded: false });
  });
});

describe("an animated image says so instead of blaming the photograph", () => {
  /*
    REAL BYTES, not hand-built ones: four 4 x 4 images written by Pillow — a
    3-frame GIF, a still GIF, a 3-frame WebP and a still WebP. `.gif` and
    `.webp` are both on the drop zone's own ACCEPTS line, and
    `createImageBitmap` hands back an animation's default image — frame one.
    Before this, a screen-recorded ticket whose code appears after a title card
    scanned to nothing and the page named four causes, every one of them wrong,
    while the true one was never offered.
  */
  const bytes = (base64: string) => Uint8Array.from(Buffer.from(base64, "base64"));
  const ANIMATED_GIF = bytes(
    "R0lGODlhBAAEAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAAICQABCBxIsCCAgAAh+QQBCgABACwAAAAABAAEAIEA/wAAAAAAAAAAAAAICQABCBxIsCCAgAAh+QQBCgABACwAAAAABAAEAIEAAP8AAAAAAAAAAAAICQABCBxIsCCAgAA7",
  );
  const STILL_GIF = bytes("R0lGODdhBAAEAIEAAP8AAAAAAAAAAAAAACwAAAAABAAEAAAICQABCBxIsCCAgAA7");
  const ANIMATED_WEBP = bytes(
    "UklGRhgBAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAMAAAMAAGQAAAJWUDggMgAAADABAJ0BKgQABAABQCYloAADcAD+8ut///mwP/bz/wR6Af//0uD//pcH//S4P/SkAAAAQU5NRkwAAAAAAAAAAAADAAADAABkAAAAVlA4IDQAAAA0AQCdASoEAAQAAAAmJaAAA3AA/ukiH//3nz//ufP/+58/6M///yn7//I4//8jj/5QIAAAQU5NRkYAAAAAAAAAAAADAAADAABkAAAAVlA4IC4AAAA0AQCdASoEAAQAAAAmJaAAA3AA/vtV4///S4P/+lwf/9Lg/9Lg//rV5Vesq6AA",
  );
  const STILL_WEBP = bytes("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoEAAQAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=");
  const STILL_PNG = bytes(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGP8z4AATEhsPBwAM9EBBzDn4UwAAAAASUVORK5CYII=",
  );

  it("counts the frames of a real animated GIF", () => {
    expect(detectAnimation(ANIMATED_GIF)).toEqual({ format: "GIF", frames: 3 });
  });

  it("names an animated WebP without inventing a frame count", () => {
    expect(detectAnimation(ANIMATED_WEBP)).toEqual({ format: "WebP", frames: null });
  });

  it("says nothing about a still image in any of the three formats", () => {
    expect(detectAnimation(STILL_GIF)).toBeNull();
    expect(detectAnimation(STILL_WEBP)).toBeNull();
    expect(detectAnimation(STILL_PNG)).toBeNull();
  });

  it("quotes the frame count it counted, and no count when it has none", () => {
    expect(describeAnimation({ format: "GIF", frames: 3 })).toContain("animated GIF of 3 frames");
    const webp = describeAnimation({ format: "WebP", frames: null });
    expect(webp).toContain("animated WebP");
    expect(webp).not.toMatch(/\d+ frames/);
  });

  /*
    `detectAnimation` is pure over bytes, but the function the scan actually
    calls is `sniffAnimation`, and it carries two decisions of its own that
    nothing above can see: a magic-byte gate that skips reading the whole file
    for anything that cannot animate, and a promise never to throw. A gate
    written slightly wrong disables the entire disclosure silently — every
    animated file would simply stop warning — which is the same class of
    failure the disclosure exists to prevent.
  */
  const file = (data: Uint8Array, name: string, type: string) =>
    new File([data as BlobPart], name, { type });

  it("sniffs a dropped animated GIF through the magic-byte gate", async () => {
    expect(await sniffAnimation(file(ANIMATED_GIF, "loop.gif", "image/gif"))).toEqual({
      format: "GIF",
      frames: 3,
    });
    expect(await sniffAnimation(file(ANIMATED_WEBP, "loop.webp", "image/webp"))).toEqual({
      format: "WebP",
      frames: null,
    });
  });

  it("believes the bytes, not the file name", async () => {
    // The gate reads the first 16 bytes, not the extension. A screen-recorded
    // ticket saved as .png is still an animated GIF and still has to warn.
    expect(await sniffAnimation(file(ANIMATED_GIF, "ticket.png", "image/png"))).toEqual({
      format: "GIF",
      frames: 3,
    });
  });

  it("stays silent for a still image and for a format that cannot animate", async () => {
    expect(await sniffAnimation(file(STILL_GIF, "still.gif", "image/gif"))).toBeNull();
    expect(await sniffAnimation(file(STILL_WEBP, "still.webp", "image/webp"))).toBeNull();
    expect(await sniffAnimation(file(STILL_PNG, "still.png", "image/png"))).toBeNull();
  });

  it("returns null rather than throwing when the file cannot be read", async () => {
    // Losing a whole scan to a failed DISCLOSURE would be the same mistake
    // `safeDecodeComponent` was written to undo, one layer up.
    const unreadable = {
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error("NotReadableError")) }),
      arrayBuffer: () => Promise.reject(new Error("NotReadableError")),
    } as unknown as Blob;
    await expect(sniffAnimation(unreadable)).resolves.toBeNull();
  });
});

describe("describeEmptyScan names the cause that applies to THIS run", () => {
  const empty = (over: Partial<ScanResult> = {}): ScanResult => ({
    symbols: [],
    sourceWidth: 800,
    sourceHeight: 600,
    scannedWidth: 800,
    scannedHeight: 600,
    elapsedMs: 34,
    scope: "qr",
    denoised: false,
    animation: null,
    ...over,
  });

  it("puts the animated-image cause FIRST, ahead of the generic ones", () => {
    /*
      The defect this pins: the page listed "cropped at the edge", "no white
      margin", "a photo of a screen" and "turn on denoising" — four causes, all
      wrong for an animated file — and never mentioned that only frame one had
      been searched. Both retries it invites re-scan the same single frame.
    */
    const message = describeEmptyScan(empty({ animation: { format: "GIF", frames: 12 } }));
    const animation = message.indexOf("animated GIF of 12 frames");
    const generic = message.indexOf("the usual causes are");
    expect(animation).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(animation);
    expect(message.indexOf("denoising pass")).toBeGreaterThan(animation);
  });

  it("says nothing about frames for a still image", () => {
    expect(describeEmptyScan(empty())).not.toContain("animated");
  });

  it("stops offering the denoising pass to a run that already used it", () => {
    expect(describeEmptyScan(empty({ denoised: true }))).not.toContain("denoising pass");
    expect(describeEmptyScan(empty())).toContain("denoising pass");
  });

  it("stops offering Every format to a run that already searched every format", () => {
    expect(describeEmptyScan(empty({ scope: "all" }))).not.toContain("Every format");
    expect(describeEmptyScan(empty({ scope: "all" }))).toContain("every symbology zxing reads");
  });

  it("quotes the size and time this run actually took", () => {
    const message = describeEmptyScan(empty({ scannedWidth: 640, scannedHeight: 480, elapsedMs: 2890 }));
    expect(message).toContain("640 × 480");
    expect(message).toContain("2.9 s");
  });
});
