import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  GUARDS for the two measured ways protect-pdf can silently ruin a file, plus
  the stale-run fence the whole PDF family carries.

  THE 127-BYTE LIMIT IS SILENT DATA LOSS. Measured against the real qpdf 12.4.1
  wasm build: a password of 128 UTF-8 bytes is accepted, the file is encrypted,
  `callMain` returns 0 and stderr is empty — and the resulting document then
  refuses that password for ever, and refuses every truncation of it too. There
  is no warning to pass on, so the only place the user can be told is here,
  before the call. The limit counts BYTES: `password.length` is UTF-16 code
  units, so a length-based guard waves through exactly the passwords that
  break (43 Hangul syllables are 43 "characters" and 129 bytes).

  RE-ENCRYPTING A PROTECTED FILE FAILS. Measured rc 2, "invalid password" —
  qpdf cannot open the file, so it cannot rewrite it. The pre-flight says so up
  front instead of letting the user type a password into a run that cannot work.

  THE RUN TOKEN. `protectPdf` runs in a worker, so the main thread stays live
  for the whole run: swap the file mid-run and the settling promise would bind
  the OLD document's bytes to the NEW file, handing over the wrong PDF under
  the right name.
*/

const deferred = () => {
  let resolve!: (v: { bytes: Uint8Array; exitCode: number; warnings: string[] }) => void;
  const promise = new Promise<{ bytes: Uint8Array; exitCode: number; warnings: string[] }>(
    (r) => {
      resolve = r;
    },
  );
  return { promise, resolve };
};

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
  /*
    Deliberately the REAL implementation and not a stub: the behaviour under
    test is "count bytes, not characters", and a mock that counted characters
    would make the multi-byte case below pass with the bug still in place.
  */
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

import { ProtectPdfUI } from "@/components/tools/ProtectPdfUI";

function makeFile(): File {
  const file = new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(3)),
  });
  return file;
}

function primary(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Protect PDF" }) as HTMLButtonElement;
}

/** Drop a file and wait for the `--requires-password` pre-flight to land. */
async function loadFile() {
  render(<ProtectPdfUI />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() => expect(screen.getByLabelText("Password")).not.toBeDisabled());
}

function type(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirm } });
}

beforeEach(() => {
  vi.clearAllMocks();
  classifyPdfProtection.mockResolvedValue("none");
  protectPdf.mockResolvedValue({ bytes: new Uint8Array([37]), exitCode: 0, warnings: [] });
});

describe("ProtectPdfUI — the 127-byte password limit", () => {
  it("refuses a 128-byte password and says how long it is", async () => {
    await loadFile();
    type("a".repeat(128));

    fireEvent.click(primary());

    await waitFor(() =>
      expect(
        screen.getByText(/That password is 128 bytes long and the limit at AES-256 is 127/),
      ).toBeInTheDocument(),
    );
    // The whole point: qpdf never sees it, because qpdf would take it happily.
    expect(protectPdf).not.toHaveBeenCalled();
  });

  it("allows exactly 127 bytes — the boundary is inclusive", async () => {
    await loadFile();
    type("a".repeat(127));

    fireEvent.click(primary());

    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/bytes long and the limit at AES/)).toBeNull();
  });

  it("counts UTF-8 bytes, not characters", async () => {
    await loadFile();
    // 43 Hangul syllables: 43 characters, 3 bytes each, 129 bytes. A guard
    // written against `password.length` would let this straight through.
    const multibyte = "한".repeat(43);
    expect(multibyte.length).toBe(43);
    expect(new TextEncoder().encode(multibyte).length).toBe(129);
    type(multibyte);

    fireEvent.click(primary());

    await waitFor(() =>
      expect(screen.getByText(/That password is 129 bytes long/)).toBeInTheDocument(),
    );
    expect(protectPdf).not.toHaveBeenCalled();

    // 42 of the same character is 126 bytes, and runs.
    type("한".repeat(42));
    fireEvent.click(primary());
    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
  });
});

describe("ProtectPdfUI — the confirmation field", () => {
  it("blocks the run when the two passwords differ, and runs once they match", async () => {
    await loadFile();
    type("correct horse", "correct hoarse");

    fireEvent.click(primary());

    await waitFor(() =>
      expect(screen.getByText(/The two passwords do not match/)).toBeInTheDocument(),
    );
    expect(protectPdf).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(primary());
    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
  });

  it("sends the owner password as the user password when no separate one is set", async () => {
    await loadFile();
    type("hunter2");

    fireEvent.click(primary());

    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    // qpdf rejects a user password with no owner password (measured rc 2), so
    // the UI must send one — and the rail promises it is this exact value.
    expect(protectPdf.mock.calls[0][1]).toMatchObject({
      userPassword: "hunter2",
      ownerPassword: "hunter2",
      bits: 256,
    });
  });
});

