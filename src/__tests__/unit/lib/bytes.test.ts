import { describe, it, expect } from "vitest";

import {
  DECIMAL_TWIN,
  LINK_SPEEDS,
  ONE_TB_IN_GIB,
  UNITS,
  convertAll,
  driveShortfall,
  exactBits,
  exactBytes,
  formatDuration,
  formatFixed,
  formatValue,
  fromBits,
  groupDigits,
  parseAmount,
  rat,
  toBits,
  transferSeconds,
  unitById,
  unitsOf,
} from "@/lib/tools/bytes";

const U = (id: string) => unitById(id)!;
const amount = (n: bigint, d = BigInt(1)) => rat(n, d);

describe("unit table", () => {
  it("has unique ids and labels", () => {
    expect(new Set(UNITS.map((u) => u.id)).size).toBe(UNITS.length);
    expect(new Set(UNITS.map((u) => u.label)).size).toBe(UNITS.length);
  });

  it("gives a byte exactly 8 bits", () => {
    expect(U("B").bits).toBe(BigInt(8));
  });

  it("uses powers of 1000 for the decimal family", () => {
    expect(U("kB").bits).toBe(BigInt(8) * BigInt(1000));
    expect(U("MB").bits).toBe(BigInt(8) * BigInt(1000) ** BigInt(2));
    expect(U("TB").bits).toBe(BigInt(8) * BigInt(1000) ** BigInt(4));
  });

  it("uses powers of 1024 for the binary family — the whole point", () => {
    expect(U("KiB").bits).toBe(BigInt(8) * BigInt(1024));
    expect(U("MiB").bits).toBe(BigInt(8) * BigInt(1024) ** BigInt(2));
    expect(U("GiB").bits).toBe(BigInt(8) * BigInt(1024) ** BigInt(3));
    expect(U("TiB").bits).toBe(BigInt(8) * BigInt(1024) ** BigInt(4));
    expect(U("PiB").bits).toBe(BigInt(8) * BigInt(1024) ** BigInt(5));
  });

  it("never lets a decimal and a binary unit at the same level coincide", () => {
    for (const [binary, decimal] of Object.entries(DECIMAL_TWIN)) {
      expect(U(binary).bits).toBeGreaterThan(U(decimal).bits);
    }
  });

  it("splits into three families", () => {
    expect(unitsOf("bits").length).toBeGreaterThan(0);
    expect(unitsOf("decimal").map((u) => u.id)).toContain("B");
    expect(unitsOf("binary").every((u) => u.label.includes("i"))).toBe(true);
  });
});

describe("parseAmount", () => {
  it("reads plain integers and decimals exactly", () => {
    expect(parseAmount("1")).toEqual({ n: BigInt(1), d: BigInt(1) });
    expect(parseAmount("1.5")).toEqual({ n: BigInt(3), d: BigInt(2) });
    expect(parseAmount("0.001")).toEqual({ n: BigInt(1), d: BigInt(1000) });
    expect(parseAmount("  42  ")).toEqual({ n: BigInt(42), d: BigInt(1) });
  });

  it("reads scientific notation", () => {
    expect(parseAmount("1e9")).toEqual({ n: BigInt(1_000_000_000), d: BigInt(1) });
    expect(parseAmount("2.5E-3")).toEqual({ n: BigInt(1), d: BigInt(400) });
  });

  it("accepts underscore and grouped-comma separators", () => {
    expect(parseAmount("1_000_000")).toEqual({ n: BigInt(1_000_000), d: BigInt(1) });
    expect(parseAmount("1,234,567")).toEqual({ n: BigInt(1_234_567), d: BigInt(1) });
  });

  it("refuses an ambiguous comma rather than guessing 1.5 or 1500", () => {
    expect(parseAmount("1,5")).toBeNull();
    expect(parseAmount("1,23")).toBeNull();
  });

  it("refuses negatives, junk and empty input", () => {
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("5 MB")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(".")).toBeNull();
  });

  it("keeps precision a double would lose", () => {
    // 9007199254740993 is 2^53 + 1. A double cannot hold it: converting the
    // BigInt to a number silently yields 2^53, which is what an implementation
    // built on `Number` would have printed as the "exact" byte count.
    const parsed = parseAmount("9007199254740993")!;
    expect(parsed.n).toBe(BigInt("9007199254740993"));
    expect(Number(parsed.n)).toBe(9007199254740992);
  });
});

