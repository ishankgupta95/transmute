import { test, expect, type Page } from "@playwright/test";
import { createHash, createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { downloadBytes, waitForDownload } from "../helpers";

/**
 * Output-value correctness for the generators / signers / hashers.
 *
 * Expected values come from Node (crypto, bcryptjs) or from reading the
 * produced image back with the site's own QR reader, never from the page
 * under test. Locators are scoped to `[data-tool-surface]` because the FAQ
 * copy below it repeats UI strings.
 */

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

// First hit on a route compiles it in the shared dev server; give it room.
test.beforeEach(() => {
  test.setTimeout(120_000);
});

const b64url = (b: Buffer) => b.toString("base64url");
const decodeSeg = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

async function region(page: Page, name: string): Promise<string> {
  const r = surfaceOf(page).getByRole("region", { name, exact: true });
  await expect(r).toBeVisible();
  return ((await r.textContent()) ?? "").trim();
}

/** Download the PNG the page offers and read it back with /qr-code-reader. */
async function decodeViaReader(page: Page, png: Buffer, expected: string, everyFormat = false): Promise<void> {
  const reader = await page.context().newPage();
  try {
    await reader.goto("/qr-code-reader");
    const input = reader.locator('input[type="file"]').first();
    await input.waitFor({ state: "attached" });
    // The reader is "QR only" by default; linear codes need "Every format".
    if (everyFormat) await surfaceOf(reader).getByRole("button", { name: "Every format", exact: true }).click();
    await input.setInputFiles({ name: "code.png", mimeType: "image/png", buffer: png });
    await expect(surfaceOf(reader).getByText(expected, { exact: true })).toBeVisible({ timeout: 60_000 });
  } finally {
    await reader.close();
  }
}

test.describe("jwt-encoder", () => {
  test("default HS256 token is signed with the secret (verified with Node crypto)", async ({ page }) => {
    await page.goto("/jwt-encoder");
    const token = await region(page, "Signed JWT");
    const [h, p, s] = token.split(".");
    expect(decodeSeg(h)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decodeSeg(p)).toMatchObject({ sub: "1234567890" });
    const expected = b64url(createHmac("sha256", "your-256-bit-secret").update(`${h}.${p}`).digest());
    expect(s).toBe(expected);
  });

  test("custom payload + secret + HS512 re-signs correctly", async ({ page }) => {
    await page.goto("/jwt-encoder");
    const surface = surfaceOf(page);
    const payload = { sub: "abc", role: "admin", n: 7, uni: "héllo" };
    await surface.getByLabel("JWT payload JSON").fill(JSON.stringify(payload));
    await surface.getByLabel("Signing secret").fill("s3cr3t-ü");
    await surface.getByRole("button", { name: "HS512", exact: true }).click();
    await expect
      .poll(async () => decodeSeg((await region(page, "Signed JWT")).split(".")[0]).alg)
      .toBe("HS512");
    const token = await region(page, "Signed JWT");
    const [h, p, s] = token.split(".");
    expect(decodeSeg(p)).toEqual(payload);
    expect(s).toBe(b64url(createHmac("sha512", "s3cr3t-ü").update(`${h}.${p}`).digest()));
  });
});

test.describe("hmac-generator", () => {
  const MSG = "The quick brown fox";

  test("HMAC-SHA-256 hex and base64 equal Node's", async ({ page }) => {
    await page.goto("/hmac-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Message").fill(MSG);
    await surface.getByLabel("Secret key").fill("key");
    const mac = createHmac("sha256", "key").update(MSG);
    const raw = mac.digest();
    await expect(surface).toContainText(raw.toString("hex"));
    await expect(surface).toContainText(raw.toString("base64"));
  });

  test("HMAC-SHA-512 with a hex-encoded key uses the decoded bytes", async ({ page }) => {
    await page.goto("/hmac-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Message").fill(MSG);
    await surface.getByRole("button", { name: "SHA-512", exact: true }).click();
    await surface.getByRole("button", { name: "Hex", exact: true }).click();
    await surface.getByLabel("Secret key").fill("deadbeef00ff");
    const raw = createHmac("sha512", Buffer.from("deadbeef00ff", "hex")).update(MSG).digest();
    await expect(surface).toContainText(raw.toString("hex"));
  });

  test("the verify field accepts a correct sha256=… header and flags a wrong one", async ({ page }) => {
    await page.goto("/hmac-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Message").fill(MSG);
    await surface.getByLabel("Secret key").fill("key");
    const hex = createHmac("sha256", "key").update(MSG).digest("hex");
    await surface.getByLabel("Expected MAC").fill(`sha256=${hex}`);
    await expect(surface.getByText(/match/i).first()).toBeVisible();
    const wrong = hex.replace(/^./, hex[0] === "0" ? "1" : "0");
    await surface.getByLabel("Expected MAC").fill(wrong);
    await expect(surface.getByText(/does not match|mismatch|no match|differ/i).first()).toBeVisible();
  });
});

test.describe("hash-generator", () => {
  test("text hashes (ASCII and non-ASCII) equal Node's MD5/SHA-1/SHA-256/SHA-512", async ({ page }) => {
    await page.goto("/hash-generator");
    for (const text of ["hello", "héllo wörld ✓ 日本"]) {
      await surfaceOf(page).locator("textarea").first().fill(text);
      for (const algo of ["md5", "sha1", "sha256", "sha512"]) {
        await expect(surfaceOf(page)).toContainText(createHash(algo).update(text, "utf8").digest("hex"));
      }
    }
  });

  test("file mode hashes the exact bytes", async ({ page }) => {
    await page.goto("/hash-generator");
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    await surfaceOf(page).getByRole("button", { name: "File", exact: true }).click();
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: "attached" });
    await input.setInputFiles({ name: "bytes.bin", mimeType: "application/octet-stream", buffer: bytes });
    for (const algo of ["md5", "sha1", "sha256", "sha512"]) {
      await expect(surfaceOf(page)).toContainText(createHash(algo).update(bytes).digest("hex"), { timeout: 30_000 });
    }
  });
});

