import { describe, expect, it } from "vitest";
import { jfifToJpg, NOT_JPEG_MESSAGE } from "@/lib/tools/jfif-to-jpg";
import { gifBytes } from "./image-byte-fixtures";

/**
 * jfif-to-jpg is pure byte logic — no canvas, no worker — so unlike the rest
 * of the image pipeline it is FULLY testable in jsdom. These pin the whole
 * contract: SOI gate, byte identity, and the name mapping.
 */

/** JPEG SOI + APP0 header prefix, then deliberately arbitrary payload bytes. */
function jpegBytes(payloadLength = 64): Uint8Array {
  const bytes = new Uint8Array(4 + payloadLength);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 0; i < payloadLength; i++) bytes[4 + i] = (i * 31 + 7) & 0xff;
  return bytes;
}

function fileOf(bytes: Uint8Array, name: string, type = "image/jpeg"): File {
  return new File([bytes as BlobPart], name, { type });
}

describe("jfifToJpg", () => {
  it("accepts JPEG bytes and returns them byte-identical", async () => {
    const input = jpegBytes();
    const result = await jfifToJpg(fileOf(input, "photo.jfif"));

    const output = new Uint8Array(await result.blob.arrayBuffer());
    expect(output).toEqual(input); // the whole point: nothing re-encoded
    expect(result.blob.type).toBe("image/jpeg");
    expect(result.fileName).toBe("photo.jpg");
    expect(result.originalSize).toBe(input.length);
    expect(result.newSize).toBe(input.length);
    expect(result.newSize).toBe(result.originalSize);
  });

  it("accepts the minimal two-byte SOI marker", async () => {
    const result = await jfifToJpg(fileOf(new Uint8Array([0xff, 0xd8]), "tiny.jfif"));
    expect(result.fileName).toBe("tiny.jpg");
    expect(result.newSize).toBe(2);
  });

  it("rejects non-JPEG bytes wearing a .jfif name", async () => {
    // A real (if minimal) GIF — magic bytes decide, the extension lies.
    await expect(jfifToJpg(fileOf(gifBytes(1), "fake.jfif"))).rejects.toThrow(
      NOT_JPEG_MESSAGE,
    );
  });

  it("rejects empty and one-byte files", async () => {
    await expect(jfifToJpg(fileOf(new Uint8Array(0), "empty.jfif"))).rejects.toThrow(
      NOT_JPEG_MESSAGE,
    );
    await expect(jfifToJpg(fileOf(new Uint8Array([0xff]), "one.jfif"))).rejects.toThrow(
      NOT_JPEG_MESSAGE,
    );
  });

  it("rejects bytes that start with only half the SOI marker", async () => {
    await expect(
      jfifToJpg(fileOf(new Uint8Array([0xff, 0xd9, 0xff, 0xd8]), "eoi-first.jfif")),
    ).rejects.toThrow(NOT_JPEG_MESSAGE);
  });

  it.each([
    ["photo.jfif", "photo.jpg"],
    ["IMG_0042.JFIF", "IMG_0042.jpg"], // uppercase extension still strips
    ["archive.backup.jfif", "archive.backup.jpg"], // only the FINAL extension goes
    ["photo", "photo.jpg"], // no extension at all
    [".jfif", "image.jpg"], // extension-only name gets a real base
    ["photo.jpeg", "photo.jpg"], // alias collapses
  ])("maps %s → %s", async (input, expected) => {
    const result = await jfifToJpg(fileOf(jpegBytes(), input));
    expect(result.fileName).toBe(expected);
  });

  it("is idempotent for a file already named .jpg", async () => {
    const input = jpegBytes(32);
    const result = await jfifToJpg(fileOf(input, "already.jpg"));
    expect(result.fileName).toBe("already.jpg");
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(input);
  });
});
