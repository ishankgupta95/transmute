import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  GUARD for the defect unlock-pdf would have shipped without a pre-flight.

  MEASURED: `qpdf --password= --decrypt -- in.pdf out.pdf` on a PDF that was
  never encrypted exits 0, prints nothing, and writes a valid output file. So a
  tool that just called the engine would time the run, print "Done in 40 ms",
  and offer a `-unlocked.pdf` for a document that had no password to remove.
  Nothing in the engine's result distinguishes that from a real unlock.

  `--requires-password` is the fix, and it is a THREE-way answer, not two:
  rc 2 = not encrypted, rc 3 = encrypted but opens without a password
  (restrictions only), rc 0 = a password is required. This file pins all three
  to the state they must produce, because collapsing rc 3 into either of the
  others is the other way to get this wrong: refuse a file that can be
  unlocked, or demand a password for a file that does not have one.
*/

const unlockPdf = vi.fn();
const classifyPdfProtection = vi.fn();

vi.mock("@/lib/tools/qpdf", () => ({
  unlockPdf: (...args: unknown[]) => unlockPdf(...args),
  classifyPdfProtection: (...args: unknown[]) => classifyPdfProtection(...args),
  QPDF_MAX_PASSWORD_BYTES: 127,
  /*
    The REAL rule, not a stub: 127 is the AES-256 (R=6) limit and 32 is the
    AES-128 (R=4) one, and a mock that returned one number for both would make
    the AES-128 cases below pass with the bug still in place.
  */
  maxPasswordBytes: (bits: number) => (bits === 128 ? 32 : 127),
  QPDF_PERMISSIONS_ALLOW_ALL: { print: "full", modify: "all", extract: true },
  // The real one: the guard under test counts bytes, not characters.
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

import { UnlockPdfUI } from "@/components/tools/UnlockPdfUI";

function makeFile(): File {
  const file = new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(3)),
  });
  return file;
}

function primary(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Remove password" }) as HTMLButtonElement;
}

/**
 * Drop a file and land the `--requires-password` pre-flight on a chosen
 * verdict. The probe is held on a deferred promise and released inside `act`
 * so the wait is on a real transition rather than on a condition that may
 * already hold — a `waitFor` that passes on its first poll proves nothing.
 */
async function loadFile(protection: string) {
  let release!: (v: string) => void;
  classifyPdfProtection.mockReturnValueOnce(
    new Promise<string>((r) => {
      release = r;
    }),
  );
  render(<UnlockPdfUI />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() => expect(classifyPdfProtection).toHaveBeenCalledTimes(1));
  await act(async () => {
    release(protection);
    // A macrotask boundary drains the whole microtask queue, so the verdict
    // has definitely been committed by the time this returns.
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  unlockPdf.mockResolvedValue({ bytes: new Uint8Array([37]), exitCode: 0, warnings: [] });
});

describe("UnlockPdfUI — the three pre-flight verdicts", () => {
  it("refuses an unprotected file rather than reporting an unlock of nothing", async () => {
    await loadFile("none");

    expect(
      screen.getByText(
        /This PDF has no password and no usage restrictions on it — there is nothing here to remove/,
      ),
    ).toBeInTheDocument();
    expect(primary()).toBeDisabled();

    // The whole defect: without this the engine would be called and succeed.
    fireEvent.click(primary());
    expect(unlockPdf).not.toHaveBeenCalled();

    expect(screen.getByRole("link", { name: "Protect PDF" })).toHaveAttribute(
      "href",
      "/protect-pdf",
    );
  });

  it("runs a restrictions-only file with no password, and offers no field to type one in", async () => {
    await loadFile("restrictions-only");

    expect(
      screen.getByText(/it carries usage restrictions — limits on printing, editing or copying/),
    ).toBeInTheDocument();
    // No field at all: there is nothing to type, and a password typed here
    // would be sent to a file that never had one.
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(primary()).toBeEnabled();

    fireEvent.click(primary());
    await waitFor(() => expect(unlockPdf).toHaveBeenCalledTimes(1));
    expect(unlockPdf.mock.calls[0][1]).toBe("");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-unlocked.pdf" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/THE USAGE RESTRICTIONS ARE GONE/),
    ).toBeInTheDocument();
  });

  it("demands a password for a file that needs one, then sends exactly what was typed", async () => {
    await loadFile("password-required");

    // The field is there and the primary is shut until something is in it.
    expect(primary()).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    expect(primary()).toBeEnabled();

    fireEvent.click(primary());
    await waitFor(() => expect(unlockPdf).toHaveBeenCalledTimes(1));
    expect(unlockPdf.mock.calls[0][1]).toBe("hunter2");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-unlocked.pdf" }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/THE PASSWORD AND ANY USAGE RESTRICTIONS ARE GONE/)).toBeInTheDocument();
  });
});

