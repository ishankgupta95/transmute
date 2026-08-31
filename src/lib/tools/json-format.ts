/**
 * Lossless JSON re-indent / minify.
 *
 * `JSON.parse` + `JSON.stringify` is NOT a re-indent: it is a round trip
 * through IEEE-754 doubles. `12345678901234567890` (a Snowflake / bigint id —
 * the single most common thing pasted into a JSON formatter) comes back as
 * `12345678901234567000`, `1.0` becomes `1`, `1e2` becomes `100`, and
 * duplicate keys are silently collapsed. From a button labelled "Format",
 * with the rail reporting "Valid: Yes", that is silent data corruption.
 *
 * So these scan the raw text instead and rewrite only whitespace: every string
 * literal, number literal and keyword is copied byte for byte. Validity is a
 * separate concern — the caller runs `JSON.parse` for that and reports the
 * parser's own message.
 */

function scan(text: string, indent: number | null): string {
  // `indent === null` means minify: emit no whitespace at all.
  const pretty = indent !== null;
  const pad = (depth: number) =>
    pretty ? `\n${" ".repeat((indent as number) * depth)}` : "";

  let out = "";
  let depth = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // A string literal is opaque: copy it verbatim, escapes and all, so
    // whitespace and structural characters inside it are never touched.
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        j++;
        if (text[j - 1] === '"') break;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }

    if (ch === "{" || ch === "[") {
      const close = ch === "{" ? "}" : "]";
      // An empty container stays on one line — `{}`, not `{\n}`.
      let k = i + 1;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === close) {
        out += ch + close;
        i = k + 1;
        continue;
      }
      depth++;
      out += ch + pad(depth);
      i++;
      continue;
    }

    if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      out += pad(depth) + ch;
      i++;
      continue;
    }

    if (ch === ",") {
      out += "," + pad(depth);
      i++;
      continue;
    }

    if (ch === ":") {
      out += pretty ? ": " : ":";
      i++;
      continue;
    }

    // Whitespace outside a string carries no meaning; everything else
    // (numbers, true/false/null) is copied through unchanged.
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** Re-indent without touching a single literal. */
export function formatJson(text: string, indent = 2): string {
  return scan(text, indent);
}

/** Strip every byte of insignificant whitespace, literals untouched. */
export function minifyJson(text: string): string {
  return scan(text, null);
}
