/**
 * Unix file mode arithmetic — octal ↔ symbolic ↔ the twelve individual bits.
 *
 * Pure functions over numbers and strings. No DOM, no dependency: a file mode
 * is twelve bits and everything interesting about it is a naming convention.
 *
 * ── The model ──────────────────────────────────────────────────────────────
 *
 * A mode is one integer, 0–4095, laid out exactly as `chmod(2)` lays it out:
 *
 *     setuid setgid sticky   r w x   r w x   r w x
 *      2048   1024    512   owner    group    other
 *
 * which is the four-digit octal `4755` read straight off: `4` is the special
 * nibble (setuid 4, setgid 2, sticky 1) and `755` is the three permission
 * nibbles. Nothing here is stored as booleans, because every question the tool
 * asks — "is this 644?", "does this render as rwsr-xr-x?" — is a question
 * about the same integer.
 *
 * ── The capital-letter rule, which is the whole reason this file exists ────
 *
 * `ls -l` overloads the EXECUTE column to carry the special bits:
 *
 *   - setuid replaces the owner's `x` with `s` — but with `S` when the owner
 *     has no execute bit, because the setuid bit is set and cannot do anything
 *     without an execute bit to ride on.
 *   - setgid does the same to the group's `x` (`s` / `S`).
 *   - sticky does the same to other's `x`, spelled `t` / `T`.
 *
 * The capital form is therefore a warning, not a variant spelling: it means
 * "this bit is set and inert". Most calculators get this wrong and print a
 * lower-case `s` for `4644`. MEASURED against BSD `chmod` + `ls -l` on macOS
 * while writing this file:
 *
 *     chmod 4755 f  →  -rwsr-xr-x        chmod 4644 f  →  -rwSr--r--
 *     chmod 1755 f  →  -rwxr-xr-t        chmod 1644 f  →  -rw-r--r-T
 *     chmod a+t  f  →  ----------T
 *
 * ── Why sticky is a separate `+t` clause in the symbolic command ───────────
 *
 * Also MEASURED, and the reason `symbolicCommand` does not simply append `t`
 * to the `o=` clause the way it appends `s` to `u=`:
 *
 *     chmod u=rwx,g=rx,o=rxt f  →  -rwxr-xr-x   (the t was ignored)
 *     chmod u=rwx,go=rx,o+t  f  →  -rwxr-xr-x   (still ignored)
 *     chmod u=rwx,go=rx,+t   f  →  -rwxr-xr-t   (correct)
 *
 * POSIX gives the `t` permission effect only when the "who" list is `a` or is
 * omitted, and BSD chmod enforces that literally. `s`, by contrast, does take
 * effect from a `u`/`g` who-list, which is why `u=rwxs` works and `o=rxt` does
 * not.
 */

/* ── Bit layout ───────────────────────────────────────────────────────────── */

export const SETUID = 0o4000;
export const SETGID = 0o2000;
export const STICKY = 0o1000;

/** Every bit a mode can carry. `0o7777` — four octal digits, twelve bits. */
export const MODE_MAX = 0o7777;

export type ClassId = "owner" | "group" | "other";
export type PermId = "read" | "write" | "execute";

export const CLASSES: readonly { id: ClassId; label: string; letter: "u" | "g" | "o" }[] = [
  { id: "owner", label: "Owner", letter: "u" },
  { id: "group", label: "Group", letter: "g" },
  { id: "other", label: "Other", letter: "o" },
];

export const PERMS: readonly { id: PermId; label: string; letter: "r" | "w" | "x" }[] = [
  { id: "read", label: "Read", letter: "r" },
  { id: "write", label: "Write", letter: "w" },
  { id: "execute", label: "Execute", letter: "x" },
];

/** Shift of a class's three-bit nibble: owner 6, group 3, other 0. */
const CLASS_SHIFT: Record<ClassId, number> = { owner: 6, group: 3, other: 0 };
/** Value of a permission within its nibble: r 4, w 2, x 1. */
const PERM_VALUE: Record<PermId, number> = { read: 4, write: 2, execute: 1 };

