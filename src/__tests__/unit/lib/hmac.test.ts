import { beforeAll, describe, expect, it } from "vitest";

import {
  compareMac,
  decodeKeyBytes,
  duplicateTopLevelKeys,
  encodeJwtSegment,
  epochSeconds,
  formatEpochUtc,
  hmacDigest,
  JwtBuildError,
  KeyDecodeError,
  looksLikeHexKey,
  readStringClaim,
  relativeEpoch,
  setClaim,
  signJwt,
  toBase64,
  toBase64Url,
  toHex,
  utf8Bytes,
} from "@/lib/tools/hmac";

/*
  jsdom ships a `crypto` with `getRandomValues` and no `subtle`, so every
  digest here would throw on a bare jsdom global. Node's own WebCrypto is the
  same implementation the browser exposes, which is what makes the RFC vectors
  below a real check rather than a check of a mock.
*/
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import("node:crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { ...globalThis.crypto, subtle: webcrypto.subtle },
    });
  }
});

const hexBytes = (hex: string) => decodeKeyBytes(hex, "hex");
const repeat = (byte: number, count: number) => new Uint8Array(count).fill(byte);

describe("base64 encoders", () => {
  // RFC 4648 §10 test vectors, both alphabets.
  it("pads standard base64 exactly as RFC 4648 does", () => {
    expect(toBase64(utf8Bytes(""))).toBe("");
    expect(toBase64(utf8Bytes("f"))).toBe("Zg==");
    expect(toBase64(utf8Bytes("fo"))).toBe("Zm8=");
    expect(toBase64(utf8Bytes("foo"))).toBe("Zm9v");
    expect(toBase64(utf8Bytes("foob"))).toBe("Zm9vYg==");
    expect(toBase64(utf8Bytes("fooba"))).toBe("Zm9vYmE=");
    expect(toBase64(utf8Bytes("foobar"))).toBe("Zm9vYmFy");
  });

  it("writes base64url with no padding at all", () => {
    expect(toBase64Url(utf8Bytes("f"))).toBe("Zg");
    expect(toBase64Url(utf8Bytes("fo"))).toBe("Zm8");
    expect(toBase64Url(utf8Bytes("foobar"))).toBe("Zm9vYmFy");
    for (let n = 0; n < 40; n++) {
      expect(toBase64Url(repeat(0xff, n))).not.toContain("=");
    }
  });

  it("uses - and _ where standard base64 uses + and /", () => {
    // 0xFB 0xFF -> "+/8=" in standard, "-_8" url-safe.
    const bytes = new Uint8Array([0xfb, 0xff, 0xff]);
    expect(toBase64(bytes)).toBe("+///");
    expect(toBase64Url(bytes)).toBe("-___");
  });
});

describe("decodeKeyBytes", () => {
  it("reads text as UTF-8, multi-byte characters included", () => {
    expect(Array.from(decodeKeyBytes("Jefe", "utf-8"))).toEqual([0x4a, 0x65, 0x66, 0x65]);
    // é is two bytes in UTF-8 and one in Latin-1; the key length differs, and
    // so would every MAC computed from it.
    expect(decodeKeyBytes("é", "utf-8").length).toBe(2);
  });

  it("reads hex, ignoring 0x prefixes and the separators tools print", () => {
    expect(Array.from(decodeKeyBytes("0b0b0b", "hex"))).toEqual([11, 11, 11]);
    expect(Array.from(decodeKeyBytes("0x0B:0b 0b", "hex"))).toEqual([11, 11, 11]);
    expect(decodeKeyBytes("", "hex").length).toBe(0);
  });

  it("refuses hex that is not hex, naming the character", () => {
    expect(() => decodeKeyBytes("00zz", "hex")).toThrow(KeyDecodeError);
    expect(() => decodeKeyBytes("00zz", "hex")).toThrow(/"z" is not a hex digit/);
  });

  it("refuses an odd number of hex digits rather than dropping one", () => {
    expect(() => decodeKeyBytes("abc", "hex")).toThrow(/even number of digits/);
  });

  it("reads both base64 alphabets, padded or not", () => {
    expect(Array.from(decodeKeyBytes("Zm9vYmFy", "base64"))).toEqual(
      Array.from(utf8Bytes("foobar")),
    );
    expect(Array.from(decodeKeyBytes("Zg==", "base64"))).toEqual([0x66]);
    expect(Array.from(decodeKeyBytes("Zg", "base64"))).toEqual([0x66]);
    expect(Array.from(decodeKeyBytes("-___", "base64"))).toEqual([0xfb, 0xff, 0xff]);
    expect(Array.from(decodeKeyBytes("+///", "base64"))).toEqual([0xfb, 0xff, 0xff]);
  });

  it("refuses a leftover base64 character instead of inventing a byte", () => {
    expect(() => decodeKeyBytes("Zm9vYmFyZ", "base64")).toThrow(/whole number of base64 groups/);
    expect(() => decodeKeyBytes("Zm9v*mFy", "base64")).toThrow(/"\*" is not a base64 character/);
  });

  /*
    The bug the encoding picker exists for. Same characters, three readings,
    three different key lengths — and therefore three unrelated MACs.
  */
  it("gives a hex key a different length read as text than read as hex", () => {
    const key = "0123456789abcdef0123456789abcdef";
    expect(decodeKeyBytes(key, "utf-8").length).toBe(32);
    expect(decodeKeyBytes(key, "hex").length).toBe(16);
  });
});

