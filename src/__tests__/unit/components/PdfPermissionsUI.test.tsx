import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  GUARDS for the three things pdf-permissions is easy to get wrong.

  ONE — it must never claim to protect anything. Measured: because the file
  opens with an EMPTY user password, `qpdf --password= --decrypt` strips every
  one of these restrictions back off (rc 0) — this site's own Unlock PDF does
  exactly that, with no password. The disclosure saying so is asserted here so
  a copy pass cannot quietly drop it.

  TWO — an owner password is not optional. Measured: qpdf refuses to write an
  encryption dictionary without one, and an empty user password plus an owner
  password is the accepted permissions-only shape (rc 0).

  THREE — running with every control at its allow-everything default would
  encrypt the file and restrict nothing, then present that as a finished job.

  `--accessibility` is deliberately absent from the controls: at revision 6 it
  is a measured no-op (P is -4 with it and -4 without), so a checkbox for it
  would be a lie. The test below pins the control set to exactly three.
*/

const protectPdf = vi.fn();
const classifyPdfProtection = vi.fn();

vi.mock("@/lib/tools/qpdf", () => ({
  protectPdf: (...args: unknown[]) => protectPdf(...args),
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

import { PdfPermissionsUI } from "@/components/tools/PdfPermissionsUI";

function makeFile(): File {
  const file = new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(3)),
  });
  return file;
}

function primary(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Apply restrictions" }) as HTMLButtonElement;
}

/** See the note in UnlockPdfUI.test.tsx: the probe is released deliberately. */
async function loadFile(protection: string) {
  let release!: (v: string) => void;
  classifyPdfProtection.mockReturnValueOnce(
    new Promise<string>((r) => {
      release = r;
    }),
  );
  render(<PdfPermissionsUI />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() => expect(classifyPdfProtection).toHaveBeenCalledTimes(1));
  await act(async () => {
    release(protection);
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  protectPdf.mockResolvedValue({ bytes: new Uint8Array([37]), exitCode: 0, warnings: [] });
});

describe("PdfPermissionsUI — the disclosure it owes the user", () => {
  it("says on the canvas that these restrictions keep nobody out", async () => {
    await loadFile("none");

    expect(
      screen.getByText(/These restrictions do not keep anyone out/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/including Unlock PDF on this site, which needs no password for a file like this/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Protect PDF" })).toHaveAttribute(
      "href",
      "/protect-pdf",
    );
  });

  it("offers exactly three permission controls — no accessibility toggle", async () => {
    await loadFile("none");

    expect(screen.getByRole("group", { name: "Printing" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Editing" })).toBeInTheDocument();
    // `--accessibility=n` has no measured effect at revision 6, so nothing here
    // may claim to control it: the copying checkbox is the ONLY checkbox on the
    // surface, and a fourth one appearing fails this outright.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]).toBe(screen.getByLabelText("Allow copying text and images"));
  });
});

describe("PdfPermissionsUI — what actually reaches the engine", () => {
  it("needs an owner password before it will run", async () => {
    await loadFile("none");

    expect(primary()).toBeDisabled();
    fireEvent.click(primary());
    expect(protectPdf).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "owner" } });
    expect(primary()).toBeEnabled();
  });

  it("refuses a run that would restrict nothing", async () => {
    await loadFile("none");
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "owner" } });

    fireEvent.click(primary());

    await waitFor(() =>
      expect(screen.getByText(/Nothing is restricted yet/)).toBeInTheDocument(),
    );
    expect(protectPdf).not.toHaveBeenCalled();
  });

  it("sends an empty user password with the chosen permissions", async () => {
    await loadFile("none");
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "owner" } });

    fireEvent.click(
      within(screen.getByRole("group", { name: "Printing" })).getByRole("button", {
        name: "None",
      }),
    );
    fireEvent.click(screen.getByLabelText("Allow copying text and images"));

    fireEvent.click(primary());

    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    expect(protectPdf.mock.calls[0][1]).toEqual({
      // Empty on purpose: the document has to keep opening for anyone. This is
      // the one thing that separates this tool from protect-pdf.
      userPassword: "",
      ownerPassword: "owner",
      permissions: { print: "none", modify: "all", extract: false },
      bits: 256,
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-restricted.pdf" }),
      ).toBeInTheDocument(),
    );
  });

  it("refuses an owner password over 127 bytes, counting bytes not characters", async () => {
    await loadFile("none");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Printing" })).getByRole("button", {
        name: "None",
      }),
    );
    // 43 Hangul syllables: 43 characters, 129 UTF-8 bytes.
    fireEvent.change(screen.getByLabelText("Owner password"), {
      target: { value: "한".repeat(43) },
    });

    fireEvent.click(primary());

    await waitFor(() =>
      expect(screen.getByText(/That owner password is 129 bytes long/)).toBeInTheDocument(),
    );
    expect(protectPdf).not.toHaveBeenCalled();

    // 127 bytes exactly is inside the limit and runs.
    fireEvent.change(screen.getByLabelText("Owner password"), {
      target: { value: "a".repeat(127) },
    });
    fireEvent.click(primary());
    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
  });
});

