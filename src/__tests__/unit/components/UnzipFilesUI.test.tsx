import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnzipFilesUI } from "@/components/tools/UnzipFilesUI";
import type { ExtractResult } from "@/lib/tools/zip-tools";

/*
  ── A ZIP writer with no opinions, again ───────────────────────────────────

  The archives these tests need cannot be produced by any real writer: an index
  that counts four records and holds two, and an entry whose declared size runs
  past the end of the file. `src/__tests__/unit/lib/zip-tools.test.ts` has a
  fuller version of this for the parser's own tests; this is the small subset
  the panel's copy needs, kept here rather than imported because that file is a
  suite and importing it would run it twice.
*/
interface Entry {
  name: string;
  body: string;
  /** Added to the size in the headers WITHOUT adding bytes — a cut download. */
  overstateBy?: number;
}

function buildZip(entries: Entry[], options: { declaredCount?: number } = {}): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (into: number[], v: number) => into.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (into: number[], v: number) =>
    into.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = enc.encode(e.body);
    const offset = local.length;
    const declared = data.length + (e.overstateBy ?? 0);

    u32(local, 0x04034b50);
    u16(local, 20);
    u16(local, 0);
    u16(local, 0);
    u16(local, 0x7527);
    u16(local, 0x5aa7);
    u32(local, 0);
    u32(local, declared);
    u32(local, declared);
    u16(local, nameBytes.length);
    u16(local, 0);
    local.push(...nameBytes, ...data);

    u32(central, 0x02014b50);
    u16(central, 20);
    u16(central, 20);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0x7527);
    u16(central, 0x5aa7);
    u32(central, 0);
    u32(central, declared);
    u32(central, declared);
    u16(central, nameBytes.length);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u16(central, 0);
    u32(central, 0);
    u32(central, offset);
    central.push(...nameBytes);
  }

  const declaredCount = options.declaredCount ?? entries.length;
  const eocd: number[] = [];
  u32(eocd, 0x06054b50);
  u16(eocd, 0);
  u16(eocd, 0);
  u16(eocd, declaredCount);
  u16(eocd, declaredCount);
  u32(eocd, central.length);
  u32(eocd, local.length);
  u16(eocd, 0);

  return new Uint8Array([...local, ...central, ...eocd]);
}

/** Held open so "what is disabled while inflating" has something to inflate. */
const pending = vi.hoisted(() => ({
  impl: null as null | ((...args: unknown[]) => Promise<ExtractResult>),
}));

vi.mock("@/lib/tools/zip-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/zip-tools")>();
  return {
    ...actual,
    extractZipEntries: (...args: Parameters<typeof actual.extractZipEntries>) =>
      pending.impl ? pending.impl(...args) : actual.extractZipEntries(...args),
  };
});

// jsdom has no `URL.createObjectURL`, and the save is not what is under test.
vi.mock("@/lib/utils/download", () => ({
  downloadFilesAsZip: vi.fn().mockResolvedValue(undefined),
  triggerDownload: vi.fn(),
}));

const dropped = vi.hoisted(() => ({ bytes: new Uint8Array(0) as Uint8Array<ArrayBufferLike> }));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button
      data-testid="dropzone"
      onClick={() =>
        onFiles([new File([dropped.bytes as unknown as BlobPart], "a.zip", { type: "application/zip" })])
      }
    >
      drop
    </button>
  ),
}));

async function open(bytes: Uint8Array) {
  dropped.bytes = bytes;
  render(<UnzipFilesUI />);
  screen.getByTestId("dropzone").click();
  await waitFor(() => expect(screen.queryByText("READING")).toBeNull());
}

