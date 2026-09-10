import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HarViewerUI } from "@/components/tools/HarViewerUI";

/*
  Everything this file guards is a SENTENCE the page prints about the reader's
  own file, and every one of them was wrong in a way no lib-level test could
  see:

    · "requests overlap, so it is longer than the wall clock" — asserted
      unconditionally, and false for the fixture below (1.39 s summed across a
      3.00 s recording).
    · TOTAL TIME "0 ms" for a recording whose every entry says -1.
    · "N credential values" counted with request bodies folded in, so a HAR
      with no credentials at all announced some.
    · A detail card left on screen for a request the filter had removed.
    · "NO SIZE CAP" over a pipeline that holds several copies of the file.

  There is no HarViewerUI.test.tsx before this one, so none of those had a gate.
*/

// `vi.mock` is hoisted above every `const` in the file, and HarViewerUI reads
// the note at module scope — so the text has to be hoisted with it.
const NOTE = vi.hoisted(
  () =>
    "Nothing is enforced, but the whole file is read as one JavaScript string and the parsed document sits in tab memory beside it.",
);

// The registry note is applied by `size-claims.test.ts`; what this file checks
// is that the UI READS it and hands it to the zone. `importOriginal` keeps the
// rest of the module intact for anything else in the tree that needs it.
vi.mock("@/data/tools", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/data/tools")>();
  return {
    ...mod,
    getToolBySlug: (slug: string) =>
      slug === "har-viewer"
        ? { ...mod.getToolBySlug(slug), practicalLimitNote: NOTE }
        : mod.getToolBySlug(slug),
  };
});

/*
  `redactHar` deep-copies the whole document. Counting how many times the page
  calls it is the only way to hold the line on WHEN that copy is built: it used
  to run in a `useMemo` on load, so every reader of a 400 MB capture paid for a
  second copy of it whether or not they ever exported one.
*/
const redactCalls = vi.hoisted(() => ({ n: 0 }));

vi.mock("@/lib/tools/har", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tools/har")>();
  return {
    ...mod,
    redactHar: (doc: unknown) => {
      redactCalls.n++;
      return mod.redactHar(doc);
    },
  };
});

const downloaded = vi.hoisted(() => ({ calls: [] as { name: string; body: string }[] }));

vi.mock("@/lib/utils/download", () => ({
  triggerDownload: async (blob: Blob, name: string) => {
    downloaded.calls.push({ name, body: await blob.text() });
  },
}));

/*
  The zone is replaced by a button that hands over whatever `dropped.make`
  returns, because jsdom cannot drive a real drag. `data-practical-limit-note`
  is how the pass-through is observed.
*/
const dropped = vi.hoisted(() => ({ text: "" }));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({
    onFiles,
    practicalLimitNote,
  }: {
    onFiles: (files: File[]) => void;
    practicalLimitNote?: string;
  }) => (
    <button
      data-testid="dropzone"
      data-practical-limit-note={practicalLimitNote ?? ""}
      onClick={() => onFiles([new File([dropped.text], "session.har", { type: "application/json" })])}
    >
      Drop file here
    </button>
  ),
}));

/* ── The fixture, matching har.test.ts's ──────────────────────────────────── */

const header = (name: string, value: string) => ({ name, value });

const SAMPLE = {
  log: {
    version: "1.2",
    creator: { name: "WebInspector", version: "537.36" },
    pages: [{ id: "page_1" }],
    entries: [
      {
        startedDateTime: "2026-09-05T10:00:00.000Z",
        time: 412.5,
        _resourceType: "document",
        request: {
          method: "GET",
          url: "https://example.com/index.html?ref=news",
          headers: [header("Cookie", "sid=abc123"), header("Accept", "text/html")],
          queryString: [header("ref", "news")],
          cookies: [{ name: "sid", value: "abc123" }],
        },
        response: {
          status: 200,
          statusText: "OK",
          headers: [header("Set-Cookie", "sid=xyz789")],
          cookies: [{ name: "sid", value: "xyz789" }],
          content: { size: 5120, mimeType: "text/html" },
          _transferSize: 2048,
        },
        timings: { blocked: 1.5, wait: 300, receive: 68.5 },
      },
      {
        startedDateTime: "2026-09-05T10:00:01.000Z",
        time: 980,
        request: {
          method: "POST",
          url: "https://api.example.com/v1/login",
          headers: [header("Authorization", "Bearer eyJhbGciOi"), header("X-Api-Key", "k_live_9182")],
          queryString: [],
          cookies: [],
          postData: {
            mimeType: "application/json",
            text: '{"user":"ada","password":"hunter2"}',
            params: [{ name: "password", value: "hunter2" }],
          },
        },
        response: {
          status: 401,
          statusText: "Unauthorized",
          headers: [],
          cookies: [],
          content: { size: 64, mimeType: "application/json" },
          headersSize: 120,
          bodySize: 64,
        },
        timings: { wait: 970, receive: 9 },
      },
      {
        startedDateTime: "2026-09-05T10:00:02.000Z",
        time: -1,
        request: { method: "GET", url: "https://cdn.example.com/logo.png", headers: [], cookies: [] },
        response: {
          status: 503,
          statusText: "Service Unavailable",
          headers: [],
          cookies: [],
          content: { size: -1, mimeType: "image/png" },
          headersSize: -1,
          bodySize: -1,
        },
        timings: { wait: 2 },
      },
      {
        startedDateTime: "2026-09-05T10:00:03.000Z",
        time: 0,
        _resourceType: "script",
        request: { method: "GET", url: "https://tracker.example.net/beacon.js", headers: [], cookies: [] },
        response: {
          status: 0,
          statusText: "",
          headers: [],
          cookies: [],
          content: { size: 0, mimeType: "" },
          headersSize: -1,
          bodySize: -1,
        },
        timings: { wait: 0 },
      },
    ],
  },
};

