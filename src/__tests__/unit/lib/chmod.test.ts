import { describe, it, expect } from "vitest";

import {
  MODE_MAX,
  PRESETS,
  SETGID,
  SETUID,
  STICKY,
  bitFor,
  describeMode,
  describeSpecials,
  hasBit,
  hasSpecial,
  modeFromUmask,
  octalCommand,
  parseOctal,
  parseSymbolic,
  riskNote,
  symbolicCommand,
  toOctal,
  toSymbolic,
  toggleBit,
  toggleSpecial,
} from "@/lib/tools/chmod";

/**
 * The expectations below were MEASURED against BSD `chmod` + `ls -l` on macOS
 * rather than recalled, which is the only reason the capital-letter cases and
 * the `+t` clause are trustworthy:
 *
 *     chmod 4755 f → -rwsr-xr-x     chmod 4644 f → -rwSr--r--
 *     chmod 1755 f → -rwxr-xr-t     chmod 1644 f → -rw-r--r-T
 *     chmod a+t  f → ----------T
 *     chmod u=rwx,g=rx,o=rxt f → -rwxr-xr-x   (the t is IGNORED)
 *     chmod u=rwx,go=rx,+t   f → -rwxr-xr-t   (correct)
 *     chmod u=rwxs,go=rx,+t  f → -rwsr-xr-t
 *     chmod u=rw,go=         f → -rw-------
 */

describe("bit layout", () => {
  it("places each class nibble where chmod places it", () => {
    expect(bitFor("owner", "read")).toBe(0o400);
    expect(bitFor("owner", "write")).toBe(0o200);
    expect(bitFor("owner", "execute")).toBe(0o100);
    expect(bitFor("group", "read")).toBe(0o040);
    expect(bitFor("other", "execute")).toBe(0o001);
  });

  it("keeps the special nibble above the nine permission bits", () => {
    expect(SETUID).toBe(0o4000);
    expect(SETGID).toBe(0o2000);
    expect(STICKY).toBe(0o1000);
    expect(MODE_MAX).toBe(0o7777);
  });

  it("toggles one bit at a time and leaves the rest alone", () => {
    expect(toggleBit(0o644, "owner", "execute")).toBe(0o744);
    expect(toggleBit(0o744, "owner", "execute")).toBe(0o644);
    expect(hasBit(0o644, "group", "read")).toBe(true);
    expect(hasBit(0o644, "group", "write")).toBe(false);
  });

  it("toggles special bits by name", () => {
    expect(toggleSpecial(0o755, "setuid")).toBe(0o4755);
    expect(toggleSpecial(0o4755, "setuid")).toBe(0o755);
    expect(hasSpecial(0o2775, "setgid")).toBe(true);
    expect(hasSpecial(0o2775, "sticky")).toBe(false);
  });
});

describe("parseOctal", () => {
  it("reads three- and four-digit modes", () => {
    expect(parseOctal("755")).toBe(0o755);
    expect(parseOctal("644")).toBe(0o644);
    expect(parseOctal("4755")).toBe(0o4755);
    expect(parseOctal("7777")).toBe(0o7777);
  });

  it("right-aligns short forms the way chmod does", () => {
    expect(parseOctal("7")).toBe(0o007);
    expect(parseOctal("44")).toBe(0o044);
  });

  it("accepts a leading zero or 0o and surrounding space", () => {
    expect(parseOctal("0755")).toBe(0o755);
    expect(parseOctal(" 0o644 ")).toBe(0o644);
    expect(parseOctal("0")).toBe(0);
    expect(parseOctal("000")).toBe(0);
  });

  it("refuses anything that is not octal", () => {
    expect(parseOctal("789")).toBeNull();
    expect(parseOctal("75x")).toBeNull();
    expect(parseOctal("77777")).toBeNull();
    expect(parseOctal("")).toBeNull();
    expect(parseOctal("   ")).toBeNull();
    expect(parseOctal("-755")).toBeNull();
  });
});

describe("toOctal", () => {
  it("prints three digits when no special bit is set", () => {
    expect(toOctal(0o755)).toBe("755");
    expect(toOctal(0o000)).toBe("000");
  });

  it("prints four digits as soon as a special bit is set", () => {
    expect(toOctal(0o4755)).toBe("4755");
    expect(toOctal(0o1777)).toBe("1777");
    expect(toOctal(0o7000)).toBe("7000");
  });

  it("can be forced to four digits", () => {
    expect(toOctal(0o755, true)).toBe("0755");
    expect(toOctal(0o4755, true)).toBe("4755");
  });
});