describe("UnlockPdfUI — the pre-flight is fenced like a run", () => {
  it("ignores a verdict that lands after the file was replaced", async () => {
    /*
      The probe is async and nothing cancels it, so it needs the same run-token
      fence the run does. Swap the file while the first probe is in flight and
      an unfenced `setProtection` would describe the OLD document: here that
      means the new file — which needs a password — is declared unprotected and
      the tool refuses to touch it.
    */
    let releaseFirst!: (v: string) => void;
    let releaseSecond!: (v: string) => void;
    classifyPdfProtection
      .mockReturnValueOnce(
        new Promise<string>((r) => {
          releaseFirst = r;
        }),
      )
      .mockReturnValueOnce(
        new Promise<string>((r) => {
          releaseSecond = r;
        }),
      );

    render(<UnlockPdfUI />);
    fireEvent.click(screen.getByText("drop"));
    await waitFor(() => expect(classifyPdfProtection).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("CHANGE FILE"));
    await waitFor(() => expect(screen.getByText("drop")).toBeInTheDocument());
    fireEvent.click(screen.getByText("drop"));
    await waitFor(() => expect(classifyPdfProtection).toHaveBeenCalledTimes(2));

    await act(async () => {
      releaseSecond("password-required");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    // The FIRST file's verdict lands last. It describes a document nobody is
    // looking at any more, so it must be dropped on the floor.
    await act(async () => {
      releaseFirst("none");
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByText(/there is nothing here to remove/)).toBeNull();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(primary()).toBeDisabled();
  });
});

describe("UnlockPdfUI — there is no length limit on OPENING a file", () => {
  it("sends a 200-byte password straight through, unaltered", async () => {
    /*
      127 and 32 are limits on what qpdf can WRITE at revision 6 and revision 4.
      Neither is a limit on what it will ACCEPT when opening a document some
      other tool produced. MEASURED: a file encrypted elsewhere at --bits=128
      with a 200-byte password is opened by that 200-byte password on the first
      try (rc 0) — R=4 truncates on both sides, so it simply matches. A guard
      here refused that document outright, with a sentence claiming a limit
      that does not exist for reading.
    */
    await loadFile("password-required");

    const long = "a".repeat(200);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: long } });

    fireEvent.click(primary());

    await waitFor(() => expect(unlockPdf).toHaveBeenCalledTimes(1));
    expect(unlockPdf.mock.calls[0][1]).toBe(long);
    expect(screen.queryByText(/bytes long/)).toBeNull();
  });

  it("does not claim a limit anywhere on the surface", async () => {
    await loadFile("password-required");

    // The rail used to say "qpdf will not take one over 127 bytes", which is
    // false for opening a file.
    expect(document.body.textContent).not.toMatch(/127/);
  });
});

describe("UnlockPdfUI — the stat strip says what the alert says", () => {
  /*
    `PROTECTION_STAT` drove three readouts — the canvas header's trailing
    value, the PROTECTION stat cell and the rail's "Found" row — and NOTHING
    asserted it. Permuting the map made the surface contradict itself
    ("PROTECTION · PASSWORD" two rows under "This PDF has no password and no
    usage restrictions on it") with the whole unit suite and the pdf-security
    e2e still green, because the e2e's notice helper only reads role=alert and
    role=status and cannot see a stat cell.
  */
  const stat = (label: string) =>
    (screen.getByText(label).parentElement as HTMLElement).textContent;

  it("prints NONE for an unprotected file, beside the alert that says the same", async () => {
    await loadFile("none");

    expect(stat("PROTECTION")).toBe("PROTECTIONNONE");
    expect(stat("Found")).toBe("FoundNONE");
    expect(
      screen.getByText(/This PDF has no password and no usage restrictions on it/),
    ).toBeInTheDocument();
  });

  it("prints RESTRICTIONS for a file that opens without a password", async () => {
    await loadFile("restrictions-only");

    expect(stat("PROTECTION")).toBe("PROTECTIONRESTRICTIONS");
    expect(stat("Found")).toBe("FoundRESTRICTIONS");
    expect(
      screen.getByText(/it carries usage restrictions — limits on printing, editing or copying/),
    ).toBeInTheDocument();
  });

  it("prints PASSWORD for a file that needs one", async () => {
    await loadFile("password-required");

    expect(stat("PROTECTION")).toBe("PROTECTIONPASSWORD");
    expect(stat("Found")).toBe("FoundPASSWORD");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("prints UNREADABLE rather than an empty cell for a file qpdf could not parse", async () => {
    /*
      The fourth verdict. A `Record` lookup printed nothing at all for a key it
      did not have, and folding it into "none" made the tool state as fact that
      an unreadable file carried no password and no restrictions.
    */
    await loadFile("unreadable");

    expect(stat("PROTECTION")).toBe("PROTECTIONUNREADABLE");
    expect(stat("Found")).toBe("FoundUNREADABLE");
    expect(
      screen.getByText(/This file could not be read as a PDF, so there is no way to tell/),
    ).toBeInTheDocument();
    expect(primary()).toBeDisabled();
    fireEvent.click(primary());
    expect(unlockPdf).not.toHaveBeenCalled();
    // No password field: there is nothing to type into a file nothing can open.
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("link", { name: "Repair PDF" })).toHaveAttribute(
      "href",
      "/repair-pdf",
    );
  });
});

describe("UnlockPdfUI — the password does not outlive the run", () => {
  it("keeps the password out of the DOM and drops it once the file is unlocked", async () => {
    await loadFile("password-required");

    const field = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "hunter2" } });
    // React mirrors a controlled input's value onto the `value` ATTRIBUTE, so
    // this field is deliberately not one: the node holds the secret as a
    // property, and serialising the document does not reveal it.
    expect(field.value).toBe("hunter2");
    expect(field.getAttribute("value")).toBe("");
    expect(document.body.innerHTML).not.toContain("hunter2");

    fireEvent.click(primary());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-unlocked.pdf" }),
      ).toBeInTheDocument(),
    );

    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByText(/It was cleared from this page/)).toBeInTheDocument();
  });
});

describe("UnlockPdfUI — a refusal is visible where the user clicked", () => {
  it("renders the failure in the aside, with the button that produced it", async () => {
    unlockPdf.mockRejectedValue(
      new Error("This PDF is password-protected and the password entered is wrong or missing."),
    );
    await loadFile("password-required");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });

    fireEvent.click(primary());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/wrong or missing/);
    const aside = screen.getByRole("complementary", { name: "Settings" });
    expect(aside).toContainElement(alert);
    expect(aside).toContainElement(primary());
  });
});
