import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  GUARD for repair-pdf's one real claim: whether anything was actually wrong.

  qpdf's exit code IS the result here, and it has three meanings, not two:
  0 = read cleanly, 3 = COMPLETED WITH WARNINGS (a success, with a valid output
  file), 2 = a genuine failure. Two opposite bugs live in collapsing that:

    "non-zero means failed"  breaks the tool on exactly the damaged files it
                             exists to fix, because a real repair exits 3.
    "we ran, so we repaired" takes credit for a file that arrived intact — the
                             rc 0 case, where qpdf found nothing to fix.

  So rc 0 and rc 3 must produce visibly different copy, and rc 3 must print
  qpdf's own warning lines: they are the honest account of what was wrong, and
  the only thing on the page that says what "repaired" actually meant.

  There is deliberately NO pre-flight on this tool — a damaged file may not
  survive the `--requires-password` probe the other three run — so this file
  asserts the engine is reached with nothing standing in front of it.
*/

const repairPdf = vi.fn();
const classifyPdfProtection = vi.fn();

vi.mock("@/lib/tools/qpdf", () => ({
  repairPdf: (...args: unknown[]) => repairPdf(...args),
  classifyPdfProtection: (...args: unknown[]) => classifyPdfProtection(...args),
  QPDF_MAX_PASSWORD_BYTES: 127,
  /*
    The REAL rule, not a stub: 127 is the AES-256 (R=6) limit and 32 is the
    AES-128 (R=4) one, and a mock that returned one number for both would make
    the AES-128 cases below pass with the bug still in place.
  */
  maxPasswordBytes: (bits: number) => (bits === 128 ? 32 : 127),
  QPDF_PERMISSIONS_ALLOW_ALL: { print: "full", modify: "all", extract: true },
  passwordByteLength: (password: string) => new TextEncoder().encode(password).length,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { RepairPdfUI } from "@/components/tools/RepairPdfUI";

function makeFile(): File {
  const file = new File([new Uint8Array([1, 2, 3])], "broken.pdf", {
    type: "application/pdf",
  });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(3)),
  });
  return file;
}

function primary(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Repair PDF" }) as HTMLButtonElement;
}

async function repair() {
  render(<RepairPdfUI />);
  fireEvent.click(screen.getByText("drop"));
  fireEvent.click(primary());
  await waitFor(() => expect(repairPdf).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RepairPdfUI — rc 0 and rc 3 are different results", () => {
  it("says nothing needed repairing on a clean file", async () => {
    repairPdf.mockResolvedValue({ bytes: new Uint8Array([37]), exitCode: 0, warnings: [] });
    await repair();

    await waitFor(() =>
      expect(screen.getByText(/THIS FILE PARSED CLEANLY — NOTHING NEEDED REPAIRING/)).toBeInTheDocument(),
    );
    // No claim of a rescue anywhere, and the stat says the same word.
    expect(screen.queryByText(/rebuilt what it could/)).toBeNull();
    expect(screen.getByText("CLEAN")).toBeInTheDocument();
    expect(screen.getByText("Parsed cleanly")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Download broken-repaired.pdf" }),
    ).toBeInTheDocument();
  });

  it("prints qpdf's own warning lines when the file WAS repaired", async () => {
    repairPdf.mockResolvedValue({
      bytes: new Uint8Array([37]),
      exitCode: 3,
      warnings: [
        "WARNING: file is damaged",
        "WARNING: attempting to reconstruct cross-reference table",
      ],
    });
    await repair();

    await waitFor(() =>
      expect(screen.getByText(/qpdf did not read this file cleanly/)).toBeInTheDocument(),
    );
    // Verbatim, because a paraphrase of a diagnostic is not a diagnostic.
    expect(screen.getByText("WARNING: file is damaged")).toBeInTheDocument();
    expect(
      screen.getByText("WARNING: attempting to reconstruct cross-reference table"),
    ).toBeInTheDocument();

    // And it must NOT be wearing the clean-file copy.
    expect(screen.queryByText(/NOTHING NEEDED REPAIRING/)).toBeNull();
    expect(screen.getByText("REPAIRED")).toBeInTheDocument();
    // The count is printed twice — the canvas stat and the rail row — and both
    // are derived from the same array, so either one landing proves the count.
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);

    // rc 3 is a success: the output file is real and downloadable.
    expect(
      screen.getByRole("button", { name: "Download broken-repaired.pdf" }),
    ).toBeInTheDocument();
  });

  it("says both halves when rc 3 arrives with nothing printed", async () => {
    repairPdf.mockResolvedValue({ bytes: new Uint8Array([37]), exitCode: 3, warnings: [] });
    await repair();

    await waitFor(() =>
      expect(
        screen.getByText(/REBUILT WHAT IT COULD, BUT PRINTED NO DETAIL ABOUT WHAT WAS WRONG/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/NOTHING NEEDED REPAIRING/)).toBeNull();
  });
});