describe("conversion", () => {
  it("converts a byte count to every unit exactly", () => {
    const bits = toBits(amount(BigInt(1)), U("GiB"));
    expect(exactBytes(bits)).toBe(BigInt(1073741824));
    expect(formatValue(fromBits(bits, U("MiB"))).text).toBe("1,024");
    expect(formatValue(fromBits(bits, U("MB"))).text).toBe("1,073.74");
  });

  it("does the 8× bits-to-bytes step that people get wrong", () => {
    const bits = toBits(amount(BigInt(100)), U("Mbit"));
    expect(formatValue(fromBits(bits, U("MB"))).text).toBe("12.5");
    expect(exactBytes(bits)).toBe(BigInt(12_500_000));
  });

  it("round-trips every unit through bits", () => {
    for (const unit of UNITS) {
      const there = toBits(amount(BigInt(7)), unit);
      expect(fromBits(there, unit)).toEqual({ n: BigInt(7), d: BigInt(1) });
    }
  });

  it("is exact past 2^53, where a double is not", () => {
    // 16 EiB in bytes. A double cannot hold this integer; a BigInt can.
    const bits = toBits(amount(BigInt(16384)), U("PiB"));
    expect(exactBytes(bits)).toBe(BigInt(16384) * BigInt(1024) ** BigInt(5));
    expect(exactBytes(bits)!).toBeGreaterThan(BigInt(2) ** BigInt(53));
  });
});

describe("exactBytes / exactBits", () => {
  it("returns the integer when the value is a whole number of bytes", () => {
    expect(exactBytes(toBits(amount(BigInt(1)), U("kB")))).toBe(BigInt(1000));
    expect(exactBytes(toBits(amount(BigInt(3), BigInt(2)), U("KiB")))).toBe(BigInt(1536));
  });

  it("returns null rather than rounding a fractional byte", () => {
    // 5 bits is not a whole number of bytes, and saying "0 bytes" or "1 byte"
    // would both be wrong.
    expect(exactBytes(toBits(amount(BigInt(5)), U("bit")))).toBeNull();
    expect(exactBits(toBits(amount(BigInt(5)), U("bit")))).toBe(BigInt(5));
  });

  it("returns null for a fractional number of bits too", () => {
    expect(exactBits(toBits(amount(BigInt(1), BigInt(2)), U("bit")))).toBeNull();
  });

  it("handles a fractional input that still lands on whole bytes", () => {
    expect(exactBytes(toBits(amount(BigInt(1), BigInt(2)), U("kB")))).toBe(BigInt(500));
  });
});

describe("formatting", () => {
  it("groups thousands without depending on the device locale", () => {
    expect(groupDigits(BigInt(0))).toBe("0");
    expect(groupDigits(BigInt(999))).toBe("999");
    expect(groupDigits(BigInt(1000))).toBe("1,000");
    expect(groupDigits(BigInt(1234567890))).toBe("1,234,567,890");
    expect(groupDigits(BigInt(2) ** BigInt(64))).toBe("18,446,744,073,709,551,616");
  });

  it("rounds half up and trims trailing zeros", () => {
    expect(formatFixed(rat(BigInt(1), BigInt(8)), 4).text).toBe("0.125");
    expect(formatFixed(rat(BigInt(1), BigInt(3)), 2).text).toBe("0.33");
    expect(formatFixed(rat(BigInt(2), BigInt(3)), 2).text).toBe("0.67");
    expect(formatFixed(rat(BigInt(5), BigInt(2)), 0).text).toBe("3");
  });

  it("reports exactness from BEFORE the rounding", () => {
    expect(formatFixed(rat(BigInt(1), BigInt(8)), 4).exact).toBe(true);
    expect(formatFixed(rat(BigInt(1), BigInt(3)), 2).exact).toBe(false);
    // 931.322574615478515625 is exact at 18 places and not at 2.
    const gib = fromBits(toBits(amount(BigInt(1)), U("TB")), U("GiB"));
    expect(formatFixed(gib, 2).exact).toBe(false);
    expect(formatFixed(gib, 18).exact).toBe(true);
    expect(formatFixed(gib, 18).text).toBe("931.322574615478515625");
  });

  it("keeps significant digits across wildly different magnitudes", () => {
    expect(formatValue(fromBits(toBits(amount(BigInt(1)), U("PB")), U("bit"))).text).toBe(
      "8,000,000,000,000,000",
    );
    expect(formatValue(fromBits(toBits(amount(BigInt(1)), U("bit")), U("PB"))).text).toBe(
      "0.000000000000000125",
    );
  });

  it("says '< something' rather than printing a small value as 0", () => {
    const tiny = rat(BigInt(1), BigInt(10) ** BigInt(40));
    expect(formatValue(tiny).text.startsWith("< 0.")).toBe(true);
    expect(formatValue(tiny).exact).toBe(false);
  });

  it("prints an exact zero as zero", () => {
    expect(formatValue(rat(BigInt(0), BigInt(1)))).toEqual({ text: "0", exact: true });
  });
});

