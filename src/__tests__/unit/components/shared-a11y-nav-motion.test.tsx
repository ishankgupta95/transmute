import { readFileSync } from "node:fs";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ToolProgress } from "@/components/tools/ToolControls";
import { MobileNav } from "@/components/layout/MobileNav";
import { Navbar } from "@/components/layout/Navbar";
import { DropZone } from "@/components/tools/DropZone";
import { RecentOutputs } from "@/components/tools/RecentOutputs";
import { ToolPageLayout } from "@/components/tools/ToolPageLayout";
import { tools } from "@/data/tools";

/*
  Regression cover for the accessibility pass over navigation, motion and the
  remaining contrast/semantics defects in the shared tool components.

  Every assertion here was mutation-proven: the fix was reverted, the test was
  watched to go RED, and the fix restored. Anything that could not be observed
  from the DOM in jsdom — Tailwind never runs, so a class string is all there
  is of a colour — is asserted against the class string or the source, and
  says so at the assertion.
*/

vi.mock("next/navigation", () => ({
  usePathname: () => "/image-tools",
}));

// ─────────────────────────────────────────────────────────────────────────────
// P2-2 · WCAG 4.1.3 Status Messages
// ─────────────────────────────────────────────────────────────────────────────

describe("ToolProgress live region (P2-2, WCAG 4.1.3)", () => {
  it("inserts the region first and writes the phase into it as a SEPARATE mutation", () => {
    /*
      The defect is an ordering one and the settled DOM is identical either
      way, so the assertion has to be on the mutation sequence — which is
      precisely what the browser turns into accessibility events, and what a
      screen reader decides from. A live region is registered when its node
      enters the tree and is announced on later changes TO it; a region that
      arrives with its text already inside it is one subtree insertion and
      nothing ever changes inside it. All 58 call sites mount ToolProgress
      conditionally (`{isProcessing && <ToolProgress …/>}`), so that is the
      shape this had.
    */
    const host = document.createElement("div");
    document.body.appendChild(host);

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(host, { childList: true, subtree: true, characterData: true });

    render(<ToolProgress phase="COMPRESSING" percent={null} />, { container: host });

    records.push(...observer.takeRecords());
    observer.disconnect();

    const live = host.querySelector('[aria-live="polite"]');
    expect(live, "the phase live region must exist").not.toBeNull();
    expect(live).toHaveAttribute("aria-atomic", "true");
    expect(live!.textContent).toBe("COMPRESSING");

    // Positive control: the observer really did see the block being inserted.
    expect(records.some((r) => r.target === host && r.type === "childList")).toBe(true);

    // ↓ RED when `{phase}` is rendered as a JSX child of the live region:
    //   the text then arrives as part of the block's own insertion and there
    //   is no mutation inside the region at all.
    const insideRegion = records.filter(
      (r) => r.target === live || live!.contains(r.target),
    );
    expect(
      insideRegion.length,
      "the phase must land in the region AFTER the region exists",
    ).toBeGreaterThan(0);

    host.remove();
  });

  it("keeps the fast-changing percentage OUT of the live region", () => {
    const { container } = render(<ToolProgress phase="ENCODING" percent={42} />);
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("ENCODING");
    expect(screen.getByText("42%")).not.toBe(live);
    expect(live.contains(screen.getByText("42%"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-4 · WCAG 2.4.3 Focus Order — the mobile drawer is aria-modal
// ─────────────────────────────────────────────────────────────────────────────

describe("MobileNav focus trap (P2-4, WCAG 2.4.3)", () => {
  const open = () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog", { name: "Site menu" });
    const links = within(dialog).getAllByRole("link");
    expect(links.length).toBeGreaterThan(1);
    return { dialog, first: links[0], last: links[links.length - 1] };
  };

  it("moves focus into the panel when it opens", () => {
    const { first } = open();
    expect(document.activeElement).toBe(first);
  });

  it("wraps Tab from the last link back to the first", () => {
    const { first, last } = open();
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    // ↓ RED without the trap: jsdom does not move focus on Tab, so activeElement
    //   would still be `last` — which is exactly the browser behaviour of
    //   walking off the overlay into the page it is covering.
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first link back to the last", () => {
    const { first, last } = open();
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("pulls focus back in when it has escaped the panel entirely", () => {
    const { first } = open();
    const trigger = screen.getByRole("button", { name: "Close menu" });
    trigger.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("still closes on Escape and restores focus to the trigger", () => {
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open menu" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-7 (2.2.2) and P3-2 (1.3.1 / 2.4.6) — both live in ToolPageLayout
// ─────────────────────────────────────────────────────────────────────────────

describe("ToolPageLayout", () => {
  const tool = tools.find((t) => t.slug === "exif-viewer")!;

  const renderLayout = () =>
    render(
      <ToolPageLayout tool={tool} howToSteps={["Pick a file"]} faqs={[]}>
        {/* Stands in for ExifViewerUI's group heading (ExifViewerUI.tsx). */}
        <h3>Camera &amp; Image</h3>
      </ToolPageLayout>,
    );

  it("names the tool surface with a heading, above every control (P3-2, WCAG 1.3.1)", () => {
    const { container } = renderLayout();
    const surface = container.querySelector("[data-tool-surface]");
    expect(surface, "the tool surface must still be findable by its data attribute").not.toBeNull();

    const id = surface!.getAttribute("aria-labelledby");
    expect(id, "the tool surface must be named").toBeTruthy();

    const heading = container.querySelector(`#${CSS.escape(id!)}`);
    expect(heading).not.toBeNull();
    expect(heading!.tagName).toBe("H2");
    expect(heading!.textContent).toBe(tool.name);
    expect(surface!.contains(heading!)).toBe(true);
    // Visually hidden, not display:none — it has to stay in the a11y tree.
    expect(heading!.className).toContain("sr-only");
  });

  it("puts that heading FIRST in the document outline and skips no level", () => {
    const { container } = renderLayout();
    const levels = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels.length).toBeGreaterThan(2);
    /*
      Before the fix the outline of /exif-viewer read h3 → h1 → h2 → h2: it
      opened at level 3 with no h1 or h2 above it. The first heading a screen
      reader now meets is the tool's own name.
    */
    expect(levels[0]).toBe(2);
    expect(levels[1]).toBe(3);
  });

  it("gives both infinite animations a reduced-motion escape (P2-7, WCAG 2.2.2)", () => {
    const { container } = renderLayout();
    for (const cls of ["animate-tm-blink", "animate-tm-glow"]) {
      const el = container.querySelector(`.${cls}`);
      // Positive control: a typo'd selector must not pass as "no violation".
      expect(el, `${cls} must still be rendered`).not.toBeNull();
      expect(
        el!.classList.contains("motion-reduce:animate-none"),
        `${cls} runs forever; it needs motion-reduce:animate-none`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P3-6 (1.4.11) and P3-11 (2.4.6 / 3.3.2) — DropZone
// ─────────────────────────────────────────────────────────────────────────────

describe("DropZone", () => {
  it("describes the file input with the accepted formats and the cap (P3-11)", () => {
    render(<DropZone accept=".png,.jpg" sizeCapMB={100} onFiles={() => {}} />);
    const input = screen.getByLabelText("Drop a file to begin");
    expect(input).toHaveAccessibleDescription(/ACCEPTS/);
    expect(input).toHaveAccessibleDescription(/MAX 100 MB/);
  });

  it("also describes the memory-bound note when there is no hard cap (P3-11)", () => {
    render(
      <DropZone
        accept=".mp4"
        practicalLimitNote="Very large files may exhaust this tab's memory."
        onFiles={() => {}}
      />,
    );
    const input = screen.getByLabelText("Drop a file to begin");
    expect(input).toHaveAccessibleDescription(/MEMORY-BOUND/);
    expect(input).toHaveAccessibleDescription(/exhaust this tab's memory/);
  });

  it("draws the drop target's only visible edge at 3:1 or better (P3-6, WCAG 1.4.11)", () => {
    const { container } = render(<DropZone accept=".png" onFiles={() => {}} />);
    const plate = container.querySelector("label")!;
    /*
      Tailwind never runs in jsdom, so the class string IS the evidence. The
      plate's own border is `border-transparent` until hover/focus, which
      makes this dashed rule the drop target's only edge:
        --color-neutral-700 #595d6c on --color-nocturne-canvas → 2.83:1  FAIL
        --color-neutral-600 #75798c on --color-nocturne-canvas → 4.30:1  PASS
    */
    expect(plate.className).toContain("border-transparent");
    expect(plate.className).toContain("var(--color-neutral-600)");
    expect(plate.className).not.toContain("var(--color-neutral-700)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P3-9 · WCAG 1.3.1 — RecentOutputs' non-interactive row
// ─────────────────────────────────────────────────────────────────────────────

describe("RecentOutputs (P3-9, WCAG 1.3.1)", () => {
  beforeEach(() => {
    localStorage.setItem(
      "transmute-recent-outputs",
      JSON.stringify([
        { name: "known.png", bytes: 2048, slug: "compress-image", at: Date.now() },
        { name: "orphan.png", bytes: 2048, slug: "a-tool-this-build-forgot", at: Date.now() },
      ]),
    );
  });
  afterEach(() => localStorage.clear());

  it("does not dress an unclickable row as clickable", () => {
    render(<RecentOutputs />);

    const orphanRow = screen.getByText("orphan.png").parentElement!;
    expect(orphanRow.tagName).toBe("SPAN");
    // Positive control: the row that IS a link wears exactly these styles.
    const knownRow = screen.getByText("known.png").parentElement!;
    expect(knownRow.tagName).toBe("A");
    expect(knownRow.className).toContain("cursor-pointer");
    expect(knownRow.className).toContain("focus-visible:outline-2");

    expect(orphanRow.className).not.toContain("cursor-pointer");
    expect(orphanRow.className).not.toContain("focus-visible:");
    expect(orphanRow.className).not.toContain("hover:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P3-10 · WCAG 1.4.1 Use of Color — the navbar's current-page pill
// ─────────────────────────────────────────────────────────────────────────────

describe("Navbar active pill (P3-10, WCAG 1.4.1)", () => {
  it("marks the current page with more than a colour change", () => {
    render(<Navbar />);
    const active = screen.getByRole("link", { name: "Image" });
    expect(active).toHaveAttribute("aria-current", "page");
    /*
      `bg-accent/13` is 1.19:1 against the bar, so before this the only real
      cue was the text hue (neutral-400 → accent-200). The ring is a shape
      cue — present on this pill and no other — and measures 5.54:1 against
      the bar.
    */
    expect(active.className).toContain("ring-1");
    expect(active.className).toContain("ring-accent");

    const inactive = screen.getByRole("link", { name: "PDF" });
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive.className).not.toContain("ring-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-level guards: values jsdom cannot see, on files with no cheap render
// ─────────────────────────────────────────────────────────────────────────────

describe("source guards", () => {
  it("draws PixelateImageUI's region fields with a 3:1 border (P2-3, WCAG 1.4.11)", () => {
    const src = readFileSync("src/components/tools/PixelateImageUI.tsx", "utf8");
    const decl = src.match(/const NUMBER_FIELD_CLASS =\s*\n?\s*"([^"]+)"/);
    expect(decl, "NUMBER_FIELD_CLASS must still exist").not.toBeNull();
    const classes = decl![1];
    /*
      `border-border` is `#e9e9ed` at 16% → 1.55:1 against the rail, and the
      field's fill is 1.17:1, so the field had no perceivable boundary at all.
      `border-neutral-600` (#75798c) is 4.12:1 against the rail and 3.52:1
      against the fill.
    */
    expect(classes).toContain("border-neutral-600");
    expect(classes).not.toMatch(/\bborder-border\b/);
  });

  it("gives PixelateImageUI's preview canvas a role that takes a name (P3-3)", () => {
    const src = readFileSync("src/components/tools/PixelateImageUI.tsx", "utf8");
    // A canvas maps to the generic role, and a name on a generic role may be
    // dropped, so the aria-label needs a role beside it to be exposed.
    const canvas = src.match(/^ *<canvas$[\s\S]*?\/>/m);
    expect(canvas, "the preview canvas must still exist").not.toBeNull();
    // Anchored to a JSX attribute line so the prose above it cannot satisfy this.
    expect(canvas![0]).toMatch(/^\s*role="img"$/m);
    expect(canvas![0]).toMatch(/^\s*aria-label="Pixelation preview/m);
  });

  it("keeps ExifViewerUI's group heading at h3 under the surface h2 (P3-1, WCAG 1.3.1)", () => {
    const src = readFileSync("src/components/tools/ExifViewerUI.tsx", "utf8");
    const headings = src.match(/<h[1-6][\s>]/g) ?? [];
    // Exactly one heading, and it is an h3: h2 is the surface's, and h4 would
    // reopen the level gap this fix closed.
    expect(headings).toEqual(["<h3 "]);
    expect(src).toContain("</h3>");
  });
});
