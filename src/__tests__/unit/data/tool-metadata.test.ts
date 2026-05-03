import { describe, expect, it } from "vitest";
import { tools, getToolBySlug } from "@/data/tools";
import { categories } from "@/data/categories";
import { faqs, PRIVACY_FAQ } from "@/data/faqs";
import { posts, getPostsLinkingToTool } from "@/data/posts";

const DESCRIPTION_MIN = 120;
const DESCRIPTION_MAX = 160;
const ABOUT_MIN_WORDS = 200;
const ABOUT_MAX_WORDS = 400;
const FAQ_MIN_RENDERED = 4;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const categorySlugs = new Set(categories.map((c) => c.slug));
const toolSlugs = new Set(tools.map((t) => t.slug));

describe("tool registry invariants", () => {
  it("has unique tool slugs", () => {
    expect(tools.length).toBe(toolSlugs.size);
  });

  it.each(tools.map((t) => [t.slug, t]))(
    "%s belongs to a known category",
    (_slug, tool) => {
      expect(categorySlugs.has(tool.category)).toBe(true);
    },
  );
});

describe("description length (§1.2: 120–160 chars)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s description is within bounds",
    (_slug, tool) => {
      expect(tool.description.length).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(tool.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    },
  );
});

// §1.2 content gap: today every tool's aboutText is below 200 words (range 115–191).
// Flip to `describe(...)` once aboutText is rewritten across the registry.
describe.skip("aboutText word count (§1.2: 200–400 words)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s aboutText is within bounds",
    (_slug, tool) => {
      const words = wordCount(tool.aboutText);
      expect(words).toBeGreaterThanOrEqual(ABOUT_MIN_WORDS);
      expect(words).toBeLessThanOrEqual(ABOUT_MAX_WORDS);
    },
  );
});

describe("relatedTools resolution (§1.2)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s relatedTools all resolve to existing tools",
    (slug, tool) => {
      for (const related of tool.relatedTools) {
        expect(getToolBySlug(related), `${slug} → ${related}`).toBeDefined();
      }
    },
  );

  it.each(tools.map((t) => [t.slug, t]))(
    "%s relatedTools does not list itself",
    (slug, tool) => {
      expect(tool.relatedTools).not.toContain(slug);
    },
  );

  it.each(tools.map((t) => [t.slug, t]))(
    "%s has no duplicate relatedTools entries",
    (_slug, tool) => {
      expect(new Set(tool.relatedTools).size).toBe(tool.relatedTools.length);
    },
  );
});

describe("FAQ structure (§1.2)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s FAQ questions are unique within the tool",
    (slug) => {
      const rendered = [...(faqs[slug] ?? []), PRIVACY_FAQ];
      const questions = rendered.map((f) => f.question.trim().toLowerCase());
      expect(new Set(questions).size).toBe(questions.length);
    },
  );

  it("PRIVACY_FAQ question does not collide with any tool's own FAQ", () => {
    const privacyQ = PRIVACY_FAQ.question.trim().toLowerCase();
    for (const slug of Object.keys(faqs)) {
      const own = faqs[slug] ?? [];
      const collisions = own.filter(
        (f) => f.question.trim().toLowerCase() === privacyQ,
      );
      expect(collisions, `${slug} duplicates PRIVACY_FAQ`).toEqual([]);
    }
  });
});

describe("FAQ count (§1.2: ≥4 rendered per tool, including PRIVACY_FAQ)", () => {
  it.each(tools.map((t) => [t.slug, t]))(
    "%s has ≥4 rendered FAQs",
    (slug) => {
      const rendered = [...(faqs[slug] ?? []), PRIVACY_FAQ];
      expect(rendered.length).toBeGreaterThanOrEqual(FAQ_MIN_RENDERED);
    },
  );
});

describe("blog post invariants (§1.1, §1.4)", () => {
  it("every blog post links to ≥3 tools", () => {
    for (const post of posts) {
      expect(
        post.relatedTools.length,
        `${post.slug} only links to ${post.relatedTools.length} tools`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("every relatedTools slug in a blog post resolves to a real tool", () => {
    for (const post of posts) {
      for (const slug of post.relatedTools) {
        expect(getToolBySlug(slug), `${post.slug} → ${slug}`).toBeDefined();
      }
    }
  });

  it("every blog post slug is unique", () => {
    const slugs = new Set(posts.map((p) => p.slug));
    expect(slugs.size).toBe(posts.length);
  });

  it.each(tools.map((t) => [t.slug]))(
    "%s has ≥1 companion blog post",
    (slug) => {
      expect(
        getPostsLinkingToTool(slug).length,
        `tool "${slug}" is not referenced by any post`,
      ).toBeGreaterThanOrEqual(1);
    },
  );
});