/** The single bit for one checkbox in the 3×3 grid. */
export function bitFor(cls: ClassId, perm: PermId): number {
  return PERM_VALUE[perm] << CLASS_SHIFT[cls];
}

export function hasBit(mode: number, cls: ClassId, perm: PermId): boolean {
  return (mode & bitFor(cls, perm)) !== 0;
}

export function toggleBit(mode: number, cls: ClassId, perm: PermId): number {
  return mode ^ bitFor(cls, perm);
}

export type SpecialId = "setuid" | "setgid" | "sticky";

export const SPECIALS: readonly { id: SpecialId; label: string; bit: number }[] = [
  { id: "setuid", label: "setuid", bit: SETUID },
  { id: "setgid", label: "setgid", bit: SETGID },
  { id: "sticky", label: "sticky", bit: STICKY },
];

export function hasSpecial(mode: number, id: SpecialId): boolean {
  const found = SPECIALS.find((s) => s.id === id);
  return found ? (mode & found.bit) !== 0 : false;
}

export function toggleSpecial(mode: number, id: SpecialId): number {
  const found = SPECIALS.find((s) => s.id === id);
  return found ? mode ^ found.bit : mode;
}

/* ── Octal ────────────────────────────────────────────────────────────────── */

/**
 * Read an octal mode the way a person types one.
 *
 * Accepts one to four octal digits, with or without a leading `0`/`0o`, and
 * with surrounding whitespace. Short forms are right-aligned exactly as
 * `chmod` reads them, so `7` is `007` and `44` is `044`. Anything with a digit
 * outside 0–7, more than four significant digits, or a stray character returns
 * `null` rather than a partially-parsed guess.
 */
export function parseOctal(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const body = trimmed.replace(/^0o/i, "").replace(/^0+(?=\d)/, "");
  const digits = body === "" ? "0" : body;
  if (!/^[0-7]{1,4}$/.test(digits)) return null;
  return parseInt(digits, 8);
}

/**
 * Print a mode as octal.
 *
 * Three digits when no special bit is set — `755`, the form everyone types —
 * and four when one is, because `4755` and `755` are different modes and a
 * three-digit rendering of the first would be a lie. Pass `always: true` for
 * the four-digit form regardless, which is what the field itself shows.
 */
export function toOctal(mode: number, always = false): string {
  const clean = mode & MODE_MAX;
  const special = clean >> 9;
  const body = (clean & 0o777).toString(8).padStart(3, "0");
  return special !== 0 || always ? `${special}${body}` : body;
}

/* ── Symbolic (the `ls -l` nine characters) ───────────────────────────────── */

/**
 * The nine-character permission string, `rwxr-xr-x`, with the special bits
 * folded into the execute columns as `s`/`S`/`t`/`T`.
 *
 * No leading file-type character: that describes the inode, not the mode, and
 * this tool has no inode. `parseSymbolic` accepts one anyway, because people
 * paste whole `ls -l` columns.
 */
export function toSymbolic(mode: number): string {
  const clean = mode & MODE_MAX;
  let out = "";
  for (const cls of CLASSES) {
    out += hasBit(clean, cls.id, "read") ? "r" : "-";
    out += hasBit(clean, cls.id, "write") ? "w" : "-";
    const x = hasBit(clean, cls.id, "execute");
    if (cls.id === "owner" && (clean & SETUID) !== 0) out += x ? "s" : "S";
    else if (cls.id === "group" && (clean & SETGID) !== 0) out += x ? "s" : "S";
    else if (cls.id === "other" && (clean & STICKY) !== 0) out += x ? "t" : "T";
    else out += x ? "x" : "-";
  }
  return out;
}

