import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/*
  P2-6 — THE TEXT PANES MUST BE SCROLLABLE FROM A KEYBOARD. WCAG 2.1.1 (A).

  Every developer/text tool renders its output into `TEXT_PANE_BODY`, which is
  `overflow-auto`. A scroll container whose children are all text or <span>
  has nothing focusable inside it, so in Safari and Firefox there is no way to
  put the caret or the scroll cursor into it: the output below the fold is
  simply unreachable without a mouse. (Chrome auto-focuses scrollers, which is
  why this survived for so long — it is invisible on the browser most people
  develop in.) The fix is a tab stop of the pane's own, plus a name so the
  person who lands there knows what they landed on.

  `TEXT_PANE_BODY` cannot host the fix today — it belongs to ToolCanvas, and
  `tabIndex` is not a class in any case — so each pane carries it. Two layers
  are pinned here:

    1. RENDERED. Four tools are driven to the point where a pane exists, and
       the pane is then focused for real: `document.activeElement` has to
       become it. That proves the attribute reaches the DOM and that the
       element genuinely accepts focus, which an attribute assertion alone
       does not.
    2. EXHAUSTIVE. The other 34 panes are not each worth a mock, but they are
       worth covering, and a pane added next month is worth covering too. The
       whole of `src/components/tools` is parsed and every non-natively-
       focusable `TEXT_PANE_BODY` element must carry the tab stop, a name and
       a focus ring. The same checker is run over a synthetic file first (see
       `positive control`) so that a pass cannot mean "found nothing to check".

  THE FOCUS RING NEEDS `outline-solid`, and that is not decoration. Tailwind 4
  compiles `outline-none` to `--tw-outline-style: none`, and compiles
  `outline-2` to `outline-style: var(--tw-outline-style); outline-width: 2px`.
  `TEXT_PANE_BODY` ends in `focus:outline-none`, so a pane that asked only for
  `focus-visible:outline-2` would resolve its style from the variable the
  earlier class had already set to `none` and paint nothing at all — a new
  2.4.7 defect handed out with the 2.1.1 fix. `focus-visible:outline-solid`
  re-sets the variable under the same variant. jsdom applies no Tailwind, so
  the class string is what is asserted; it fails the moment the fix is undone.
*/

/* ── Layer 1: rendered ─────────────────────────────────────────────────── */

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([(globalThis as { __nextFile?: File }).__nextFile as File])}>
      drop
    </button>
  ),
}));

const mockDiffWords = vi.fn(() => [{ value: "hello", added: false, removed: false }]);
vi.mock("diff", () => ({
  diffWords: (...args: unknown[]) => mockDiffWords(...(args as [])),
  diffLines: (...args: unknown[]) => mockDiffWords(...(args as [])),
}));

import { CrlfLfUI } from "@/components/tools/CrlfLfUI";
import { SortDedupeLinesUI } from "@/components/tools/SortDedupeLinesUI";
import { TextDiffUI } from "@/components/tools/TextDiffUI";
import { JwtDecoderUI } from "@/components/tools/JwtDecoderUI";

function makeFile(text: string, name: string): File {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const file = new File([buffer], name, { type: "" });
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(buffer) });
  return file;
}

/**
 * What a keyboard user actually needs, checked on a live element: the pane is
 * in the tab order, and focusing it really does move the focus there. jsdom
 * only moves `activeElement` for elements it considers focusable, so this
 * fails if `tabIndex` is dropped — it is not a restatement of the attribute.
 */
function expectKeyboardScrollable(pane: HTMLElement) {
  expect(pane.tabIndex).toBe(0);
  act(() => pane.focus());
  expect(document.activeElement).toBe(pane);
  // A pane the browser can scroll but the ring cannot be seen on is a 2.4.7
  // defect in place of a 2.1.1 one. See the header note on `outline-solid`.
  expect(pane.className).toContain("focus-visible:outline-solid");
  expect(pane.className).toContain("focus-visible:outline-2");
  expect(pane.className).toContain("focus-visible:outline-accent");
}

