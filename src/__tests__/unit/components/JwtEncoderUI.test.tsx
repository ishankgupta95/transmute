import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { JwtEncoderUI } from "@/components/tools/JwtEncoderUI";

// Polyfill crypto.subtle for jsdom — the signing path is real WebCrypto, so the
// token below is genuinely computed rather than stubbed.
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) {
    const { webcrypto } = await import("node:crypto");
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { ...globalThis.crypto, subtle: webcrypto.subtle },
    });
  }
});

/** The value span of one `StatStrip` cell, so its tone class is readable. */
function statValue(label: string): HTMLElement {
  const cell = screen.getByText(label).parentElement;
  if (!cell) throw new Error(`no stat cell for ${label}`);
  const value = cell.querySelector("span:last-child");
  if (!value) throw new Error(`no value span in the ${label} cell`);
  return value as HTMLElement;
}

describe("JwtEncoderUI", () => {
  it("signs the seeded example on mount", async () => {
    render(<JwtEncoderUI />);
    await waitFor(() => {
      expect(screen.getByLabelText("Signed JWT").textContent).toBe(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      );
    });
    // The seeded secret makes the signature forgeable, so the surface has to
    // say so. `getByRole("status")` alone passed against any warning at all;
    // name the one that has to be there.
    expect(screen.getAllByRole("status").map((n) => n.textContent).join(" ")).toContain(
      "anyone can forge a token that verifies against it",
    );
  });

  /*
    `your-256-bit-secret` is jwt.io's debugger placeholder. It is in no JOSE
    RFC: RFC 7515 App. A.1's HS256 example signs with a 64-byte key and lands
    on `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`. Attributing the seeded
    secret to "the JWT specification's own worked example" sent anyone who
    checked to a page that says something else, so the warning must not.
  */
  it("attributes the seeded secret to jwt.io, not to the specification", async () => {
    render(<JwtEncoderUI />);
    await waitFor(() => expect(screen.getByLabelText("Signed JWT")).toBeInTheDocument());
    const warnings = screen.getAllByRole("status").map((n) => n.textContent ?? "");
    const seeded = warnings.find((t) => t.includes("your-256-bit-secret"));
    expect(seeded).toBeDefined();
    expect(seeded).toContain("jwt.io");
    expect(seeded).not.toContain("specification");
    // 19 bytes of text, whatever the name says — and the strip beside it
    // already prints 19 BYTES, so the warning cannot claim 256 bits.
    expect(seeded).toContain("19 bytes");
    expect(statValue("SECRET").textContent).toBe("19 BYTES");
  });

  it("switching algorithm rewrites the header and re-signs", async () => {
    render(<JwtEncoderUI />);
    fireEvent.click(screen.getByRole("button", { name: "HS512" }));
    await waitFor(() => {
      expect(
        (screen.getByLabelText("JWT header JSON") as HTMLTextAreaElement).value,
      ).toContain("HS512");
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Signed JWT").textContent).not.toContain("SflKxw");
    });
  });

  it("clicking an exp preset adds exp and does not corrupt the payload", () => {
    render(<JwtEncoderUI />);
    fireEvent.click(screen.getByRole("button", { name: "1 hour" }));
    const pane = screen.getByLabelText("JWT payload JSON") as HTMLTextAreaElement;
    expect(pane.value).toContain('"exp"');
    expect(pane.value).toContain('"iat": 1516239022');
  });

  it("does not move the algorithm picker when the header cannot be rewritten", async () => {
    render(<JwtEncoderUI />);
    const pane = screen.getByLabelText("JWT header JSON") as HTMLTextAreaElement;
    // A normal mid-edit state: the closing brace is not typed yet.
    fireEvent.change(pane, { target: { value: '{\n  "alg": "HS256",\n  "typ": "JWT"' } });
    fireEvent.click(screen.getByRole("button", { name: "HS512" }));
    expect(pane.value).not.toContain("HS512");
    // The picker must not run ahead of the header it claims to write into —
    // the page would then report an alg mismatch it caused itself.
    expect(screen.getByRole("button", { name: "HS512" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "HS256" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(screen.getByText(/picker cannot write/)).toBeInTheDocument(),
    );
  });

  it("takes the previous secret's token off screen the instant the secret changes", async () => {
    render(<JwtEncoderUI />);
    await waitFor(() =>
      expect(screen.getByLabelText("Signed JWT").textContent).toContain(
        "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      ),
    );
    fireEvent.change(screen.getByLabelText("Signing secret"), {
      target: { value: "totally-different-secret" },
    });
    // Read the DOM synchronously, in the frame the keystroke painted: signing
    // is async, so this is exactly the window in which a stale token sat under
    // a fresh key length with a live Copy button over it.
    expect(screen.queryByLabelText("Signed JWT")).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Copy token$/ })).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByLabelText("Signed JWT").textContent).not.toContain("SflKxw"),
    );
  });

  it("does not paint a missing expiry green", async () => {
    render(<JwtEncoderUI />);
    await waitFor(() => expect(screen.getByLabelText("Signed JWT")).toBeInTheDocument());
    const value = statValue("EXPIRES");
    expect(value.textContent).toBe("NO EXP");
    // Green on this strip means "healthy". A token that never expires is the
    // state this page's own copy treats as worth flagging.
    expect(value.className).not.toContain("text-success");
    expect(value.className).toContain("text-neutral-300");
  });

  it("does not report an unusable exp as NO EXP", async () => {
    render(<JwtEncoderUI />);
    fireEvent.change(screen.getByLabelText("JWT payload JSON"), {
      target: { value: '{\n  "sub": "1",\n  "exp": "1516239022"\n}' },
    });
    await waitFor(() => expect(screen.getByLabelText("Signed JWT")).toBeInTheDocument());
    const value = statValue("EXPIRES");
    // The claim IS there — quoted, as a shell template or a config file hands
    // it to you. Saying "NO EXP" in green asserts the opposite of the truth.
    expect(value.textContent).toBe("UNREADABLE");
    expect(value.className).not.toContain("text-success");
    const warning = screen
      .getAllByRole("status")
      .map((n) => n.textContent ?? "")
      .find((t) => t.includes("exp claim"));
    // The warning quotes the value back rather than describing it generically.
    expect(warning).toContain('"1516239022"');
    expect(warning).toContain("a string, and exp is a number of seconds since 1970");
    expect(warning).toContain("does carry an expiry");
  });

  it("says why a numeric exp is unreadable rather than calling it not a number", async () => {
    render(<JwtEncoderUI />);
    // 1e20 seconds is past the end of the range a Date can be read from — the
    // other half of `describeInstant` returning null.
    fireEvent.change(screen.getByLabelText("JWT payload JSON"), {
      target: { value: '{\n  "sub": "1",\n  "exp": 1e20\n}' },
    });
    await waitFor(() => expect(screen.getByLabelText("Signed JWT")).toBeInTheDocument());
    expect(statValue("EXPIRES").textContent).toBe("UNREADABLE");
    const warning = screen
      .getAllByRole("status")
      .map((n) => n.textContent ?? "")
      .find((t) => t.includes("exp claim"));
    expect(warning).toContain("outside the range a date can be read from");
    // It IS a number. Only the string branch may say otherwise.
    expect(warning).not.toContain("a string, and exp is");
  });
});
