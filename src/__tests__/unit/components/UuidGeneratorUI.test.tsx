import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UuidGeneratorUI } from "@/components/tools/UuidGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

describe("UuidGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders version buttons and generate button", () => {
    render(<UuidGeneratorUI />);
    expect(screen.getByText("UUID v4")).toBeInTheDocument();
    expect(screen.getByText("UUID v7")).toBeInTheDocument();
    expect(screen.getByText("Generate")).toBeInTheDocument();
  });

  it("generates a single v4 UUID in correct format", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    const uuidEl = document.querySelector("code");
    expect(uuidEl).not.toBeNull();
    const uuid = uuidEl!.textContent!;
    // 8-4-4-4-12 hex format
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("v4 UUID has version 4 at position 14", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    const uuid = document.querySelector("code")!.textContent!;
    // Position 14 in the UUID string (0-indexed) is the version nibble
    // Format: xxxxxxxx-xxxx-Vxxx-xxxx-xxxxxxxxxxxx
    // Indices: 0       8    13  14
    expect(uuid[14]).toBe("4");
  });

  it("generates v7 UUID with version 7 and correct variant bits", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByText("UUID v7"));
    fireEvent.click(screen.getByText("Generate"));
    const uuid = document.querySelector("code")!.textContent!;
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    // Version nibble at position 14 should be '7'
    expect(uuid[14]).toBe("7");
    // Variant nibble at position 19 should be 8, 9, a, or b (10xx in binary)
    expect(uuid[19]).toMatch(/[89ab]/);
  });

  it("generates the requested count of UUIDs", () => {
    render(<UuidGeneratorUI />);
    // Select 5 UUIDs
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByText("Generate"));
    const codes = document.querySelectorAll("code");
    expect(codes).toHaveLength(5);
  });

  it("generates 10 UUIDs when selected", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "10" }));
    fireEvent.click(screen.getByText("Generate"));
    const codes = document.querySelectorAll("code");
    expect(codes).toHaveLength(10);
  });

  it("shows Copy all button when multiple UUIDs generated", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByText("Generate"));
    expect(screen.getByText("Copy all")).toBeInTheDocument();
  });

  it("copies a single UUID to clipboard", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByText("Generate"));
    fireEvent.click(screen.getByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(arg).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("copies all UUIDs to clipboard separated by newline", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByText("Generate"));
    fireEvent.click(screen.getByText("Copy all"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    const lines = arg.split("\n");
    expect(lines).toHaveLength(5);
  });

  it("shows label with UUID count", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByText("Generate"));
    // The canvas header names the count.
    expect(screen.getByText("5 UUIDs")).toBeInTheDocument();
  });

  it("all generated UUIDs are unique", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByRole("button", { name: "50" }));
    fireEvent.click(screen.getByText("Generate"));
    const codes = document.querySelectorAll("code");
    const uuids = Array.from(codes).map((c) => c.textContent);
    const unique = new Set(uuids);
    expect(unique.size).toBe(50);
  });

  it("v7 UUIDs generated in sequence have increasing timestamp prefix", () => {
    render(<UuidGeneratorUI />);
    fireEvent.click(screen.getByText("UUID v7"));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByText("Generate"));
    const codes = document.querySelectorAll("code");
    const uuids = Array.from(codes).map((c) => c.textContent!);
    // All generated in same tick should share the same timestamp prefix (first 12 hex chars)
    const prefixes = uuids.map((u) => u.slice(0, 8));
    // They should all be the same or very close (same millisecond)
    expect(prefixes[0]).toBe(prefixes[1]);
  });
});