describe("toSymbolic — the capital-letter rule", () => {
  it("renders ordinary modes", () => {
    expect(toSymbolic(0o755)).toBe("rwxr-xr-x");
    expect(toSymbolic(0o644)).toBe("rw-r--r--");
    expect(toSymbolic(0o000)).toBe("---------");
    expect(toSymbolic(0o777)).toBe("rwxrwxrwx");
  });

  it("uses a LOWER-case s or t when the execute bit is also set", () => {
    expect(toSymbolic(0o4755)).toBe("rwsr-xr-x");
    expect(toSymbolic(0o2755)).toBe("rwxr-sr-x");
    expect(toSymbolic(0o1755)).toBe("rwxr-xr-t");
  });

  it("uses a CAPITAL S or T when the execute bit is NOT set", () => {
    expect(toSymbolic(0o4644)).toBe("rwSr--r--");
    expect(toSymbolic(0o2644)).toBe("rw-r-Sr--");
    expect(toSymbolic(0o1644)).toBe("rw-r--r-T");
    expect(toSymbolic(0o7000)).toBe("--S--S--T");
  });

  it("mixes the two within one mode", () => {
    // setuid with owner-x (lower s), setgid without group-x (capital S).
    expect(toSymbolic(0o6745)).toBe("rwsr-Sr-x");
    expect(toSymbolic(0o7777)).toBe("rwsrwsrwt");
  });
});

describe("parseSymbolic", () => {
  it("round-trips every mode 0000–7777", () => {
    for (let mode = 0; mode <= MODE_MAX; mode++) {
      expect(parseSymbolic(toSymbolic(mode))).toBe(mode);
    }
  });

  it("reads the capital form as set-but-inert", () => {
    expect(parseSymbolic("rwSr--r--")).toBe(0o4644);
    expect(parseSymbolic("rwsr--r--")).toBe(0o4744);
    expect(parseSymbolic("rw-r--r-T")).toBe(0o1644);
    expect(parseSymbolic("rw-r--r-t")).toBe(0o1645);
  });

  it("tolerates a leading file-type character and macOS ACL markers", () => {
    expect(parseSymbolic("-rwxr-xr-x")).toBe(0o755);
    expect(parseSymbolic("drwxr-xr-x")).toBe(0o755);
    expect(parseSymbolic("lrwxrwxrwx")).toBe(0o777);
    expect(parseSymbolic("-rw-r--r--@")).toBe(0o644);
    expect(parseSymbolic("drwxr-xr-x+")).toBe(0o755);
    expect(parseSymbolic("  rwxr-xr-x  ")).toBe(0o755);
  });

  it("refuses a letter in the wrong column", () => {
    // `w` where only r/- is legal, `r` where only x/s/S/- is legal.
    expect(parseSymbolic("wwxr-xr-x")).toBeNull();
    expect(parseSymbolic("rwrr-xr-x")).toBeNull();
    // `t` belongs to other, `s` to owner and group — not the other way round.
    expect(parseSymbolic("rwtr-xr-x")).toBeNull();
    expect(parseSymbolic("rwxr-xr-s")).toBeNull();
  });

  it("refuses the wrong length", () => {
    expect(parseSymbolic("rwxr-xr-")).toBeNull();
    expect(parseSymbolic("rwxr-xr-xx")).toBeNull();
    expect(parseSymbolic("")).toBeNull();
  });
});

describe("octalCommand", () => {
  it("names the target and uses the short octal form", () => {
    expect(octalCommand(0o755)).toBe("chmod 755 file");
    expect(octalCommand(0o4755, "program")).toBe("chmod 4755 program");
  });
});

