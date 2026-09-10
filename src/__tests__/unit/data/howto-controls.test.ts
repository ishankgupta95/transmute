import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tools } from "@/data/tools";

/*
  HOW-TO STEPS NAME CONTROLS THAT MUST EXIST.

  `HOW_TO_STEPS_BY_TOOL_TYPE` is not SEO metadata that nobody reads. It renders
  twice: as the numbered grid under every tool (ToolPageLayout.tsx) and as HowTo
  JSON-LD. A step that says "Click Convert" on a page with no Convert button is
  an instruction nobody can follow, and this repo has shipped exactly that lie
  more than once — most recently `exif-viewer`'s "Optionally export the metadata
  as JSON", where there has never been a JSON export of any kind.

  WHY THIS GATE IS GENERAL AND THE OLD ONE WAS NOT. `tool-copy-claims.test.ts`
  already checks this — for THREE tools, each with a hand-written list of the
  control names to look for. So it caught nothing about the other 118, which is
  why the JSON lie shipped with every gate green. This file derives the whole
  chain from source instead: toolType -> client -> UI component -> the
  components that component mounts, and then asserts that every control a step
  tells the user to click is a literal string in that source.

  WHAT IT DELIBERATELY DOES NOT DO, stated precisely so nobody over-reads it:

  1. It gates the "Click X" / "Press X" / "Tap X" pattern only, because that is
     the one that is mechanically extractable without guessing. A step can still
     lie in prose — "Optionally export the metadata as JSON" contains no
     imperative and this would not have caught it — and no assertion here says
     anything about the other two-thirds of a typical step.
  2. Because `sourceOffers` falls back to shorter prefixes, a step that names a
     control by a PREFIX of its real label passes: "Click Stop" is accepted on a
     page whose button reads "Stop and save". That is the price of never
     producing a false positive, and it is the right trade for a gate that runs
     over 121 tool types — but it means a green run proves the control EXISTS,
     not that the step names it exactly.

  Proven able to fail in three independent directions: a step naming a control
  that is absent, a broken toolType->component parser, and broken label
  extraction each turn it red.
*/

const COMPONENTS = join(
  dirname(new URL(import.meta.url).pathname),
  "../../../components/tools",
);
const SEO = join(dirname(new URL(import.meta.url).pathname), "../../../lib/seo/tool-metadata.ts");

