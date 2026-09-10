import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  REGRESSION GUARD for audit P1-2 — "assembly order is drag-only".

  Merge PDF's entire function is choosing what order the documents come out
  in, and before this it could only be done by HTML5 drag and drop. HTML5
  drag events never fire from a finger and never fire from a keyboard, so a
  user who cannot drag could add files and press Merge but could not choose
  the order — WCAG 2.1.1 Keyboard (A) and 2.5.7 Dragging Movements (AA).

  The positive control for the shape of the fix is `PdfPageReorderUI`, which
  already solved this in this codebase: ← / → on the focused tile, visible
  Move left / Move right buttons for touch, and an `aria-live` announcement.

  The assertions below deliberately end at the ENGINE CALL, not at the
  rendered labels: a component that repainted the cards in the new order but
  merged the buffers in the old one would be the same bug wearing a fix. Each
  file's `arrayBuffer()` resolves to a distinctly-sized buffer, so the order
  `mergePdfs` receives is readable from the byte lengths alone.
*/

const mergePdfs = vi.fn();
const getPageCount = vi.fn();

vi.mock("@/lib/tools/pdf-engine", () => ({
  mergePdfs: (...args: unknown[]) => mergePdfs(...args),
  getPageCount: (...args: unknown[]) => getPageCount(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles(makeFiles())}>drop</button>
  ),
}));

import { MergePdfUI } from "@/components/tools/MergePdfUI";

/** Sizes are the identity: 11 = alpha, 22 = bravo, 33 = charlie. */
const SIZES: Record<string, number> = { "alpha.pdf": 11, "bravo.pdf": 22, "charlie.pdf": 33 };

function makeFiles(): File[] {
  return Object.entries(SIZES).map(([name, size]) => {
    const file = new File([new Uint8Array(size)], name, { type: "application/pdf" });
    // jsdom's File does not always carry arrayBuffer(); the component awaits it.
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(new ArrayBuffer(size)),
    });
    return file;
  });
}

/** The card order, read back off the accessible names the cards expose. */
function cardOrder(): string[] {
  return screen
    .getAllByRole("group")
    .map((el) => el.getAttribute("aria-label") ?? "")
    .filter((label) => /, position \d+ of \d+$/.test(label))
    .map((label) => label.replace(/, position \d+ of \d+$/, ""));
}

function card(name: string): HTMLElement {
  return screen.getByRole("group", { name: new RegExp(`^${name}, position \\d+ of \\d+$`) });
}

async function dropThree() {
  render(<MergePdfUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByRole("group", { name: /^alpha\.pdf, position 1 of 3$/ });
}

/** Byte lengths, in call order, of the buffers the engine was handed. */
function mergedSizes(): number[] {
  const [buffers] = mergePdfs.mock.calls[0] as [ArrayBuffer[]];
  return buffers.map((b) => b.byteLength);
}

beforeEach(() => {
  vi.clearAllMocks();
  getPageCount.mockResolvedValue(2);
  mergePdfs.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe("MergePdfUI — the assembly order can be set without a mouse (P1-2)", () => {
  it("exposes every card as a focusable, named target", async () => {
    await dropThree();
    for (const [idx, name] of Object.keys(SIZES).entries()) {
      const el = card(name);
      expect(el.getAttribute("tabindex"), `${name} must be reachable by Tab`).toBe("0");
      expect(el.getAttribute("aria-label")).toBe(`${name}, position ${idx + 1} of 3`);
      // The keyboard path has to be discoverable from the card itself.
      const hint = document.getElementById(el.getAttribute("aria-describedby") ?? "");
      expect(hint?.textContent).toMatch(/left or right arrow key/i);
    }
  });

  it("reorders with ArrowRight / ArrowLeft and merges in the NEW order", async () => {
    await dropThree();

    // WCAG 2.1.1: the keyboard alone must be able to change the order.
    fireEvent.keyDown(card("alpha.pdf"), { key: "ArrowRight" });
    await waitFor(() => expect(cardOrder()).toEqual(["bravo.pdf", "alpha.pdf", "charlie.pdf"]));

    fireEvent.keyDown(card("charlie.pdf"), { key: "ArrowLeft" });
    await waitFor(() => expect(cardOrder()).toEqual(["bravo.pdf", "charlie.pdf", "alpha.pdf"]));

    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));
    await waitFor(() => expect(mergePdfs).toHaveBeenCalledTimes(1));
    // 22 = bravo, 33 = charlie, 11 = alpha. The default order would be 11,22,33.
    expect(mergedSizes()).toEqual([22, 33, 11]);
  });

  it("announces each move on a polite live region", async () => {
    await dropThree();
    fireEvent.keyDown(card("alpha.pdf"), { key: "ArrowRight" });

    const live = await screen.findByText("alpha.pdf moved to position 2 of 3.");
    expect(live.getAttribute("aria-live")).toBe("polite");
  });

  it("reorders by tap + Move buttons, with no drag at all (WCAG 2.5.7)", async () => {
    await dropThree();

    // A finger produces a click, never a dragstart. Selecting the card must be
    // enough to arm the Move buttons.
    const moveRight = screen.getByRole("button", { name: "Move right" });
    const moveLeft = screen.getByRole("button", { name: "Move left" });
    expect(moveRight).toBeDisabled();
    expect(moveLeft).toBeDisabled();

    fireEvent.click(card("alpha.pdf"));
    await waitFor(() => expect(moveRight).toBeEnabled());
    // Nothing sits left of position 1.
    expect(moveLeft).toBeDisabled();

    fireEvent.click(moveRight);
    await waitFor(() => expect(cardOrder()).toEqual(["bravo.pdf", "alpha.pdf", "charlie.pdf"]));

    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));
    await waitFor(() => expect(mergePdfs).toHaveBeenCalledTimes(1));
    expect(mergedSizes()).toEqual([22, 11, 33]);
  });

  it("does not walk a card off either end of the strip", async () => {
    await dropThree();

    fireEvent.keyDown(card("alpha.pdf"), { key: "ArrowLeft" });
    fireEvent.keyDown(card("charlie.pdf"), { key: "ArrowRight" });
    await waitFor(() =>
      expect(cardOrder()).toEqual(["alpha.pdf", "bravo.pdf", "charlie.pdf"]),
    );
    // A no-op move must not claim one happened.
    expect(screen.queryByText(/moved to position/)).toBeNull();
  });

  it("drops a stale merge when the keyboard changes the order", async () => {
    await dropThree();
    fireEvent.click(screen.getByRole("button", { name: "Merge PDFs" }));
    await screen.findByRole("button", { name: "Download merged.pdf" });

    fireEvent.keyDown(card("alpha.pdf"), { key: "ArrowRight" });

    // The download offered a PDF in the OLD order — it must be gone.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Download merged.pdf" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Merge PDFs" })).toBeEnabled();
  });
});
