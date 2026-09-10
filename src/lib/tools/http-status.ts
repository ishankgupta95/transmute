/**
 * The HTTP status code registry, as data.
 *
 * Two lists, kept apart on purpose. `STANDARD_STATUSES` is the IANA HTTP
 * Status Code Registry — every code with an assigned reason phrase and the RFC
 * that defines it. `VENDOR_STATUSES` is the codes you will actually meet in a
 * log file that no standard defines: nginx's, Cloudflare's, IIS's and a
 * handful of one-company inventions.
 *
 * Merging the two would make the page more useful and less true, so it does
 * not. Every vendor entry names the software that emits it, and the UI keeps
 * them under their own heading.
 *
 * ── What is derived rather than asserted ───────────────────────────────────
 *
 * `heuristicallyCacheable` is not an opinion. RFC 9110 Section 15.1 names the
 * exact set of status codes a cache may reuse WITHOUT explicit freshness
 * information — 200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414 and 501
 * — and `HEURISTICALLY_CACHEABLE` below is that list, with the flag computed
 * from it. Everything else is cacheable only when the response says so with
 * `Cache-Control` or `Expires`; nothing here says a response "cannot" be
 * cached, because that is a property of the headers, not of the code.
 *
 * `methodPreserved` is stated only for 3xx, because it is only defined there:
 * 307 and 308 forbid changing the method, 303 requires changing it to GET, and
 * 301 and 302 are the historical mess where the specification permits POST to
 * become GET and every browser does it.
 *
 * ── References ─────────────────────────────────────────────────────────────
 *
 * Section numbers are given only for RFC 9110, where the layout is regular
 * (15.2.x for 1xx, 15.3.x for 2xx, 15.4.x for 3xx, 15.5.x for 4xx, 15.6.x for
 * 5xx, numbered in code order over the codes that document defines). Codes
 * defined elsewhere cite the RFC alone rather than a section this file is not
 * certain of.
 */

export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

export interface StatusCode {
  code: number;
  /** The official reason phrase, or the vendor's own name for it. */
  phrase: string;
  /** "RFC 9110 §15.3.1", or the vendor name for a non-standard code. */
  reference: string;
  /** Plain English: what a server means by sending it. */
  summary: string;
  /**
   * True only for the twelve codes RFC 9110 Section 15.1 lists as reusable by
   * a cache with no explicit freshness header. Absent means "only when the
   * response says so", never "never".
   */
  heuristicallyCacheable?: boolean;
  /** 3xx only. What happens to the request method on the follow-up request. */
  methodPreserved?: string;
  /** Set where the registry or the defining RFC marks the code obsolete. */
  deprecated?: string;
}

export interface VendorStatusCode extends StatusCode {
  /** Which software emits it. Always shown — that is the point of the split. */
  source: string;
}

/** RFC 9110 Section 15.1, verbatim. */
export const HEURISTICALLY_CACHEABLE: readonly number[] = [
  200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501,
];

const cacheable = (code: number) =>
  HEURISTICALLY_CACHEABLE.includes(code) ? { heuristicallyCacheable: true } : {};

