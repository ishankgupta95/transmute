import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { HashGeneratorUI } from "@/components/tools/HashGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

// Polyfill crypto.subtle.digest for jsdom
beforeAll(async () => {
  if (!globalThis.crypto.subtle) {
    const { webcrypto } = await import("node:crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: { ...globalThis.crypto, subtle: webcrypto.subtle },
    });
  }
});

/*
  The file the mocked zone hands over, swappable per test. A `let` inside the
  factory is not reachable (vi.mock hoists), so it lives in a hoisted box.
*/
const dropped = vi.hoisted(() => ({
  make: (): File => new File(["hello world"], "test.txt", { type: "text/plain" }),
}));

const GOOD_FILE = () => new File(["hello world"], "test.txt", { type: "text/plain" });

// Mock DropZone to avoid complex file drag interactions
vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({
    onFiles,
    practicalLimitNote,
  }: {
    onFiles: (files: File[]) => void;
    accept: string;
    practicalLimitNote?: string;
  }) => (
    <button
      data-testid="dropzone"
      data-practical-limit-note={practicalLimitNote ?? ""}
      onClick={() => {
        onFiles([dropped.make()]);
      }}
    >
      Drop file here
    </button>
  ),
}));

describe("HashGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dropped.make = GOOD_FILE;
  });

  it("renders text mode by default with textarea", () => {
    render(<HashGeneratorUI />);
    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Enter text to hash...")
    ).toBeInTheDocument();
  });

  it("computes hashes for text input", async () => {
    render(<HashGeneratorUI />);
    const textarea = screen.getByPlaceholderText("Enter text to hash...");
    fireEvent.change(textarea, { target: { value: "hello" } });

    // The labels have CSS uppercase class but text content is lowercase
    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(4);
    });
  });

  it("produces hex strings of correct length for each algorithm", async () => {
    render(<HashGeneratorUI />);
    const textarea = screen.getByPlaceholderText("Enter text to hash...");
    fireEvent.change(textarea, { target: { value: "test" } });

    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(4);
      // MD5 = 32 hex chars
      expect(codes[0].textContent).toMatch(/^[0-9a-f]{32}$/);
      // SHA-1 = 40 hex chars
      expect(codes[1].textContent).toMatch(/^[0-9a-f]{40}$/);
      // SHA-256 = 64 hex chars
      expect(codes[2].textContent).toMatch(/^[0-9a-f]{64}$/);
      // SHA-512 = 128 hex chars
      expect(codes[3].textContent).toMatch(/^[0-9a-f]{128}$/);
    });
  });

  it("switches to file mode and shows dropzone", () => {
    render(<HashGeneratorUI />);
    fireEvent.click(screen.getByText("File"));
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
  });

  it("computes hashes for file input", async () => {
    render(<HashGeneratorUI />);
    fireEvent.click(screen.getByText("File"));
    fireEvent.click(screen.getByTestId("dropzone"));

    await waitFor(() => {
      expect(screen.getByText(/test\.txt/)).toBeInTheDocument();
    });

    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(4);
      codes.forEach((code) => {
        expect(code.textContent).toMatch(/^[0-9a-f]+$/);
      });
    });
  });

  it("clears hashes when switching modes", async () => {
    render(<HashGeneratorUI />);
    const textarea = screen.getByPlaceholderText("Enter text to hash...");
    fireEvent.change(textarea, { target: { value: "hello" } });

    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(4);
    });

    // Switch to file mode should clear hashes
    fireEvent.click(screen.getByText("File"));
    const codes = document.querySelectorAll("code");
    expect(codes.length).toBe(0);
  });

  it("copies hash value to clipboard", async () => {
    render(<HashGeneratorUI />);
    const textarea = screen.getByPlaceholderText("Enter text to hash...");
    fireEvent.change(textarea, { target: { value: "hello" } });

    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(4);
    });

    const copyButtons = screen.getAllByText("Copy");
    fireEvent.click(copyButtons[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(arg).toMatch(/^[0-9a-f]+$/);
  });

  it("clears hashes when text is emptied", async () => {
    render(<HashGeneratorUI />);
    const textarea = screen.getByPlaceholderText("Enter text to hash...");
    fireEvent.change(textarea, { target: { value: "hello" } });

    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(4);
    });

    fireEvent.change(textarea, { target: { value: "" } });
    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(0);
    });
  });

  /*
    The File arm reads the whole file into ONE ArrayBuffer, and past V8's
    single-allocation wall that read REJECTS. Before this, the rejection
    escaped `handleFiles` unhandled and the surface just sat there: the file
    name, no digests, no progress bar, no message. Reproduced live with a
    2.2 GB ISO, under a drop zone that said "NO SIZE CAP".
  */
  it("says so when the whole-file read is refused, instead of showing nothing", async () => {
    dropped.make = () => {
      const big = new File([], "big.iso");
      Object.defineProperty(big, "arrayBuffer", {
        value: () =>
          Promise.reject(
            new DOMException("The requested file could not be read", "NotReadableError"),
          ),
      });
      return big;
    };

    render(<HashGeneratorUI />);
    fireEvent.click(screen.getByText("File"));
    fireEvent.click(screen.getByTestId("dropzone"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/big\.iso/);
    expect(alert.textContent).toMatch(/one buffer/i);
    expect(document.querySelectorAll("code").length).toBe(0);
  });

  it("does not print the absolute no-cap claim over that read", () => {
    // The zone's note comes off the registry, so the sentence under the zone
    // and the MAX SIZE row on the page cannot drift apart.
    render(<HashGeneratorUI />);
    fireEvent.click(screen.getByText("File"));
    const note = screen.getByTestId("dropzone").getAttribute("data-practical-limit-note");
    expect(note, "the drop zone is back to NO SIZE CAP").toBeTruthy();
    expect(note).toMatch(/one piece/);
  });

  it("produces known MD5 hash for 'hello'", async () => {
    render(<HashGeneratorUI />);
    const textarea = screen.getByPlaceholderText("Enter text to hash...");
    fireEvent.change(textarea, { target: { value: "hello" } });

    await waitFor(() => {
      const codes = document.querySelectorAll("code");
      expect(codes.length).toBe(4);
      // MD5 of "hello" = 5d41402abc4b2a76b9719d911017c592
      expect(codes[0].textContent).toBe("5d41402abc4b2a76b9719d911017c592");
    });
  });
});