const load = async (doc: unknown) => {
  dropped.text = JSON.stringify(doc);
  render(<HarViewerUI />);
  fireEvent.click(screen.getByTestId("dropzone"));
  await screen.findByText(/REQUESTS MATCH|MATCHING REQUESTS/);
};

/** The value cell of a stat, found through its label. */
const statValue = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";

describe("HarViewerUI", () => {
  beforeEach(() => {
    downloaded.calls.length = 0;
    redactCalls.n = 0;
  });

  it("hands the drop zone the ceiling it has, instead of letting it print NO SIZE CAP", () => {
    dropped.text = JSON.stringify(SAMPLE);
    render(<HarViewerUI />);
    expect(screen.getByTestId("dropzone")).toHaveAttribute("data-practical-limit-note", NOTE);
  });

  describe("the SUMMARY paragraph's claim about total time", () => {
    it("derives the comparison instead of asserting the sum is longer", async () => {
      await load(SAMPLE);
      // 412.5 + 980 + 0 summed, across a 10:00:00.000 → 10:00:03.000 recording.
      const para = screen.getByText(/Total time adds up/);
      expect(para).toHaveTextContent("1.39 s of request time across a 3.00 s recording");
      expect(para).toHaveTextContent(/the rest of that span was idle/);
      expect(para).not.toHaveTextContent(/longer than the wall clock/);
    });

    it("says overlap only when the file actually overlaps", async () => {
      const at = (iso: string, time: number) => ({
        startedDateTime: iso,
        time,
        request: { method: "GET", url: "https://example.com/a", headers: [], cookies: [] },
        response: { status: 200, headers: [], cookies: [], content: { size: 1, mimeType: "text/html" } },
      });
      await load({
        log: {
          entries: [
            at("2026-09-05T10:00:00.000Z", 2000),
            at("2026-09-05T10:00:00.100Z", 2000),
            at("2026-09-05T10:00:00.200Z", 2000),
          ],
        },
      });
      const para = screen.getByText(/Total time adds up/);
      expect(para).toHaveTextContent("6.00 s of request time across a 2.20 s recording");
      expect(para).toHaveTextContent(/requests overlapped/);
    });

    it("makes no comparison at all when the span covers only some of the entries", async () => {
      await load({
        log: {
          entries: [
            {
              startedDateTime: "2026-09-05T10:00:00.000Z",
              time: 40,
              request: { method: "GET", url: "https://example.com/a", headers: [], cookies: [] },
              response: { status: 200, headers: [], cookies: [], content: { size: 1, mimeType: "text/html" } },
            },
            {
              startedDateTime: "",
              time: 40,
              request: { method: "GET", url: "https://example.com/b", headers: [], cookies: [] },
              response: { status: 200, headers: [], cookies: [], content: { size: 1, mimeType: "text/html" } },
            },
          ],
        },
      });
      const para = screen.getByText(/Total time adds up/);
      expect(para).toHaveTextContent(/neither the wall clock nor a page-load time/);
      expect(para).not.toHaveTextContent(/across a/);
    });
  });

  describe("TOTAL TIME", () => {
    it("says NOT RECORDED rather than 0 ms when nothing was timed", async () => {
      const noTime = JSON.parse(JSON.stringify(SAMPLE)) as typeof SAMPLE;
      noTime.log.entries.forEach((e) => {
        e.time = -1;
      });
      await load(noTime);
      expect(statValue("TOTAL TIME")).toContain("NOT RECORDED");
      expect(statValue("TOTAL TIME")).not.toContain("0 ms");
      expect(screen.getByText(/No request in this file reported a duration/)).toBeInTheDocument();
    });

    it("prints the sum, and its coverage, when some entries were timed", async () => {
      await load(SAMPLE);
      expect(statValue("TOTAL TIME")).toContain("1.39 s");
      // The counterpart to the "Sizes recorded" row that already existed.
      expect(screen.getByText("Times recorded").parentElement).toHaveTextContent("3 of 4");
    });
  });

  describe("the credential warning", () => {
    it("does not call request bodies credentials", async () => {
      const body = {
        request: {
          method: "POST",
          url: "https://public.example/graphql",
          headers: [header("Content-Type", "application/json")],
          cookies: [],
          postData: { mimeType: "application/json", text: '{"query":"{ me }"}' },
        },
        response: { status: 200, headers: [], cookies: [], content: { size: 2, mimeType: "application/json" } },
      };
      await load({ log: { entries: [body, body, body] } });
      const banner = screen.getByRole("status");
      expect(banner).toHaveTextContent("No credential header or cookie value was found in this recording.");
      expect(banner).toHaveTextContent("3 request bodies");
      expect(banner).not.toHaveTextContent(/\d+ credential value/);
    });

    it("counts only header and cookie values as credentials when there are some", async () => {
      await load(SAMPLE);
      const banner = screen.getByRole("status");
      // 4 header values (Cookie, Set-Cookie, Authorization, X-Api-Key) + 2
      // cookie values. The old sentence added the 1 body in and led with 7.
      expect(banner).toHaveTextContent("carries 6 credential values");
      expect(banner).toHaveTextContent(
        "4 header values (authorization, cookie, set-cookie, x-api-key) and 2 cookie values",
      );
      expect(banner).toHaveTextContent("1 request body");
      // …and the body is described as a body, with its own value count.
      expect(banner).toHaveTextContent("2 values");
      expect(banner).not.toHaveTextContent(/carries 7 credential/);
    });
  });

  describe("the detail card", () => {
    it("goes away when the filter removes the request it describes", async () => {
      await load(SAMPLE);
      fireEvent.click(screen.getByText("/index.html?ref=news"));
      expect(await screen.findByText("https://example.com/index.html?ref=news")).toBeInTheDocument();

      const statusGroup = screen.getByRole("group", { name: "Filter by status class" });
      fireEvent.click(within(statusGroup).getByText("5xx"));

      await waitFor(() => {
        expect(screen.queryByText("https://example.com/index.html?ref=news")).not.toBeInTheDocument();
      });
      // The 5xx row is still listed — it is the card that went, not the table.
      expect(screen.getByText("/logo.png")).toBeInTheDocument();
    });

    it("comes back when the filter stops excluding it", async () => {
      await load(SAMPLE);
      fireEvent.click(screen.getByText("/index.html?ref=news"));
      const statusGroup = screen.getByRole("group", { name: "Filter by status class" });
      fireEvent.click(within(statusGroup).getByText("5xx"));
      await waitFor(() => {
        expect(screen.queryByText("https://example.com/index.html?ref=news")).not.toBeInTheDocument();
      });
      fireEvent.click(within(statusGroup).getByText("All"));
      expect(await screen.findByText("https://example.com/index.html?ref=news")).toBeInTheDocument();
    });
  });

  describe("the export", () => {
    it("builds the redacted copy when it is asked for, not on load", async () => {
      await load(SAMPLE);
      // No copy of the document exists yet. Filtering, sorting and opening a
      // row must not make one either.
      expect(redactCalls.n).toBe(0);
      expect(downloaded.calls).toHaveLength(0);
      fireEvent.click(screen.getByText("/index.html?ref=news"));
      fireEvent.change(screen.getByLabelText("Filter by URL substring"), {
        target: { value: "api" },
      });
      expect(redactCalls.n).toBe(0);

      fireEvent.click(screen.getByRole("button", { name: "Download redacted copy" }));
      await waitFor(() => expect(downloaded.calls).toHaveLength(1));
      expect(redactCalls.n).toBe(1);
      expect(downloaded.calls[0].name).toBe("session.redacted.har");
      expect(downloaded.calls[0].body).not.toContain("hunter2");
      expect(downloaded.calls[0].body).not.toContain("Bearer eyJhbGciOi");
      expect(downloaded.calls[0].body).toContain("[redacted by Transmute]");
    });

    it("hands back the original bytes when redaction is switched off", async () => {
      await load(SAMPLE);
      fireEvent.click(screen.getByLabelText("Strip credentials from the download"));
      fireEvent.click(screen.getByRole("button", { name: "Download this file unchanged" }));
      await waitFor(() => expect(downloaded.calls).toHaveLength(1));
      expect(downloaded.calls[0].name).toBe("session.har");
      expect(downloaded.calls[0].body).toBe(JSON.stringify(SAMPLE));
      // …and it did not copy the document to hand back bytes it already had.
      expect(redactCalls.n).toBe(0);
    });
  });
});
