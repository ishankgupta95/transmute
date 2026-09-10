import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateZipUI } from "@/components/tools/CreateZipUI";
import type { CreateZipResult } from "@/lib/tools/zip-tools";

/*
  ── What is real here and what is not ──────────────────────────────────────

  The copy assertions run the REAL `createZip`: the sentence under test is
  written from `clampedLow`/`clampedHigh`, and those are only worth asserting
  if the numbers came out of an archive that was actually built. jsdom gives
  `File.arrayBuffer()`, jszip runs happily in it, and the whole batch is a
  handful of bytes.

  Only the PENDING-run test swaps `createZip` for a promise this file resolves
  by hand, because "what is disabled while a pack is in flight" needs a pack
  that stays in flight for as long as the assertions take.
*/
const pending = vi.hoisted(() => ({
  impl: null as
    | null
    | ((...args: unknown[]) => Promise<CreateZipResult>),
}));

vi.mock("@/lib/tools/zip-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/zip-tools")>();
  return {
    ...actual,
    createZip: (...args: Parameters<typeof actual.createZip>) =>
      pending.impl ? pending.impl(...args) : actual.createZip(...args),
  };
});

/*
  The zone is replaced by a button that hands over a fixed batch: the drag
  interaction is not what any of these tests are about, and every other
  component test in this directory does the same.
*/
const dropped = vi.hoisted(() => ({ files: [] as File[] }));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button data-testid="dropzone" onClick={() => onFiles(dropped.files)}>
      drop
    </button>
  ),
}));

/** `lastModified` is the whole subject of the clamp tests, so it is explicit. */
const fileAt = (name: string, lastModified: number): File =>
  new File(["some contents"], name, { lastModified });

async function dropAndCreate(files: File[]) {
  dropped.files = files;
  render(<CreateZipUI />);
  screen.getByTestId("dropzone").click();
  const create = await screen.findByRole("button", { name: /^Create archive\.zip$/ });
  create.click();
  return create;
}

describe("CreateZipUI names the date it actually wrote", () => {
  it("says 31 December 2107 for a date clamped at the TOP of the DOS window", async () => {
    await dropAndCreate([fileAt("future.txt", Date.UTC(2200, 0, 1))]);

    const warning = await screen.findByText(/modified date a ZIP cannot store/);
    expect(warning).toHaveTextContent("written as 31 December 2107 instead");
    // The archive holds 2107; saying 1980 would be 128 years out.
    expect(warning).not.toHaveTextContent("they were written as 1 January 1980");
  });

  it("still says 1 January 1980 for a date clamped at the bottom", async () => {
    await dropAndCreate([fileAt("ancient.txt", Date.UTC(1970, 0, 1))]);

    const warning = await screen.findByText(/modified date a ZIP cannot store/);
    expect(warning).toHaveTextContent("it was written as 1 January 1980 instead");
    expect(warning).not.toHaveTextContent("2107 instead");
  });

  it("names BOTH ends, with their own counts, when a batch mixes the two", async () => {
    await dropAndCreate([
      fileAt("ancient.txt", Date.UTC(1970, 0, 1)),
      fileAt("future.txt", Date.UTC(2200, 0, 1)),
      fileAt("fine.txt", Date.UTC(2024, 0, 1)),
    ]);

    const warning = await screen.findByText(/modified date a ZIP cannot store/);
    // Two of the three, and the sentence says which went which way.
    expect(warning).toHaveTextContent("2 files had a modified date a ZIP cannot store");
    expect(warning).toHaveTextContent(
      "1 was written as 1 January 1980 and 1 as 31 December 2107 instead",
    );
  });

  it("says nothing at all when every date fits", async () => {
    await dropAndCreate([fileAt("fine.txt", Date.UTC(2024, 0, 1))]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Download archive\.zip/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/modified date a ZIP cannot store/)).toBeNull();
  });
});

describe("CreateZipUI freezes the file list while a pack is in flight", () => {
  it("disables the hidden 'add more files' input, which sr-only leaves operable", async () => {
    /*
      `sr-only` CLIPS an element, it does not remove it: an undisabled input
      there is still tab-focusable and still fires `onChange`. Adding a file
      mid-pack bumps `runToken`, the in-flight run then skips its own cleanup,
      and the tool sits in PACKING with no archive and no error until START
      OVER throws the whole list away.
    */
    let release: (result: CreateZipResult) => void = () => {};
    pending.impl = () =>
      new Promise<CreateZipResult>((resolve) => {
        release = resolve;
      });

    try {
      dropped.files = [fileAt("a.txt", Date.UTC(2024, 0, 1))];
      render(<CreateZipUI />);
      screen.getByTestId("dropzone").click();
      (await screen.findByRole("button", { name: /^Create archive\.zip$/ })).click();

      // The pack is running: the visible affordances are all off…
      const addInput = await screen.findByLabelText("Add more files to the archive");
      await waitFor(() => expect(screen.getByRole("button", { name: "Packing…" })).toBeDisabled());
      expect(screen.getByRole("button", { name: "+ ADD MORE FILES" })).toBeDisabled();
      // …and so is the input hiding behind them.
      expect(addInput).toBeDisabled();

      release({
        bytes: new Uint8Array([1, 2, 3]),
        entries: [],
        uncompressedTotal: 0,
        compressedTotal: 0,
        archiveBytes: 3,
        overheadBytes: 3,
        renamed: [],
        clampedDates: 0,
        clampedLow: 0,
        clampedHigh: 0,
      });
      await waitFor(() => expect(addInput).not.toBeDisabled());
    } finally {
      pending.impl = null;
    }
  });
});
