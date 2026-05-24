import { Marked, type Token, type Tokens } from "marked";
import DOMPurify from "dompurify";

export type MarkdownPdfTheme = "light" | "dark";
export type MarkdownPdfFont = "serif" | "sans";

interface RenderOpts {
  theme?: MarkdownPdfTheme;
  font?: MarkdownPdfFont;
}

export const SHIKI_LANGS = [
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "json",
  "yaml",
  "toml",
  "bash",
  "sh",
  "sql",
  "html",
  "css",
  "md",
  "diff",
] as const;

type ShikiHighlighter = {
  codeToHtml(code: string, opts: { lang: string; theme: string }): string;
  getLoadedLanguages(): string[];
};

let highlighterPromise: Promise<ShikiHighlighter | null> | null = null;

/**
 * Lazy-load the Shiki highlighter the first time we need to render a code block.
 * Uses the JavaScript regex engine (no WASM) so the bundle works under
 * `output: "export"` without extra wasm asset wiring.
 *
 * Resolves to `null` if Shiki fails to load — callers fall back to plain
 * `<pre><code>` so an unknown language never breaks the whole render.
 */
export async function getShikiHighlighter(): Promise<ShikiHighlighter | null> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      try {
        const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] =
          await Promise.all([
            import("shiki/core"),
            import("shiki/engine/javascript"),
          ]);

        const highlighter = await createHighlighterCore({
          themes: [
            import("shiki/themes/github-light.mjs"),
            import("shiki/themes/github-dark.mjs"),
          ],
          langs: [
            import("shiki/langs/js.mjs"),
            import("shiki/langs/ts.mjs"),
            import("shiki/langs/tsx.mjs"),
            import("shiki/langs/jsx.mjs"),
            import("shiki/langs/python.mjs"),
            import("shiki/langs/go.mjs"),
            import("shiki/langs/rust.mjs"),
            import("shiki/langs/java.mjs"),
            import("shiki/langs/c.mjs"),
            import("shiki/langs/cpp.mjs"),
            import("shiki/langs/json.mjs"),
            import("shiki/langs/yaml.mjs"),
            import("shiki/langs/toml.mjs"),
            import("shiki/langs/bash.mjs"),
            import("shiki/langs/sql.mjs"),
            import("shiki/langs/html.mjs"),
            import("shiki/langs/css.mjs"),
            import("shiki/langs/markdown.mjs"),
            import("shiki/langs/diff.mjs"),
          ],
          engine: createJavaScriptRegexEngine(),
        });
        return highlighter as unknown as ShikiHighlighter;
      } catch {
        return null;
      }
    })();
  }
  return highlighterPromise;
}

/** Reset the cached highlighter — used by unit tests so each run starts clean. */
export function _resetHighlighterForTests(): void {
  highlighterPromise = null;
}

const LANG_ALIASES: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "python",
  py: "python",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  markdown: "markdown",
  md: "markdown",
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shikiThemeFor(theme: MarkdownPdfTheme): string {
  return theme === "dark" ? "github-dark" : "github-light";
}

interface CachedCode extends Tokens.Code {
  __highlighted?: string;
}

/**
 * Render a Markdown string to sanitized HTML, with Shiki syntax highlighting
 * on fenced code blocks and GFM features (tables, task lists, strikethrough,
 * autolinks) enabled. Task list checkboxes are emitted as Unicode glyphs so
 * they print consistently across browsers.
 */
export async function renderMarkdown(
  md: string,
  opts: RenderOpts = {},
): Promise<string> {
  const theme = opts.theme ?? "light";
  const shikiTheme = shikiThemeFor(theme);

  const marked = new Marked({
    gfm: true,
    breaks: false,
    async: true,
  });

  marked.use({
    async: true,
    async walkTokens(token: Token) {
      if (token.type !== "code") return;
      const code = token as CachedCode;
      const lang = (code.lang ?? "").trim().toLowerCase();
      if (!lang) return;
      const highlighter = await getShikiHighlighter();
      if (!highlighter) return;
      const resolved = LANG_ALIASES[lang] ?? lang;
      if (!highlighter.getLoadedLanguages().includes(resolved)) return;
      try {
        code.__highlighted = highlighter.codeToHtml(code.text, {
          lang: resolved,
          theme: shikiTheme,
        });
      } catch {
        // unknown lang or parse error — leave undefined; renderer falls back.
      }
    },
    renderer: {
      code(token: Tokens.Code) {
        const cached = (token as CachedCode).__highlighted;
        if (cached) return cached + "\n";
        const lang = token.lang ? ` data-lang="${escapeHtml(token.lang)}"` : "";
        return `<pre class="md-pdf-code-fallback"${lang}><code>${escapeHtml(token.text)}\n</code></pre>\n`;
      },
      checkbox({ checked }: Tokens.Checkbox) {
        return checked ? "☑ " : "☐ ";
      },
    },
  });

  const rawHtml = (await marked.parse(md)) as string;
  return sanitizeMarkdownHtml(rawHtml);
}

/**
 * Sanitize Markdown-rendered HTML, preserving the inline `style` and `class`
 * attributes that Shiki emits for syntax-highlighting spans.
 */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["style", "class"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}