/**
 * Read a nine-character permission string back into a mode.
 *
 * Tolerant about the things people actually paste: a leading file-type
 * character (`-`, `d`, `l`, `c`, `b`, `p`, `s`), a trailing `@`/`+`/`.` from
 * macOS extended attributes or an ACL, and surrounding whitespace. Strict
 * about everything else — each of the nine slots must hold either its own
 * letter or a `-`, so `rwxrwxrwr` (a `r` in an execute slot) is `null` rather
 * than something close.
 *
 * The capital rule is read as well as written: `S` in the owner column sets
 * setuid and leaves owner-execute CLEAR, which is the whole point of the
 * capital.
 */
export function parseSymbolic(text: string): number | null {
  let s = text.trim().replace(/[@+.]+$/, "");
  if (s.length === 10 && /^[-dlcbps]/i.test(s)) s = s.slice(1);
  if (s.length !== 9) return null;

  let mode = 0;
  for (let i = 0; i < CLASSES.length; i++) {
    const cls = CLASSES[i].id;
    const [r, w, x] = [s[i * 3], s[i * 3 + 1], s[i * 3 + 2]];
    if (r === "r") mode |= bitFor(cls, "read");
    else if (r !== "-") return null;
    if (w === "w") mode |= bitFor(cls, "write");
    else if (w !== "-") return null;

    const special = cls === "owner" ? SETUID : cls === "group" ? SETGID : STICKY;
    const lower = cls === "other" ? "t" : "s";
    const upper = cls === "other" ? "T" : "S";
    if (x === "x") mode |= bitFor(cls, "execute");
    else if (x === lower) mode |= bitFor(cls, "execute") | special;
    else if (x === upper) mode |= special;
    else if (x !== "-") return null;
  }
  return mode;
}

/* ── The commands you actually run ────────────────────────────────────────── */

/** `chmod 755 file` — the form that sets the mode absolutely. */
export function octalCommand(mode: number, target = "file"): string {
  return `chmod ${toOctal(mode)} ${target}`;
}

const RWX = (mode: number, cls: ClassId): string =>
  (hasBit(mode, cls, "read") ? "r" : "") +
  (hasBit(mode, cls, "write") ? "w" : "") +
  (hasBit(mode, cls, "execute") ? "x" : "");

/**
 * `chmod u=rwx,go=rx file` — the same mode said in words.
 *
 * Classes with identical permissions are merged (`go=rx`, `a=rwx`) so the
 * clause list stays readable, but ONLY when no special bit is in play: `s`
 * attaches to a who-list, so merging `u` and `g` under one clause would set
 * both setuid and setgid from a single `s`. When any special bit is set, all
 * three classes get their own clause.
 *
 * Sticky is emitted as a trailing `+t` with no who-list. See the file header:
 * `o=rxt` and `o+t` are both silently ignored by BSD chmod, measured.
 */
export function symbolicCommand(mode: number, target = "file"): string {
  const clean = mode & MODE_MAX;
  const clauses: string[] = [];
  const special = (clean & (SETUID | SETGID)) !== 0 || (clean & STICKY) !== 0;

  if (!special) {
    // Merge runs of classes whose permissions match, in u/g/o order.
    const groups: { who: string; perms: string }[] = [];
    for (const cls of CLASSES) {
      const perms = RWX(clean, cls.id);
      const last = groups[groups.length - 1];
      if (last && last.perms === perms) last.who += cls.letter;
      else groups.push({ who: cls.letter, perms });
    }
    if (groups.length === 1) groups[0].who = "a";
    for (const g of groups) clauses.push(`${g.who}=${g.perms}`);
  } else {
    clauses.push(`u=${RWX(clean, "owner")}${(clean & SETUID) !== 0 ? "s" : ""}`);
    clauses.push(`g=${RWX(clean, "group")}${(clean & SETGID) !== 0 ? "s" : ""}`);
    clauses.push(`o=${RWX(clean, "other")}`);
    if ((clean & STICKY) !== 0) clauses.push("+t");
  }
  return `chmod ${clauses.join(",")} ${target}`;
}

/* ── Plain English ────────────────────────────────────────────────────────── */

