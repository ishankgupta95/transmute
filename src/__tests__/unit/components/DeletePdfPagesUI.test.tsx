import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  REGRESSION GUARD for a measured defect (F1).

  `deletePdfPages` runs in a dedicated worker, so the main thread is idle for
  the whole run and the page deck stays fully clickable. The invalidation the
  tool relied on — `setStatus((s) => (s === "done" ? "idle" : s))` — is inert
  mid-run, because the status is "processing" and never "done". So clicking a
  tile while the engine was working left every readout describing the NEW
  selection while the finished download carried the OLD one.

  Measured before the fix, driving the real component with the engine held on a
  deferred promise: header "3 PAGES WILL BE REMOVED", aside "Removing 3 of 6",
  a `pages-removed.pdf` download offered, engine called with [[0, 1]].
*/

const deferred = () => {
  let resolve!: (v: Uint8Array) => void;
  const promise = new Promise<Uint8Array>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const deletePdfPages = vi.fn();
const getPageCount = vi.fn();

vi.mock("@/lib/tools/pdf-engine", () => ({
  deletePdfPages: (...args: unknown[]) => deletePdfPages(...args),
  getPageCount: (...args: unknown[]) => getPageCount(...args),
  // The thumbnail hook parses the file with pdfjs. Neither call matters here,
  // but both must resolve or the hook's un-caught async IIFE rejects.
  loadPdfjsDocument: vi.fn().mockResolvedValue({
    numPages: 6,
    destroy: vi.fn().mockResolvedValue(undefined),
  }),
  renderPageFromDoc: vi.fn().mockResolvedValue({ toDataURL: () => "" }),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { DeletePdfPagesUI } from "@/components/tools/DeletePdfPagesUI";

function makeFile(): File {
  const file = new File([new Uint8Array([1, 2, 3])], "six-pages.pdf", {
    type: "application/pdf",
  });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(3)),
  });
  return file;
}

async function loadSixPages() {
  render(<DeletePdfPagesUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByRole("button", { name: /^Page 1(,|$)/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  getPageCount.mockResolvedValue(6);
});

describe("DeletePdfPagesUI — the download always matches the visible selection", () => {
  it("cancels an in-flight run when the deck selection changes", async () => {
    const run = deferred();
    deletePdfPages.mockReturnValueOnce(run.promise);
    await loadSixPages();

    fireEvent.click(screen.getByRole("button", { name: /^Page 1,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Page 2,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 pages" }));

    await waitFor(() => expect(deletePdfPages).toHaveBeenCalledTimes(1));
    expect(deletePdfPages.mock.calls[0][1]).toEqual([0, 1]);

    // Mid-run click: this is the whole defect.
    fireEvent.click(screen.getByRole("button", { name: /^Page 5,/ }));
    expect(screen.getByText("3 PAGES WILL BE REMOVED")).toBeInTheDocument();

    run.resolve(new Uint8Array([37]));
    await waitFor(() =>
      // The primary is back, which only happens once the run has been dropped.
      expect(screen.getByRole("button", { name: "Delete 3 pages" })).toBeInTheDocument(),
    );

    // The bytes were built from [0, 1]; the screen says three pages go. No
    // download may be offered for a selection the file does not describe.
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByText("3 PAGES WILL BE REMOVED")).toBeInTheDocument();
  });

  it("still publishes the download when nothing touched the selection", async () => {
    const run = deferred();
    deletePdfPages.mockReturnValueOnce(run.promise);
    await loadSixPages();

    fireEvent.click(screen.getByRole("button", { name: /^Page 1,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 page" }));
    await waitFor(() => expect(deletePdfPages).toHaveBeenCalledTimes(1));

    run.resolve(new Uint8Array([37]));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download pages-removed.pdf" }),
      ).toBeInTheDocument(),
    );
  });

  it("drops an in-flight run when the file is replaced", async () => {
    const run = deferred();
    deletePdfPages.mockReturnValueOnce(run.promise);
    await loadSixPages();

    fireEvent.click(screen.getByRole("button", { name: /^Page 1,/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 page" }));
    await waitFor(() => expect(deletePdfPages).toHaveBeenCalledTimes(1));

    // Reset, drop a fresh document, and only THEN let the old run land.
    fireEvent.click(screen.getByText("CHANGE FILE"));
    await waitFor(() => expect(screen.getByText("drop")).toBeInTheDocument());
    fireEvent.click(screen.getByText("drop"));
    await screen.findByRole("button", { name: /^Page 1(,|$)/ });

    run.resolve(new Uint8Array([37]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete 0 pages" })).toBeInTheDocument(),
    );
    // Nothing is selected on the new file, so nothing may be downloadable.
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
  });
});
