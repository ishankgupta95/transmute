import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { HmacGeneratorUI } from "@/components/tools/HmacGeneratorUI";

// Polyfill crypto.subtle for jsdom — the MACs below are computed by real
// WebCrypto on the test thread, not stubbed.
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import("node:crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { ...globalThis.crypto, subtle: webcrypto.subtle },
    });
  }
});

describe("HmacGeneratorUI", () => {
  it("computes the RFC 4231 case 2 vector through the UI", async () => {
    render(<HmacGeneratorUI />);
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "Jefe" } });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "what do ya want for nothing?" },
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        ),
      ).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("Expected MAC"), {
      target: {
        value:
          "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
      },
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Match");
    });
  });

  it("warns when a hex key is being read as text", async () => {
    render(<HmacGeneratorUI />);
    fireEvent.change(screen.getByLabelText("Secret key"), {
      target: { value: "0123456789abcdef0123456789abcdef" },
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("hex characters");
    });
  });

  it("reports an unreadable hex key as an error", async () => {
    render(<HmacGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "Hex" }));
    fireEvent.change(screen.getByLabelText("Secret key"), { target: { value: "zz" } });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("not a hex digit");
    });
  });
});