const CLASS_NOUN: Record<ClassId, string> = {
  owner: "The owner",
  group: "Members of the group",
  other: "Everyone else",
};

/**
 * One sentence per class, written for the target kind — because `x` means two
 * unrelated things and conflating them is the single commonest chmod mistake.
 *
 * On a FILE, execute means "run this as a program". On a DIRECTORY it means
 * "traverse" — enter it, and resolve a path through it. A directory with `r`
 * and no `x` lets you list the names inside and read nothing; a directory with
 * `x` and no `r` lets you open a file whose name you already know and refuses
 * to tell you what is in there.
 */
export function describeMode(mode: number, kind: "file" | "directory"): string[] {
  const clean = mode & MODE_MAX;
  return CLASSES.map(({ id }) => {
    const can: string[] = [];
    if (hasBit(clean, id, "read")) can.push(kind === "file" ? "read it" : "list its contents");
    if (hasBit(clean, id, "write"))
      can.push(kind === "file" ? "change it" : "create, rename and delete entries in it");
    if (hasBit(clean, id, "execute"))
      can.push(kind === "file" ? "run it as a program" : "enter it and open paths through it");
    if (can.length === 0) return `${CLASS_NOUN[id]} can do nothing with it.`;
    const list =
      can.length === 1 ? can[0] : `${can.slice(0, -1).join(", ")} and ${can[can.length - 1]}`;
    return `${CLASS_NOUN[id]} can ${list}.`;
  });
}

/**
 * What the special bits do to THIS mode, including the case where one is set
 * and inert. Empty when no special bit is set — a list of "not set" lines is
 * noise, and the checkboxes already say so.
 */
export function describeSpecials(mode: number, kind: "file" | "directory"): string[] {
  const clean = mode & MODE_MAX;
  const notes: string[] = [];

  if ((clean & SETUID) !== 0) {
    notes.push(
      hasBit(clean, "owner", "execute")
        ? kind === "file"
          ? "setuid: the program runs as the file's owner rather than as whoever started it. This is how /usr/bin/passwd edits a root-owned file, and it is also the classic way a local user becomes root — set it only on something you wrote or trust completely."
          : "setuid on a directory has no defined meaning on Linux and is ignored. Some BSD variants read it; nothing portable depends on it."
        : "setuid is set but the owner has no execute bit, which is why the symbolic form shows a capital S. The bit is stored and does nothing: there is no program here to run as the owner.",
    );
  }
  if ((clean & SETGID) !== 0) {
    notes.push(
      hasBit(clean, "group", "execute")
        ? kind === "file"
          ? "setgid: the program runs with the file's group rather than the caller's."
          : "setgid on a directory: new files created inside inherit the directory's group instead of the creator's primary group, and new subdirectories inherit the setgid bit too. This is the usual way a shared project directory stays readable to the whole team."
        : "setgid is set but there is no group execute bit, which is why the symbolic form shows a capital S. On a directory the group-inheritance behaviour still applies; on a file the bit is inert — and note that on Linux, setgid without group-execute is also the mandatory file-locking flag.",
    );
  }
  if ((clean & STICKY) !== 0) {
    notes.push(
      hasBit(clean, "other", "execute")
        ? "sticky: on a directory, only the owner of an entry (or the directory's owner, or root) may delete or rename it, even though write permission is shared. This is what makes /tmp — mode 1777 — usable by everyone without letting anyone delete anyone else's files. On a regular file the bit is ignored by modern kernels."
        : "sticky is set but there is no execute bit for other, which is why the symbolic form shows a capital T. Nobody can enter the directory, so its restricted-deletion behaviour never comes up.",
    );
  }
  return notes;
}

/**
 * Modes that are actively dangerous, said plainly. Returns `null` when there
 * is nothing to warn about — the tool never prints a reassurance.
 */