describe("symbolicCommand", () => {
  it("merges classes with identical permissions", () => {
    expect(symbolicCommand(0o755)).toBe("chmod u=rwx,go=rx file");
    expect(symbolicCommand(0o644)).toBe("chmod u=rw,go=r file");
    expect(symbolicCommand(0o777)).toBe("chmod a=rwx file");
    expect(symbolicCommand(0o600)).toBe("chmod u=rw,go= file");
    expect(symbolicCommand(0o000)).toBe("chmod a= file");
  });

  it("splits u/g/o apart as soon as a special bit is involved", () => {
    // Merging would attach one `s` to both u and g.
    expect(symbolicCommand(0o4755)).toBe("chmod u=rwxs,g=rx,o=rx file");
    expect(symbolicCommand(0o2775)).toBe("chmod u=rwx,g=rwxs,o=rx file");
  });

  it("emits sticky as a who-less +t clause", () => {
    // MEASURED: `o=rxt` and `o+t` are ignored by BSD chmod; `+t` is not.
    expect(symbolicCommand(0o1777)).toBe("chmod u=rwx,g=rwx,o=rwx,+t file");
    expect(symbolicCommand(0o4755)).not.toContain("t");
    expect(symbolicCommand(0o1755)).toContain(",+t ");
  });

  it("names the target", () => {
    expect(symbolicCommand(0o755, "bin/run")).toBe("chmod u=rwx,go=rx bin/run");
  });
});

describe("describeMode", () => {
  it("says 'run it' for a file and 'enter it' for a directory", () => {
    const file = describeMode(0o755, "file");
    const dir = describeMode(0o755, "directory");
    expect(file[0]).toContain("run it as a program");
    expect(dir[0]).toContain("enter it and open paths through it");
    expect(dir[0]).not.toContain("run it as a program");
  });

  it("uses directory wording for read and write too", () => {
    const dir = describeMode(0o755, "directory");
    expect(dir[1]).toContain("list its contents");
    expect(dir[0]).toContain("create, rename and delete entries in it");
  });

  it("says so when a class has nothing", () => {
    expect(describeMode(0o700, "file")[2]).toBe("Everyone else can do nothing with it.");
  });

  it("returns one sentence per class", () => {
    expect(describeMode(0o644, "file")).toHaveLength(3);
  });
});

describe("describeSpecials", () => {
  it("is empty when no special bit is set", () => {
    expect(describeSpecials(0o755, "file")).toEqual([]);
  });

  it("explains the inert case for a capital S", () => {
    const notes = describeSpecials(0o4644, "file");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("capital S");
    expect(notes[0]).toContain("does nothing");
  });

  it("explains group inheritance for setgid on a directory", () => {
    const notes = describeSpecials(0o2775, "directory");
    expect(notes[0]).toContain("inherit the directory's group");
  });

  it("explains sticky as restricted deletion, and its inert form", () => {
    expect(describeSpecials(0o1777, "directory")[0]).toContain("only the owner of an entry");
    expect(describeSpecials(0o1666, "directory")[0]).toContain("capital T");
  });
});

describe("riskNote", () => {
  it("says nothing about a sane mode", () => {
    expect(riskNote(0o644)).toBeNull();
    expect(riskNote(0o755)).toBeNull();
    expect(riskNote(0o600)).toBeNull();
  });

  it("flags world-writable", () => {
    expect(riskNote(0o777)).toContain("World-writable");
    expect(riskNote(0o666)).toContain("World-writable");
  });

  it("does not flag 1777, where the sticky bit is the mitigation", () => {
    expect(riskNote(0o1777)).toBeNull();
  });

  it("flags setuid, and escalates when it is also world-writable", () => {
    expect(riskNote(0o4755)).toContain("privilege boundary");
    expect(riskNote(0o4777)).toContain("no configuration in which this is what you wanted");
  });
});

describe("PRESETS", () => {
  it("carries the modes the labels claim", () => {
    for (const preset of PRESETS) {
      expect(toOctal(preset.mode)).toBe(preset.label);
    }
  });

  it("warns about 777 rather than presenting it neutrally", () => {
    const world = PRESETS.find((p) => p.label === "777");
    expect(world?.note).toMatch(/not a fix/i);
  });

  it("has a note on every entry", () => {
    for (const preset of PRESETS) expect(preset.note.length).toBeGreaterThan(40);
  });
});

describe("modeFromUmask", () => {
  it("starts from 666 for files and 777 for directories", () => {
    expect(toOctal(modeFromUmask(0o022, "file"))).toBe("644");
    expect(toOctal(modeFromUmask(0o022, "directory"))).toBe("755");
    expect(toOctal(modeFromUmask(0o077, "file"))).toBe("600");
    expect(toOctal(modeFromUmask(0o077, "directory"))).toBe("700");
    expect(toOctal(modeFromUmask(0o002, "file"))).toBe("664");
  });

  it("never invents an execute bit on a file", () => {
    expect(toOctal(modeFromUmask(0o000, "file"))).toBe("666");
    expect(toOctal(modeFromUmask(0o000, "directory"))).toBe("777");
  });
});
