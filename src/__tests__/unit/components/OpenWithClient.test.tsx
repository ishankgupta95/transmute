import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { OpenWithClient } from "@/components/pwa/OpenWithClient";
import { SHARED_NAME_HEADER, encodeSharedName, sharedFileKey } from "@/lib/pwa/share-target";

/*
  /open is the route both OS entry points land in — and the route almost
  nobody arrives at that way. Share targets are Chromium-on-Android; file
  handlers are Chromium-on-desktop-when-installed. Every other visit — a
  bookmark, a link, Safari, an ordinary tab — has to get a working upload page,
  which is what the first block asserts.
*/

const ID = "9f2a1c30-4b6e-4c1a-8d55-0e7c2b3a91f4";
const ORIGIN = "https://transmute.tools";

function stubShare(entries: [string, Response][]): Map<string, Response> {
  const map = new Map(entries);
  const cache = {
    keys: async () => [...map.keys()].map((url) => new Request(url)),
    match: async (request: Request) => map.get(request.url),
    delete: async (request: Request) => map.delete(request.url),
  };
  vi.stubGlobal("caches", { open: async () => cache as unknown as Cache });
  return map;
}

/** Hand-built rather than a real `Response`, for the realm reason recorded in
 *  shared-intake.test.ts: jsdom's `File` stringifies undici's Blob. */
function stashed(name: string, type: string): Response {
  return {
    headers: new Headers({
      "content-type": type,
      [SHARED_NAME_HEADER]: encodeSharedName(name),
    }),
    blob: async () => new Blob(["0123456789"], { type }),
  } as unknown as Response;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/open");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opened directly, with nothing shared", () => {
  it("is an ordinary upload page", async () => {
    render(<OpenWithClient />);

    expect(
      screen.getByLabelText("Drop a file to see which tools take it"),
    ).toBeInTheDocument();
    // No "collecting" state on a plain visit: there is nothing to collect and
    // a flash of one would be a lie about what the page is doing.
    expect(screen.queryByText(/Collecting the shared file/)).not.toBeInTheDocument();
    // And no share notice either — nothing was shared, so nothing failed.
    await waitFor(() =>
      expect(screen.queryByText(/No shared file reached this page/)).not.toBeInTheDocument(),
    );
  });

  it("makes no claim about a capability it cannot verify", async () => {
    // `launchQueue` is absent here, and the readout says so rather than
    // staying silent or claiming otherwise (CapabilityReadout.tsx:10-11).
    render(<OpenWithClient />);
    await waitFor(() =>
      expect(
        screen.getByText(/this browser does not hand files to installed apps/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/can hand a file to an installed Transmute/)).toBeNull();
  });
});

describe("arriving from a share sheet", () => {
  it("names the file and the tools that open it", async () => {
    stubShare([[`${ORIGIN}${sharedFileKey(ID, 0)}`, stashed("IMG_0042.HEIC", "image/heic")]]);
    window.history.replaceState({}, "", `/open?shared=${ID}`);

    render(<OpenWithClient />);

    expect(await screen.findByText("IMG_0042.HEIC")).toBeInTheDocument();
    // The tool built for the format, ranked first by open-with.ts.
    const first = await screen.findByRole("link", { name: /HEIC to JPG/ });
    expect(first).toHaveAttribute("href", "/heic-to-jpg");
    // ...and the picker is gone, because there is a file to act on.
    expect(screen.queryByLabelText("Drop a file to see which tools take it")).toBeNull();
  });

  it("says plainly that the file does not travel with the link", async () => {
    stubShare([[`${ORIGIN}${sharedFileKey(ID, 0)}`, stashed("invoice.pdf", "application/pdf")]]);
    window.history.replaceState({}, "", `/open?shared=${ID}`);

    render(<OpenWithClient />);

    expect(
      await screen.findByText(/where you pick the file again/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("empties the stash it read", async () => {
    // The page is the only thing that will ever come back for these bytes.
    const map = stubShare([
      [`${ORIGIN}${sharedFileKey(ID, 0)}`, stashed("a.pdf", "application/pdf")],
    ]);
    window.history.replaceState({}, "", `/open?shared=${ID}`);

    render(<OpenWithClient />);

    await screen.findByText("a.pdf");
    expect(map.size).toBe(0);
  });

  it("falls back to the picker when the share did not arrive", async () => {
    // A reload of /open?shared=… after the stash was taken, or a browser that
    // posted nothing. Either way the user gets a working page and an honest
    // sentence, not an empty screen.
    stubShare([]);
    window.history.replaceState({}, "", `/open?shared=${ID}`);

    render(<OpenWithClient />);

    expect(await screen.findByText(/No shared file reached this page/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("Drop a file to see which tools take it"),
    ).toBeInTheDocument();
  });
});

describe("arriving from Open with", () => {
  it("draws launched files through the same surface as shared ones", async () => {
    const file = new File(["%PDF"], "scan.pdf", { type: "application/pdf" });
    // A holder rather than a `let`: the assignment happens inside a callback
    // TypeScript cannot see into, so a plain binding stays narrowed to `null`.
    const held: { consumer?: (p: { files?: readonly unknown[] }) => void } = {};
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      writable: true,
      value: {
        setConsumer(next: (p: { files?: readonly unknown[] }) => void) {
          held.consumer = next;
        },
      },
    });

    render(<OpenWithClient />);
    held.consumer?.({ files: [{ kind: "file", getFile: async () => file }] });

    expect(await screen.findByText("scan.pdf")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Compress PDF/ })).toBeInTheDocument();
    Reflect.deleteProperty(window, "launchQueue");
  });
});
