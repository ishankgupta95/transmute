import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { AspectRatioCalculatorUI } from "@/components/tools/AspectRatioCalculatorUI";

/**
 * The arithmetic is pinned in src/__tests__/unit/lib/aspect-ratio.test.ts.
 * What is pinned HERE is the sentence the user reads, because both defects
 * this file guards against were only visible as copy: a screen that IS 16:10
 * being told it is not, and two bars that do not add up to the frame they sit
 * in. A tool whose whole pitch is "1366×768 is not 16:9" cannot afford either.
 */

function widthField(): HTMLInputElement {
  return screen.getByLabelText("Width") as HTMLInputElement;
}

function heightField(): HTMLInputElement {
  return screen.getByLabelText("Height") as HTMLInputElement;
}

function ratioField(): HTMLInputElement {
  return screen.getByLabelText("Ratio") as HTMLInputElement;
}

describe("AspectRatioCalculatorUI — the 16:10 chip", () => {
  it("calls 1920×1200 an exact 16:10 instead of '8:5, not 16:10'", () => {
    render(<AspectRatioCalculatorUI />);
    fireEvent.click(screen.getByRole("button", { name: "16:10" }));

    // The banner that used to fire: "1920 × 1200 is 8:5, not 16:10. It is 0%
    // narrower than 16:10 — close enough to look right and not close enough
    // to be it." Zero percent off and still refused.
    expect(screen.queryByText(/close enough to look right/)?.textContent ?? "no banner").toBe(
      "no banner",
    );
    expect(screen.queryByText(/not 16:10/)).toBeNull();

    // MATCH reads "exact", not "off 0%".
    expect(screen.getByText("exact")).toBeInTheDocument();
    expect(screen.queryByText(/^off /)).toBeNull();

    // 1920 is the default width; the chip solves the height from the ratio,
    // and the ratio field carries the pair the module actually stores.
    expect(widthField().value).toBe("1920");
    expect(heightField().value).toBe("1200");
    expect(ratioField().value).toBe("8:5");
  });

  it("still refuses to call 1366×768 16:9, which is the point of the page", () => {
    render(<AspectRatioCalculatorUI />);
    fireEvent.change(widthField(), { target: { value: "1366" } });
    expect(screen.getByText(/1366 × 768 is 683:384, not 16:9/)).toBeInTheDocument();
  });
});

describe("AspectRatioCalculatorUI — fitting into a frame", () => {
  function openFrame(w: string, h: string) {
    render(<AspectRatioCalculatorUI />);
    fireEvent.click(screen.getByLabelText("Scale this box into another one"));
    fireEvent.change(screen.getByLabelText("Frame width"), { target: { value: w } });
    fireEvent.change(screen.getByLabelText("Frame height"), { target: { value: h } });
  }

  it("prints two bars that add up to the frame when the leftover is odd", () => {
    // 1920×1080 into 1000×1000 scales to 1000×563 and leaves 437 px over.
    // The old copy said "219 px above and 219 px below" — 1001 px of picture
    // and bars in a 1000 px frame.
    openFrame("1000", "1000");
    expect(
      screen.getByText(
        /218 px of empty frame above and 219 px below — those two plus the 563 px picture are the 1000 px frame/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/219 px of empty frame above/)).toBeNull();
  });

  it("still says 'above and below' with equal bars when the leftover is even", () => {
    // 1920×1080 into 1080×1080 is the case the FAQ describes: 1080×608, and
    // 236 px of frame top and bottom.
    openFrame("1080", "1080");
    expect(
      screen.getByText(
        /236 px of empty frame above and 236 px below — those two plus the 608 px picture are the 1080 px frame/,
      ),
    ).toBeInTheDocument();
  });
});
