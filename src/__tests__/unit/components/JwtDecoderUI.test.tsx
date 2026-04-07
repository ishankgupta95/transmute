import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { JwtDecoderUI } from "@/components/tools/JwtDecoderUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// Helper to create a JWT token from header and payload objects
function makeJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signature = "test-sig",
): string {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode(header)}.${encode(payload)}.${signature}`;
}

describe("JwtDecoderUI", () => {
  it("decodes a valid JWT and shows header and payload", () => {
    const token = makeJwt(
      { alg: "HS256", typ: "JWT" },
      { sub: "123", name: "John" },
    );
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: token } });
    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByText("Payload")).toBeInTheDocument();
    expect(screen.getByText("Signature")).toBeInTheDocument();
    // Check decoded content
    expect(
      screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent?.includes('"alg": "HS256"') === true),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent?.includes('"name": "John"') === true),
    ).toBeInTheDocument();
  });

  it("identifies expired tokens", () => {
    // exp in the past (year 2000)
    const token = makeJwt(
      { alg: "HS256" },
      { sub: "123", exp: 946684800 },
    );
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: token } });
    expect(screen.getByText(/Token is expired/)).toBeInTheDocument();
  });

  it("identifies valid (non-expired) tokens", () => {
    // exp far in the future (year 2100)
    const token = makeJwt(
      { alg: "HS256" },
      { sub: "123", exp: 4102444800 },
    );
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: token } });
    expect(screen.getByText(/Token is valid/)).toBeInTheDocument();
  });

  it("shows error for tokens with wrong number of parts", () => {
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: "only.two" } });
    expect(screen.getByText(/must have 3 parts/)).toBeInTheDocument();
  });

  it("shows error for single segment token", () => {
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: "nodotshere" } });
    expect(screen.getByText(/must have 3 parts/)).toBeInTheDocument();
  });

  it("handles base64url padding correctly", () => {
    // Create a payload that would require padding in standard base64
    const token = makeJwt(
      { alg: "HS256" },
      { data: "a" }, // short payload to test padding
    );
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: token } });
    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent?.includes('"data": "a"') === true),
    ).toBeInTheDocument();
  });

  it("does nothing for empty input", () => {
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByText("Header")).not.toBeInTheDocument();
  });

  it("shows signature section", () => {
    const token = makeJwt(
      { alg: "HS256" },
      { sub: "123" },
      "my-signature",
    );
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: token } });
    expect(screen.getByText("my-signature")).toBeInTheDocument();
  });

  it("does not show expiry info when exp claim is absent", () => {
    const token = makeJwt({ alg: "HS256" }, { sub: "123" });
    render(<JwtDecoderUI />);
    const input = screen.getByPlaceholderText(/eyJhbGci/);
    fireEvent.change(input, { target: { value: token } });
    expect(screen.queryByText(/Token is expired/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Token is valid/)).not.toBeInTheDocument();
  });
});