test.describe("bcrypt-generator", () => {
  test("the page's hash verifies against the password with bcryptjs in Node", async ({ page }) => {
    await page.goto("/bcrypt-generator");
    const surface = surfaceOf(page);
    const pw = surface.getByPlaceholder("correct horse battery staple");
    await pw.waitFor({ state: "visible", timeout: 60_000 });
    await pw.fill("hunter2 ünï");
    await surface.getByRole("button", { name: /GENERATE HASH/i }).click();
    const hashEl = surface.getByRole("region", { name: "Hash" });
    await expect(hashEl).toHaveText(/^\$2[abxy]\$\d{2}\$.{53}$/, { timeout: 90_000 });
    const hash = ((await hashEl.textContent()) ?? "").trim();
    expect(bcrypt.compareSync("hunter2 ünï", hash)).toBe(true);
    expect(bcrypt.compareSync("hunter3 ünï", hash)).toBe(false);
  });
});

test.describe("password-generator", () => {
  async function setLength(page: Page, n: number) {
    await page.locator('input[type="range"]').evaluate((el: HTMLInputElement, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, n);
  }
  const passwords = (page: Page) => surfaceOf(page).locator("code").allInnerTexts();

  test("digits-only, length 12, batch of 20: every password obeys both rules", async ({ page }) => {
    await page.goto("/password-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Uppercase").uncheck();
    await surface.getByLabel("Lowercase").uncheck();
    await surface.getByLabel("Symbols").uncheck();
    await setLength(page, 12);
    await surface.getByRole("button", { name: "20", exact: true }).click();
    await surface.getByRole("button", { name: "Generate", exact: true }).click();
    const list = await passwords(page);
    expect(list).toHaveLength(20);
    for (const pw of list) expect(pw).toMatch(/^\d{12}$/);
    expect(new Set(list).size).toBeGreaterThan(15); // not a constant string
  });

  test("all classes on: every password has one of each class at exactly the length", async ({ page }) => {
    await page.goto("/password-generator");
    const surface = surfaceOf(page);
    await setLength(page, 10);
    await surface.getByRole("button", { name: "20", exact: true }).click();
    await surface.getByRole("button", { name: "Generate", exact: true }).click();
    const list = await passwords(page);
    expect(list).toHaveLength(20);
    for (const pw of list) {
      expect(pw).toHaveLength(10);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/\d/);
      expect(pw).toMatch(/[^A-Za-z0-9]/);
    }
  });

  test("letters-only never emits a digit or symbol", async ({ page }) => {
    await page.goto("/password-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Numbers").uncheck();
    await surface.getByLabel("Symbols").uncheck();
    await setLength(page, 30);
    await surface.getByRole("button", { name: "20", exact: true }).click();
    await surface.getByRole("button", { name: "Generate", exact: true }).click();
    for (const pw of await passwords(page)) expect(pw).toMatch(/^[A-Za-z]{30}$/);
  });
});

test.describe("lorem-ipsum-generator", () => {
  test("paragraph count is honoured for 1 and 5", async ({ page }) => {
    await page.goto("/lorem-ipsum-generator");
    const surface = surfaceOf(page);
    for (const n of [1, 5]) {
      await surface.locator('input[type="number"]').fill(String(n));
      await surface.getByRole("button", { name: "Generate", exact: true }).click();
      const text = (await surface.locator(".whitespace-pre-wrap").innerText()).trim();
      expect(text.split(/\n\s*\n/)).toHaveLength(n);
    }
  });

  test("sentence count is honoured (each ends with a full stop)", async ({ page }) => {
    await page.goto("/lorem-ipsum-generator");
    const surface = surfaceOf(page);
    await surface.getByRole("button", { name: "Sentences", exact: true }).click();
    await surface.locator('input[type="number"]').fill("4");
    await surface.getByRole("button", { name: "Generate", exact: true }).click();
    const text = (await surface.locator(".whitespace-pre-wrap").innerText()).trim();
    expect(text.match(/[.!?](\s|$)/g)).toHaveLength(4);
  });
});