describe("text panes are keyboard-scrollable (rendered)", () => {
  it("CrlfLfUI: both panes are named, focusable regions", async () => {
    (globalThis as { __nextFile?: File }).__nextFile = makeFile("a\r\nb\r\n", "report.log");
    render(<CrlfLfUI />);
    fireEvent.click(screen.getByText("drop"));
    await screen.findByLabelText("Source text");

    for (const name of ["Source text", "Converted text"]) {
      expectKeyboardScrollable(screen.getByRole("region", { name }));
    }
  });

  it("SortDedupeLinesUI: both panes are named, focusable regions", async () => {
    (globalThis as { __nextFile?: File }).__nextFile = makeFile("b\na\n", "hosts.txt");
    render(<SortDedupeLinesUI />);
    fireEvent.click(screen.getByText("drop"));
    await screen.findByLabelText("Source lines");

    for (const name of ["Source lines", "Sorted lines"]) {
      expectKeyboardScrollable(screen.getByRole("region", { name }));
    }
  });

  it("TextDiffUI: the diff pane is a <div> of <span>s, and still takes focus", () => {
    render(<TextDiffUI />);
    fireEvent.change(screen.getByPlaceholderText(/paste original text/i), {
      target: { value: "hello" },
    });
    fireEvent.change(screen.getByPlaceholderText(/paste modified text/i), {
      target: { value: "hello there" },
    });

    const pane = screen.getByRole("region", { name: "Diff output" });
    // The pane this finding is about: not one focusable descendant in it.
    expect(pane.querySelector("a, button, input, textarea, select, [tabindex]")).toBeNull();
    expectKeyboardScrollable(pane);
  });

  it("JwtDecoderUI: header, payload and the <code> signature are all named regions", () => {
    const enc = (o: Record<string, unknown>) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    render(<JwtDecoderUI />);
    fireEvent.change(screen.getByPlaceholderText(/eyJhbGci/), {
      target: { value: `${enc({ alg: "HS256" })}.${enc({ sub: "1" })}.sig` },
    });

    for (const name of ["Decoded header", "Decoded payload", "Signature"]) {
      expectKeyboardScrollable(screen.getByRole("region", { name }));
    }
    // `role="region"` is what carries the name here: `code`'s own role
    // prohibits an author name, so an `aria-label` alone would be dropped.
    expect(screen.getByRole("region", { name: "Signature" }).tagName).toBe("CODE");
  });
});

/* ── Layer 2: exhaustive, over the source ──────────────────────────────── */

/** Tags that are already in the tab order, so they need nothing added. */
const NATIVELY_FOCUSABLE = ["textarea", "input", "select", "button", "a"];

interface Pane {
  where: string;
  tag: string;
  nativelyFocusable: boolean;
  problems: string[];
}

/**
 * Every `TEXT_PANE_BODY` element in one file, with what it is missing.
 *
 * The JSX is parsed rather than grepped on purpose: the panes are written both
 * inline and across several lines, and a line-oriented grep sees only the
 * inline ones — it reports 31 of the 38 that exist.
 */