/**
 * Comments discuss the very labels this scan looks for — the `screen-recorder`
 * fix above records the retired "Stop" in a comment, and `ScreenRecorderUI`
 * lists its own control labels in its header. Searching raw source would let a
 * comment satisfy the gate, which is the failure mode `size-claims.test.ts`
 * strips comments for.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readComponent = (name: string): string | null => {
  try {
    return stripComments(readFileSync(join(COMPONENTS, `${name}.tsx`), "utf8"));
  } catch {
    return null;
  }
};

/** toolType -> the client component ToolClient's switch returns for it. */
function typeToClient(): Map<string, string> {
  const source = stripComments(readFileSync(join(COMPONENTS, "ToolClient.tsx"), "utf8"));
  const map = new Map<string, string>();
  for (const match of source.matchAll(/case\s+"([a-z0-9-]+)":\s*\n?\s*return\s+<(\w+)/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

/** Client component -> the UI component it renders, and UI name -> its file. */
function clientAndUiMaps(): { clientToUi: Map<string, string>; uiToFile: Map<string, string> } {
  const clientToUi = new Map<string, string>();
  const uiToFile = new Map<string, string>();
  for (const file of readdirSync(COMPONENTS).filter((name) => name.endsWith(".tsx"))) {
    const raw = readFileSync(join(COMPONENTS, file), "utf8");
    const source = stripComments(raw);
    for (const match of source.matchAll(
      /export function (\w+Client)\s*\([^)]*\)\s*(?:\{[\s\S]*?return\s*\(?\s*)?<(\w+)/g,
    )) {
      clientToUi.set(match[1], match[2]);
    }
    // The barrel's dynamic() lines are the UI-name -> filename mapping.
    for (const match of raw.matchAll(/const (\w+) = dynamic\(\s*\(\) => import\("\.\/(\w+)"\)/g)) {
      uiToFile.set(match[1], match[2]);
    }
  }
  return { clientToUi, uiToFile };
}

/**
 * The UI's own source plus the source of every sibling component it imports.
 *
 * ONE LEVEL, and that level is load-bearing rather than defensive: several
 * tools are a thin page over a shared shell that owns the buttons.
 * `screen-recorder`'s primary action is `<ToolActions primaryLabel="Stop and
 * save">` inside `MediaRecorderShell.tsx`, and the four qpdf pages get theirs
 * from `QpdfToolShell.tsx`. Reading only the page component would report those
 * controls missing when they are simply one file over.
 */
function reachableSource(file: string): string {
  const own = readComponent(file);
  if (own === null) return "";
  let combined = own;
  // Both spellings are in use in this directory: siblings are imported as
  // "./X" in the barrels and as "@/components/tools/X" from the tool UIs.
  // Matching only the first found nothing for ScreenRecorderUI and reported
  // its shell's buttons missing.
  for (const match of own.matchAll(/from\s+"(?:\.\/|@\/components\/tools\/)(\w+)"/g)) {
    const sibling = readComponent(match[1]);
    if (sibling !== null) combined += `\n${sibling}`;
  }
  return combined;
}

/**
 * The control labels a step tells the user to click.
 *
 * Conservative by construction. A label starts immediately after
 * Click/Press/Tap; its FIRST word must be Capitalised, which is what separates
 * a control name from ordinary prose — "Click an icon to include or exclude it"
 * and "Click any value to copy it" both yield nothing. It stops at punctuation
 * or at " to " / " then ", and runs at most four words. " or " splits one
 * clause into two labels, so "Click Download PNG or Download SVG" checks both.
 *
 * Connectives are NOT treated as terminators, because real controls contain
 * them — the screen recorder's primary button reads "Stop and save". Breaking
 * at "and" would have extracted "Stop", which is not a label anywhere, and the
 * gate would have reported a lie that was really an extraction bug.
 */
export function controlsNamedIn(step: string): string[] {
  const found: string[] = [];
  for (const match of step.matchAll(/\b(?:Click|Press|Tap)\s+(.{0,60})/g)) {
    const clause = match[1].split(/[,.;—(]|'/)[0].split(/\s+(?:to|then)\s+/)[0];
    for (const piece of clause.split(/\s+or\s+/)) {
      const words = piece.trim().split(/\s+/).slice(0, 4);
      if (words.length === 0 || !/^[A-Z]/.test(words[0])) continue;
      const label = words.join(" ").replace(/[^\w\s-]+$/, "").trim();
      if (label.length > 0) found.push(label);
    }
  }
  return found;
}

/**
 * Whether a component's source really offers this control.
 *
 * The longest candidate is tried first and trailing words are dropped until
 * something matches, because the extractor cannot know where a label ends: a
 * step reads "Click Repair PDF — there is nothing to configure", and only the
 * component knows the button says "Repair PDF". Dropping trailing words makes
 * the gate lenient about the TAIL of a label while staying strict about its
 * HEAD, and the head is where the lies have been: a step naming a control that
 * simply does not exist fails every prefix, down to the single word.
 */
export function sourceOffers(source: string, label: string): boolean {
  const words = label.split(" ");
  for (let take = words.length; take >= 1; take--) {
    if (source.includes(words.slice(0, take).join(" "))) return true;
  }
  return false;
}

function howToSteps(): Map<string, string[]> {
  const source = stripComments(readFileSync(SEO, "utf8"));
  const block = source.slice(source.indexOf("HOW_TO_STEPS_BY_TOOL_TYPE"));
  const map = new Map<string, string[]>();
  for (const match of block.matchAll(/"([a-z0-9-]+)":\s*\[([\s\S]*?)\],\n/g)) {
    map.set(
      match[1],
      [...match[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((quoted) => quoted[1]),
    );
  }
  return map;
}

describe("how-to steps name controls that exist", () => {
  const steps = howToSteps();
  const toClient = typeToClient();
  const { clientToUi, uiToFile } = clientAndUiMaps();

  const toolTypes = [...new Set(tools.map((tool) => tool.toolType))];

  it("parses the whole chain — a broken parser would pass everything silently", () => {
    /*
      THE VACUITY GUARD. Every assertion below is "for each thing found, check
      it"; a regex that stopped matching would find nothing and the suite would
      go green over a gate that had stopped running. These floors are the
      positive control.
    */
    expect(steps.size).toBeGreaterThanOrEqual(toolTypes.length);
    expect(toClient.size).toBeGreaterThanOrEqual(100);
    expect(clientToUi.size).toBeGreaterThanOrEqual(100);
    expect(uiToFile.size).toBeGreaterThanOrEqual(100);
  });

  it("extracts labels from a step, and nothing from ordinary prose", () => {
    expect(controlsNamedIn("Click Download to save your converted image.")).toEqual(["Download"]);
    expect(controlsNamedIn("Click Crop, then Download to save the result.")).toEqual(["Crop"]);
    expect(controlsNamedIn("Click Remove EXIF, then Download the cleaned copy.")).toEqual([
      "Remove EXIF",
    ]);
    // a real multi-word label containing a connective
    expect(controlsNamedIn("Click Stop and save when you're done.")).toEqual([
      "Stop and save when",
    ]);
    expect(controlsNamedIn("Click Download PNG or Download SVG to save it.")).toEqual([
      "Download PNG",
      "Download SVG",
    ]);
    // prose, not controls
    expect(controlsNamedIn("Click an icon to include or exclude it.")).toEqual([]);
    expect(controlsNamedIn("Click any value to copy it to your clipboard.")).toEqual([]);
    // no imperative at all
    expect(controlsNamedIn("Upload your image by dragging it into the drop zone.")).toEqual([]);
  });

  it("finds a control to check on a meaningful number of tools", () => {
    // Another vacuity guard: if label extraction silently broke, the sweep
    // below would check nothing and still pass.
    let labelled = 0;
    for (const [, entries] of steps) {
      for (const step of entries) labelled += controlsNamedIn(step).length;
    }
    expect(labelled).toBeGreaterThanOrEqual(50);
  });

  it.each(toolTypes)("%s: every control its steps name is in the component it mounts", (type) => {
    const entries = steps.get(type);
    expect(entries, `no HowTo steps for toolType ${type}`).toBeTruthy();

    const client = toClient.get(type);
    if (!client) return; // covered by ToolClient.test.tsx's own completeness gate
    const ui = clientToUi.get(client);
    if (!ui) return;
    const file = uiToFile.get(ui) ?? ui;
    const source = reachableSource(file);
    if (source === "") return;

    for (const step of entries ?? []) {
      for (const control of controlsNamedIn(step)) {
        expect(
          sourceOffers(source, control),
          `${type}: a how-to step says "Click ${control}" but ${file}.tsx (and the components it imports) contains no such label, at any length.\n    step: ${step}`,
        ).toBe(true);
      }
    }
  });
});
