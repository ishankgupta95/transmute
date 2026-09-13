import { describe, expect, it } from "vitest";

import { DEFAULT_COST, hashPassword, verifyPassword } from "@/lib/tools/bcrypt";

/*
  bcrypt. Pure JS, no canvas and no wasm, so it is genuinely testable here —
  but every case uses a LOW cost factor: the work factor doubles per step and
  the default would make this file take seconds for no extra coverage.
*/

const FAST = 4;

describe("hashPassword", () => {
  it("produces a $2b$ hash carrying its own cost and salt", async () => {
    const { hash, parts } = await hashPassword("correct horse", FAST);
    expect(hash).toMatch(/^\$2[abxy]\$04\$.{53}$/);
    expect(parts.cost).toBe(FAST);
    expect(parts.salt).toHaveLength(22);
  });

  it("gives a different hash every time, because the salt is random", async () => {
    // The property that makes bcrypt worth using: identical passwords must not
    // produce identical hashes, or a stolen table is a lookup table.
    const a = await hashPassword("same", FAST);
    const b = await hashPassword("same", FAST);
    expect(a.hash).not.toBe(b.hash);
    // …and both still verify.
    await expect(verifyPassword("same", a.hash)).resolves.toBe("match");
    await expect(verifyPassword("same", b.hash)).resolves.toBe("match");
  });

  it("clamps a cost outside the supported range instead of throwing", async () => {
    const low = await hashPassword("x", 1);
    expect(low.parts.cost).toBe(4);
    const high = await hashPassword("x", 99);
    expect(high.parts.cost).toBe(14);
  }, 60_000);

  it("refuses an empty password rather than hashing nothing", async () => {
    await expect(hashPassword("", FAST)).rejects.toThrow(/type a password/i);
  });
});

describe("verifyPassword", () => {
  it("tells a wrong password apart from a malformed hash", async () => {
    /*
      THE THIRD OUTCOME. Collapsing "not a hash" into "no match" would tell
      someone their password is wrong when what is wrong is the thing they
      pasted — the failure this function exists to avoid.
    */
    const { hash } = await hashPassword("right", FAST);
    expect(await verifyPassword("right", hash)).toBe("match");
    expect(await verifyPassword("wrong", hash)).toBe("no-match");
    expect(await verifyPassword("right", "not a hash at all")).toBe("not-a-hash");
    expect(await verifyPassword("right", "$2b$12$tooshort")).toBe("not-a-hash");
  });

  it("ignores surrounding whitespace, which a paste always brings", async () => {
    const { hash } = await hashPassword("padded", FAST);
    expect(await verifyPassword("padded", `  ${hash}\n`)).toBe("match");
  });

  it("has a default cost in the range it advertises", () => {
    expect(DEFAULT_COST).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_COST).toBeLessThanOrEqual(14);
  });
});
