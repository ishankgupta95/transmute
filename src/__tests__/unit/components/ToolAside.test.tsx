import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ToolAdvanced, ToolAside, ToolDone } from "@/components/tools/ToolAside";

/*
  Two defects in this file's components, both of which pay out across the whole
  site because 24 tools render `ToolDone` and 120 render the rail.

  1. NOTHING ANNOUNCED SUCCESS. Failure has been announced since the redesign —
     `ErrorMessage` is a `role="alert"` at 96 call sites, `WarningMessage` a
     `role="status"`. `ToolDone`, the component whose entire job is to say the
     run finished, was a bare `<div>`: no role, no `aria-live`. A screen-reader
     user pressed Run and heard nothing at all when the file was ready — the
     Download button that appears beside it is silent too. WCAG 4.1.3 Status
     Messages (AA).

  2. `ADVANCED`'s settings count was `text-text-muted` under `opacity-60`.
     text-muted is #9397ab, which measures 6.14:1 on the rail; at 60% opacity it
     composites to 3.03:1 — under the 4.5:1 WCAG 1.4.3 (AA) asks of body text.
     jsdom has no Tailwind stylesheet, so the ratio cannot be recomputed here;
     what is pinned instead is the one thing the fix changed, an opacity utility
     on that node, with a positive control that the node was found at all.

  Copy strings are duplicated rather than imported, so the test notices the
  constant changing.
*/

/** Collapses the whitespace JSX inserts between source lines. */
function text(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("ToolDone", () => {
  describe("it announces the finish (WCAG 4.1.3)", () => {
    it("is a live region, not a bare div", () => {
      render(<ToolDone elapsed="1.4 s" />);
      expect(screen.getByRole("status")).toBeTruthy();
    });

    it("is polite and atomic, so the whole sentence is read once", () => {
      // `role="status"` implies both, but the implication is not universal in
      // older AT and the two attributes are what a live-region audit greps for.
      render(<ToolDone elapsed="1.4 s" />);
      const region = screen.getByRole("status");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveAttribute("aria-atomic", "true");
    });

    it("carries the completion sentence INSIDE the live region", () => {
      // The region announcing nothing would be the same silence with an
      // attribute on it, so assert the text is a descendant, not a sibling.
      render(<ToolDone elapsed="1.4 s" />);
      expect(text(screen.getByRole("status"))).toBe("Done in 1.4 s.");
    });

    it("adds the Recent-output clause, spaced, when the output was recorded", () => {
      // This repo has shipped `at most 300frames` from exactly this JSX shape:
      // an expression next to a text chunk eats the newline-only whitespace.
      render(<ToolDone elapsed="0.2 s" savedToRecent />);
      expect(text(screen.getByRole("status"))).toBe(
        "Done in 0.2 s — saved to Recent output.",
      );
    });

    it("keeps the tick out of the announcement", () => {
      const { container } = render(<ToolDone elapsed="1.4 s" />);
      expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    });

    it("is the only live region it renders — one announcement, not two", () => {
      const { container } = render(<ToolDone elapsed="1.4 s" />);
      expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
      expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
    });
  });

  it("still reaches the rail footer as a live region when composed", () => {
    // The footer is where all 24 callers put it; a wrapper that stripped the
    // role on the way through would not show up in the isolated tests above.
    render(
      <ToolAside footer={<ToolDone elapsed="3.1 s" />}>
        <div>controls</div>
      </ToolAside>,
    );
    const region = screen.getByRole("status");
    expect(text(region)).toBe("Done in 3.1 s.");
    expect(screen.getByRole("complementary", { name: "Settings" })).toContainElement(region);
  });
});

describe("ToolAdvanced", () => {
  const ROWS = [
    ["Encoder", "libx264"],
    ["Container", "MP4"],
  ] as const;

  it("does not dim the settings count below the body-text contrast floor", () => {
    render(<ToolAdvanced rows={ROWS} />);
    const count = screen.getByText("2 SETTINGS", { exact: false });
    // Positive control: without this the assertion below would pass just as
    // happily against the wrong node, or against nothing.
    expect(count.className).toContain("text-text-muted");
    expect(count.className).not.toMatch(/(^|[\s:])opacity-\d/);
  });

  it("does not dim the ADVANCED label either", () => {
    render(<ToolAdvanced rows={ROWS} />);
    const label = screen.getByText("ADVANCED");
    expect(label.className).toContain("text-text-muted");
    expect(label.className).not.toMatch(/(^|[\s:])opacity-\d/);
  });

  it("counts the rows it was handed", () => {
    render(<ToolAdvanced rows={[["Encoder", "libx264"]]} />);
    expect(screen.getByText("1 SETTINGS", { exact: false })).toBeTruthy();
  });
});
