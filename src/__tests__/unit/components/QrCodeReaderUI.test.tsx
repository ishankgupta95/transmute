import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QrCodeReaderUI } from "@/components/tools/QrCodeReaderUI";
import {
  describePayload,
  type AnimationInfo,
  type DecodedSymbol,
  type ScanResult,
} from "@/lib/tools/qr-decode";

/*
  `qr-decode.test.ts` covers the pure half — the grammars, the frame sniff and
  the sentences. What it cannot see is the WIRING, and the wiring is where this
  page's animated-image disclosure was actually lost.

  `decodeImageCodes` is the one export mocked here; everything the component
  renders THROUGH — `describeAnimation`, `describeEmptyScan`, `summariseScan` —
  is the real implementation, so these assertions read the shipped sentences
  rather than a copy of them.
*/
const decodeImageCodes = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tools/qr-decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tools/qr-decode")>()),
  decodeImageCodes,
}));

const symbol = (text: string): DecodedSymbol => ({
  index: 1,
  text,
  format: "QR Code",
  contentType: "Text",
  byteLength: text.length,
  ecLevel: "M",
  orientation: 0,
  mirrored: false,
  inverted: false,
  sequence: null,
  // `describePayload`, not `classifyPayload` — this is the call `toSymbols`
  // makes, catch and all. Building the fixture the other way would move a
  // throw out of the production path and into the test's own helper, and the
  // failure being pinned here is what the SCREEN shows, not where it throws.
  payload: describePayload(text),
});

const scan = (over: Partial<ScanResult> = {}): ScanResult => ({
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

const GIF_12: AnimationInfo = { format: "GIF", frames: 12 };

function drop(container: HTMLElement, name = "ticket.gif") {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [new File(["not really a gif"], name, { type: "image/gif" })],
    configurable: true,
  });
  fireEvent.change(input);
}

beforeEach(() => {
  decodeImageCodes.mockReset();
});

describe("QrCodeReaderUI discloses the frames it did not scan", () => {
  /*
    THE DEFECT: the page accepts .gif and .webp and says so on the drop zone,
    but `createImageBitmap` hands back an animation's DEFAULT IMAGE — frame
    one. A screen-recorded ticket whose code appears after a title card scanned
    to nothing while the page named four causes, every one of them wrong.
  */
  it("names the unscanned frames FIRST when nothing was found", async () => {
    decodeImageCodes.mockResolvedValue(scan({ animation: GIF_12 }));
    const { container } = render(<QrCodeReaderUI />);
    drop(container);

    const alert = await waitFor(() => {
      const found = screen
        .getAllByRole("alert")
        .find((node) => node.textContent?.includes("Nothing was found"));
      expect(found).toBeDefined();
      return found!;
    });
    const message = alert.textContent ?? "";
    expect(message).toContain("animated GIF of 12 frames");
    expect(message.indexOf("animated GIF of 12 frames")).toBeLessThan(
      message.indexOf("the usual causes are"),
    );
  });

  /*
    The half a "nothing found" message alone cannot cover, and the reason the
    warning is not folded into `describeEmptyScan`: a code found in frame one
    leaves the reader believing the whole animation was searched. The second
    code, on frame nine, is simply absent and nothing on the page says so.
  */
  it("still warns when a code WAS found, because the rest of the animation was not searched", async () => {
    decodeImageCodes.mockResolvedValue(
      scan({ symbols: [symbol("https://example.com/ticket")], animation: GIF_12 }),
    );
    const { container } = render(<QrCodeReaderUI />);
    drop(container);

    await waitFor(() => expect(screen.getByText("CODES FOUND")).toBeInTheDocument());
    // role="status", not "alert": the run succeeded and something was dropped
    // along the way, which is exactly what WarningMessage is for.
    const warned = screen
      .getAllByRole("status")
      .some((node) => node.textContent?.includes("animated GIF of 12 frames"));
    expect(warned, "the animation warning must survive a successful scan").toBe(true);
  });

  it("says nothing about frames for a still image", async () => {
    decodeImageCodes.mockResolvedValue(scan({ symbols: [symbol("hello")] }));
    const { container } = render(<QrCodeReaderUI />);
    drop(container, "photo.png");

    await waitFor(() => expect(screen.getByText("CODES FOUND")).toBeInTheDocument());
    expect(container.textContent).not.toContain("animated");
  });
});

describe("QrCodeReaderUI keeps a prettifier from costing the read", () => {
  /*
    The P1, at the surface it was reported on, and at the size it was actually
    still costing by the time it got fixed.

    As first reported, a bare per-cent in a `mailto:` threw `URIError` out of
    `decodeURIComponent` and travelled all the way to the component's only
    catch, which rendered "URI malformed" as the error for the WHOLE image —
    no CODES FOUND, no payload, no download, and four other codes in the
    picture lost with it. `toSymbols`' `describePayload` guard had already
    stopped that much. What was left was quieter and still wrong: the mailto
    branch was the one site never converted to `safeDecodeComponent`, so the
    payload fell through the guard and rendered as "Plain text" with no To
    field and the note "could not be broken into labelled fields (URI
    malformed)" — telling the reader their perfectly good email QR code was
    unparseable garbage.

    Both halves are pinned here: the address is shown, the failure of the
    PRETTIFIER is disclosed as an escape that was left alone, and the engine's
    error string never reaches the page.
  */
  it("shows the payload of a mailto: holding a bare per-cent", async () => {
    decodeImageCodes.mockResolvedValue(
      scan({ symbols: [symbol("mailto:100%discount@example.com")] }),
    );
    const { container } = render(<QrCodeReaderUI />);
    drop(container, "poster.png");

    await waitFor(() => expect(screen.getByText("CODES FOUND")).toBeInTheDocument());
    expect(screen.getByText("mailto:100%discount@example.com")).toBeInTheDocument();
    expect(screen.getByText("Email address")).toBeInTheDocument();
    expect(screen.getByText("100%discount@example.com")).toBeInTheDocument();
    expect(container.textContent).toContain("not a valid %XX escape");
    expect(container.textContent).not.toContain("URI malformed");
    expect(container.textContent).not.toContain("could not be broken into labelled fields");
  });
});