export function riskNote(mode: number): string | null {
  const clean = mode & MODE_MAX;
  const otherWrite = hasBit(clean, "other", "write");
  const suid = (clean & (SETUID | SETGID)) !== 0;

  if (suid && otherWrite) {
    return "This mode is setuid or setgid AND world-writable. Anyone on the machine can replace the contents of a program that runs as somebody else. There is no configuration in which this is what you wanted.";
  }
  if (otherWrite && (clean & STICKY) === 0) {
    return hasBit(clean, "other", "execute")
      ? "World-writable: every account on the machine can modify this, and if it is a directory, delete anything inside it. On a shared directory you almost always want the sticky bit as well (1777, the mode /tmp uses), which limits deletion to the owner of each entry."
      : "World-writable: every account on the machine can modify this. 666 and 777 are almost never the fix for a permissions problem — they are what people try when the real problem is ownership or a missing execute bit on a parent directory.";
  }
  if (suid) {
    return "setuid or setgid means this program runs with the file's owner or group rather than the caller's. That is a privilege boundary; set it deliberately, and never on a script — most kernels ignore the bit on interpreted files precisely because honouring it is unsafe.";
  }
  return null;
}

/* ── Presets ──────────────────────────────────────────────────────────────── */

export interface ChmodPreset {
  mode: number;
  label: string;
  /** One honest sentence about when this is the right mode. */
  note: string;
}

/**
 * The modes worth one click. Deliberately short: a preset list long enough to
 * scroll is a worse index than the octal field.
 */
export const PRESETS: readonly ChmodPreset[] = [
  {
    mode: 0o644,
    label: "644",
    note: "The default for a regular file. The owner edits it, everyone reads it. Almost every file in a web root, a repository or a home directory should be this.",
  },
  {
    mode: 0o755,
    label: "755",
    note: "The default for a directory or an executable. The owner writes, everyone reads and traverses. A directory needs its execute bit or nobody can open anything inside it, whatever the files themselves say.",
  },
  {
    mode: 0o600,
    label: "600",
    note: "Owner only, read and write. What an SSH private key, a .env file or a credentials file should be — ssh refuses to use a private key that is readable by anyone else.",
  },
  {
    mode: 0o700,
    label: "700",
    note: "Owner only, including traverse. The directory form of 600: ~/.ssh, ~/.gnupg and anything else nobody else has business entering.",
  },
  {
    mode: 0o664,
    label: "664",
    note: "Group-writable file. Sensible when a real group owns the file and its members collaborate on it; pointless when the group is a single-user group, which on most Linux systems it is.",
  },
  {
    mode: 0o775,
    label: "775",
    note: "Group-writable directory. Usually wants the setgid bit too (2775), so files created inside keep the shared group instead of the creator's.",
  },
  {
    mode: 0o777,
    label: "777",
    note: "Everything to everyone. This is not a fix; it is the thing people try when the real problem is ownership or a missing execute bit on a parent directory. It also silently disables ssh keys, most cron jobs and PHP-FPM configurations that check for group- or world-writable files.",
  },
  {
    mode: 0o1777,
    label: "1777",
    note: "World-writable with the sticky bit — the mode of /tmp. Anyone can create entries; only the owner of an entry can delete or rename it.",
  },
  {
    mode: 0o2775,
    label: "2775",
    note: "The shared project directory. setgid makes every file created inside inherit the directory's group, so a teammate's new file is still readable by the team.",
  },
  {
    mode: 0o4755,
    label: "4755",
    note: "setuid executable, the /usr/bin/passwd shape. Runs as its owner whoever starts it. Set this only on a compiled program you trust; kernels ignore it on scripts.",
  },
];

/**
 * How a `umask` value maps to the mode a new file or directory ends up with.
 *
 * A umask is subtractive, which is why `022` produces 644 for a file and 755
 * for a directory rather than 755 for both: the kernel starts from 666 for a
 * file and 777 for a directory and clears every bit the mask names. Special
 * bits are not involved.
 */
export function modeFromUmask(umask: number, kind: "file" | "directory"): number {
  const base = kind === "file" ? 0o666 : 0o777;
  return base & ~(umask & 0o777) & 0o777;
}