describe("RepairPdfUI — the run", () => {
  it("goes straight at the file, with no pre-flight probe in front of it", async () => {
    repairPdf.mockResolvedValue({ bytes: new Uint8Array([37]), exitCode: 0, warnings: [] });
    render(<RepairPdfUI />);
    fireEvent.click(screen.getByText("drop"));

    // The primary is live the moment the file lands: nothing is being read
    // first, because a damaged file may not survive being read first.
    expect(primary()).toBeEnabled();
    expect(classifyPdfProtection).not.toHaveBeenCalled();

    fireEvent.click(primary());
    await waitFor(() => expect(repairPdf).toHaveBeenCalledTimes(1));
    expect(classifyPdfProtection).not.toHaveBeenCalled();
  });

  it("reports a genuine failure without promising a rebuild it cannot do", async () => {
    repairPdf.mockRejectedValue(new Error("This file is not a readable PDF."));
    await repair();

    await waitFor(() =>
      expect(screen.getByText("This file is not a readable PDF.")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/No PDF header or trailer dictionary to start from is the usual reason/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
  });
});

describe("RepairPdfUI — the diagnosis derives from what actually happened", () => {
  /*
    ONE FIXED PARAGRAPH used to be printed for every `status === "error"`,
    asserting the file had no trailer dictionary and that "nothing on this site
    can recover it". Measured against the built site: dropping an intact
    AES-256 PDF here produced the engine's password message — repair runs with
    no password and deliberately no pre-flight, so an encrypted file exits 2
    with "invalid password" — and that paragraph landed directly under it. The
    trailer claim was false, the file was byte-intact, and this site's own
    Unlock PDF opens it. The user was told their only copy was destroyed.
  */
  it("points an encrypted file at unlock-pdf instead of calling it unrecoverable", async () => {
    // The engine's own repair-op sentence, verbatim.
    repairPdf.mockRejectedValue(
      new Error(
        "This PDF is password-protected, and repairing it means reading the whole document — which cannot be done while it is encrypted. Remove the password with Unlock PDF first, then repair the file that produces.",
      ),
    );
    await repair();

    await waitFor(() =>
      expect(
        screen.getByText(/repairing it means reading the whole document/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Unlock PDF" })).toHaveAttribute(
      "href",
      "/unlock-pdf",
    );
    expect(
      screen.getByText(/The document itself is not damaged, and nothing on this page has changed it/),
    ).toBeInTheDocument();
    // The claims that contradicted the message must be gone.
    expect(screen.queryByText(/nothing on this site can recover it/)).toBeNull();
    expect(
      screen.queryByText(/A file it cannot find a trailer dictionary in has nothing left/),
    ).toBeNull();
  });

  it("keeps the damaged-file account for a damaged file, with no unlock link", async () => {
    repairPdf.mockRejectedValue(
      new Error(
        "This file could not be read as a PDF — it is damaged past reconstruction, or it is not a PDF at all.",
      ),
    );
    await repair();

    await waitFor(() =>
      expect(
        screen.getByText(/No PDF header or trailer dictionary to start from is the usual reason/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("link", { name: "Unlock PDF" })).toBeNull();
  });

  it("does not diagnose the document at all when the engine never loaded", async () => {
    /*
      Measured: with /qpdf.wasm served 503 the old surface printed the
      trailer-dictionary paragraph verbatim under "The PDF security engine
      could not be loaded (HTTP 503)." — a diagnosis of a file that was never
      read, on a page whose engine had not arrived.
    */
    repairPdf.mockRejectedValue(
      new Error("The PDF security engine could not be loaded (HTTP 503)."),
    );
    await repair();

    await waitFor(() =>
      expect(screen.getByText(/this file was never read/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/2.3 MB WebAssembly download/)).toBeInTheDocument();
    expect(screen.queryByText(/trailer dictionary to start from/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Unlock PDF" })).toBeNull();
  });

  it("renders the failure in the aside, with the button that produced it", async () => {
    /*
      Measured at 375×812 on the built site: errors rendered in the canvas
      column sat hundreds of pixels above the viewport when the aside — where
      the button is — became a sheet under the canvas.
    */
    repairPdf.mockRejectedValue(new Error("This file is not a readable PDF."));
    await repair();

    const alert = await screen.findByRole("alert");
    const aside = screen.getByRole("complementary", { name: "Settings" });
    expect(aside).toContainElement(alert);
    expect(aside).toContainElement(primary());
  });
});
