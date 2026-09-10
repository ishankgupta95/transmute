import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import {
  CodeBlock,
  CompareStage,
  PageDeck,
  PageTile,
  QueueTable,
} from "@/components/tools/ToolCanvas";

/*
  ToolCanvas is the canvas half of every tool page, so an accessibility defect
  in it is a defect on 171 pages at once. What is pinned here is exactly the
  set of things a keyboard or screen-reader user cannot work around:

    1. THE PAGE DECK IS ONE TAB STOP. `PageDeck label=…` is an ARIA listbox,
       and the APG listbox pattern is a single tab stop with the arrows moving
       between options. Every tile used to render `tabIndex: 0`, so a 60-page
       PDF on /pdf-page-reorder put 60 tab stops between the file and the Save
       button. WCAG 4.1.2.
    2. …WITHOUT STEALING THE ARROW KEYS. /pdf-page-reorder binds ArrowLeft /
       ArrowRight on the option to MOVE the page and calls preventDefault. The
       deck must yield to that, or the tool's one function stops working.
    3. SCROLL CONTAINERS TAKE FOCUS. A scroller whose children are all <span>
       or text cannot be scrolled from a keyboard in Safari or Firefox — only
       Chrome auto-focuses scrollers. WCAG 2.1.1.
    4. THE COMPARE PLATE SHOWS FOCUS. CompareStage's split slider is `opacity-0`
       across the whole stage, which renders its own focus ring at opacity 0
       too: a full-stage tab stop with no indicator. The ring has to live on the
       opaque plate. WCAG 2.4.7.
    5. THE OUTPUT HAS A NAME. The "after" image is the tool's actual result and
       the diff canvas is the entire stage in that mode; both were silent.
       WCAG 1.1.1.
    6. THE DIM TILE'S PAGE NUMBER IS READABLE. `opacity-55` computed to 4.49:1
       against the plate — under 4.5:1 by a rounding error. WCAG 1.4.3.

  Class strings are asserted directly where the defect IS the class string
  (4 and 6): jsdom applies no Tailwind, so there is no computed style to read,
  and the assertion still fails the moment the fix is removed.
*/

/** Options in DOM order with the tabindex each one currently carries. */
function optionTabIndexes(): number[] {
  return screen.getAllByRole("option").map((el) => el.tabIndex);
}

/**
 * A real focus, flushed. jsdom does fire `focusin` from `.focus()` (React's
 * `onFocus` rides on it), but an update raised outside `act` sits in the act
 * queue and never reaches the DOM the assertions read.
 */
function focusOption(name: string): HTMLElement {
  const el = screen.getByRole("option", { name });
  act(() => el.focus());
  return el;
}

function renderDeck(count: number, opts: { onArrowKey?: boolean } = {}) {
  return render(
    <PageDeck label="Page order">
      {Array.from({ length: count }, (_, i) => (
        <PageTile
          key={i}
          number={i + 1}
          selected
          interactive
          label={`Page ${i + 1}, position ${i + 1} of ${count}`}
          draggableProps={
            opts.onArrowKey
              ? {
                  // Mirrors PdfPageReorderUI: the arrows reorder, and the
                  // handler claims them with preventDefault.
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                    e.preventDefault();
                  },
                }
              : undefined
          }
        />
      ))}
    </PageDeck>,
  );
}