export const STANDARD_STATUSES: readonly StatusCode[] = [
  /* ── 1xx Informational ─────────────────────────────────────────────── */
  {
    code: 100,
    phrase: "Continue",
    reference: "RFC 9110 §15.2.1",
    summary:
      "The request headers were accepted and the client should send the body. Sent only in reply to an `Expect: 100-continue` header, which lets a client offer a large upload and find out it will be rejected before spending the bandwidth.",
  },
  {
    code: 101,
    phrase: "Switching Protocols",
    reference: "RFC 9110 §15.2.2",
    summary:
      "The server is changing to the protocol named in the request's `Upgrade` header on this same connection. In practice this is almost always the WebSocket handshake.",
  },
  {
    code: 102,
    phrase: "Processing",
    reference: "RFC 2518",
    summary:
      "A WebDAV interim response meaning the request was received and is still being worked on, sent to stop a client timing out during a long operation. Deprecated in practice: RFC 4918 removed it, and browsers ignore it.",
    deprecated: "Removed by RFC 4918; browsers ignore it.",
  },
  {
    code: 103,
    phrase: "Early Hints",
    reference: "RFC 8297",
    summary:
      "An interim response carrying `Link` headers so the client can start preloading stylesheets and fonts while the server is still assembling the real response. The final status follows on the same connection.",
  },

  /* ── 2xx Successful ─────────────────────────────────────────────────── */
  {
    code: 200,
    phrase: "OK",
    reference: "RFC 9110 §15.3.1",
    summary:
      "The request succeeded. What the body contains depends on the method: the resource for GET, the result of the action for POST, the headers alone for HEAD.",
    ...cacheable(200),
  },
  {
    code: 201,
    phrase: "Created",
    reference: "RFC 9110 §15.3.2",
    summary:
      "The request succeeded and created one or more resources. The `Location` header should carry the URL of the new resource; without it, the client has no way to address what it just made.",
  },
  {
    code: 202,
    phrase: "Accepted",
    reference: "RFC 9110 §15.3.3",
    summary:
      "The request was accepted for processing that has not finished and may not succeed. Deliberately non-committal — it exists for queues and batch jobs, and the body should say how to check on the outcome.",
  },
  {
    code: 203,
    phrase: "Non-Authoritative Information",
    reference: "RFC 9110 §15.3.4",
    summary:
      "The request succeeded but a proxy modified the headers or body on the way through. Rare, and mostly a signal that something in the middle is transforming responses.",
    ...cacheable(203),
  },
  {
    code: 204,
    phrase: "No Content",
    reference: "RFC 9110 §15.3.5",
    summary:
      "Succeeded, and there is deliberately no body. The correct answer to a DELETE or a PUT that has nothing to report; a browser stays on the current page rather than navigating.",
    ...cacheable(204),
  },
  {
    code: 205,
    phrase: "Reset Content",
    reference: "RFC 9110 §15.3.6",
    summary:
      "Succeeded, and the client should clear the form that sent the request so the user can enter another. Almost never used.",
  },
  {
    code: 206,
    phrase: "Partial Content",
    reference: "RFC 9110 §15.3.7",
    summary:
      "The server is returning the byte ranges the request's `Range` header asked for. This is how a resumed download, a video seek and a multi-connection downloader all work.",
    ...cacheable(206),
  },
  {
    code: 207,
    phrase: "Multi-Status",
    reference: "RFC 4918",
    summary:
      "WebDAV: the body is an XML document carrying a separate status for each of several resources the one request touched. The 207 itself says nothing about whether any of them succeeded.",
  },
  {
    code: 208,
    phrase: "Already Reported",
    reference: "RFC 5842",
    summary:
      "WebDAV: the members of this binding were already enumerated earlier in the same multi-status response and are not repeated.",
  },
  {
    code: 226,
    phrase: "IM Used",
    reference: "RFC 3229",
    summary:
      "The response is the result of applying one or more instance-manipulations — delta encoding — to the current resource, rather than the resource itself.",
  },

  /* ── 3xx Redirection ────────────────────────────────────────────────── */
  {
    code: 300,
    phrase: "Multiple Choices",
    reference: "RFC 9110 §15.4.1",
    summary:
      "The request has more than one possible response and the server is not choosing. Rarely implemented; there is no standard way for a client to pick automatically.",
    methodPreserved: "Not applicable — no automatic follow-up.",
    ...cacheable(300),
  },
  {
    code: 301,
    phrase: "Moved Permanently",
    reference: "RFC 9110 §15.4.2",
    summary:
      "The resource has a new URL, given in `Location`, and clients should use it from now on. Because it is cacheable without asking, a 301 sent by mistake is very hard to take back — browsers keep it, sometimes indefinitely. Test with 302 first.",
    methodPreserved:
      "In practice no: the specification permits a user agent to change POST to GET, and every browser does. Use 308 to keep the method.",
    ...cacheable(301),
  },
  {
    code: 302,
    phrase: "Found",
    reference: "RFC 9110 §15.4.3",
    summary:
      "The resource is temporarily at the URL in `Location`. The client should keep using the original URL for future requests. Historically called `Moved Temporarily`.",
    methodPreserved:
      "In practice no: browsers rewrite POST to GET, which is the behaviour 303 was defined to state explicitly and 307 to forbid.",
  },
  {
    code: 303,
    phrase: "See Other",
    reference: "RFC 9110 §15.4.4",
    summary:
      "The result of the request is at another URL, to be fetched with GET. This is the POST/redirect/GET pattern: it stops a browser refresh from resubmitting the form.",
    methodPreserved: "No — the follow-up is always GET, by definition.",
  },
  {
    code: 304,
    phrase: "Not Modified",
    reference: "RFC 9110 §15.4.5",
    summary:
      "The cached copy the client named with `If-None-Match` or `If-Modified-Since` is still current. There is no body — that is the saving. A 304 that keeps arriving for a resource you changed usually means an ETag that is not changing.",
    methodPreserved: "Not applicable — the client uses its cached response.",
  },
  {
    code: 305,
    phrase: "Use Proxy",
    reference: "RFC 9110 §15.4.6",
    summary:
      "Was to mean the resource must be reached through the proxy in `Location`. Deprecated for security reasons — it let a server redirect a client through an attacker's proxy — and ignored by browsers.",
    deprecated: "Deprecated by RFC 9110 for security reasons.",
    methodPreserved: "Not applicable — deprecated and ignored.",
  },
  {
    code: 306,
    phrase: "(Unused)",
    reference: "RFC 9110 §15.4.7",
    summary:
      "Reserved. Defined in a previous version of the specification as `Switch Proxy` and no longer used; the code stays reserved so nothing reuses it.",
    deprecated: "Reserved; no longer defined.",
    methodPreserved: "Not applicable — reserved and never sent.",
  },
  {
    code: 307,
    phrase: "Temporary Redirect",
    reference: "RFC 9110 §15.4.8",
    summary:
      "Like 302, but the method and body must survive the redirect. This is the one to send when a POST needs to land at a different URL and still be a POST.",
    methodPreserved: "Yes — the client must not change the method or drop the body.",
  },
  {
    code: 308,
    phrase: "Permanent Redirect",
    reference: "RFC 9110 §15.4.9",
    summary:
      "The permanent form of 307: new URL for good, method preserved. The right choice for an HTTPS upgrade or a domain move on an API where POSTs must keep working. Also defined by RFC 7538.",
    methodPreserved: "Yes — the client must not change the method or drop the body.",
    ...cacheable(308),
  },

  /* ── 4xx Client Error ───────────────────────────────────────────────── */
  {
    code: 400,
    phrase: "Bad Request",
    reference: "RFC 9110 §15.5.1",
    summary:
      "The server will not process the request because something about it is malformed — bad syntax, an invalid framing, a header it cannot parse. Widely misused as a generic \"your input was wrong\", where 422 is usually the better answer.",
  },
  {
    code: 401,
    phrase: "Unauthorized",
    reference: "RFC 9110 §15.5.2",
    summary:
      "The request lacks valid authentication. Misnamed: it means unauthenticated. The response must carry a `WWW-Authenticate` header naming the scheme — a 401 without one is a specification violation and a common source of a browser not showing a login prompt.",
  },
  {
    code: 402,
    phrase: "Payment Required",
    reference: "RFC 9110 §15.5.3",
    summary:
      "Reserved for future use. No standard payment protocol was ever defined for it, though some APIs use it to mean a quota or subscription has run out.",
  },
  {
    code: 403,
    phrase: "Forbidden",
    reference: "RFC 9110 §15.5.4",
    summary:
      "The server understood the request and refuses it, and re-authenticating will not help. Use this when identity is known and insufficient; use 401 when identity is missing. Serving 404 instead is a legitimate choice when even the existence of the resource is private.",
  },
  {
    code: 404,
    phrase: "Not Found",
    reference: "RFC 9110 §15.5.5",
    summary:
      "No resource at this URL, and the server will not say whether that is permanent. Note that it is heuristically cacheable — a 404 served during a deploy can be cached by intermediaries after the resource exists.",
    ...cacheable(404),
  },
  {
    code: 405,
    phrase: "Method Not Allowed",
    reference: "RFC 9110 §15.5.6",
    summary:
      "The resource exists but does not support this method. The response must include an `Allow` header listing the methods it does support; without it the client has been told no and nothing else.",
    ...cacheable(405),
  },
  {
    code: 406,
    phrase: "Not Acceptable",
    reference: "RFC 9110 §15.5.7",
    summary:
      "Nothing the server can produce matches the request's `Accept`, `Accept-Language` or `Accept-Encoding` headers. Servers are permitted to ignore those headers and send their preferred representation instead, and most do.",
  },
  {
    code: 407,
    phrase: "Proxy Authentication Required",
    reference: "RFC 9110 §15.5.8",
    summary:
      "Like 401, but the proxy in front of the server is the one demanding credentials. Carries `Proxy-Authenticate` rather than `WWW-Authenticate`.",
  },
  {
    code: 408,
    phrase: "Request Timeout",
    reference: "RFC 9110 §15.5.9",
    summary:
      "The server gave up waiting for the client to finish sending the request. Some servers send it on an idle keep-alive connection just before closing it, which is why it appears in logs for requests that were never made.",
  },
  {
    code: 409,
    phrase: "Conflict",
    reference: "RFC 9110 §15.5.10",
    summary:
      "The request conflicts with the current state of the resource — a duplicate unique key, an edit against a version that has moved on. The body should say enough for the client to resolve it and retry.",
  },
  {
    code: 410,
    phrase: "Gone",
    reference: "RFC 9110 §15.5.11",
    summary:
      "The resource used to exist here and has been deliberately removed with no forwarding address. Stronger than 404, and a signal to search engines to drop the URL rather than keep checking.",
    ...cacheable(410),
  },
  {
    code: 411,
    phrase: "Length Required",
    reference: "RFC 9110 §15.5.12",
    summary: "The server refuses the request because it has no `Content-Length` header.",
  },
  {
    code: 412,
    phrase: "Precondition Failed",
    reference: "RFC 9110 §15.5.13",
    summary:
      "One of the request's conditional headers — `If-Match`, `If-Unmodified-Since` — evaluated false. This is the success case for optimistic concurrency: your update was refused because somebody else got there first.",
  },
  {
    code: 413,
    phrase: "Content Too Large",
    reference: "RFC 9110 §15.5.14",
    summary:
      "The request body is larger than the server is willing to process. Formerly `Payload Too Large`, and before that `Request Entity Too Large`. Often produced by a reverse proxy's limit rather than the application's.",
  },
  {
    code: 414,
    phrase: "URI Too Long",
    reference: "RFC 9110 §15.5.15",
    summary:
      "The request target is longer than the server will interpret. Usually a GET that should have been a POST, or a redirect loop appending a query parameter each time round.",
    ...cacheable(414),
  },
  {
    code: 415,
    phrase: "Unsupported Media Type",
    reference: "RFC 9110 §15.5.16",
    summary:
      "The body's `Content-Type` is not one this resource accepts. The classic cause is a JSON API sent `application/x-www-form-urlencoded`, or a missing `Content-Type` entirely.",
  },
  {
    code: 416,
    phrase: "Range Not Satisfiable",
    reference: "RFC 9110 §15.5.17",
    summary:
      "The `Range` header asked for bytes outside the resource. The response should carry `Content-Range` with the real length so the client can retry sensibly.",
  },
  {
    code: 417,
    phrase: "Expectation Failed",
    reference: "RFC 9110 §15.5.18",
    summary:
      "The expectation in the request's `Expect` header cannot be met by this server. In practice that means an `Expect: 100-continue` a proxy in the path does not support.",
  },
  {
    code: 418,
    phrase: "(Unused)",
    reference: "RFC 9110 §15.5.19",
    summary:
      "Reserved and unassignable. It is the teapot: RFC 2324's Hyper Text Coffee Pot Control Protocol, an April Fools' joke from 1998, defined 418 as `I'm a teapot`. It is not part of HTTP, but so many servers implement it that RFC 9110 reserves the number so nothing real can ever take it.",
    deprecated: "Reserved as unusable; never a real HTTP status.",
  },
  {
    code: 421,
    phrase: "Misdirected Request",
    reference: "RFC 9110 §15.5.20",
    summary:
      "The request reached a server that is not configured to answer for this authority. Mostly an HTTP/2 artefact: a client reused a connection for a second hostname whose certificate matched, and this server does not serve it.",
  },
  {
    code: 422,
    phrase: "Unprocessable Content",
    reference: "RFC 9110 §15.5.21",
    summary:
      "The syntax is fine and the semantics are not — well-formed JSON with a field that fails validation. Originally WebDAV's `Unprocessable Entity` (RFC 4918); RFC 9110 adopted it for general HTTP, which is why it is now the right answer where 400 used to be used.",
  },
  {
    code: 423,
    phrase: "Locked",
    reference: "RFC 4918",
    summary: "WebDAV: the resource is locked by another user or process.",
  },
  {
    code: 424,
    phrase: "Failed Dependency",
    reference: "RFC 4918",
    summary:
      "WebDAV: this request failed because a different request it depended on failed, so it was never attempted.",
  },
  {
    code: 425,
    phrase: "Too Early",
    reference: "RFC 8470",
    summary:
      "The server will not risk processing a request replayed from TLS 1.3 early data. The client should retry once the handshake has completed.",
  },
  {
    code: 426,
    phrase: "Upgrade Required",
    reference: "RFC 9110 §15.5.22",
    summary:
      "The server refuses this request on this protocol version and names the required one in `Upgrade`. Used to force a client onto TLS or onto HTTP/2.",
  },
  {
    code: 428,
    phrase: "Precondition Required",
    reference: "RFC 6585",
    summary:
      "The server requires the request to be conditional. It exists to stop the lost-update problem: the server insists on an `If-Match` so two clients cannot silently overwrite each other.",
  },
  {
    code: 429,
    phrase: "Too Many Requests",
    reference: "RFC 6585",
    summary:
      "Rate limited. The response should carry `Retry-After` — a delay in seconds or an HTTP date — and a client that ignores it usually gets banned rather than throttled.",
  },
  {
    code: 431,
    phrase: "Request Header Fields Too Large",
    reference: "RFC 6585",
    summary:
      "The headers, or one of them, exceed what the server will accept. In the wild this is nearly always an oversized `Cookie` header built up by an app that never expires anything.",
  },
  {
    code: 451,
    phrase: "Unavailable For Legal Reasons",
    reference: "RFC 7725",
    summary:
      "Access is denied as a result of a legal demand — a court order, a takedown, a geographic block required by law. The number is a deliberate reference to Fahrenheit 451.",
  },

  /* ── 5xx Server Error ───────────────────────────────────────────────── */
  {
    code: 500,
    phrase: "Internal Server Error",
    reference: "RFC 9110 §15.6.1",
    summary:
      "The server hit a condition it does not know how to handle. The catch-all: an unhandled exception, a failed database connection, a bug. It tells the client nothing useful by design — the detail belongs in your logs, not the response.",
  },
  {
    code: 501,
    phrase: "Not Implemented",
    reference: "RFC 9110 §15.6.2",
    summary:
      "The server does not support the functionality the request needs — usually an unrecognised method. Distinct from 405, which means the method is understood but not allowed here.",
    ...cacheable(501),
  },
  {
    code: 502,
    phrase: "Bad Gateway",
    reference: "RFC 9110 §15.6.3",
    summary:
      "A proxy or load balancer got an invalid response from the server behind it. Almost always means the upstream process crashed, is not listening, or returned something that is not HTTP.",
  },
  {
    code: 503,
    phrase: "Service Unavailable",
    reference: "RFC 9110 §15.6.4",
    summary:
      "The server is temporarily unable to handle the request — overloaded, or deliberately down for maintenance. Explicitly a transient state, and the one status where sending `Retry-After` is genuinely expected.",
  },
  {
    code: 504,
    phrase: "Gateway Timeout",
    reference: "RFC 9110 §15.6.5",
    summary:
      "A proxy gave up waiting for the upstream server to respond. Compared with 502, this one means the upstream was reachable and simply too slow — the difference matters when you are deciding what to fix.",
  },
  {
    code: 505,
    phrase: "HTTP Version Not Supported",
    reference: "RFC 9110 §15.6.6",
    summary: "The server refuses the major HTTP version the request used.",
  },
  {
    code: 506,
    phrase: "Variant Also Negotiates",
    reference: "RFC 2295",
    summary:
      "A transparent content negotiation misconfiguration: the chosen variant is itself set up to negotiate, so the negotiation cannot terminate.",
  },
  {
    code: 507,
    phrase: "Insufficient Storage",
    reference: "RFC 4918",
    summary:
      "WebDAV: the server cannot store what the request needs to complete. Disk quota, in other words.",
  },
  {
    code: 508,
    phrase: "Loop Detected",
    reference: "RFC 5842",
    summary:
      "WebDAV: the server stopped an operation because it found an infinite loop while processing a request with `Depth: infinity`.",
  },
  {
    code: 510,
    phrase: "Not Extended",
    reference: "RFC 2774",
    summary:
      "Further extensions to the request are required. RFC 2774 was an experiment that was reclassified as Historic, so this code is obsolete — treat it as a curiosity.",
    deprecated: "RFC 2774 was reclassified Historic; the code is obsolete.",
  },
  {
    code: 511,
    phrase: "Network Authentication Required",
    reference: "RFC 6585",
    summary:
      "The client must authenticate to gain network access. This is the captive-portal code — a hotel or airport Wi-Fi intercepting the request. It is deliberately not 401, so that a client can tell the network apart from the origin server.",
  },
];

