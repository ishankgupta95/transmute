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

// Mock DropZone to avoid complex file drag interactions
vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({
    onFiles,
  }: {
    onFiles: (files: File[]) => void;
    accept: string;
  }) => (
    <button
      data-testid="dropzone"
      onClick={() => {
        const file = new File(["hello world"], "test.txt", {
          type: "text/plain",
        });
        onFiles([file]);
      }}
    >
      Drop file here
    </button>
  ),
}));

describe("HashGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
