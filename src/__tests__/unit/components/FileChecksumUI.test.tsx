import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { FileChecksumUI } from "@/components/tools/FileChecksumUI";

/*
  `checksum-compare.test.ts` covers the lib module; what it cannot see is the
  WIRING — that a dropped file actually reaches the hashing path and that the
  verdict comes back to the screen.

  jsdom has no Worker, so `hashRunsInline()` is true and `computeHashes` runs on
  the test thread against Node's real `crypto.subtle` — the digest below is
  genuinely computed, not stubbed.
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

/** sha256("hello") — the digest the tool has to arrive at on its own. */
const HELLO_SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

function dropGreeting(container: HTMLElement, expected: string) {
  const q = within(container);
  fireEvent.change(q.getByLabelText("Expected checksum"), { target: { value: expected } });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [new File(["hello"], "greeting.txt", { type: "text/plain" })],
    configurable: true,
  });
  fireEvent.change(input);
  return q;
}

describe("FileChecksumUI", () => {
  it("hashes a dropped file and names the algorithm that matched", async () => {
    const { container } = render(<FileChecksumUI />);
    const q = dropGreeting(container, `${HELLO_SHA256}  greeting.txt`);
    // 8000 here would outlive vitest's own 5000ms test timeout, so a genuine
    // regression reported as "Test timed out" instead of naming the missing
    // text. Stay under it and the waitFor's own error is what you read.
    await waitFor(() => expect(q.getAllByText(/matched on SHA-256/).length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    expect(q.getAllByText("MATCH").length).toBeGreaterThan(0);
    // The matching row is marked in the digest list, not just in the banner.
    expect(q.getAllByText("SHA-256 · MATCH").length).toBe(1);
    expect(q.getByText(HELLO_SHA256)).toBeInTheDocument();
  });

  it("says NO MATCH in a role=alert when a byte is off", async () => {
    const { container } = render(<FileChecksumUI />);
    const q = dropGreeting(container, HELLO_SHA256.replace(/.$/, "0"));
    await waitFor(() => expect(q.getAllByText("NO MATCH").length).toBeGreaterThan(0), {
      timeout: 4000,
    });
    expect(q.getByRole("alert").textContent).toContain("does not match");
  });

  /*
    A release page's combined block is one MD5 line and one SHA-256 line. The
    pre-file summary named `entries[0].algorithm` for the whole list, which on
    a page whose premise is that the algorithm is DERIVED rather than assumed
    is the one thing it must not do.
  */
  it("names every algorithm in a mixed list, not just the first line's", () => {
    render(<FileChecksumUI />);
    fireEvent.change(screen.getByLabelText("Expected checksum"), {
      target: {
        value: `d41d8cd98f00b204e9800998ecf8427e  ubuntu.iso\n${"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}  ubuntu.iso`,
      },
    });
    const detail = screen.getByText(/checksums read/);
    expect(detail.textContent).toContain("MD5 and SHA-256");
  });

  it("refuses a truncated paste out loud instead of comparing its prefix", () => {
    render(<FileChecksumUI />);
    fireEvent.change(screen.getByLabelText("Expected checksum"), { target: { value: "nope" } });
    expect(screen.getByText(/NO CHECKSUM FOUND/)).toBeInTheDocument();
  });
});