function panesIn(fileName: string, source: string): Pane[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Pane[] = [];

  const visit = (node: ts.Node): void => {
    const open = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
    if (open && /\bTEXT_PANE_BODY\b/.test(open.attributes.getText(sf))) {
      const tag = open.tagName.getText(sf);
      const line = sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1;
      const attrs = open.attributes.properties.filter(ts.isJsxAttribute);
      const attr = (name: string) => attrs.find((a) => a.name.getText(sf) === name);
      const problems: string[] = [];

      if (!NATIVELY_FOCUSABLE.includes(tag)) {
        const tabIndex = attr("tabIndex");
        if (!tabIndex) problems.push("no tabIndex — unreachable by keyboard in Safari/Firefox");
        else if (tabIndex.initializer?.getText(sf) !== "{0}")
          problems.push(`tabIndex is ${tabIndex.initializer?.getText(sf)}, not {0}`);

        if (!attr("aria-label") && !attr("aria-labelledby")) problems.push("no accessible name");
        if (attr("role")?.initializer?.getText(sf) !== '"region"')
          problems.push("not role=region, so the name would not be exposed");

        const cls = attr("className")?.initializer?.getText(sf) ?? "";
        if (!/\bPANE_FOCUS\b/.test(cls)) problems.push("no PANE_FOCUS ring");
      }

      found.push({
        where: `${fileName}:${line} <${tag}>`,
        tag,
        nativelyFocusable: NATIVELY_FOCUSABLE.includes(tag),
        problems,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

/**
 * `PANE_FOCUS` is per-file (it cannot live in `TEXT_PANE_BODY` yet), so a file
 * that names it must also define it, and define it with the classes that work.
 */
function paneFocusDefinition(source: string): string | null {
  const m = source.match(/const PANE_FOCUS\s*=\s*\n?\s*"([^"]*)"/);
  return m ? m[1] : null;
}

const TOOLS_DIR = join(process.cwd(), "src/components/tools");

describe("text panes are keyboard-scrollable (every site in src/components/tools)", () => {
  const files = readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ name: f, source: readFileSync(join(TOOLS_DIR, f), "utf8") }))
    .filter((f) => f.source.includes("TEXT_PANE_BODY"));

  const panes = files.flatMap((f) => panesIn(f.name, f.source));

  it("positive control: the checker reports an unguarded pane and clears a guarded one", () => {
    const synthetic = `
      const PANE_FOCUS = "x";
      export function Bad() {
        return (
          <>
            <pre className={TEXT_PANE_BODY} aria-label="Unguarded" />
            <pre
              tabIndex={0}
              role="region"
              aria-label="Guarded"
              className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
            />
            <textarea className={TEXT_PANE_BODY} />
          </>
        );
      }`;
    const control = panesIn("Synthetic.tsx", synthetic);

    // The multi-line pane is the one a line-oriented grep drops; the parser
    // must see all three elements before any verdict below means anything.
    expect(control).toHaveLength(3);
    expect(control.filter((p) => p.problems.length > 0).map((p) => p.where)).toEqual([
      "Synthetic.tsx:6 <pre>",
    ]);
    expect(control[0].problems).toEqual([
      "no tabIndex — unreachable by keyboard in Safari/Firefox",
      "not role=region, so the name would not be exposed",
      "no PANE_FOCUS ring",
    ]);
    // The <textarea> is already a tab stop, so the checker must leave it alone.
    expect(control[2].problems).toEqual([]);
  });

  it("finds the panes at all — a clean run must not be an empty run", () => {
    // Guards against the checker silently matching nothing after a rename.
    expect(files.length).toBeGreaterThanOrEqual(25);
    expect(panes.filter((p) => !p.nativelyFocusable).length).toBeGreaterThanOrEqual(38);
  });

  it("every pane that is not natively focusable is a named, focusable region", () => {
    const broken = panes
      .filter((p) => p.problems.length > 0)
      .map((p) => `${p.where}: ${p.problems.join("; ")}`);
    expect(broken).toEqual([]);
  });

  it("textarea and input panes are left alone — they are already tab stops", () => {
    const native = panes.filter((p) => p.nativelyFocusable);
    expect(native.length).toBeGreaterThanOrEqual(37);
    expect(native.every((p) => p.problems.length === 0)).toBe(true);
  });

  it("every file that uses PANE_FOCUS defines it, with a ring that compiles", () => {
    const users = files.filter((f) => /\bPANE_FOCUS\b/.test(f.source));
    expect(users.length).toBeGreaterThanOrEqual(25);

    for (const f of users) {
      const definition = paneFocusDefinition(f.source);
      expect(definition, `${f.name} uses PANE_FOCUS without defining it`).not.toBeNull();
      // outline-solid is load-bearing: see the header note.
      expect(definition, f.name).toContain("focus-visible:outline-solid");
      expect(definition, f.name).toContain("focus-visible:outline-2");
      expect(definition, f.name).toContain("focus-visible:outline-accent");
    }

    // One string, not 25 dialects — so hoisting it into TEXT_PANE_BODY later
    // is a delete, not a reconciliation.
    const distinct = new Set(users.map((f) => paneFocusDefinition(f.source)));
    expect(distinct.size).toBe(1);
  });
});