describe("PdfPermissionsUI — the pre-flight", () => {
  it("refuses a file it cannot open, and points at unlock-pdf", async () => {
    await loadFile("password-required");

    expect(
      screen.getByText(
        /This PDF needs a password to open it, so its permissions cannot be read or rewritten here/,
      ),
    ).toBeInTheDocument();
    expect(primary()).toBeDisabled();
    fireEvent.click(primary());
    expect(protectPdf).not.toHaveBeenCalled();

    expect(screen.getByRole("link", { name: "Unlock PDF" })).toHaveAttribute(
      "href",
      "/unlock-pdf",
    );
  });
});

describe("PdfPermissionsUI — the owner password does not outlive the run", () => {
  /*
    React mirrors a controlled input's value onto the DOM `value` ATTRIBUTE, so
    the owner password was in `documentElement.outerHTML` in cleartext and
    stayed in an enabled field behind a reveal toggle after the download.
  */
  it("keeps it out of the DOM, and drops it once the restricted file exists", async () => {
    await loadFile("none");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Printing" })).getByRole("button", {
        name: "None",
      }),
    );

    const field = screen.getByLabelText("Owner password") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "ownersecret" } });
    expect(field.value).toBe("ownersecret");
    expect(field.getAttribute("value")).toBe("");
    expect(document.body.innerHTML).not.toContain("ownersecret");

    fireEvent.click(primary());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-restricted.pdf" }),
      ).toBeInTheDocument(),
    );

    expect(screen.getByLabelText("Owner password")).toHaveValue("");
    expect(screen.getByText(/The owner password was cleared from this page/)).toBeInTheDocument();
  });
});

describe("PdfPermissionsUI — the limit follows the encryption strength", () => {
  /*
    MEASURED: `--bits=128` makes qpdf write revision 4, whose handler keeps only
    the first 32 BYTES of the password — silently, rc 0, empty stderr. 127 is
    the AES-256 limit and is wrong for the other button on this rail.
  */
  it("blocks a 33-byte owner password at AES-128 and allows it at AES-256", async () => {
    await loadFile("none");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Printing" })).getByRole("button", {
        name: "None",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "AES-128" }));
    fireEvent.change(screen.getByLabelText("Owner password"), {
      target: { value: "a".repeat(33) },
    });

    fireEvent.click(primary());

    await waitFor(() =>
      expect(
        screen.getByText(/That owner password is 33 bytes long and the limit at AES-128 is 32/),
      ).toBeInTheDocument(),
    );
    expect(protectPdf).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "AES-256" }));
    fireEvent.click(primary());
    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    expect(protectPdf.mock.calls[0][1].bits).toBe(256);
  });

  it("states the limit that applies to the selected strength", async () => {
    await loadFile("none");

    expect(screen.getByText(/Up to 127 bytes at AES-256/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AES-128" }));
    expect(screen.getByText(/Up to 32 bytes at AES-128/)).toBeInTheDocument();
  });
});

describe("PdfPermissionsUI — a refusal is visible where the user clicked", () => {
  it("renders the refusal in the aside, with the button that produced it", async () => {
    await loadFile("none");
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "owner" } });

    fireEvent.click(primary());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Nothing is restricted yet/);
    const aside = screen.getByRole("complementary", { name: "Settings" });
    expect(aside).toContainElement(alert);
    expect(aside).toContainElement(primary());
  });
});

describe("PdfPermissionsUI — a control change withdraws the download", () => {
  it("takes the download away when a permission changes after a run", async () => {
    await loadFile("none");
    fireEvent.click(
      within(screen.getByRole("group", { name: "Printing" })).getByRole("button", {
        name: "None",
      }),
    );
    fireEvent.change(screen.getByLabelText("Owner password"), { target: { value: "owner" } });
    fireEvent.click(primary());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-restricted.pdf" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      within(screen.getByRole("group", { name: "Editing" })).getByRole("button", {
        name: "None",
      }),
    );

    // Leaving the download in place would hand over a file built from the
    // previous settings while the rail describes the new ones.
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(primary()).toBeInTheDocument();
  });
});

describe("PdfPermissionsUI — a file qpdf could not parse", () => {
  it("refuses it instead of treating it as an unrestricted PDF", async () => {
    await loadFile("unreadable");

    expect(
      screen.getByText(/This file could not be read as a PDF, so no permissions can be written/),
    ).toBeInTheDocument();
    expect(primary()).toBeDisabled();
    fireEvent.click(primary());
    expect(protectPdf).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Repair PDF" })).toHaveAttribute(
      "href",
      "/repair-pdf",
    );
  });
});
