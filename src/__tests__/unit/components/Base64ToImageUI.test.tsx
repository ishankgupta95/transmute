import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  This page has one job people cannot check by eye: deciding WHAT a pasted
  string actually is. The prefix in front of a data URI is a label a human
  typed, and `data:image/png;base64,` in front of JPEG bytes is one of the
  commonest pastes there is — so the format, the extension and the download
  name all have to come from the decoded bytes, and the disagreement has to be
  said out loud rather than quietly resolved.

  The other half is the refusals. `atob` throws the identical
  `InvalidCharacterError` for a percent-encoded data URI, a paste that was cut
  short and outright junk, and those three people need three different pieces
  of advice. Every one of them is pinned below, because a regression here does
  not crash — it just tells someone the wrong thing about their clipboard.

  The engine (`@/lib/tools/base64-image`) is NOT mocked: it is DOM-free and
  runs in jsdom, and mocking it would leave the classification this file exists
  to check untested. Only the two things jsdom cannot do are stubbed — the
  object URL and the intrinsic-size decode.

  Copy strings are duplicated rather than imported: a test that reads the
  constant it checks cannot notice the constant changing.
*/

vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => null,
}));

import { Base64ToImageUI } from "@/components/tools/Base64ToImageUI";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];

/** Bytes → standard Base64, the way a person's clipboard would carry them. */
function b64(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Render, then type `text` into the paste pane and press the primary. */
function decode(text: string): void {
  render(<Base64ToImageUI />);
  fireEvent.change(screen.getByLabelText("Base64"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Decode to image" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("Base64ToImageUI — the bytes decide, not the label", () => {
  it("saves a bare payload under the extension its magic bytes earn", () => {
    decode(b64([...PNG_MAGIC, 1, 2, 3]));

    expect(screen.getByText("image.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download image.png" })).toBeInTheDocument();
  });

  it("names a mislabelled data URI from its bytes and says the label was wrong", () => {
    // The paste claims PNG; the bytes are a JPEG SOI. The bytes win.
    decode(`data:image/png;base64,${b64([...JPEG_MAGIC, 0, 0])}`);

    expect(
      screen.getByText(
        "The data: URI says image/png, but the bytes are JPEG. The download is named from the bytes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download image.jpg" })).toBeInTheDocument();
  });

  it("tells a percent-encoded data URI apart from a bad one", () => {
    decode("data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%201%201%22%2F%3E");

    expect(
      screen.getByText(/percent-encoded, not Base64 — there is no ;base64 marker/),
    ).toBeInTheDocument();
    // The generic refusal must NOT be the one that fires here.
    expect(screen.queryByText(/got through all three repairs/)).toBeNull();
  });

  it("tells a paste that was cut short apart from one that is not Base64", () => {
    // 4n + 1 characters: a length no whole Base64 string can have.
    const cut = "iVBORw0KGgoAAAANSUhEUgAAAAEA";
    expect(cut.length % 4, "the fixture must be the length under test").toBe(0);
    decode(`${cut}A`);

    expect(
      screen.getByText(/one character longer than a whole number of four-character/),
    ).toBeInTheDocument();
  });

  it("says how much decoded when the bytes are not an image", () => {
    // 35 characters of plain text: valid Base64, and not an image.
    decode(b64([...Array(35).keys()].map((n) => 65 + (n % 26))));

    expect(
      screen.getByText(/That decoded cleanly into 35 B of data, but the first bytes match no/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
  });

  it("reports the alphabet it had to translate", () => {
    // 0xff bytes guarantee a `/` in the standard alphabet, which is what the
    // URL-safe form replaces — a fixture without one would prove nothing.
    const standard = b64([...PNG_MAGIC, 0xff, 0xff, 0xff]);
    const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
    expect(urlSafe, "the fixture must actually use the URL-safe alphabet").not.toBe(standard);

    decode(urlSafe);

    expect(screen.getByText("URL-safe → standard")).toBeInTheDocument();
  });

  it("says the alphabet was standard when nothing was translated", () => {
    decode(b64([...PNG_MAGIC, 1, 2, 3]));

    expect(screen.getByText("Standard")).toBeInTheDocument();
  });

  it("drops the download the moment the paste changes under it", () => {
    decode(b64([...PNG_MAGIC, 1, 2, 3]));
    expect(screen.getByRole("button", { name: "Download image.png" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Base64"), { target: { value: "something else" } });

    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
  });

  it("names the file from the stem the user typed and the extension it sniffed", () => {
    render(<Base64ToImageUI />);
    fireEvent.change(screen.getByLabelText("File name"), { target: { value: "logo" } });
    fireEvent.change(screen.getByLabelText("Base64"), {
      target: { value: `data:image/png;base64,${b64([...JPEG_MAGIC, 0, 0])}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decode to image" }));

    expect(screen.getByRole("button", { name: "Download logo.jpg" })).toBeInTheDocument();
  });
});