describe("PageDeck — roving tabindex (WCAG 4.1.2, APG listbox)", () => {
  it("is a single tab stop no matter how many pages the deck holds", () => {
    renderDeck(6);

    const tabIndexes = optionTabIndexes();
    expect(tabIndexes).toHaveLength(6);
    expect(tabIndexes.filter((t) => t === 0)).toHaveLength(1);
    // The first option is the one that holds it before anything is focused.
    expect(tabIndexes[0]).toBe(0);
    expect(tabIndexes.slice(1)).toEqual([-1, -1, -1, -1, -1]);
  });

  it("moves the tab stop to whatever option the user focused", () => {
    renderDeck(4);

    focusOption("Page 3, position 3 of 4");

    expect(optionTabIndexes()).toEqual([-1, -1, 0, -1]);
  });

  it("Home and End move focus, and the tab stop follows", () => {
    renderDeck(4);
    const last = screen.getByRole("option", { name: "Page 4, position 4 of 4" });
    const first = focusOption("Page 1, position 1 of 4");

    fireEvent.keyDown(first, { key: "End" });

    expect(document.activeElement).toBe(last);
    expect(optionTabIndexes()).toEqual([-1, -1, -1, 0]);

    fireEvent.keyDown(last, { key: "Home" });

    expect(document.activeElement).toBe(first);
    expect(optionTabIndexes()).toEqual([0, -1, -1, -1]);
  });

  it("yields the arrow keys to an option that already claimed them", () => {
    // /pdf-page-reorder moves the focused page with the arrows. If the deck
    // moved focus as well, the page would move AND the selection would jump.
    renderDeck(4, { onArrowKey: true });
    const first = focusOption("Page 1, position 1 of 4");

    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(document.activeElement).toBe(first);
    expect(optionTabIndexes()).toEqual([0, -1, -1, -1]);
  });

  it("still moves focus with the arrows when the option does not want them", () => {
    renderDeck(4);
    const first = focusOption("Page 1, position 1 of 4");

    fireEvent.keyDown(first, { key: "ArrowRight" });

    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: "Page 2, position 2 of 4" }),
    );
  });

  it("keeps focus on the page a reorder moved", () => {
    // The deck now rebuilds its children to hand out the tab stop. If that
    // rebuild dropped the caller's keys, every tile would remount on a
    // reorder and the focused page would lose focus mid-move — which is the
    // whole keyboard path on /pdf-page-reorder.
    function Deck({ order }: { order: number[] }) {
      return (
        <PageDeck label="Page order">
          {order.map((n, i) => (
            <PageTile
              key={n}
              number={n}
              selected
              interactive
              label={`Page ${n}, position ${i + 1} of ${order.length}`}
            />
          ))}
        </PageDeck>
      );
    }

    const { rerender } = render(<Deck order={[1, 2, 3]} />);
    const moved = focusOption("Page 1, position 1 of 3");

    rerender(<Deck order={[2, 1, 3]} />);

    expect(document.activeElement).toBe(moved);
    expect(screen.getByRole("option", { name: "Page 1, position 2 of 3" })).toBe(moved);
    // Still one tab stop. (It may sit on a different tile than the focused one
    // until the next focus event — a cosmetic return point, not a trap.)
    expect(optionTabIndexes().filter((t) => t === 0)).toHaveLength(1);
  });

  it("leaves a deck of buttons alone — those are not listbox options", () => {
    // The seven other PageDeck call sites pass no label; their tiles are real
    // buttons in a plain div, where one tab stop each is correct.
    render(
      <PageDeck>
        {[1, 2, 3].map((n) => (
          <PageTile key={n} number={n} selected={false} onClick={() => {}} />
        ))}
      </PageDeck>,
    );

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

describe("PageTile — dim tiles stay readable (WCAG 1.4.3)", () => {
  it("dims an unselected tile no further than opacity-70", () => {
    render(<PageTile number={7} selected={false} onClick={() => {}} />);

    const cls = screen.getByRole("button", { name: "Page 7" }).className;
    expect(cls).toContain("opacity-70");
    // 4.49:1 — under the 4.5:1 the page number needs against the plate.
    expect(cls).not.toContain("opacity-55");
  });
});

describe("Keyboard-reachable scroll containers (WCAG 2.1.1)", () => {
  it("CodeBlock's <pre> is a focusable, named region", () => {
    render(<CodeBlock>{"const a = 1;"}</CodeBlock>);

    const region = screen.getByRole("region", { name: "Generated code" });
    expect(region.tagName).toBe("PRE");
    expect(region.tabIndex).toBe(0);
  });

  it("CodeBlock's region takes its name from the label when there is one", () => {
    render(<CodeBlock label="Head snippet">{"<meta />"}</CodeBlock>);

    expect(screen.getByRole("region", { name: "Head snippet" }).tabIndex).toBe(0);
  });

  it("QueueTable's row scroller is a focusable, named region", () => {
    render(
      <QueueTable
        rows={[{ name: "a.png", inSize: "1 MB", outSize: "0.4 MB", pct: 100, state: "DONE" }]}
      />,
    );

    expect(screen.getByRole("region", { name: "Conversion queue" }).tabIndex).toBe(0);
  });
});

describe("CompareStage", () => {
  function renderCompare(props: Partial<React.ComponentProps<typeof CompareStage>> = {}) {
    return render(
      <CompareStage
        beforeUrl="blob:before"
        afterUrl="blob:after"
        inLabel="ORIGINAL"
        outLabel="COMPRESSED"
        split={50}
        onSplitChange={() => {}}
        {...props}
      />,
    );
  }

  it("renders the focus ring on the plate, not on the opacity-0 slider (WCAG 2.4.7)", () => {
    const { container } = renderCompare();

    const plate = container.firstElementChild as HTMLElement;
    const slider = screen.getByRole("slider", { name: "Compare position" });

    // The slider covers the whole plate and is invisible, so its own ring is
    // invisible too — the plate has to wear it.
    expect(slider.className).toContain("opacity-0");
    expect(plate.className).toContain("has-[input:focus-visible]:outline-2");
    expect(plate.className).toContain("has-[input:focus-visible]:outline-accent");
  });

  it("names the before and after images (WCAG 1.1.1)", () => {
    renderCompare();

    expect(screen.getByAltText("ORIGINAL")).toBeTruthy();
    expect(screen.getByAltText("COMPRESSED")).toBeTruthy();
    // Nothing on the stage is left as a silent decorative image.
    expect(
      Array.from(document.querySelectorAll("img")).filter((img) => img.alt === ""),
    ).toHaveLength(0);
  });

  it("names the before and after images in side-by-side mode too", () => {
    renderCompare();

    fireEvent.click(screen.getByRole("button", { name: "SIDE BY SIDE" }));

    expect(screen.getByAltText("ORIGINAL")).toBeTruthy();
    expect(screen.getByAltText("COMPRESSED")).toBeTruthy();
  });

  it("names the diff canvas (WCAG 1.1.1)", () => {
    renderCompare();

    fireEvent.click(screen.getByRole("button", { name: "DIFF" }));

    const diff = screen.getByRole("img", {
      name: "Pixel difference between the input and the output, amplified four times",
    });
    expect(diff.tagName).toBe("CANVAS");
  });
});
