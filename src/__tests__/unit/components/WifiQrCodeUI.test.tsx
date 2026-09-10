import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  The encoder is stubbed, not exercised: what is under test is WHICH STRING the
  page hands it. `qrcode` needs a real 2D context to draw and jsdom has none, so
  the real library could not run here anyway.
*/
const qr = vi.hoisted(() => ({
  /* Typed to the real signatures so `mock.calls[0][n]` is a checked tuple and
     an assertion on the wrong argument index fails at tsc, not at runtime. */
  toCanvas: vi.fn(
    async (_canvas: HTMLCanvasElement, _text: string, _options?: unknown) => undefined,
  ),
  toString: vi.fn(async (_text: string, _options?: unknown) => "<svg/>"),
}));
vi.mock("qrcode", () => ({ default: qr }));

/* The SVG button's only other side effect. Stubbed so the assertion below is
   about the payload and not about jsdom's object-URL plumbing. */
const download = vi.hoisted(() => ({ triggerDownload: vi.fn() }));
vi.mock("@/lib/utils/download", () => download);

import { WifiQrCodeUI } from "@/components/tools/WifiQrCodeUI";

const REAL = String.raw`WIFI:T:WPA;S:Cafe\; Bar;P:hunter22;H:false;;`;

/**
 * A working WPA network, typed with "Hide password characters" already ticked.
 *
 * The mask goes on BEFORE the password on purpose. `handleGenerate` and
 * `handleCopyPayload` are `useCallback`s keyed on `payload`, so toggling the
 * mask LAST would leave them closed over the pre-mask render — and a mutation
 * that encoded `shownPayload` would then slip through on a stale closure rather
 * than on being correct. Ticking first (the privacy-minded order anyway: hide,
 * then type the secret) makes the last keystroke rebuild both callbacks, so
 * what they encode is what this render computed.
 */
function fillAndMask() {
  fireEvent.change(screen.getByLabelText("Network name (SSID)"), {
    target: { value: "Cafe; Bar" },
  });
  fireEvent.click(screen.getByLabelText("Hide password characters"));
  fireEvent.change(screen.getByLabelText("Network password"), {
    target: { value: "hunter22" },
  });
}

/*
  `wifi-qr.test.ts` covers the payload builder; what it cannot see is the
  WIRING — that the SSID box feeds the payload and that the security chips
  blank the P field.
*/
describe("WifiQrCodeUI", () => {
  beforeEach(() => {
    qr.toCanvas.mockClear();
    qr.toString.mockClear();
    download.triggerDownload.mockClear();
  });

  it("escapes the payload as it is typed, and blanks P for an open network", () => {
    const { container } = render(<WifiQrCodeUI />);
    const payload = () => container.querySelector("pre code")!.textContent;

    expect(payload()).toBe("WIFI:T:WPA;S:;P:;H:false;;");

    fireEvent.change(screen.getByLabelText("Network name (SSID)"), {
      target: { value: "Cafe; Bar" },
    });
    fireEvent.change(screen.getByLabelText("Network password"), {
      target: { value: "hunter22" },
    });
    expect(payload()).toBe(REAL);

    // Masking hides it in this view only; the code still carries the real one.
    fireEvent.click(screen.getByLabelText("Hide password characters"));
    expect(payload()).toBe(String.raw`WIFI:T:WPA;S:Cafe\; Bar;P:••••••••;H:false;;`);

    fireEvent.click(screen.getByText("Open"));
    expect(payload()).toBe(String.raw`WIFI:T:nopass;S:Cafe\; Bar;P:;H:false;;`);
    expect(payload()).not.toContain("hunter22");

    expect(screen.getByRole("button", { name: "Generate QR Code" })).toBeInTheDocument();
  });

  /*
    THE MASKING PROMISE.

    With "Hide password characters" ticked the page states, in so many words,
    that masking "does not change the code: the square still encodes the real
    password, and Copy still copies it". That sentence is the reason it is safe
    to tick the box before screenshotting a code for a guest network — and until
    these three tests it was checked by nothing. Encoding `shownPayload` instead
    of `payload` at either call site would ship a square that scans, offers to
    join, and then fails on a password of eight bullet characters, under a page
    that promised that could not happen.

    The three assertions are one per surface a user can walk away with: the
    on-screen/PNG code, the SVG file, and the clipboard.
  */
  describe("masking is a view, not an edit", () => {
    it("encodes the real password into the square even while masked", async () => {
      render(<WifiQrCodeUI />);
      fillAndMask();

      fireEvent.click(screen.getByRole("button", { name: "Generate QR Code" }));

      await waitFor(() => expect(qr.toCanvas).toHaveBeenCalledTimes(1));
      // toCanvas(canvas, text, options) — the second argument is what is drawn.
      const encoded = qr.toCanvas.mock.calls[0][1];
      expect(encoded).toBe(REAL);
      expect(encoded).not.toContain("•");
    });

    it("writes the real password into the downloaded SVG", async () => {
      render(<WifiQrCodeUI />);
      fillAndMask();

      fireEvent.click(screen.getByRole("button", { name: "Generate QR Code" }));
      // Download SVG only exists once the canvas is fresh for this payload.
      const svgButton = await screen.findByRole("button", { name: "Download SVG" });
      fireEvent.click(svgButton);

      await waitFor(() => expect(qr.toString).toHaveBeenCalledTimes(1));
      const encoded = qr.toString.mock.calls[0][0];
      expect(encoded).toBe(REAL);
      expect(encoded).not.toContain("•");
      await waitFor(() => expect(download.triggerDownload).toHaveBeenCalledTimes(1));
    });

    it("copies the real password, not the bullets on screen", async () => {
      const writeText = vi.fn(async (_text: string) => undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      const { container } = render(<WifiQrCodeUI />);
      fillAndMask();

      // The view really is masked — otherwise this test proves nothing.
      expect(container.querySelector("pre code")!.textContent).toContain("••••••••");

      fireEvent.click(screen.getByRole("button", { name: "Copy payload" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0][0]).toBe(REAL);
    });
  });
});
