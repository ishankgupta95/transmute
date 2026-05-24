import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderMarkdown,
  sanitizeMarkdownHtml,
  _resetHighlighterForTests,
} from "@/lib/tools/markdown-to-pdf";

// Stub Shiki — the real package pulls in lang/theme JSON via dynamic imports
// that jsdom cannot resolve. We only need to verify our pipeline calls into
// the highlighter and that fallback works when it doesn't.
vi.mock("shiki/core", () => ({
  createHighlighterCore: vi.fn(async () => ({
    codeToHtml: (code: string, opts: { lang: string }) =>
      `<pre class="shiki" data-lang="${opts.lang}"><code><span style="color:#005CC5">${code}</span></code></pre>`,
    getLoadedLanguages: () => ["js", "ts", "python"],
  })),
}));

vi.mock("shiki/engine/javascript", () => ({
  createJavaScriptRegexEngine: vi.fn(() => ({})),
}));

beforeEach(() => {
  _resetHighlighterForTests();
});

describe("sanitizeMarkdownHtml", () => {
  it("strips <script> tags", () => {
    const dirty = "<p>hi</p><script>alert(1)</script>";
    const clean = sanitizeMarkdownHtml(dirty);
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("alert(1)");
  });

  it("strips inline event handlers like onerror", () => {
    const dirty = '<img src="x" onerror="alert(1)">';
    const clean = sanitizeMarkdownHtml(dirty);
    expect(clean).not.toContain("onerror");
  });

  it("preserves Shiki's inline style attributes for color spans", () => {
    const dirty = '<pre class="shiki"><code><span style="color:#005CC5">x</span></code></pre>';
    const clean = sanitizeMarkdownHtml(dirty);
    expect(clean).toContain('style="color');
    expect(clean).toContain('class="shiki"');
  });

  it("strips <iframe> and <form> tags", () => {
    const dirty = '<iframe src="evil"></iframe><form action="x"></form><p>ok</p>';
    const clean = sanitizeMarkdownHtml(dirty);
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<form");
    expect(clean).toContain("<p>ok</p>");
  });
});

describe("renderMarkdown — GFM features", () => {
  it("renders headings and basic inline formatting", async () => {
    const html = await renderMarkdown("# Hello\n\nThis is **bold** and *italic*.");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders GFM tables", async () => {
    const md = `| Tool | Output |\n| --- | --- |\n| MD2PDF | PDF |\n| MD2HTML | HTML |\n`;
    const html = await renderMarkdown(md);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Tool");
    expect(html).toContain("MD2PDF");
  });

  it("renders task list items as Unicode glyphs (not <input type=checkbox>)", async () => {
    const md = "- [x] Done\n- [ ] Todo\n";
    const html = await renderMarkdown(md);
    expect(html).not.toContain("<input");
    expect(html).toContain("☑");
    expect(html).toContain("☐");
  });

  it("renders strikethrough via GFM ~~", async () => {
    const html = await renderMarkdown("hello ~~world~~");
    expect(html).toContain("<del>world</del>");
  });

  it("autolinks bare URLs", async () => {
    const html = await renderMarkdown("Visit https://example.com today");
    expect(html).toContain('href="https://example.com"');
  });

  it("strips dangerous content from rendered Markdown", async () => {
    const md = `<script>alert(1)</script>\n\n[ok](javascript:void(0))`;
    const html = await renderMarkdown(md);
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/href="javascript:/);
  });
});

describe("renderMarkdown — code blocks", () => {
  it("highlights js code via Shiki", async () => {
    const md = "```js\nconsole.log(1)\n```\n";
    const html = await renderMarkdown(md);
    expect(html).toContain('class="shiki"');
    expect(html).toContain('data-lang="js"');
    expect(html).toContain('style="color');
  });

  it("falls back to plain <pre><code> for unknown languages", async () => {
    const md = "```fakelangxxx\nlet x = 1;\n```\n";
    const html = await renderMarkdown(md);
    // Shiki mock loaded only ["js","ts","python"] — the fallback path renders
    // a md-pdf-code-fallback wrapper.
    expect(html).toContain("md-pdf-code-fallback");
    expect(html).toContain("let x");
  });

  it("switches Shiki theme between light and dark without throwing", async () => {
    const md = "```ts\nconst x: number = 1;\n```\n";
    const lightHtml = await renderMarkdown(md, { theme: "light" });
    expect(lightHtml).toContain('class="shiki"');
    const darkHtml = await renderMarkdown(md, { theme: "dark" });
    expect(darkHtml).toContain('class="shiki"');
  });

  // Keep this test last in the file — it overrides the module mock and
  // intentionally cannot be cleanly restored within the same module load.
  it("falls back gracefully when Shiki fails to load", async () => {
    vi.doMock("shiki/core", () => ({
      createHighlighterCore: vi.fn(async () => {
        throw new Error("boom");
      }),
    }));
    _resetHighlighterForTests();
    const html = await renderMarkdown("```js\nfoo()\n```\n");
    expect(html).toContain("foo()");
  });
});
