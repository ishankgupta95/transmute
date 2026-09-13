/**
 * bcrypt hashing and verification, in the tab.
 *
 * `bcryptjs` (BSD-3-Clause, ~112 KB) is BUNDLED, not served — ordinary
 * JavaScript with no WebAssembly, so it rides inside the importing chunk and
 * adds no origin-root artifact and no disclosure surface.
 *
 * ⚠ WHY THIS IS DELIBERATELY SLOW, and why the UI must not hide that. bcrypt's
 * whole purpose is to cost time: the work factor doubles per increment, so an
 * attacker with a stolen database pays the same multiple. That means a high
 * cost BLOCKS THE MAIN THREAD for seconds — measured below — and a progress
 * spinner would be a lie, because there is nothing to report. The async API is
 * used so the browser can at least paint between rounds.
 */

/**
 * Work factor bounds.
 *
 * 10 is what most frameworks default to. 12 is the common current advice. The
 * ceiling is 14 rather than bcrypt's own 31 because each step DOUBLES the
 * time: on a modern laptop 12 is ~250 ms, 14 is ~1 s, and 17 would be about
 * eight seconds of frozen tab — a number this tool should not let someone
 * reach by dragging a slider one notch too far.
 */
export const MIN_COST = 4;
export const MAX_COST = 14;
export const DEFAULT_COST = 12;

export interface BcryptHashResult {
  readonly hash: string;
  /** How long it actually took here, in ms — the only honest cost estimate. */
  readonly elapsedMs: number;
  /** The `$2b$` prefix, cost and salt, split out so the page can explain them. */
  readonly parts: { version: string; cost: number; salt: string };
}

/** Split `$2b$12$<22-char salt><31-char digest>` into its documented fields. */
function describe(hash: string): BcryptHashResult["parts"] {
  const match = /^\$(2[abxy])\$(\d{2})\$(.{22})/.exec(hash);
  if (!match) return { version: "", cost: 0, salt: "" };
  return { version: `$${match[1]}$`, cost: Number(match[2]), salt: match[3] };
}

export async function hashPassword(password: string, cost: number): Promise<BcryptHashResult> {
  if (!password) throw new Error("Type a password to hash.");
  const clamped = Math.min(MAX_COST, Math.max(MIN_COST, Math.round(cost)));
  const bcrypt = (await import("bcryptjs")).default;
  const started = performance.now();
  const hash = await bcrypt.hash(password, clamped);
  return { hash, elapsedMs: performance.now() - started, parts: describe(hash) };
}

export type VerifyOutcome = "match" | "no-match" | "not-a-hash";

/**
 * Check a password against an existing hash.
 *
 * ⚠ "not-a-hash" is a THIRD outcome and collapsing it into "no match" would be
 * the dishonest shortcut. bcryptjs throws on a malformed hash, and reporting
 * that as a failed comparison tells someone their password is wrong when what
 * is actually wrong is the thing they pasted.
 */
export async function verifyPassword(password: string, hash: string): Promise<VerifyOutcome> {
  if (!/^\$2[abxy]\$\d{2}\$.{53}$/.test(hash.trim())) return "not-a-hash";
  const bcrypt = (await import("bcryptjs")).default;
  try {
    return (await bcrypt.compare(password, hash.trim())) ? "match" : "no-match";
  } catch {
    return "not-a-hash";
  }
}