describe("looksLikeHexKey", () => {
  it("flags a long even-length hex string with both digits and letters", () => {
    expect(looksLikeHexKey("0123456789abcdef")).toBe(true);
    expect(looksLikeHexKey("  0123456789abcdef  ")).toBe(true);
  });

  it("does not flag ordinary passphrases, short strings or bare digits", () => {
    expect(looksLikeHexKey("correct horse battery staple")).toBe(false);
    expect(looksLikeHexKey("deadbeef")).toBe(false); // too short
    expect(looksLikeHexKey("1234567890123456")).toBe(false); // no letters
    expect(looksLikeHexKey("abcdefabcdefabcd")).toBe(false); // no digits
    expect(looksLikeHexKey("0123456789abcde")).toBe(false); // odd length
  });
});

describe("hmacDigest — RFC 4231 and RFC 2202 known answers", () => {
  // RFC 4231 §4.2 / RFC 2202 §3, test case 1.
  const key1 = repeat(0x0b, 20);
  const data1 = utf8Bytes("Hi There");

  it("matches RFC 2202 case 1 for HMAC-SHA-1", async () => {
    expect(toHex(await hmacDigest("SHA-1", key1, data1))).toBe(
      "b617318655057264e28bc0b6fb378c8ef146be00",
    );
  });

  it("matches RFC 4231 case 1 for SHA-256, SHA-384 and SHA-512", async () => {
    expect(toHex(await hmacDigest("SHA-256", key1, data1))).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
    expect(toHex(await hmacDigest("SHA-384", key1, data1))).toBe(
      "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6",
    );
    expect(toHex(await hmacDigest("SHA-512", key1, data1))).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
    );
  });

  it("matches RFC 4231 case 2, the short ASCII key", async () => {
    const key = decodeKeyBytes("Jefe", "utf-8");
    const data = utf8Bytes("what do ya want for nothing?");
    expect(toHex(await hmacDigest("SHA-1", key, data))).toBe(
      "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79",
    );
    expect(toHex(await hmacDigest("SHA-256", key, data))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
    expect(toHex(await hmacDigest("SHA-512", key, data))).toBe(
      "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737",
    );
  });

  it("matches RFC 4231 case 3, a 50-byte message", async () => {
    expect(toHex(await hmacDigest("SHA-256", repeat(0xaa, 20), repeat(0xdd, 50)))).toBe(
      "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
    );
  });

  // Cases 6 and 7 exercise the key-longer-than-the-block-size path, where the
  // key is hashed first. A hand-rolled HMAC gets these wrong; SubtleCrypto does not.
  it("matches RFC 4231 cases 6 and 7, the 131-byte key", async () => {
    const key = repeat(0xaa, 131);
    expect(
      toHex(
        await hmacDigest(
          "SHA-256",
          key,
          utf8Bytes("Test Using Larger Than Block-Size Key - Hash Key First"),
        ),
      ),
    ).toBe("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");

    const longData = utf8Bytes(
      "This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.",
    );
    expect(toHex(await hmacDigest("SHA-256", key, longData))).toBe(
      "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2",
    );
    expect(toHex(await hmacDigest("SHA-512", key, longData))).toBe(
      "e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58",
    );
  });

  it("gives the same key read two ways two different MACs", async () => {
    const text = "0123456789abcdef0123456789abcdef";
    const message = utf8Bytes("payload");
    const asText = toHex(await hmacDigest("SHA-256", decodeKeyBytes(text, "utf-8"), message));
    const asHex = toHex(await hmacDigest("SHA-256", decodeKeyBytes(text, "hex"), message));
    expect(asText).not.toBe(asHex);
  });

  it("refuses an empty key with a sentence instead of a DataError", async () => {
    await expect(hmacDigest("SHA-256", new Uint8Array(0), utf8Bytes("x"))).rejects.toThrow(
      /at least one byte/,
    );
  });
});

