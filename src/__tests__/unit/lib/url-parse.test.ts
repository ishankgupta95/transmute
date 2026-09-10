import { describe, it, expect } from "vitest";

import {
  decodeQueryComponent,
  parseQuery,
  parseUrl,
  punycodeDecode,
  rebuildWithParams,
  toUnicodeHost,
} from "@/lib/tools/url-parse";

/**
 * Three things these pin, all of which a naive splitter gets wrong:
 * that repeated query keys survive as repeats, that a double-encoded value is
 * flagged rather than shown once-decoded and called done, and that a hostname
 * `new URL` silently Punycoded is shown in both forms.
 */

describe("punycodeDecode", () => {
  it("decodes the RFC's shape of input", () => {
    expect(punycodeDecode("mnchen-3ya")).toBe("münchen");
    expect(punycodeDecode("bcher-kva")).toBe("bücher");
    expect(punycodeDecode("80akhbyknj4f")).toBe("испытание");
    expect(punycodeDecode("e1afmkfd")).toBe("пример");
  });

  it("throws on malformed input rather than returning a guess", () => {
    expect(() => punycodeDecode("!!!")).toThrow();
  });
});

describe("toUnicodeHost", () => {
  it("decodes every xn-- label and leaves the rest alone", () => {
    expect(toUnicodeHost("xn--mnchen-3ya.de")).toBe("münchen.de");
    expect(toUnicodeHost("xn--80akhbyknj4f.xn--p1ai")).toBe("испытание.рф");
    expect(toUnicodeHost("www.xn--bcher-kva.example")).toBe("www.bücher.example");
  });

  it("passes an ASCII host straight through", () => {
    expect(toUnicodeHost("example.com")).toBe("example.com");
    expect(toUnicodeHost("")).toBe("");
  });

  it("keeps a broken xn-- label exactly as it arrived", () => {
    expect(toUnicodeHost("xn--!!!.com")).toBe("xn--!!!.com");
  });
});

describe("decodeQueryComponent", () => {
  it("treats + as a space, like URLSearchParams", () => {
    expect(decodeQueryComponent("hello+world")).toEqual({
      value: "hello world",
      malformed: false,
    });
    expect(decodeQueryComponent("a%20b")).toEqual({ value: "a b", malformed: false });
  });

  it("returns the raw text and flags malformed percent-encoding", () => {
    expect(decodeQueryComponent("%zz")).toEqual({ value: "%zz", malformed: true });
    expect(decodeQueryComponent("100%")).toEqual({ value: "100%", malformed: true });
  });
});

describe("parseQuery", () => {
  it("keeps repeated keys as repeats, in order", () => {
    const params = parseQuery("?tag=a&tag=b&tag=c");
    expect(params).toHaveLength(3);
    expect(params.map((p) => p.value)).toEqual(["a", "b", "c"]);
  });

  it("distinguishes ?flag from ?flag=", () => {
    const [flag, empty] = parseQuery("?flag&other=");
    expect(flag).toMatchObject({ key: "flag", value: "", valueless: true });
    expect(empty).toMatchObject({ key: "other", value: "", valueless: false });
  });

  it("skips empty pairs, as URLSearchParams does", () => {
    expect(parseQuery("?a=1&&b=2")).toHaveLength(2);
    expect(parseQuery("?")).toEqual([]);
    expect(parseQuery("")).toEqual([]);
  });

  it("agrees with URLSearchParams on the decoded pairs", () => {
    const search = "?a=hello+world&b=%E2%9C%93&a=2&c";
    const mine = parseQuery(search).map((p) => [p.key, p.value]);
    const theirs = [...new URLSearchParams(search)];
    expect(mine).toEqual(theirs);
  });

  it("keeps only the first = as the separator", () => {
    const [p] = parseQuery("?next=https%3A%2F%2Fexample.com%2F%3Fa%3D1");
    expect(p.key).toBe("next");
    expect(p.value).toBe("https://example.com/?a=1");
  });

  it("flags a double-encoded value and shows the raw beside it", () => {
    const [p] = parseQuery("?next=https%253A%252F%252Fexample.com");
    expect(p.value).toBe("https%3A%2F%2Fexample.com");
    expect(p.doubleEncoded).toBe(true);
    expect(p.rawValue).toBe("https%253A%252F%252Fexample.com");
  });

  it("does not call a singly-encoded value double-encoded", () => {
    const [p] = parseQuery("?next=https%3A%2F%2Fexample.com");
    expect(p.doubleEncoded).toBe(false);
  });

  it("flags malformed encoding instead of dropping the parameter", () => {
    const [p] = parseQuery("?discount=50%&keep=1");
    expect(p.malformed).toBe(true);
    expect(p.value).toBe("50%");
    expect(parseQuery("?discount=50%&keep=1")).toHaveLength(2);
  });
});