describe("UnzipFilesUI says when the archive's index counts differently from what it holds", () => {
  it("names both numbers rather than short-listing in silence", async () => {
    await open(buildZip([{ name: "a.txt", body: "one" }, { name: "b.txt", body: "two" }], {
      declaredCount: 4,
    }));

    const note = await screen.findByText(/index says it holds/);
    expect(note).toHaveTextContent("index says it holds 4 entries and only 2 were found in it");
    expect(note).toHaveTextContent("so 2 are missing from the list below");
  });

  it("says nothing when the count is truthful", async () => {
    await open(buildZip([{ name: "a.txt", body: "one" }, { name: "b.txt", body: "two" }]));

    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
    expect(screen.queryByText(/index says it holds/)).toBeNull();
  });
});

describe("UnzipFilesUI tells the truth about a truncated archive", () => {
  it("offers nothing, and names truncation as the reason the whole file is refused", async () => {
    /*
      The trap: `truncated` looks per-entry, but the reader reads every entry's
      data as it opens the archive, so one short entry takes the two whole ones
      with it. If the panel counted the whole entries as extractable it would
      tick them, count them, offer "Download 2 files" — and deliver nothing.
    */
    await open(
      buildZip([
        { name: "good1.txt", body: "all present" },
        { name: "good2.txt", body: "also fine" },
        { name: "cut.txt", body: "cc", overstateBy: 999_999 },
      ]),
    );

    expect(await screen.findByText(/0 EXTRACTABLE/)).toBeInTheDocument();
    // The two whole entries are drawn BLOCKED, not ticked.
    expect(screen.getAllByText("BLOCKED")).toHaveLength(2);
    expect(screen.getByText("TRUNCATED")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();

    // …and the rail names truncation, not just encryption and compression.
    expect(screen.getByText(/opens an archive whole or refuses it whole/)).toHaveTextContent(
      "an entry whose data is not all in the file",
    );
    // The warning says so too, instead of implying the whole ones survive.
    expect(screen.getByText(/runs past the end of this file/)).toHaveTextContent(
      "nothing at all can be extracted from this file, not even the entries that are whole",
    );
  });
});

describe("UnzipFilesUI refuses the unreachable copy of a duplicated path", () => {
  it("marks the earlier one SHADOWED instead of ticking it", async () => {
    await open(
      buildZip([
        { name: "dup.txt", body: "first-version-short" },
        { name: "dup.txt", body: "SECOND VERSION, much longer than the first" },
      ]),
    );

    expect(await screen.findByText(/1 EXTRACTABLE/)).toBeInTheDocument();
    expect(screen.getByText("SHADOWED")).toBeInTheDocument();
    // One tick for the one entry that can actually be fetched back.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText(/listed more than once/)).toHaveTextContent(
      "marked SHADOWED rather than offered",
    );
  });
});

describe("UnzipFilesUI freezes the selection while it inflates", () => {
  it("disables the checkboxes and SELECT ALL / SELECT NONE", async () => {
    /*
      `handleExtract` captured the selection at click time; the SELECTED cell,
      "Files selected", "Unpacked size" and "Saves as" all recompute from it
      live. Left ungated, SELECT NONE pressed mid-run makes the panel read
      "0 of 2" while a two-file archive is being written to disk.
    */
    let release: (result: ExtractResult) => void = () => {};
    pending.impl = () =>
      new Promise<ExtractResult>((resolve) => {
        release = resolve;
      });

    try {
      await open(buildZip([{ name: "a.txt", body: "one" }, { name: "b.txt", body: "two" }]));

      const boxes = await screen.findAllByRole("checkbox");
      expect(boxes).toHaveLength(2);
      screen.getByRole("button", { name: /Download 2 files/ }).click();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "SELECT NONE" })).toBeDisabled(),
      );
      expect(screen.getByRole("button", { name: "SELECT ALL" })).toBeDisabled();
      for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();

      release({ files: [{ path: "a.txt", baseName: "a.txt", data: new Uint8Array([1]) }], failures: [] });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "SELECT NONE" })).not.toBeDisabled(),
      );
    } finally {
      pending.impl = null;
    }
  });
});
