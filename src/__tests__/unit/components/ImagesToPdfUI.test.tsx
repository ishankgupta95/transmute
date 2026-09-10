import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  REGRESSION GUARD for audit P1-2 — "assembly order is drag-only".

  Images→PDF is the other half of the same defect as Merge PDF: the assembly
  strip could only be reordered by HTML5 drag and drop, which never fires from
  a finger and never fires from a keyboard. Page order IS the product here, so
  a user who cannot drag could build a PDF but not decide what page 1 is —
  WCAG 2.1.1 Keyboard (A) and 2.5.7 Dragging Movements (AA).

  As in the Merge PDF guard, the assertions end at the ENGINE CALL rather than
  at the rendered labels: repainting the strip in the new order while flatting
  the pages in the old one is the same bug wearing a fix. Each prepared page
  carries a distinctly-sized byte array, so the order `imagesToPdf` receives
  is readable off the byte lengths alone.
*/

const imagesToPdf = vi.fn();
const prepareForPdf = vi.fn();

vi.mock("@/lib/tools/pdf-engine", () => ({
  imagesToPdf: (...args: unknown[]) => imagesToPdf(...args),
}));

vi.mock("@/lib/tools/images-to-pdf-prep", () => ({
  prepareForPdf: (...args: unknown[]) => prepareForPdf(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles(makeFiles())}>drop</button>
  ),
}));

import { ImagesToPdfUI } from "@/components/tools/ImagesToPdfUI";

/** Sizes are the identity: 11 = alpha, 22 = bravo, 33 = charlie. */
const SIZES: Record<string, number> = { "alpha.png": 11, "bravo.png": 22, "charlie.png": 33 };

function makeFiles(): File[] {
  return Object.entries(SIZES).map(
    ([name, size]) => new File([new Uint8Array(size)], name, { type: "image/png" }),
  );
}

Object.assign(URL, {
  createObjectURL: (blob: Blob) => `blob:thumb-${blob.size}`,
  revokeObjectURL: () => {},
});

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
  render(<ImagesToPdfUI acceptFormats=".png" />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByRole("group", { name: /^alpha\.png, position 1 of 3$/ });
}

/** Byte lengths, in page order, of the images the engine was handed. */
function pageSizes(): number[] {
  const [images] = imagesToPdf.mock.calls[0] as [{ bytes: Uint8Array }[]];
  return images.map((i) => i.bytes.byteLength);
}

beforeEach(() => {
  vi.clearAllMocks();
  prepareForPdf.mockImplementation((file: File) => ({
    pages: [{ bytes: new Uint8Array(SIZES[file.name]), type: "image/png" }],
    warnings: [],
  }));
  imagesToPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe("ImagesToPdfUI — the page order can be set without a mouse (P1-2)", () => {
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

  it("reorders with ArrowRight / ArrowLeft and builds the PDF in the NEW order", async () => {
    await dropThree();

    // WCAG 2.1.1: the keyboard alone must be able to change the page order.
    fireEvent.keyDown(card("alpha.png"), { key: "ArrowRight" });
    await waitFor(() => expect(cardOrder()).toEqual(["bravo.png", "alpha.png", "charlie.png"]));

    fireEvent.keyDown(card("charlie.png"), { key: "ArrowLeft" });
    await waitFor(() => expect(cardOrder()).toEqual(["bravo.png", "charlie.png", "alpha.png"]));

    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await waitFor(() => expect(imagesToPdf).toHaveBeenCalledTimes(1));
    // 22 = bravo, 33 = charlie, 11 = alpha. The default order would be 11,22,33.
    expect(pageSizes()).toEqual([22, 33, 11]);
  });

  it("announces each move on a polite live region", async () => {
    await dropThree();
    fireEvent.keyDown(card("alpha.png"), { key: "ArrowRight" });

    const live = await screen.findByText("alpha.png moved to position 2 of 3.");
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

    fireEvent.click(card("charlie.png"));
    await waitFor(() => expect(moveLeft).toBeEnabled());
    // Nothing sits right of the last position.
    expect(moveRight).toBeDisabled();

    fireEvent.click(moveLeft);
    await waitFor(() => expect(cardOrder()).toEqual(["alpha.png", "charlie.png", "bravo.png"]));

    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await waitFor(() => expect(imagesToPdf).toHaveBeenCalledTimes(1));
    expect(pageSizes()).toEqual([11, 33, 22]);
  });

  it("does not walk a card off either end of the strip", async () => {
    await dropThree();

    fireEvent.keyDown(card("alpha.png"), { key: "ArrowLeft" });
    fireEvent.keyDown(card("charlie.png"), { key: "ArrowRight" });
    await waitFor(() =>
      expect(cardOrder()).toEqual(["alpha.png", "bravo.png", "charlie.png"]),
    );
    // A no-op move must not claim one happened.
    expect(screen.queryByText(/moved to position/)).toBeNull();
  });

  it("drops a stale PDF when the keyboard changes the order", async () => {
    await dropThree();
    fireEvent.click(screen.getByRole("button", { name: "Create PDF" }));
    await screen.findByRole("button", { name: "Download images.pdf" });

    fireEvent.keyDown(card("alpha.png"), { key: "ArrowRight" });

    // The download offered a PDF in the OLD page order — it must be gone.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Download images.pdf" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Create PDF" })).toBeEnabled();
  });
});