/**
 * Codes no standard defines, grouped so the page can be useful about them
 * without being wrong about what HTTP is. Every one names its source.
 */
export const VENDOR_STATUSES: readonly VendorStatusCode[] = [
  {
    code: 218,
    phrase: "This is fine",
    reference: "Apache Web Server",
    source: "Apache",
    summary:
      "Used by Apache's mod_proxy when a request is passed through with an error suppressed, so the response is not treated as a failure. Not registered with IANA.",
  },
  {
    code: 419,
    phrase: "Page Expired",
    reference: "Laravel",
    source: "Laravel",
    summary:
      "Laravel returns this when a CSRF token is missing or stale. 419 is unassigned in the IANA registry, which is why the framework was free to take it.",
  },
  {
    code: 420,
    phrase: "Enhance Your Calm",
    reference: "Twitter API v1",
    source: "Twitter",
    summary:
      "The rate-limit response of Twitter's version 1 API, retired in favour of the standard 429. Occasionally still emitted by old clients and mocks.",
  },
  {
    code: 430,
    phrase: "Shopify Security Rejection",
    reference: "Shopify API docs",
    source: "Shopify",
    summary:
      "Shopify's own name for it: the request was rejected as possibly malicious before the app ever saw it. It is not a rate limit — Shopify still sends 429 for that, and its response-code documentation lists the two separately. Older write-ups call 430 a Request Header Fields Too Large variant of 431, or a stand-in for 429; neither matches what Shopify documents, and 430 is unassigned in the IANA registry, so there is no standard to appeal to over Shopify's head.",
  },
  {
    code: 440,
    phrase: "Login Time-out",
    reference: "Microsoft IIS",
    source: "IIS",
    summary: "The client's session has expired and it must log in again.",
  },
  {
    code: 444,
    phrase: "No Response",
    reference: "nginx",
    source: "nginx",
    summary:
      "Not sent to anybody — it is an nginx configuration directive that closes the connection with no response at all. It appears in the access log, never on the wire, which is why a client never sees a 444.",
  },
  {
    code: 449,
    phrase: "Retry With",
    reference: "Microsoft IIS",
    source: "IIS",
    summary: "The request should be retried after performing the action given in the response.",
  },
  {
    code: 494,
    phrase: "Request header too large",
    reference: "nginx",
    source: "nginx",
    summary: "nginx's internal code for oversized request headers, logged before it closes the connection.",
  },
  {
    code: 495,
    phrase: "SSL Certificate Error",
    reference: "nginx",
    source: "nginx",
    summary: "The client supplied a TLS client certificate that failed verification.",
  },
  {
    code: 496,
    phrase: "SSL Certificate Required",
    reference: "nginx",
    source: "nginx",
    summary: "A client certificate is required by the configuration and none was supplied.",
  },
  {
    code: 497,
    phrase: "HTTP Request Sent to HTTPS Port",
    reference: "nginx",
    source: "nginx",
    summary:
      "A plaintext HTTP request arrived on a TLS listener. Usually a client with the wrong scheme, or a health check that forgot the s.",
  },
  {
    code: 498,
    phrase: "Invalid Token",
    reference: "Esri ArcGIS",
    source: "Esri",
    summary: "An expired or otherwise invalid token was supplied.",
  },
  {
    code: 499,
    phrase: "Client Closed Request",
    reference: "nginx",
    source: "nginx",
    summary:
      "The client hung up before nginx could answer. The commonest non-standard code in a real access log, and it is not a server fault: it usually means a user navigated away, or an upstream timeout on the caller's side fired first.",
  },
  {
    code: 509,
    phrase: "Bandwidth Limit Exceeded",
    reference: "Apache / cPanel",
    source: "cPanel",
    summary:
      "Emitted by cPanel's bandwidth-limit module when an account exceeds its monthly transfer allowance. Not registered with IANA.",
  },
  {
    code: 520,
    phrase: "Web Server Returned an Unknown Error",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "Cloudflare's catch-all for an origin response it could not make sense of — an empty reply, a connection reset, or headers that violate the protocol. It means the problem is at the origin, not at the edge.",
  },
  {
    code: 521,
    phrase: "Web Server Is Down",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "The origin refused the connection. Usually the web server is stopped, or its firewall is dropping Cloudflare's IP ranges.",
  },
  {
    code: 522,
    phrase: "Connection Timed Out",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "The TCP handshake with the origin never completed. Distinct from 524: here the connection was never established at all.",
  },
  {
    code: 523,
    phrase: "Origin Is Unreachable",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "Cloudflare could not route to the origin — typically a DNS record pointing at an address that no longer exists.",
  },
  {
    code: 524,
    phrase: "A Timeout Occurred",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "The connection to the origin succeeded but no response arrived within Cloudflare's window. The origin is up and too slow — a long query or a stuck worker.",
  },
  {
    code: 525,
    phrase: "SSL Handshake Failed",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "The TLS handshake between Cloudflare and the origin failed — no shared cipher, or an origin certificate the edge would not accept.",
  },
  {
    code: 526,
    phrase: "Invalid SSL Certificate",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "The origin's certificate could not be validated, usually because it is expired or self-signed while the zone is set to Full (strict).",
  },
  {
    code: 530,
    phrase: "Origin DNS Error",
    reference: "Cloudflare",
    source: "Cloudflare",
    summary:
      "Always sent alongside a Cloudflare 1xxx error code shown in the response body — the body's number is the one worth searching for, not the 530.",
  },
  {
    code: 598,
    phrase: "Network read timeout error",
    reference: "Informal proxy convention",
    source: "Proxies",
    summary: "Used by some HTTP proxies to signal a read timeout behind them. No standard defines it.",
  },
  {
    code: 599,
    phrase: "Network Connect Timeout Error",
    reference: "Informal proxy convention",
    source: "Proxies",
    summary:
      "Used by some proxies and by curl-based tooling to signal a connect timeout behind the proxy. No standard defines it.",
  },
  {
    code: 999,
    phrase: "Non-standard denial",
    reference: "LinkedIn",
    source: "LinkedIn",
    summary:
      "LinkedIn returns 999 to requests it decides are automated. Outside HTTP's three-digit range in spirit if not in syntax, and it defeats a lot of client libraries that switch on the status class.",
  },
];