describe("convertAll", () => {
  it("returns one row per unit, in table order", () => {
    const rows = convertAll(toBits(amount(BigInt(1)), U("MB")));
    expect(rows.map((r) => r.unit.id)).toEqual(UNITS.map((u) => u.id));
  });

  it("carries the exactness flag per row", () => {
    const rows = convertAll(toBits(amount(BigInt(1)), U("MB")));
    const byId = Object.fromEntries(rows.map((r) => [r.unit.id, r.formatted]));
    expect(byId.B.text).toBe("1,000,000");
    expect(byId.B.exact).toBe(true);
    // 1 MB is 0.95367431640625 MiB — exact at 14 places, not at 6 significant.
    expect(byId.MiB.text).toBe("0.953674");
    expect(byId.MiB.exact).toBe(false);
  });
});

describe("driveShortfall — computed, not quoted", () => {
  it("turns 1 TB into the number the operating system prints", () => {
    expect(ONE_TB_IN_GIB.shown.text).toBe("931.323");
    expect(ONE_TB_IN_GIB.percent?.text).toBe("6.87");
  });

  it("gives the same percentage at every prefix level for its own twin", () => {
    expect(driveShortfall(1, U("GB"), U("GiB")).percent?.text).toBe("6.87");
    expect(driveShortfall(500, U("GB"), U("GiB")).percent?.text).toBe("6.87");
    expect(driveShortfall(1, U("MB"), U("MiB")).percent?.text).toBe("4.63");
    expect(driveShortfall(1, U("kB"), U("KiB")).percent?.text).toBe("2.34");
  });

  it("scales the shown value with the amount", () => {
    expect(driveShortfall(2, U("TB"), U("GiB")).shown.text).toBe("1,862.65");
    expect(driveShortfall(512, U("GB"), U("GiB")).shown.text).toBe("476.837");
  });

  it("returns a null percentage when there is no decimal twin", () => {
    expect(driveShortfall(1, U("TB"), U("bit")).percent).toBeNull();
  });
});

describe("transfer time", () => {
  it("divides bits by BITS per second, not bytes", () => {
    // 100 MB over 100 Mbit/s is 8 seconds, not 1.
    const bits = toBits(amount(BigInt(100)), U("MB"));
    expect(formatDuration(transferSeconds(bits, BigInt(100_000_000)))).toBe("8 s");
  });

  it("formats sub-second, second, minute and hour scales", () => {
    const oneGbit = BigInt(1_000_000_000);
    expect(formatDuration(transferSeconds(toBits(amount(BigInt(1)), U("MB")), oneGbit))).toBe("0.008 s");
    expect(formatDuration(transferSeconds(toBits(amount(BigInt(1)), U("GB")), oneGbit))).toBe("8 s");
    expect(formatDuration(transferSeconds(toBits(amount(BigInt(10)), U("GB")), oneGbit))).toBe("1 min 20 s");
    expect(formatDuration(transferSeconds(toBits(amount(BigInt(1)), U("TB")), oneGbit))).toBe(
      "2 h 13 min 20 s",
    );
  });

  it("drops to days for the absurd cases", () => {
    const dialup = LINK_SPEEDS.find((s) => s.id === "56k")!;
    expect(formatDuration(transferSeconds(toBits(amount(BigInt(1)), U("GB")), dialup.bps))).toBe(
      "1 d 15 h 40 min",
    );
  });

  it("quotes every link speed in bits per second", () => {
    for (const speed of LINK_SPEEDS) {
      expect(speed.label).toContain("bit/s");
      expect(speed.bps).toBeGreaterThan(BigInt(0));
    }
  });
});