test.describe("qr / barcode generators decode back to their input", () => {
  test("qr-code-generator PNG decodes to the exact input text", async ({ page }) => {
    const payload = "https://transmute.tools/?q=hello world&x=é";
    await page.goto("/qr-code-generator");
    await surfaceOf(page).locator("textarea").first().fill(payload);
    await surfaceOf(page).getByRole("button", { name: "Generate QR Code" }).click();
    const { download } = await waitForDownload(page, page.getByRole("button", { name: "Download PNG" }));
    await decodeViaReader(page, await downloadBytes(download), payload);
  });

  test("wifi-qr-code payload escapes ; : \\ and the PNG decodes to that payload", async ({ page }) => {
    await page.goto("/wifi-qr-code");
    const surface = surfaceOf(page);
    await surface.getByLabel("Network name (SSID)").fill("My;Net");
    await surface.getByLabel("Network password").fill("pa:ss;wd\\1");
    const expected = "WIFI:T:WPA;S:My\\;Net;P:pa\\:ss\\;wd\\\\1;H:false;;";
    expect(await region(page, "Encoded payload")).toBe(expected);

    await surface.getByLabel("This network does not broadcast its name").check();
    expect(await region(page, "Encoded payload")).toBe(expected.replace("H:false", "H:true"));
    await surface.getByLabel("This network does not broadcast its name").uncheck();

    await surface.getByRole("button", { name: "Generate QR Code" }).click();
    const dl = surface.getByRole("button", { name: /Download/ }).first();
    const { download } = await waitForDownload(page, dl);
    const bytes = await downloadBytes(download);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("89504e47");
    await decodeViaReader(page, bytes, expected);
  });

  test("wifi-qr-code open network carries no password, and a hex-looking SSID is quoted", async ({ page }) => {
    await page.goto("/wifi-qr-code");
    const surface = surfaceOf(page);
    await surface.getByLabel("Network name (SSID)").fill("Guest Cafe");
    await surface.getByRole("button", { name: "Open", exact: true }).click();
    expect(await region(page, "Encoded payload")).toBe("WIFI:T:nopass;S:Guest Cafe;P:;H:false;;");

    // "Cafe" is all hex digits: unquoted, a reader may take it as raw bytes.
    await surface.getByLabel("Network name (SSID)").fill("Cafe");
    expect(await region(page, "Encoded payload")).toBe('WIFI:T:nopass;S:"Cafe";P:;H:false;;');
  });

  test("barcode-generator EAN-13 appends the correct check digit", async ({ page }) => {
    await page.goto("/barcode-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Symbology").selectOption({ label: "EAN-13" });
    await surface.locator("textarea").first().fill("590123412345");
    // GS1 check digit, computed here: weights 1,3 alternating over the 12 digits.
    const digits = "590123412345".split("").map(Number);
    const sum = digits.reduce((a, d, i) => a + d * (i % 2 === 0 ? 1 : 3), 0);
    const full = `590123412345${(10 - (sum % 10)) % 10}`;
    expect(full).toBe("5901234123457");
    await surface.getByRole("button", { name: "Generate Barcode" }).click();
    await expect(surface.getByText(full, { exact: true }).first()).toBeVisible();
  });

  test("barcode-generator QR symbology PNG decodes to the text", async ({ page }) => {
    await page.goto("/barcode-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Symbology").selectOption({ label: "QR Code" });
    await surface.locator("textarea").first().fill("SHIP-4417-B / ü");
    await surface.getByRole("button", { name: "Generate Barcode" }).click();
    const { download } = await waitForDownload(page, surface.getByRole("button", { name: "Download PNG" }));
    await decodeViaReader(page, await downloadBytes(download), "SHIP-4417-B / ü");
  });

  test("barcode-generator Code 128 PNG decodes to the text (Every format scope)", async ({ page }) => {
    await page.goto("/barcode-generator");
    const surface = surfaceOf(page);
    await surface.locator("textarea").first().fill("SHIP-4417-B");
    await surface.getByRole("button", { name: "Generate Barcode" }).click();
    const { download } = await waitForDownload(page, surface.getByRole("button", { name: "Download PNG" }));
    await decodeViaReader(page, await downloadBytes(download), "SHIP-4417-B", true);
  });

  test("barcode-generator EAN-13 PNG decodes to the 13 digits including the check digit", async ({ page }) => {
    await page.goto("/barcode-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Symbology").selectOption({ label: "EAN-13" });
    await surface.locator("textarea").first().fill("590123412345");
    await surface.getByRole("button", { name: "Generate Barcode" }).click();
    const { download } = await waitForDownload(page, surface.getByRole("button", { name: "Download PNG" }));
    await decodeViaReader(page, await downloadBytes(download), "5901234123457", true);
  });

  test("barcode-generator Code 39 PNG decodes to the text", async ({ page }) => {
    await page.goto("/barcode-generator");
    const surface = surfaceOf(page);
    await surface.getByLabel("Symbology").selectOption({ label: "Code 39" });
    await surface.locator("textarea").first().fill("ABC-123");
    await surface.getByRole("button", { name: "Generate Barcode" }).click();
    const { download } = await waitForDownload(page, surface.getByRole("button", { name: "Download PNG" }));
    await decodeViaReader(page, await downloadBytes(download), "ABC-123", true);
  });
});