describe("parseUrl — decomposition", () => {
  it("returns every part, empty ones included", () => {
    const r = parseUrl("https://example.com/a/b?x=1#top");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.parts).toMatchObject({
      protocol: "https:",
      username: "",
      password: "",
      hostname: "example.com",
      port: "",
      pathname: "/a/b",
      search: "?x=1",
      hash: "#top",
      origin: "https://example.com",
    });
  });

  it("reports credentials rather than hiding them", () => {
    const r = parseUrl("https://alice:s3cret@example.com/");
    if (!r.ok) throw new Error("unreachable");
    expect(r.hasCredentials).toBe(true);
    expect(r.parts.username).toBe("alice");
    expect(r.parts.password).toBe("s3cret");
  });

  it("flags a URL the parser normalised", () => {
    const r = parseUrl("HTTP://Example.COM:80/a/../b?x=1");
    if (!r.ok) throw new Error("unreachable");
    expect(r.normalised).toBe(true);
    expect(r.parts.href).toBe("http://example.com/b?x=1");
    expect(r.parts.port).toBe("");
  });

  it("does not claim normalisation when nothing changed", () => {
    const r = parseUrl("https://example.com/a?x=1");
    if (!r.ok) throw new Error("unreachable");
    expect(r.normalised).toBe(false);
  });

  it("shows both forms of an internationalised host", () => {
    const r = parseUrl("https://münchen.de/straße");
    if (!r.ok) throw new Error("unreachable");
    expect(r.host.ascii).toBe("xn--mnchen-3ya.de");
    expect(r.host.unicode).toBe("münchen.de");
    expect(r.host.differs).toBe(true);
  });

  it("says the two host forms agree for a plain ASCII host", () => {
    const r = parseUrl("https://example.com");
    if (!r.ok) throw new Error("unreachable");
    expect(r.host.differs).toBe(false);
  });

  it("decodes path segments", () => {
    const r = parseUrl("https://example.com/a%20b/c%2Fd/");
    if (!r.ok) throw new Error("unreachable");
    expect(r.pathSegments).toEqual(["a b", "c/d"]);
  });

  it("marks an opaque-path scheme and reports its null origin", () => {
    const r = parseUrl("mailto:someone@example.com");
    if (!r.ok) throw new Error("unreachable");
    expect(r.opaquePath).toBe(true);
    expect(r.parts.hostname).toBe("");
    expect(r.parts.pathname).toBe("someone@example.com");
    expect(r.parts.origin).toBe("null");
  });

  it("does not call an ordinary https URL opaque", () => {
    const r = parseUrl("https://example.com/");
    if (!r.ok) throw new Error("unreachable");
    expect(r.opaquePath).toBe(false);
  });

  it("keeps an explicit non-default port", () => {
    const r = parseUrl("https://example.com:8443/api");
    if (!r.ok) throw new Error("unreachable");
    expect(r.parts.port).toBe("8443");
    expect(r.parts.host).toBe("example.com:8443");
  });
});

