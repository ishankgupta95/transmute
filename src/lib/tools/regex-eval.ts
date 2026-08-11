/**
 * The regex tester's evaluation core. Pure and DOM-free — it runs inside the
 * regex pool worker (workers/regex.worker.ts) so a catastrophically
 * backtracking pattern (`(a+)+$` against a long string) spins a worker the
 * client can terminate, not the main thread. Keep this module a leaf: it
 * must never import anything that names the worker's URL.
 */

export interface RegexMatch {
  text: string;
  index: number;
  groups: (string | undefined)[];
}

export interface RegexEvalResult {
  matches: RegexMatch[];
  error: string;
}

export function evalRegexSync(
  pattern: string,
  flags: string,
  testStr: string,
): RegexEvalResult {
  try {
    const re = new RegExp(pattern, flags);
    const found: RegexMatch[] = [];
    let m: RegExpExecArray | null;

    if (flags.includes("g")) {
      while ((m = re.exec(testStr)) !== null) {
        found.push({ text: m[0], index: m.index, groups: m.slice(1) });
        if (!m[0]) re.lastIndex++;
      }
    } else {
      m = re.exec(testStr);
      if (m) found.push({ text: m[0], index: m.index, groups: m.slice(1) });
    }
    return { matches: found, error: "" };
  } catch (e) {
    return { matches: [], error: e instanceof Error ? e.message : "Invalid regex" };
  }
}