/* ── Classification and lookup ────────────────────────────────────────────── */

export const STATUS_CLASSES: readonly { id: StatusClass; label: string; blurb: string }[] = [
  { id: "1xx", label: "1xx", blurb: "Informational — the request was received, keep going" },
  { id: "2xx", label: "2xx", blurb: "Successful — the request was received and accepted" },
  { id: "3xx", label: "3xx", blurb: "Redirection — further action is needed to finish" },
  { id: "4xx", label: "4xx", blurb: "Client error — the request is the problem" },
  { id: "5xx", label: "5xx", blurb: "Server error — the request was fine, the server failed" },
];

/**
 * Which class a code belongs to. Anything outside 100–599 — LinkedIn's 999 —
 * returns null rather than being forced into a bucket that would be wrong.
 */
export function statusClass(code: number): StatusClass | null {
  if (code < 100 || code > 599) return null;
  return `${Math.floor(code / 100)}xx` as StatusClass;
}

export const ALL_STATUSES: readonly StatusCode[] = [...STANDARD_STATUSES, ...VENDOR_STATUSES];

export function findStatus(code: number): StatusCode | undefined {
  return ALL_STATUSES.find((s) => s.code === code);
}

/**
 * Hyphens and runs of whitespace are the same separator on both sides of the
 * comparison, so `captive portal` finds the entry that writes it
 * `captive-portal` and `multi status` finds `Multi-Status`. Nobody remembers
 * which side of a term the RFC put a hyphen on, and a search that insists is
 * a search that says "no results" about text that is on the screen.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-\u2010-\u2015\s]+/g, " ")
    .trim();
}

/** True when `text` cites RFC `digits` — `6585` matches "RFC 6585", never "RFC 65850". */
function citesRfc(text: string, digits: string): boolean {
  return new RegExp(`rfc ${digits}(?!\\d)`).test(text);
}