describe("ProtectPdfUI — the pre-flight", () => {
  it("refuses a file that already needs a password, and points at unlock-pdf", async () => {
    classifyPdfProtection.mockResolvedValue("password-required");
    render(<ProtectPdfUI />);
    fireEvent.click(screen.getByText("drop"));

    await waitFor(() =>
      expect(
        screen.getByText(/This PDF already needs a password to open it/),
      ).toBeInTheDocument(),
    );
    expect(primary()).toBeDisabled();

    // Clicking anyway must not reach the engine.
    fireEvent.click(primary());
    expect(protectPdf).not.toHaveBeenCalled();

    expect(screen.getByRole("link", { name: "Unlock PDF" })).toHaveAttribute(
      "href",
      "/unlock-pdf",
    );
  });

  it("runs on a restrictions-only file, and says what the probe found", async () => {
    classifyPdfProtection.mockResolvedValue("restrictions-only");
    await loadFile();

    expect(
      screen.getByText(/it opens without a password — it carries usage restrictions only/),
    ).toBeInTheDocument();

    type("hunter2");
    fireEvent.click(primary());
    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
  });
});

describe("ProtectPdfUI — the download always matches the loaded file", () => {
  it("publishes the download when nothing changed under the run", async () => {
    await loadFile();
    type("hunter2");
    fireEvent.click(primary());

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-protected.pdf" }),
      ).toBeInTheDocument(),
    );
  });

  it("drops an in-flight run when the file is replaced", async () => {
    const run = deferred();
    protectPdf.mockReturnValueOnce(run.promise);
    await loadFile();
    type("hunter2");
    fireEvent.click(primary());
    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));

    // Reset, drop a fresh document, and only THEN let the old run land.
    fireEvent.click(screen.getByText("CHANGE FILE"));
    await waitFor(() => expect(screen.getByText("drop")).toBeInTheDocument());
    fireEvent.click(screen.getByText("drop"));
    await waitFor(() => expect(screen.getByLabelText("Password")).not.toBeDisabled());

    await act(async () => {
      run.resolve({ bytes: new Uint8Array([37]), exitCode: 0, warnings: [] });
      /*
        A macrotask boundary drains the WHOLE microtask queue, and several hops
        separate the engine's promise from the shell's `await` — the tool's own
        async wrapper sits between them. Asserting straight after `resolve()`
        would pass even with the fence removed, because the continuation would
        not have run yet.
      */
      await new Promise((r) => setTimeout(r, 0));
    });

    // The bytes belong to the previous load, so nothing may be downloadable —
    // and the password field was cleared with the file, so it is empty too.
    expect(primary()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });
});

describe("ProtectPdfUI — the restrictions the user chose are the ones that run", () => {
  /*
    NOTHING covered this path before: no test — unit or e2e — ever ticked the
    checkbox, and the only assertion on what reached the engine was a
    `toMatchObject` that omitted `permissions` entirely. So sending the
    allow-all baseline instead of the chosen restrictions passed the whole
    suite, while the rail kept reporting "Restrictions: 1 set" and the
    downloaded file came back at P = -4 with everything allowed.
  */
  it("sends the chosen permissions, not the allow-all baseline", async () => {
    await loadFile();
    type("hunter2");

    fireEvent.click(screen.getByLabelText("Also restrict what readers can do"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Printing" })).getByRole("button", {
        name: "None",
      }),
    );
    fireEvent.click(screen.getByLabelText("Allow copying text and images"));

    fireEvent.click(primary());

    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    // Whole-object equality: `toMatchObject` is what let this through before.
    expect(protectPdf.mock.calls[0][1]).toEqual({
      userPassword: "hunter2",
      ownerPassword: "hunter2",
      permissions: { print: "none", modify: "all", extract: false },
      bits: 256,
    });
  });

  it("sends the allow-all baseline while the checkbox is off, whatever was set behind it", async () => {
    await loadFile();
    type("hunter2");

    // Set a restriction, then close the disclosure again. The engine must get
    // what the surface says is happening, which is "nothing restricted".
    fireEvent.click(screen.getByLabelText("Also restrict what readers can do"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Printing" })).getByRole("button", {
        name: "None",
      }),
    );
    fireEvent.click(screen.getByLabelText("Also restrict what readers can do"));

    fireEvent.click(primary());

    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    expect(protectPdf.mock.calls[0][1].permissions).toEqual({
      print: "full",
      modify: "all",
      extract: true,
    });
  });
});