describe("compareMac", () => {
  const digest = hexBytes("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");

  it("matches hex in either case, and says it was hex", () => {
    expect(compareMac(toHex(digest), digest)).toBe("hex");
    expect(compareMac(toHex(digest).toUpperCase(), digest)).toBe("hex");
    expect(compareMac(`  ${toHex(digest)}\n`, digest)).toBe("hex");
  });

  it("strips the sha256= prefix webhook headers carry", () => {
    expect(compareMac(`sha256=${toHex(digest)}`, digest)).toBe("hex");
    expect(compareMac(`SHA-1=${toHex(digest)}`, digest)).toBe("hex");
  });

  it("matches base64 with or without padding", () => {
    expect(compareMac(toBase64(digest), digest)).toBe("base64");
    expect(compareMac(toBase64(digest).replace(/=+$/, ""), digest)).toBe("base64");
  });

  it("reports base64url separately, because the alphabet differs", () => {
    const urlish = hexBytes("fbffff");
    expect(compareMac(toBase64Url(urlish), urlish)).toBe("base64url");
    expect(compareMac(toBase64(urlish), urlish)).toBe("base64");
  });

  it("does not case-fold base64, where case is significant", () => {
    expect(compareMac(toBase64(digest).toUpperCase(), digest)).toBeNull();
  });

  it("returns null for a mismatch and for an empty field", () => {
    expect(compareMac("", digest)).toBeNull();
    expect(compareMac(`${toHex(digest).slice(0, -1)}0`, digest)).toBeNull();
  });
});

describe("setClaim", () => {
  it("adds a claim to a pretty-printed object using its own indentation", () => {
    const before = '{\n  "sub": "1234567890",\n  "name": "John Doe"\n}';
    expect(setClaim(before, "iat", "1516239022")).toBe(
      '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}',
    );
  });

  it("replaces an existing claim in place, leaving the rest byte for byte", () => {
    const before = '{\n    "exp": 1,\n    "sub": "abc"\n}';
    expect(setClaim(before, "exp", "999")).toBe('{\n    "exp": 999,\n    "sub": "abc"\n}');
  });

  /*
    The whole reason this is a text rewrite. A JSON.parse/stringify round trip
    turns the id into ...567000, `1.0` into `1` and `1e2` into `100`; clicking
    a claim helper must not silently do any of that.
  */
  it("does not disturb literals a JSON round trip would rewrite", () => {
    const before = '{\n  "sub": 12345678901234567890,\n  "ratio": 1.0,\n  "big": 1e2\n}';
    const after = setClaim(before, "iat", "1516239022");
    expect(after).toContain("12345678901234567890");
    expect(after).toContain('"ratio": 1.0');
    expect(after).toContain('"big": 1e2');
    // And the round trip really would have broken them, so the test is not
    // asserting against a straw man.
    expect(JSON.stringify(JSON.parse(before))).not.toContain("12345678901234567890");
  });

  it("keeps duplicate keys that a round trip would collapse", () => {
    const before = '{\n  "role": "user",\n  "role": "admin"\n}';
    const after = setClaim(before, "iat", "1");
    expect(after.match(/"role"/g)).toHaveLength(2);
  });

  it("handles an empty object in both layouts", () => {
    expect(setClaim("{}", "iat", "1")).toBe('{"iat": 1}');
    expect(setClaim("{\n}", "iat", "1")).toBe('{\n  "iat": 1\n}');
  });

  it("appends inline when the source is on one line", () => {
    expect(setClaim('{"a": 1}', "b", "2")).toBe('{"a": 1, "b": 2}');
  });

  it("is not fooled by braces, commas or colons inside strings and nested values", () => {
    const before = '{"a": "}, not the end", "b": {"c": [1, 2]}}';
    expect(setClaim(before, "b", "null")).toBe('{"a": "}, not the end", "b": null}');
    expect(setClaim(before, "d", "3")).toBe('{"a": "}, not the end", "b": {"c": [1, 2]}, "d": 3}');
  });

  it("removes a claim, and the comma with it", () => {
    expect(setClaim('{"a": 1, "b": 2}', "b", null)).toBe('{"a": 1}');
    expect(setClaim('{"a": 1, "b": 2}', "a", null)).toBe('{"b": 2}');
    expect(setClaim('{"a": 1}', "a", null)).toBe("{}");
    expect(setClaim('{"a": 1}', "zz", null)).toBe('{"a": 1}');
  });

  it("returns non-object text untouched rather than throwing", () => {
    expect(setClaim("not json", "a", "1")).toBe("not json");
    expect(setClaim("[1,2]", "a", "1")).toBe("[1,2]");
  });
});