/**
 * Search over code, reason phrase AND description, because the three are what
 * people actually have: a number from a log, half a phrase from a screenshot,
 * or a symptom ("gateway", "rate limit", "captive portal").
 *
 * A purely numeric query is the one that needs a rule, because a bare number
 * is two different things. It is tried as the START of a code — `50` finds
 * 500–511 but not 405, since the digits people type are the start of a code
 * and never a fragment from the middle of one — and as an RFC number, so
 * `6585` finds the four codes RFC 6585 defines and `9110` finds the 46 that
 * cite RFC 9110. It is deliberately NOT run as a substring over the prose:
 * that would make `04` return 304, 403, 404 and 410, which is noise, and the
 * empty state promises the opposite.
 */
export function matchesQuery(status: StatusCode, query: string): boolean {
  const q = normalise(query);
  if (!q) return true;

  if (/^\d+$/.test(q)) {
    return (
      String(status.code).startsWith(q) ||
      citesRfc(normalise(status.reference), q) ||
      citesRfc(normalise(status.summary), q)
    );
  }

  // A non-numeric query cannot be a substring of an all-digit code, so the
  // code itself is not tested here.
  return (
    normalise(status.phrase).includes(q) ||
    normalise(status.summary).includes(q) ||
    normalise(status.reference).includes(q)
  );
}

export function filterStatuses<T extends StatusCode>(
  list: readonly T[],
  query: string,
  cls: StatusClass | "all",
): T[] {
  return list.filter(
    (s) => (cls === "all" || statusClass(s.code) === cls) && matchesQuery(s, query),
  );
}