describe("ProtectPdfUI — a separate owner password", () => {
  /*
    `separateOwner` was never switched on in any test, so the true branch of
    `ownerPassword: separateOwner ? ownerPassword : password` was uncovered: a
    mutant that always sent the user password produced a file whose owner
    password was the open password — anyone who could open the document could
    also lift its restrictions — and the whole suite stayed green.
  */
  it("sends the owner password the user typed, not the open password", async () => {
    await loadFile();
    type("openme");

    fireEvent.click(screen.getByLabelText("Set a separate owner password"));
    fireEvent.change(screen.getByLabelText("Owner password"), {
      target: { value: "OWNERSECRET" },
    });

    fireEvent.click(primary());

    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    expect(protectPdf.mock.calls[0][1]).toMatchObject({
      userPassword: "openme",
      ownerPassword: "OWNERSECRET",
    });
  });

  it("will not run with the box ticked and the owner field empty", async () => {
    await loadFile();
    type("openme");
    fireEvent.click(screen.getByLabelText("Set a separate owner password"));

    expect(primary()).toBeDisabled();
    fireEvent.click(primary());
    expect(protectPdf).not.toHaveBeenCalled();
  });

  it("counts the owner password's bytes too", async () => {
    await loadFile();
    type("openme");
    fireEvent.click(screen.getByLabelText("Set a separate owner password"));
    // 43 Hangul syllables: 43 characters, 129 UTF-8 bytes.
    fireEvent.change(screen.getByLabelText("Owner password"), {
      target: { value: "한".repeat(43) },
    });

    fireEvent.click(primary());

    await waitFor(() =>
      expect(
        screen.getByText(/That owner password is 129 bytes long and the limit at AES-256 is 127/),
      ).toBeInTheDocument(),
    );
    expect(protectPdf).not.toHaveBeenCalled();
  });
});