describe("readStringClaim", () => {
  it("offers a string claim for editing and an absent one as empty", () => {
    expect(readStringClaim('{"iss": "acme"}', "iss")).toEqual({ text: "acme", editable: true });
    expect(readStringClaim("{}", "iss")).toEqual({ text: "", editable: true });
  });

  it("locks a claim whose value is not a string, so an array aud is not flattened", () => {
    expect(readStringClaim('{"aud": ["a", "b"]}', "aud")).toEqual({
      text: '["a","b"]',
      editable: false,
    });
  });
});

describe("duplicateTopLevelKeys", () => {
  it("finds repeats and ignores nested ones", () => {
    expect(duplicateTopLevelKeys('{"a": 1, "a": 2, "b": 3}')).toEqual(["a"]);
    expect(duplicateTopLevelKeys('{"a": {"b": 1, "b": 2}, "c": 3}')).toEqual([]);
    expect(duplicateTopLevelKeys('{"a": 1, "a": 2, "a": 3}')).toEqual(["a"]);
  });
});

describe("signJwt", () => {
  const HEADER = '{\n  "alg": "HS256",\n  "typ": "JWT"\n}';
  const PAYLOAD = '{"sub":"1234567890","name":"John Doe","iat":1516239022}';

  // jwt.io's default token, byte for byte — NOT the RFC's. RFC 7515 App. A.1
  // signs a different header and payload with a 64-byte key and lands on
  // `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`; `your-256-bit-secret` is 19
  // bytes and appears in no JOSE RFC. The page's copy must not say otherwise.
  it("produces jwt.io's own default token, byte for byte", async () => {
    const result = await signJwt({
      header: HEADER,
      payload: PAYLOAD,
      alg: "HS256",
      secret: "your-256-bit-secret",
      secretEncoding: "utf-8",
    });
    expect(result.token).toBe(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    expect(result.keyBytes).toBe(19);
  });

  it("writes no padding into any segment", async () => {
    const result = await signJwt({
      header: HEADER,
      payload: '{"a":1}',
      alg: "HS256",
      secret: "s",
      secretEncoding: "utf-8",
    });
    expect(result.token).not.toContain("=");
    expect(result.token.split(".")).toHaveLength(3);
  });

  it("minifies the editors' whitespace without touching a literal", async () => {
    const result = await signJwt({
      header: HEADER,
      payload: '{\n  "sub": 12345678901234567890\n}',
      alg: "HS256",
      secret: "s",
      secretEncoding: "utf-8",
    });
    const decoded = Buffer.from(result.payloadSegment, "base64url").toString("utf8");
    expect(decoded).toBe('{"sub":12345678901234567890}');
  });

  it("refuses when the header names an algorithm this page will not sign", async () => {
    await expect(
      signJwt({
        header: '{"alg":"RS256","typ":"JWT"}',
        payload: "{}",
        alg: "HS256",
        secret: "s",
        secretEncoding: "utf-8",
      }),
    ).rejects.toThrow(/RS\*, PS\* and ES\* need an RSA or EC private key/);
  });

  it("refuses when the header and the picker disagree", async () => {
    const error: unknown = await signJwt({
      header: '{"alg":"HS512","typ":"JWT"}',
      payload: "{}",
      alg: "HS256",
      secret: "s",
      secretEncoding: "utf-8",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JwtBuildError);
    expect((error as JwtBuildError).stage).toBe("alg");
  });

  it("names which editor is broken", async () => {
    const headerError = (await signJwt({
      header: "{oops",
      payload: "{}",
      alg: "HS256",
      secret: "s",
      secretEncoding: "utf-8",
    }).catch((e: unknown) => e)) as JwtBuildError;
    expect(headerError.stage).toBe("header");

    const payloadError = (await signJwt({
      header: HEADER,
      payload: "[1,2]",
      alg: "HS256",
      secret: "s",
      secretEncoding: "utf-8",
    }).catch((e: unknown) => e)) as JwtBuildError;
    expect(payloadError.stage).toBe("payload");
    expect(payloadError.message).toMatch(/has to be a JSON object/);
  });

  it("will not sign with an empty secret", async () => {
    const error = (await signJwt({
      header: HEADER,
      payload: "{}",
      alg: "HS256",
      secret: "",
      secretEncoding: "utf-8",
    }).catch((e: unknown) => e)) as JwtBuildError;
    expect(error.stage).toBe("secret");
  });

  it("signs HS384 and HS512 with the matching hash", async () => {
    const hs512 = await signJwt({
      header: '{"alg":"HS512","typ":"JWT"}',
      payload: '{"a":1}',
      alg: "HS512",
      secret: "s",
      secretEncoding: "utf-8",
    });
    // A 512-bit MAC is 64 bytes, which is 86 unpadded base64url characters.
    expect(hs512.signatureSegment).toHaveLength(86);

    const hs384 = await signJwt({
      header: '{"alg":"HS384","typ":"JWT"}',
      payload: '{"a":1}',
      alg: "HS384",
      secret: "s",
      secretEncoding: "utf-8",
    });
    expect(hs384.signatureSegment).toHaveLength(64);
  });

  it("reports duplicate keys, which survive into the token", async () => {
    const result = await signJwt({
      header: HEADER,
      payload: '{"role":"user","role":"admin"}',
      alg: "HS256",
      secret: "s",
      secretEncoding: "utf-8",
    });
    expect(result.duplicateKeys).toEqual(["role"]);
    const decoded = Buffer.from(result.payloadSegment, "base64url").toString("utf8");
    expect(decoded.match(/"role"/g)).toHaveLength(2);
  });

  it("signs the exact bytes of the two segments it emits", async () => {
    const result = await signJwt({
      header: HEADER,
      payload: PAYLOAD,
      alg: "HS256",
      secret: "your-256-bit-secret",
      secretEncoding: "utf-8",
    });
    const recomputed = await hmacDigest(
      "SHA-256",
      utf8Bytes("your-256-bit-secret"),
      utf8Bytes(`${result.headerSegment}.${result.payloadSegment}`),
    );
    expect(toBase64Url(recomputed)).toBe(result.signatureSegment);
  });
});

describe("encodeJwtSegment", () => {
  it("round-trips through base64url for non-ASCII claims", () => {
    const segment = encodeJwtSegment('{"name": "日本語 🎉"}');
    expect(Buffer.from(segment, "base64url").toString("utf8")).toBe('{"name":"日本語 🎉"}');
  });
});

describe("time claims", () => {
  it("converts milliseconds to whole epoch seconds", () => {
    expect(epochSeconds(1_516_239_022_999)).toBe(1_516_239_022);
    expect(epochSeconds(0)).toBe(0);
  });

  it("formats an instant in UTC and refuses anything that is not one", () => {
    expect(formatEpochUtc(1_516_239_022)).toBe("2018-01-18 01:30:22 UTC");
    expect(formatEpochUtc("soon")).toBeNull();
    expect(formatEpochUtc(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatEpochUtc(1e20)).toBeNull();
  });

  it("floors the relative reading rather than rounding it up", () => {
    const now = 1_700_000_000_000;
    expect(relativeEpoch(1_700_000_000, now)).toBe("now");
    expect(relativeEpoch(1_700_000_000 + 3600, now)).toBe("in 1 hour");
    // 1h50m still reads as one hour; rounding would claim two.
    expect(relativeEpoch(1_700_000_000 + 6600, now)).toBe("in 1 hour");
    expect(relativeEpoch(1_700_000_000 - 3 * 86_400, now)).toBe("3 days ago");
    expect(relativeEpoch(1_700_000_000 + 90, now)).toBe("in 1 minute");
    expect(relativeEpoch(1_700_000_000 - 5, now)).toBe("5 seconds ago");
  });
});