describe("parseUrl — failures", () => {
  it("says nothing to parse for an empty string", () => {
    const r = parseUrl("   ");
    expect(r).toMatchObject({ ok: false, needsBase: false });
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/nothing to parse/i);
  });

  it("recognises a scheme-relative reference and asks for a base", () => {
    const r = parseUrl("//cdn.example.com/lib.js");
    if (r.ok) throw new Error("unreachable");
    expect(r.needsBase).toBe(true);
    expect(r.reason).toMatch(/scheme-relative/i);
  });

  it("recognises an absolute path and asks for a base", () => {
    const r = parseUrl("/api/v1/users?page=2");
    if (r.ok) throw new Error("unreachable");
    expect(r.needsBase).toBe(true);
    expect(r.reason).toMatch(/absolute path/i);
  });

  it("recognises a bare host as a relative reference", () => {
    const r = parseUrl("example.com/page");
    if (r.ok) throw new Error("unreachable");
    expect(r.needsBase).toBe(true);
    expect(r.reason).toMatch(/no scheme/i);
  });

  it("names a non-numeric port", () => {
    const r = parseUrl("https://example.com:https/x");
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/port "https" is not a number/i);
    expect(r.needsBase).toBe(false);
  });

  it("names an unterminated IPv6 bracket", () => {
    const r = parseUrl("https://[::1/x");
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/ipv6/i);
  });

  it("names a scheme with no host", () => {
    const r = parseUrl("https://");
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/no host/i);
  });
});

describe("parseUrl — base URL", () => {
  it("resolves a relative reference against a base", () => {
    const r = parseUrl("/api/v1?page=2", "https://example.com/root/");
    if (!r.ok) throw new Error("unreachable");
    expect(r.usedBase).toBe(true);
    expect(r.parts.href).toBe("https://example.com/api/v1?page=2");
  });

  it("resolves a scheme-relative reference against a base's scheme", () => {
    const r = parseUrl("//cdn.example.net/a.js", "https://example.com/");
    if (!r.ok) throw new Error("unreachable");
    expect(r.parts.href).toBe("https://cdn.example.net/a.js");
  });

  it("resolves a dotted relative path against the base's directory", () => {
    const r = parseUrl("../b.png", "https://example.com/x/y/z.html");
    if (!r.ok) throw new Error("unreachable");
    expect(r.parts.href).toBe("https://example.com/x/b.png");
  });

  it("does not claim the base was used when the URL was absolute", () => {
    const r = parseUrl("https://other.example/", "https://example.com/");
    if (!r.ok) throw new Error("unreachable");
    expect(r.usedBase).toBe(false);
  });

  it("rejects a base that is not itself a URL", () => {
    const r = parseUrl("/a", "not a url");
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toMatch(/base URL is not a URL/i);
    expect(r.needsBase).toBe(true);
  });
});

describe("rebuildWithParams", () => {
  it("writes an edited list back into the URL", () => {
    const out = rebuildWithParams("https://example.com/a?x=1&y=2", [
      { key: "x", value: "9" },
      { key: "z", value: "hello world" },
    ]);
    expect(out).toBe("https://example.com/a?x=9&z=hello+world");
  });

  it("keeps repeated keys as repeats", () => {
    const out = rebuildWithParams("https://example.com/", [
      { key: "tag", value: "a" },
      { key: "tag", value: "b" },
    ]);
    expect(out).toBe("https://example.com/?tag=a&tag=b");
  });

  it("drops the whole query when the list empties", () => {
    expect(rebuildWithParams("https://example.com/a?x=1", [])).toBe("https://example.com/a");
  });

  it("leaves the path, port and hash alone", () => {
    const out = rebuildWithParams("https://example.com:8443/a/b?x=1#frag", [
      { key: "x", value: "1" },
    ]);
    expect(out).toBe("https://example.com:8443/a/b?x=1#frag");
  });

  it("round-trips a parsed query unchanged when nothing is edited", () => {
    const href = "https://example.com/a?tag=x&tag=y&q=hello+world";
    const parsed = parseUrl(href);
    if (!parsed.ok) throw new Error("unreachable");
    expect(rebuildWithParams(parsed.parts.href, parsed.params)).toBe(href);
  });
});