describe("ProtectPdfUI — the limit follows the encryption strength", () => {
  /*
    MEASURED: at --bits=128 qpdf writes revision 4, whose handler keeps only
    the first 32 BYTES of the password. A 60-character password there produces
    a file that opens with its first 32 characters followed by any tail at all,
    with rc 0 and empty stderr. A fixed 127 on this rail is therefore right for
    AES-256 and silent data loss for AES-128.
  */
  it("blocks a 33-byte password at AES-128 and allows it at AES-256", async () => {
    await loadFile();
    fireEvent.click(screen.getByRole("button", { name: "AES-128" }));
    type("a".repeat(33));

    fireEvent.click(primary());

    await waitFor(() =>
      expect(
        screen.getByText(/That password is 33 bytes long and the limit at AES-128 is 32/),
      ).toBeInTheDocument(),
    );
    expect(protectPdf).not.toHaveBeenCalled();

    // The same password at AES-256 is well inside the limit and runs.
    fireEvent.click(screen.getByRole("button", { name: "AES-256" }));
    fireEvent.click(primary());
    await waitFor(() => expect(protectPdf).toHaveBeenCalledTimes(1));
    expect(protectPdf.mock.calls[0][1].bits).toBe(256);
  });

  it("states the limit that applies to the selected strength", async () => {
    await loadFile();

    expect(screen.getByText(/Up to 127 bytes at AES-256/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AES-128" }));
    expect(screen.getByText(/Up to 32 bytes at AES-128/)).toBeInTheDocument();
    expect(screen.queryByText(/Up to 127 bytes/)).toBeNull();
  });

  it("keeps the space between the number and its unit in the rail's explanation", async () => {
    await loadFile();
    const sentence = screen.getByText(/Passwords stop at/);
    expect(sentence.textContent).toContain("Passwords stop at 127 bytes because");
    expect(sentence.textContent).not.toContain("127bytes");
  });

  it("keeps that sentence in one interpolated string, where no compiler can eat the space", () => {
    /*
      THE ONLY TEST THAT CAN SEE THIS ONE, and the reason it reads the source.

      Written as JSX text around `{QPDF_MAX_PASSWORD_BYTES}`, the leading space
      of a text node that wrapped onto a second source line was stripped by
      SWC, and the SHIPPED bundle read
        `"Passwords stop at ",i.QPDF_MAX_PASSWORD_BYTES,"bytes beca`
      — the page said "Passwords stop at 127bytes". The source looked correct,
      which is why review missed it, and vitest cannot reproduce it because
      esbuild trims JSX whitespace differently from SWC: the assertion above
      passes on BOTH forms under this transform. So the fix is structural —
      inside a template literal the spacing is data, not layout — and this pins
      the structure.
    */
    const src = readFileSync("src/components/tools/ProtectPdfUI.tsx", "utf8");
    expect(src).toMatch(/\{`Passwords stop at \$\{maxBytes\} bytes because/);
    // The JSX-text form, in any of its shapes, must not come back.
    expect(src).not.toMatch(/Passwords stop at \{[A-Za-z_$]/);
  });
});

describe("ProtectPdfUI — a file that already carries restrictions", () => {
  /*
    MEASURED: `--encrypt` writes a BRAND-NEW encryption dictionary, so the
    input's permission word is dropped, not merged. A file loaded at P = -2072
    (printing and copying denied — what this site's own Permissions tool
    writes) came back at P = -4 with both allowed, while the canvas said
    "RESTRICTIONS · NONE" beside a warning that the file carried restrictions.
    Two statements about the same file, and the one the user acted on was the
    false one.
  */
  it("says the existing restrictions are replaced, not kept", async () => {
    classifyPdfProtection.mockResolvedValue("restrictions-only");
    await loadFile();

    const warning = screen.getByText(/it carries usage restrictions only/);
    expect(warning.textContent).toMatch(/REPLACED/);
    expect(warning.textContent).toMatch(
      /printing, editing and copying all allowed again|REPLACED by the ones set on this rail/,
    );
  });

  it("names the stat cell after the file it will write, not the file it was given", async () => {
    classifyPdfProtection.mockResolvedValue("restrictions-only");
    await loadFile();

    /*
      The cell is derived from this rail's controls and nothing else, so it can
      only ever describe the OUTPUT. Labelled "RESTRICTIONS" it read as a fact
      about the loaded document and printed "NONE" for a file that had two.
    */
    const cell = screen.getByText("NEW LIMITS").parentElement as HTMLElement;
    expect(cell).toHaveTextContent("NONE");
    // And no cell in the strip is labelled for the FILE's restrictions, which
    // is what "RESTRICTIONS · NONE" beside that warning was read as. (The rail
    // below still has a RESTRICTIONS control; that one is a control.)
    const strip = cell.parentElement as HTMLElement;
    expect(within(strip).queryByText("RESTRICTIONS")).toBeNull();
  });
});

describe("ProtectPdfUI — the password does not outlive the run", () => {
  /*
    React syncs a controlled input's `value` PROP onto the DOM `value`
    ATTRIBUTE, so the password was sitting in `documentElement.outerHTML` in
    cleartext despite `type="password"` — readable by anything that serialises
    the DOM — and it stayed in state, in an enabled field behind a reveal
    toggle, after the download had been handed over.
  */
  it("never writes the password into the DOM as an attribute", async () => {
    await loadFile();
    type("hunter2");

    const field = screen.getByLabelText("Password") as HTMLInputElement;
    // The node holds it as a property, which is what the engine reads back.
    expect(field.value).toBe("hunter2");
    // Serialising the document must not.
    expect(field.getAttribute("value")).toBe("");
    expect(document.body.innerHTML).not.toContain("hunter2");
  });

  it("clears the password once the encrypted file exists", async () => {
    await loadFile();
    type("hunter2");
    fireEvent.click(primary());

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-protected.pdf" }),
      ).toBeInTheDocument(),
    );

    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("hunter2");
    // And the surface says why the box is empty rather than leaving it to look
    // like the run lost it.
    expect(screen.getByText(/The password was cleared from this page/)).toBeInTheDocument();
    expect(screen.getByText("The password you set")).toBeInTheDocument();
  });
});

describe("ProtectPdfUI — a control change withdraws the download", () => {
  /*
    The shell documents `invalidate` as "every control change must call this:
    the footer swaps the primary out for a Download the moment a run lands, so
    leaving it in place would hand over a file built from the previous
    settings". Only the FILE-SWAP path was tested, and that one bumps the token
    by itself — so dropping `invalidate()` from a control's onChange left a
    Download button that handed over the previously-encrypted document while
    the rail described the new settings, with the whole suite green.
  */
  it("takes the download away when the encryption strength changes", async () => {
    await loadFile();
    type("hunter2");
    fireEvent.click(primary());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-protected.pdf" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "AES-128" }));

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(primary()).toBeInTheDocument();
  });

  it("takes the download away when the restrictions change", async () => {
    await loadFile();
    type("hunter2");
    fireEvent.click(primary());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download doc-protected.pdf" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("Also restrict what readers can do"));

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(primary()).toBeInTheDocument();
  });
});

describe("ProtectPdfUI — a refusal is visible where the user clicked", () => {
  /*
    MEASURED on the built site at 375×812: the message rendered in the canvas
    column while the primary lives in the aside, which below `xl` is a sheet
    UNDERNEATH the canvas. Tapping a refusing "Protect PDF" put the role=alert
    at top:-623 — 517px above the viewport — with no scroll and no focus move.
    The button looked dead. The structural guarantee that fixes it is that the
    message and the button share the aside.
  */
  it("renders the refusal inside the aside, with the button that produced it", async () => {
    await loadFile();
    type("hunter2", "hunterX");

    fireEvent.click(primary());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/The two passwords do not match/);
    const aside = screen.getByRole("complementary", { name: "Settings" });
    expect(aside).toContainElement(alert);
    expect(aside).toContainElement(primary());
  });

  it("re-announces an identical refusal on a second click", async () => {
    await loadFile();
    type("hunter2", "hunterX");

    fireEvent.click(primary());
    const first = await screen.findByRole("alert");

    fireEvent.click(primary());
    const second = await screen.findByRole("alert");

    /*
      A second click that re-rendered the same text into the same node produced
      ZERO DOM mutations, so the live region had nothing to announce and a
      screen-reader user got silence. The alert is keyed, so an identical
      refusal remounts.
    */
    expect(second).not.toBe(first);
    expect(second).toHaveTextContent(/The two passwords do not match/);
  });
});

describe("ProtectPdfUI — an engine that never loaded is not a broken file", () => {
  /*
    `classifyPdfProtection` throws when the 2.3 MB engine fails to load, and
    that arrived at the user as "This PDF could not be read — …" followed by an
    invitation to try Repair PDF, which loads the same engine from the same URL
    and fails identically. The file is fine; the download is not.
  */
  it("says the engine did not load, and does not blame the document", async () => {
    classifyPdfProtection.mockRejectedValue(
      new Error("The PDF security engine could not be loaded (HTTP 503)."),
    );
    render(<ProtectPdfUI />);
    fireEvent.click(screen.getByText("drop"));

    await waitFor(() =>
      expect(screen.getByText(/this file was never read/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/there is nothing wrong with it/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument();
    expect(screen.queryByText(/This PDF could not be read/)).toBeNull();
    // Repair PDF runs on the same engine, so it is not offered as the way out.
    expect(screen.queryByRole("link", { name: "Repair PDF" })).toBeNull();
    expect(screen.getByText(/2.3 MB WebAssembly download/)).toBeInTheDocument();
  });

  it("does not leak the engine's URL out of a failed module import", async () => {
    classifyPdfProtection.mockRejectedValue(
      new Error("Failed to fetch dynamically imported module: http://localhost:8815/qpdf.js"),
    );
    render(<ProtectPdfUI />);
    fireEvent.click(screen.getByText("drop"));

    await waitFor(() =>
      expect(screen.getByText(/this file was never read/)).toBeInTheDocument(),
    );
    expect(document.body.textContent).not.toContain("qpdf.js");
    expect(document.body.textContent).not.toContain("localhost:8815");
  });

  it("still blames the document when the document is what failed", async () => {
    classifyPdfProtection.mockRejectedValue(new Error("This file could not be read as a PDF."));
    render(<ProtectPdfUI />);
    fireEvent.click(screen.getByText("drop"));

    await waitFor(() =>
      expect(screen.getByText(/This PDF could not be read/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Repair PDF" })).toHaveAttribute(
      "href",
      "/repair-pdf",
    );
  });
});

describe("ProtectPdfUI — a file qpdf could not parse", () => {
  it("refuses it instead of treating it as an unprotected PDF", async () => {
    /*
      The fourth pre-flight verdict. Collapsed into "none" it made the surface
      state, as a fact, that a file qpdf could not read carried no password and
      no restrictions.
    */
    classifyPdfProtection.mockResolvedValue("unreadable");
    render(<ProtectPdfUI />);
    fireEvent.click(screen.getByText("drop"));

    await waitFor(() =>
      expect(screen.getByText(/This file could not be read as a PDF/)).toBeInTheDocument(),
    );
    expect(primary()).toBeDisabled();
    fireEvent.click(primary());
    expect(protectPdf).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Repair PDF" })).toHaveAttribute(
      "href",
      "/repair-pdf",
    );
  });
});
