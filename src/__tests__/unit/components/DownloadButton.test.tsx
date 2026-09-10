import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";

import { DownloadButton } from "@/components/tools/DownloadButton";

/*
  70 tool UIs render this button, and every one of them renders it in the slot
  the primary action button just vacated:

      footer={result ? <DownloadButton …/> : <ToolActions primaryLabel="Crop" …/>}

  So the failure this file exists to catch is a keyboard one. The user presses
  the primary with the keyboard — which means the primary holds focus — the run
  finishes, `result` flips the branch, and the focused element is torn out of
  the DOM. The browser resets `document.activeElement` to `<body>`, there is no
  focus ring anywhere on the page, and the next Tab starts at the top of the
  document: past the skip link, past the whole navbar, past the 230px
  sibling-tool rail, before it reaches the result the user just made.
  WCAG 2.4.3 Focus Order (Level A).

  The fix has to be narrow in one specific way: it may only claim focus that was
  ORPHANED. A user who tabbed away to read the canvas while a 40-second video
  encode ran must keep their place — a button that yanks focus back on mount
  would be a second 2.4.3 defect wearing the first one's clothes. Both
  directions are pinned below, and the harness keeps one button OUTSIDE the
  branch so "focus survived" and "focus was orphaned" are distinguishable at
  all: with every candidate inside the branch, both cases collapse to <body>.

  `triggerDownload` is mocked: it reaches for `URL.createObjectURL`, GA4 and
  localStorage, none of which is what this file is about.
*/

const triggerDownload = vi.fn();

vi.mock("@/lib/utils/download", () => ({
  triggerDownload: (...args: unknown[]) => triggerDownload(...args),
}));

const BLOB = new Blob(["x"], { type: "image/png" });

/**
 * The shape all 70 call sites share: the primary and the download occupy the
 * same slot, so flipping `done` unmounts whichever the user was standing on.
 * `Elsewhere` is deliberately outside that slot and survives the flip.
 */
function Harness({ focusOnMount }: { focusOnMount?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <>
      <button type="button">Elsewhere</button>
      {done ? (
        <DownloadButton blob={BLOB} fileName="out.png" focusOnMount={focusOnMount} />
      ) : (
        <button type="button" onClick={() => setDone(true)}>
          Crop
        </button>
      )}
    </>
  );
}

const download = () => screen.getByRole("button", { name: "Download out.png" });

beforeEach(() => {
  triggerDownload.mockClear();
});

describe("DownloadButton", () => {
  describe("focus order across the success flip (WCAG 2.4.3)", () => {
    it("takes the focus the unmounting primary dropped", () => {
      render(<Harness />);
      const primary = screen.getByRole("button", { name: "Crop" });
      primary.focus();
      expect(document.activeElement).toBe(primary);

      fireEvent.click(primary);

      expect(document.activeElement).toBe(download());
      // Spelled out because <body> is exactly where the defect left it.
      expect(document.activeElement).not.toBe(document.body);
    });

    it("leaves focus alone when the user tabbed away while the job ran", () => {
      render(<Harness />);
      const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
      elsewhere.focus();

      // `fireEvent.click` does not move focus, so this is exactly the case
      // where the result lands while the user is standing somewhere else.
      fireEvent.click(screen.getByRole("button", { name: "Crop" }));

      expect(document.activeElement).toBe(elsewhere);
      expect(document.activeElement).not.toBe(download());
    });

    it("does not grab focus from a live control when it mounts beside one", () => {
      render(<input aria-label="Nudge" />);
      const field = screen.getByLabelText("Nudge");
      field.focus();

      render(<DownloadButton blob={BLOB} fileName="out.png" />);

      expect(document.activeElement).toBe(field);
    });

    it("opts out entirely when `focusOnMount` is false", () => {
      render(<Harness focusOnMount={false} />);
      const primary = screen.getByRole("button", { name: "Crop" });
      primary.focus();

      fireEvent.click(primary);

      expect(document.activeElement).toBe(document.body);
    });
  });

  describe("the button itself", () => {
    it("is a type=button, so it can never submit a form it is dropped into", () => {
      // A <button> with no `type` is a SUBMIT button. Nothing on these pages is
      // a <form> today; the attribute is what keeps that harmless if one is.
      render(<DownloadButton blob={BLOB} fileName="out.png" />);
      expect(download()).toHaveAttribute("type", "button");
      expect((download() as HTMLButtonElement).type).toBe("button");
    });

    it("names the file it will save, not just the verb", () => {
      render(<DownloadButton blob={BLOB} fileName="holiday-photo.webp" />);
      expect(screen.getByRole("button", { name: "Download holiday-photo.webp" })).toBeTruthy();
    });

    it("hides the icon from assistive tech — the label already carries it", () => {
      const { container } = render(<DownloadButton blob={BLOB} fileName="out.png" />);
      expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    });

    it("saves the blob it was handed under the name it was handed", () => {
      render(<DownloadButton blob={BLOB} fileName="out.png" />);
      fireEvent.click(download());
      expect(triggerDownload).toHaveBeenCalledWith(BLOB, "out.png");
    });
  });
});
