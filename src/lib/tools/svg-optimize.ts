/**
 * SVG optimisation with SVGO 4, plus an account of what it changed.
 *
 * SVGO is very good at making an SVG smaller and it is NOT universally safe.
 * Its default preset runs thirty-four passes, and seven of them can change how
 * a file renders or sever something outside the file that was reaching into
 * it. Every one of the sentences in `RISKY_DEFAULT_PLUGINS` below was measured
 * against svgo 4.1.0 rather than repeated from the docs, and the ones the docs
 * are usually wrong about are worth stating here:
 *
 *   - `removeViewBox` and `removeDimensions` are NOT in `preset-default` in
 *     svgo 4. The most-repeated warning about this tool ("it strips your
 *     viewBox") does not describe what it does any more. `removeDimensions` is
 *     offered here as an opt-in, and `removeViewBox` is not offered at all.
 *   - `removeScripts` is NOT a default either, so `<script>` and every `on…`
 *     handler come through untouched. Verified: an input carrying
 *     `<script>` + `onclick` + `onload` came back with all three.
 *   - `<title>` and a non-boilerplate `<desc>` DO survive `preset-default`.
 *   - `cleanupIds` and `minifyStyles` both switch themselves off when the file
 *     contains a non-empty `<style>` or any `<script>`, because neither can be
 *     read for what it references (`plugins/cleanupIds.js:159-164`,
 *     `plugins/minifyStyles.js:106`). So the two most destructive default
 *     passes are quietest on exactly the files that would suffer most.
 *   - The parser will not fetch an external entity — `<!ENTITY x SYSTEM
 *     "file:///etc/passwd">` fails with "Invalid character entity" rather than
 *     resolving, so an SVG dropped here cannot be used to read anything.
 *
 * The module is DOM-free on purpose (the `svgo/browser` build parses with sax,
 * not with `DOMParser`), so every claim above is exercised by unit tests in
 * jsdom and could move to a worker unchanged.
 */

import {
  optimize,
  type Config,
  type PluginConfig,
  type XastChild,
  type XastElement,
  type XastRoot,
} from "svgo/browser";

/* ── Settings ─────────────────────────────────────────────────────────────── */

export const MIN_PRECISION = 0;
export const MAX_PRECISION = 8;
/** SVGO's own default. Kept as the tool's default so "Default" means default. */
export const DEFAULT_PRECISION = 3;

/**
 * Above this many bytes of source the page stops re-optimising on every
 * control change and waits for a button.
 *
 * `optimize` is synchronous and runs on whichever thread calls it, so the tab
 * is frozen for the duration. Measured with this build on generated artwork:
 * 31 KB / 200 paths took 31 ms, 313 KB / 2 000 paths took 113 ms, and
 * 1.88 MB / 12 000 paths took 1 019 ms. A range input fires an event per
 * pixel of travel, so the last of those would be unusable live. 256 KiB is
 * the round number just under the 113 ms measurement.
 */
export const AUTO_OPTIMIZE_LIMIT = 262_144;

/**
 * The passes inside `preset-default` that can change what the file DOES, as
 * opposed to how many bytes it takes to say it. Each `why` describes an
 * effect reproduced against svgo 4.1.0; see the unit tests, which run the same
 * inputs.
 */
export type RiskyPluginId =
  | "cleanupIds"
  | "inlineStyles"
  | "removeUnknownsAndDefaults"
  | "collapseGroups"
  | "convertShapeToPath"
  | "mergePaths"
  | "removeHiddenElems";

export interface RiskyPlugin {
  id: RiskyPluginId;
  /** Checkbox label in the rail. */
  label: string;
  /** One sentence naming a measured consequence, not a theoretical one. */
  why: string;
}

export const RISKY_DEFAULT_PLUGINS: readonly RiskyPlugin[] = [
  {
    id: "cleanupIds",
    label: "Rename and drop ids",
    why: 'Ids that something inside the file points at are renamed to a, b, c…, and ids that nothing inside the file points at are deleted outright. Measured: id="hookedByJs" disappeared, and <title id="t1"> lost its id while aria-labelledby="t1" was kept — so the graphic ended up naming an element that no longer exists. Anything reaching in from outside (a <use href="sprite.svg#icon">, a #id rule in a separate stylesheet, getElementById) stops resolving. It has one safety valve of its own: a <script>, or a <style> block still standing by the time this pass runs, switches it off entirely and every id survives — neither can be read for what it references. A stylesheet the inlining pass above has already dissolved does not count, because by then there is no <style> left to see.',
  },
  {
    id: "inlineStyles",
    label: "Inline the stylesheet",
    why: "A <style> rule is written onto the element it matched and the class attribute it matched on is removed. minifyStyles then deletes whatever rules were left, because nothing carries that class any more. Measured: .a{fill:red} was inlined and both .a:hover and an @media (prefers-color-scheme: dark) block vanished with the <style> element.",
  },
  {
    id: "removeUnknownsAndDefaults",
    label: "Drop unknown and default attributes",
    why: 'Attributes svgo does not recognise, and attributes already set to their spec default, are removed. Measured: role="img" was deleted, and so was the SVG 2 href on <a href="https://example.com"> — the link stopped being a link, while the legacy xlink:href form survived.',
  },
  {
    id: "collapseGroups",
    label: "Collapse groups",
    why: 'A <g> whose attributes can move onto its child is dissolved. Measured: <g class="animated"><path/></g> came back as a bare <path class="animated"/> — so a g { } rule, a transform or SMIL animation applied to the group, and any script that walked the group, all lose the element they were written against.',
  },
  {
    id: "convertShapeToPath",
    label: "Rewrite shapes as paths",
    why: 'A <rect>, <line>, <polyline> or <polygon> becomes a <path>. Measured: <rect class="bar" …> came back as <path class="bar" …>, so a rect { } CSS rule, a querySelectorAll("rect") or an editor that expected editable primitives no longer matches.',
  },
  {
    id: "mergePaths",
    label: "Merge sibling paths",
    why: "Adjacent <path> elements with the same styling are joined into one d attribute. Measured: two separate strokes became one path — after that they cannot be styled, animated or hit-tested apart, and where the merged subpaths overlap the fill-rule decides what you see.",
  },
  {
    id: "removeHiddenElems",
    label: "Remove hidden elements",
    why: 'Elements that are invisible at rest are deleted — display:none, zero width or height, empty containers. Measured: <rect id="tooltip" style="display:none"> was removed. That is dead weight in an exported icon and a missing layer in anything a script switches on later.',
  },
];

/** The label the rail shows for a risky pass, in the upper case the copy uses. */
export function riskyLabel(id: RiskyPluginId): string {
  return (RISKY_DEFAULT_PLUGINS.find((p) => p.id === id)?.label ?? id).toUpperCase();
}

/**
 * The three opt-in checkboxes and the group they sit in, named once here.
 *
 * `SvgOptimizerUI` renders these as the labels and every sentence below quotes
 * them in upper case, so a note cannot tell the reader to tick a control that is
 * not on the screen. It could before: the script warning ended "tick REMOVE
 * SCRIPTS AND HANDLERS" and no control has ever carried that name — the checkbox
 * reads "Scripts and handlers" and the group above it reads "ALSO REMOVE".
 * `svg-optimize.test.ts` pulls every upper-case phrase out of every note and
 * fails on one that is not a shipped label.
 */
export const OPT_IN_GROUP_LABEL = "ALSO REMOVE";

export const OPT_IN_LABELS = {
  removeScripts: "Scripts and handlers",
  removeEmbeddedImages: "Embedded raster images",
  removeDimensions: "Root width and height",
} as const;

/** Non-default passes offered as opt-ins. None of these runs unless asked. */
export interface SvgOptimizeSettings {
  /** Decimal places kept by convertPathData, convertTransform and friends. */
  precision: number;
  /** Risky `preset-default` passes to switch OFF. */
  disabled: readonly RiskyPluginId[];
  /** Adds `removeScripts`: deletes <script> and every on… handler attribute. */
  removeScripts: boolean;
  /** Deletes `<image>` elements carrying a `data:` URI. See `stripEmbedded`. */
  removeEmbeddedImages: boolean;
  /** Adds `removeDimensions`: drops width/height so the SVG fills its box. */
  removeDimensions: boolean;
}

export const DEFAULT_SETTINGS: SvgOptimizeSettings = {
  precision: DEFAULT_PRECISION,
  disabled: [],
  removeScripts: false,
  removeEmbeddedImages: false,
  removeDimensions: false,
};

/**
 * Delete `<image>` elements whose href is a `data:` URI.
 *
 * SVGO ships `removeRasterImages` and it is not usable here: it tests
 * `node.attributes['xlink:href']` and nothing else
 * (`node_modules/svgo/plugins/removeRasterImages.js`), so an `<image href="data:image/png;base64,…">`
 * — the SVG 2 spelling every current exporter writes — is left in place while
 * the legacy `xlink:` spelling is removed. A control that works on half the
 * files people bring is worse than no control, so this is our own pass.
 *
 * It deliberately leaves a LINKED image (`href="photo.png"`) alone: that
 * reference costs a few bytes and deleting it would destroy the picture for no
 * saving, which is not what the checkbox offers.
 *
 * Reassigning `parentNode.children` is SVGO's own removal idiom — see the
 * comment on `detachNodeFromParent` in `lib/xast.js`: "avoid splice to not
 * break for loops".
 */
const stripEmbedded: PluginConfig = {
  name: "transmute-strip-embedded-images",
  fn: () => ({
    element: {
      enter: (node: XastElement, parentNode) => {
        if (localName(node.name) !== "image") return;
        const href = node.attributes.href ?? node.attributes["xlink:href"] ?? "";
        if (!href.startsWith("data:")) return;
        parentNode.children = parentNode.children.filter((child) => child !== node);
      },
    },
  }),
};

export interface SvgPreset {
  id: string;
  label: string;
  /** Shown under the chips while this preset is active. Must stay true. */
  note: string;
  settings: SvgOptimizeSettings;
}

export const SVG_PRESETS: readonly SvgPreset[] = [
  {
    id: "safe",
    label: "Safe",
    note: "SVGO's default passes minus the seven that can change how the file renders or cut something outside it off. A smaller saving, and nothing below moves.",
    settings: {
      ...DEFAULT_SETTINGS,
      disabled: RISKY_DEFAULT_PLUGINS.map((p) => p.id),
    },
  },
  {
    id: "default",
    label: "SVGO default",
    note: "preset-default exactly as SVGO ships it — what `svgo file.svg` does with no arguments. Read the warnings above the panes before you ship the result.",
    settings: DEFAULT_SETTINGS,
  },
  {
    id: "smallest",
    label: "Smallest",
    note: "Every default pass, with coordinate precision cut to one decimal. On fine curves and large viewBoxes that is visible — compare the two panes before you take it.",
    settings: { ...DEFAULT_SETTINGS, precision: 1 },
  },
];

/** The id `ToolPresets` shows when the settings no longer match any preset. */
export const CUSTOM_PRESET = "custom";

/** Which preset these settings ARE, or `CUSTOM_PRESET`. */
export function presetIdFor(settings: SvgOptimizeSettings): string {
  const key = settingsKey(settings);
  return SVG_PRESETS.find((p) => settingsKey(p.settings) === key)?.id ?? CUSTOM_PRESET;
}

/** Stable string form of a settings object — used for equality, not display. */
export function settingsKey(settings: SvgOptimizeSettings): string {
  return [
    settings.precision,
    [...settings.disabled].sort().join("+"),
    settings.removeScripts ? "s" : "",
    settings.removeEmbeddedImages ? "r" : "",
    settings.removeDimensions ? "d" : "",
  ].join("|");
}

/* ── Errors ───────────────────────────────────────────────────────────────── */

export type SvgErrorKind = "empty" | "not-svg" | "parse";

/** Carries a sentence already written for the user, plus where it went wrong. */
export class SvgOptimizeError extends Error {
  readonly kind: SvgErrorKind;
  readonly line?: number;
  readonly column?: number;

  constructor(kind: SvgErrorKind, message: string, line?: number, column?: number) {
    super(message);
    this.name = "SvgOptimizeError";
    this.kind = kind;
    this.line = line;
    this.column = column;
  }
}

/* ── Reading the file off disk ────────────────────────────────────────────── */

export interface DecodedSvg {
  text: string;
  /** The label the bytes were decoded with. */
  encoding: "utf-8" | "utf-16le" | "utf-16be";
  /** Bytes of byte-order mark that were consumed and are not in `text`. */
  bomBytes: number;
}

/**
 * Decode SVG bytes.
 *
 * An SVG is XML, and XML may legally be UTF-16 — Inkscape and a few Windows
 * editors will write it. Both of those cases matter to the byte arithmetic:
 * a UTF-16 file loses roughly half its bytes on the way to UTF-8 output for
 * reasons that have nothing to do with optimisation, and a UTF-8 BOM is three
 * bytes that leave silently. Both are reported so the saving can be explained.
 */
export function decodeSvgBytes(bytes: Uint8Array): DecodedSvg {
  const [b0, b1, b2] = [bytes[0], bytes[1], bytes[2]];
  if (b0 === 0xff && b1 === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes), encoding: "utf-16le", bomBytes: 2 };
  }
  if (b0 === 0xfe && b1 === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes), encoding: "utf-16be", bomBytes: 2 };
  }
  const bom = b0 === 0xef && b1 === 0xbb && b2 === 0xbf ? 3 : 0;
  return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8", bomBytes: bom };
}

const encoder = new TextEncoder();

/** UTF-8 byte length — what the file will weigh on disk, not `String.length`. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/* ── Is this actually an SVG? ─────────────────────────────────────────────── */

/** `svg:svg` → `svg`; anything without a prefix is returned unchanged. */
function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * The name of the first START TAG in the source, skipping the XML declaration,
 * comments and the DOCTYPE (including a `[…]` internal subset, which contains
 * its own `>` characters). `null` when there is no start tag to find.
 *
 * This exists because SVGO does not check what it was handed. Measured: given
 * an HTML document it returns `<html/>` and reports a 96% saving — a wrong
 * answer delivered as a triumph. The refusal below is the whole reason for
 * this scanner.
 */
export function firstElementName(source: string): string | null {
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch !== "<") return null;
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end === -1) return null;
      i = end + 3;
      continue;
    }
    if (source.startsWith("<?", i)) {
      const end = source.indexOf("?>", i + 2);
      if (end === -1) return null;
      i = end + 2;
      continue;
    }
    if (source.startsWith("<!", i)) {
      let j = i + 2;
      while (j < source.length) {
        if (source[j] === "[") {
          const close = source.indexOf("]", j + 1);
          if (close === -1) return null;
          j = close + 1;
          continue;
        }
        if (source[j] === ">") break;
        j++;
      }
      if (j >= source.length) return null;
      i = j + 1;
      continue;
    }
    const match = /^<([A-Za-z_][A-Za-z0-9_.:-]*)/.exec(source.slice(i, i + 128));
    return match ? match[1] : null;
  }
  return null;
}

/* ── What is in the file ──────────────────────────────────────────────────── */

export interface SvgFacts {
  /** Element nodes, root included. */
  elements: number;
  /** Every `id` attribute value, in document order. */
  ids: readonly string[];
  /** `<script>` elements. */
  scripts: number;
  /** `on…` handler attributes (onclick, onload, …). */
  eventAttributes: number;
  /** `<image>` whose href is a `data:` URI. */
  embeddedImages: number;
  /**
   * Length of those `data:` URIs — the weight nothing here can shrink. A data
   * URI is ASCII by construction, so its character count IS its byte count.
   */
  embeddedImageBytes: number;
  /** `<image>` pointing at a file somewhere else. */
  linkedImages: number;
  /** `<style>` elements. */
  styleElements: number;
  /**
   * `<style>` elements carrying anything other than whitespace.
   *
   * Counted separately from `styleElements` because an EMPTY `<style>` — which
   * Illustrator and Figma both write, and which is what is left of a stylesheet
   * something else already emptied — is deleted by `removeEmptyContainers`
   * whether or not `inlineStyles` ran. Measured: an empty `<style>` element,
   * and one holding only a CSS comment, both vanished with `inlineStyles`
   * DISABLED. Blaming that on inlining, and offering unticking it as the
   * remedy, is the same wrong-cause-plus-inert-remedy the id notes used to have.
   */
  styleElementsWithRules: number;
  /** `href` (not `xlink:href`) on an `<a>` — the form svgo 4 removes. */
  linkHrefs: number;
  /** Ids named by `aria-labelledby` / `aria-describedby`. */
  ariaRefs: readonly string[];
  hasDoctype: boolean;
  /** The DOCTYPE carried an internal subset declaring entities. */
  hasEntityDeclarations: boolean;
  hasViewBox: boolean;
  /** Root carries both `width` and `height`. */
  hasDimensions: boolean;
  /**
   * The root's `width` / `height` exactly as written, or null when absent.
   *
   * Kept as the raw string because the UNIT is the interesting part:
   * `removeDimensions` refuses to run on a root sized in mm, in, pt, em or %
   * (see `isPlainLength`), and the note that reports the refusal names the
   * value that blocked it.
   */
  rootWidth: string | null;
  rootHeight: string | null;
}

/**
 * SVGO's own test, copied from `svgo/plugins/removeDimensions.js`:
 * `Number.isNaN(Number(value)) === false`. Anything carrying a unit fails it.
 */
export function isPlainLength(value: string): boolean {
  return !Number.isNaN(Number(value));
}

const EMPTY_FACTS: SvgFacts = {
  elements: 0,
  ids: [],
  scripts: 0,
  eventAttributes: 0,
  embeddedImages: 0,
  embeddedImageBytes: 0,
  linkedImages: 0,
  styleElements: 0,
  styleElementsWithRules: 0,
  linkHrefs: 0,
  ariaRefs: [],
  hasDoctype: false,
  hasEntityDeclarations: false,
  hasViewBox: false,
  hasDimensions: false,
  rootWidth: null,
  rootHeight: null,
};

function collectFacts(root: XastRoot): SvgFacts {
  const ids: string[] = [];
  const ariaRefs: string[] = [];
  let elements = 0;
  let scripts = 0;
  let eventAttributes = 0;
  let embeddedImages = 0;
  let embeddedImageBytes = 0;
  let linkedImages = 0;
  let styleElements = 0;
  let styleElementsWithRules = 0;
  let linkHrefs = 0;
  let hasDoctype = false;
  let hasEntityDeclarations = false;
  let hasViewBox = false;
  let hasDimensions = false;
  let rootWidth: string | null = null;
  let rootHeight: string | null = null;
  let rootSeen = false;

  const visitElement = (el: XastElement): void => {
    elements++;
    const tag = localName(el.name);
    if (tag === "script") scripts++;
    if (tag === "style") {
      styleElements++;
      /*
        `text` for a plain stylesheet, `cdata` for the <![CDATA[ … ]]> form
        every Adobe export writes. Whitespace-only and comment-only both count
        as no rules: SVGO's own minifyStyles reduces a comment to nothing, and
        the empty element is then removed by a pass that is not on the rail.
      */
      const css = el.children
        .map((child) =>
          child.type === "text" || child.type === "cdata" ? child.value : "",
        )
        .join("")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
      if (css !== "") styleElementsWithRules++;
    }
    if (!rootSeen && tag === "svg") {
      rootSeen = true;
      hasViewBox = el.attributes.viewBox !== undefined;
      rootWidth = el.attributes.width ?? null;
      rootHeight = el.attributes.height ?? null;
      hasDimensions = rootWidth !== null && rootHeight !== null;
    }
    for (const [name, value] of Object.entries(el.attributes)) {
      if (/^on[a-z]+$/i.test(name)) eventAttributes++;
      else if (name === "id") ids.push(value);
      else if (name === "aria-labelledby" || name === "aria-describedby") {
        for (const ref of value.split(/\s+/)) if (ref) ariaRefs.push(ref);
      }
    }
    if (tag === "a" && el.attributes.href !== undefined) linkHrefs++;
    if (tag === "image") {
      const href = el.attributes.href ?? el.attributes["xlink:href"] ?? "";
      if (href.startsWith("data:")) {
        embeddedImages++;
        embeddedImageBytes += href.length;
      } else if (href) {
        linkedImages++;
      }
    }
    for (const child of el.children) visitChild(child);
  };

  const visitChild = (node: XastChild): void => {
    if (node.type === "doctype") {
      hasDoctype = true;
      if (node.data.doctype.includes("<!ENTITY")) hasEntityDeclarations = true;
      return;
    }
    if (node.type === "element") visitElement(node);
  };

  for (const child of root.children) visitChild(child);

  return {
    elements,
    ids,
    scripts,
    eventAttributes,
    embeddedImages,
    embeddedImageBytes,
    linkedImages,
    styleElements,
    styleElementsWithRules,
    linkHrefs,
    ariaRefs,
    hasDoctype,
    hasEntityDeclarations,
    hasViewBox,
    hasDimensions,
    rootWidth,
    rootHeight,
  };
}

/**
 * A plugin that only looks. SVGO hands every plugin the parsed tree, so
 * putting one of these at each end of the plugin list reads the file before
 * and after without paying for a second parse.
 */
function collector(sink: { facts: SvgFacts }): PluginConfig {
  return {
    name: "transmute-collect",
    fn: (root: XastRoot) => {
      sink.facts = collectFacts(root);
      return null;
    },
  };
}

/** Parse the source and report what is in it, changing nothing. */
export function inspectSvg(source: string): SvgFacts {
  const sink = { facts: EMPTY_FACTS };
  try {
    optimize(source, { plugins: [collector(sink)] });
  } catch (err) {
    throw asSvgError(err, source);
  }
  return sink.facts;
}

/* ── The run ──────────────────────────────────────────────────────────────── */

export interface SvgOptimizeResult {
  svg: string;
  inputBytes: number;
  outputBytes: number;
  /** Negative when the output is bigger — which happens, and is reported. */
  savedBytes: number;
  /** One decimal place. Negative when the output grew. */
  savedPercent: number;
  elapsedMs: number;
  before: SvgFacts;
  after: SvgFacts;
  /** Ids present before and gone after — by value, so a rename counts. */
  idsDropped: readonly string[];
  /** aria targets that resolved before and resolve to nothing after. */
  ariaRefsBroken: readonly string[];
  scriptsRemoved: number;
  eventAttributesRemoved: number;
  embeddedImagesRemoved: number;
  linkHrefsDropped: number;
  styleElementsDropped: number;
  viewBoxLost: boolean;
  dimensionsLost: boolean;
}

function clampPrecision(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRECISION;
  return Math.min(MAX_PRECISION, Math.max(MIN_PRECISION, Math.round(value)));
}

/** The exact SVGO config a settings object means. Exported so tests can read it. */
export function buildConfig(settings: SvgOptimizeSettings): Config {
  const overrides: Partial<Record<RiskyPluginId, false>> = {};
  for (const id of settings.disabled) overrides[id] = false;

  const plugins: PluginConfig[] = [{ name: "preset-default", params: { overrides } }];
  // Order matters only in that these run after the preset; each is independent.
  if (settings.removeScripts) plugins.push("removeScripts");
  if (settings.removeEmbeddedImages) plugins.push(stripEmbedded);
  if (settings.removeDimensions) plugins.push("removeDimensions");

  return { floatPrecision: clampPrecision(settings.precision), plugins };
}

function asSvgError(err: unknown, source: string): SvgOptimizeError {
  if (err instanceof SvgOptimizeError) return err;
  if (err && typeof err === "object" && (err as { name?: string }).name === "SvgoParserError") {
    const e = err as { reason?: string; line?: number; column?: number };
    const where =
      typeof e.line === "number" && typeof e.column === "number"
        ? ` at line ${e.line}, column ${e.column}`
        : "";
    return new SvgOptimizeError(
      "parse",
      `This file is not well-formed XML, so it cannot be parsed${where}: ${
        e.reason ?? "the parser gave no reason"
      }. An SVG has to be valid XML — every tag closed, every attribute quoted, and every &entity; declared.`,
      e.line,
      e.column,
    );
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new SvgOptimizeError(
    "parse",
    `This SVG could not be read: ${detail}. Source length ${source.length} characters.`,
  );
}

/**
 * Optimise, and report what changed.
 *
 * Throws `SvgOptimizeError` rather than returning a half-answer: an empty
 * file, a file whose first element is not `<svg>`, or XML the parser refuses.
 */
export function optimizeSvg(
  source: string,
  settings: SvgOptimizeSettings = DEFAULT_SETTINGS,
): SvgOptimizeResult {
  if (source.trim() === "") {
    throw new SvgOptimizeError("empty", "There is nothing in this file to optimise.");
  }

  const first = firstElementName(source);
  if (first !== null && localName(first).toLowerCase() !== "svg") {
    throw new SvgOptimizeError(
      "not-svg",
      `This is not an SVG: the first element in the file is <${first}>, and an SVG has to open with <svg>. Renaming a file to .svg does not change what is inside it. The check matters because SVGO itself does not make it — handed an HTML document it returns <html/> and reports a large saving.`,
    );
  }

  const beforeSink = { facts: EMPTY_FACTS };
  const afterSink = { facts: EMPTY_FACTS };
  const config = buildConfig(settings);
  const plugins: PluginConfig[] = [
    collector(beforeSink),
    ...(config.plugins ?? []),
    collector(afterSink),
  ];

  const started = performance.now();
  let svg: string;
  try {
    svg = optimize(source, { ...config, plugins }).data;
  } catch (err) {
    throw asSvgError(err, source);
  }
  const elapsedMs = performance.now() - started;

  const before = beforeSink.facts;
  const after = afterSink.facts;

  if (before.elements === 0) {
    throw new SvgOptimizeError(
      "not-svg",
      "This file parsed as XML but contains no elements at all, so there is no SVG in it.",
    );
  }

  const inputBytes = utf8Bytes(source);
  const outputBytes = utf8Bytes(svg);
  const savedBytes = inputBytes - outputBytes;

  const afterIds = new Set(after.ids);
  const idsDropped = [...new Set(before.ids)].filter((id) => !afterIds.has(id));
  // Only counted as BROKEN where the reference used to resolve. A file that
  // already pointed at a missing id was already broken, and saying so here
  // would blame this run for it.
  const beforeIds = new Set(before.ids);
  const ariaRefsBroken = [...new Set(after.ariaRefs)].filter(
    (ref) => beforeIds.has(ref) && !afterIds.has(ref),
  );

  return {
    svg,
    inputBytes,
    outputBytes,
    savedBytes,
    savedPercent: inputBytes > 0 ? Math.round((savedBytes / inputBytes) * 1000) / 10 : 0,
    elapsedMs,
    before,
    after,
    idsDropped,
    ariaRefsBroken,
    scriptsRemoved: Math.max(0, before.scripts - after.scripts),
    eventAttributesRemoved: Math.max(0, before.eventAttributes - after.eventAttributes),
    embeddedImagesRemoved: Math.max(0, before.embeddedImages - after.embeddedImages),
    linkHrefsDropped: Math.max(0, before.linkHrefs - after.linkHrefs),
    styleElementsDropped: Math.max(0, before.styleElements - after.styleElements),
    viewBoxLost: before.hasViewBox && !after.hasViewBox,
    dimensionsLost: before.hasDimensions && !after.hasDimensions,
  };
}

/**
 * Re-indent an SVG without optimising it: `plugins: []` runs nothing, so this
 * is SVGO's stringifier over the same tree. Used only to line the two sides up
 * for the diff view — it is never what you download.
 */
export function indentSvg(source: string): string {
  try {
    return optimize(source, { plugins: [], js2svg: { pretty: true, indent: 2 } }).data;
  } catch {
    // The diff is a convenience; a source that will not re-parse still has a
    // perfectly good side-by-side view, so fall back rather than throwing.
    return source;
  }
}

/* ── What to tell the reader ──────────────────────────────────────────────── */

/*
  These three used to live in `SvgOptimizerUI`, where nothing could reach them:
  jsdom cannot render this page's canvas, so every sentence below was unreachable
  by any test and four of them were measurably false. They are pure functions of
  a run, so they live next to the run and `svg-optimize.test.ts` drives them with
  the same fixtures it drives `optimizeSvg` with.
*/

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "a, b and 4 more" — a wall of ids helps nobody. */
function listOf(values: readonly string[], keep = 6): string {
  if (values.length <= keep) return values.join(", ");
  return `${values.slice(0, keep).join(", ")} and ${values.length - keep} more`;
}

/** "a", "a and b", "a, b and c". */
function andList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/**
 * The risky defaults that delete an ELEMENT outright. An id lives on its
 * element, so these take ids with them without `cleanupIds` running at all —
 * which is why the id notes below derive their cause instead of assuming one.
 */
const ELEMENT_DELETING_PLUGINS: readonly RiskyPluginId[] = [
  "removeHiddenElems",
  "collapseGroups",
  "mergePaths",
];

/**
 * Anything still executable in the file you are about to download, and
 * anything in it that this page cannot make smaller. Separate from the loss
 * notes below because it is about what the OUTPUT still contains rather than
 * about what the run took away.
 */
export function payloadNotes(
  result: SvgOptimizeResult,
  settings: SvgOptimizeSettings,
): string[] {
  const notes: string[] = [];
  const { after } = result;

  if (!settings.removeScripts && (after.scripts > 0 || after.eventAttributes > 0)) {
    const parts: string[] = [];
    if (after.scripts > 0) {
      parts.push(`${after.scripts} <script> ${plural(after.scripts, "element")}`);
    }
    if (after.eventAttributes > 0) {
      parts.push(
        `${after.eventAttributes} on… handler ${plural(after.eventAttributes, "attribute")}`,
      );
    }
    notes.push(
      `This file contains ${parts.join(" and ")}, and they are still in the output — removing them is not part of SVGO's default set, so nothing here has touched them. A browser will not run script in an SVG loaded through an <img> tag or a CSS background; it will when the same file is pasted inline into a page or opened directly. If you did not put this code here yourself, tick ${OPT_IN_LABELS.removeScripts.toUpperCase()} under ${OPT_IN_GROUP_LABEL}.`,
    );
  }

  if (settings.removeScripts && (result.scriptsRemoved > 0 || result.eventAttributesRemoved > 0)) {
    notes.push(
      `Removed ${result.scriptsRemoved} <script> ${plural(result.scriptsRemoved, "element")} and ${result.eventAttributesRemoved} on… handler ${plural(result.eventAttributesRemoved, "attribute")}. Whatever this graphic did on click, on load or on hover is gone with them, which is the point — but it is a change in behaviour, not only in size.`,
    );
  }

  if (after.embeddedImages > 0) {
    const share = Math.round((after.embeddedImageBytes / result.outputBytes) * 100);
    /*
      The remainder is stated in BYTES, not as `100 - share`. Measured: a 40 KB
      PNG in a bare <svg> wrapper — which is what most "SVGs" out of a
      screenshot tool are — rounds `share` to 100, and the old clause then read
      "it saves out of the other 0%" over a file with 105 drawable bytes in it.
      A count cannot round itself away to a number that is not true.
    */
    const rest = result.outputBytes - after.embeddedImageBytes;
    notes.push(
      `${after.embeddedImages} embedded raster ${plural(after.embeddedImages, "image")} ${plural(after.embeddedImages, "accounts", "account")} for ${after.embeddedImageBytes.toLocaleString()} of the ${result.outputBytes.toLocaleString()} bytes in the result — ${share}% of it. Those are already-compressed PNG or JPEG bytes carried as base64, which costs about a third more than the binary and which no SVG pass can shrink. Whatever this page saves, it saves out of the other ${rest.toLocaleString()} ${plural(rest, "byte")}.`,
    );
  }

  if (after.linkedImages > 0) {
    notes.push(
      `${after.linkedImages} <image> ${plural(after.linkedImages, "element")} ${plural(after.linkedImages, "points", "point")} at a file somewhere else rather than carrying the picture. That reference is a few bytes and is left alone; the file it names has to travel with this SVG.`,
    );
  }

  return notes;
}

/**
 * What the run changed beyond the byte count, one sentence per kind, every
 * number derived from this file rather than written as a standing caveat.
 * Empty when none of it happened — a list of zeroes is reassurance, not
 * disclosure.
 */
export function lossNotes(result: SvgOptimizeResult, settings: SvgOptimizeSettings): string[] {
  const notes: string[] = [];
  const off = (id: RiskyPluginId) => settings.disabled.includes(id);
  const { before, after } = result;
  const elementsGone = Math.max(0, before.elements - after.elements);

  /*
    An id goes missing two different ways and the remedy differs. `cleanupIds`
    renames and deletes ids BY NAME; removeHiddenElems, collapseGroups and
    mergePaths delete the ELEMENT, and the id leaves with it. This used to fire
    one sentence for both, ending "Untick RENAME AND DROP IDS" — so a user who
    had already unticked it (measured: aria-labelledby="lbl" pointing at a
    display:none <desc id="lbl">, `disabled: ["cleanupIds"]`, both ids still
    gone) was told to untick a box that was already unticked, and left with no
    way to recover the accessible name. The cause is now read off the run.
  */
  const renaming = !off("cleanupIds");
  const deleters = ELEMENT_DELETING_PLUGINS.filter((id) => !off(id)).map(riskyLabel);
  const idRemedy = renaming
    ? `Untick ${riskyLabel("cleanupIds")} to keep them.`
    : deleters.length > 0 && elementsGone > 0
      ? `${riskyLabel("cleanupIds")} is already off, so unticking it again changes nothing — untick whichever of ${andList(deleters)} removed the element instead.`
      : `${riskyLabel("cleanupIds")} is already off, so nothing renamed them; they left with something else the run rewrote.`;

  if (result.idsDropped.length > 0) {
    const n = result.idsDropped.length;
    const cause = renaming
      ? "Ids that something inside the file pointed at were renamed to single letters; ids that nothing inside the file pointed at were deleted."
      : elementsGone > 0
        ? `Nothing renamed them: ${plural(n, "it went", "they went")} with the ${elementsGone.toLocaleString()} ${plural(elementsGone, "element")} this run deleted, because an id lives on its element.`
        : "Nothing renamed them.";
    notes.push(
      `${n} ${plural(n, "id")} no longer ${plural(n, "exists", "exist")} in the output (${listOf(result.idsDropped)}). ${cause} Anything reaching in from outside stops resolving — a <use href="sprite.svg#name">, a #name rule in a separate stylesheet, a getElementById. ${idRemedy}`,
    );
  }

  if (result.ariaRefsBroken.length > 0) {
    const n = result.ariaRefsBroken.length;
    notes.push(
      `aria-labelledby or aria-describedby still points at ${listOf(result.ariaRefsBroken)}, and nothing in the output carries ${plural(n, "that id", "those ids")} any more — so this graphic has lost its accessible name to a screen reader. ${idRemedy}`,
    );
  }

  if (result.linkHrefsDropped > 0) {
    const n = result.linkHrefsDropped;
    notes.push(
      `${n} <a href> ${plural(n, "attribute")} ${plural(n, "was", "were")} removed. SVGO 4 does not recognise the SVG 2 href spelling on <a> and drops it as unknown, while the older xlink:href spelling survives, so ${plural(n, "that link is", "those links are")} no longer ${plural(n, "a link", "links")}. Untick ${riskyLabel("removeUnknownsAndDefaults")} to keep ${plural(n, "it", "them")}.`,
    );
  }

  /*
    Gated on the block having carried RULES, not merely on a <style> element
    disappearing. An empty or comment-only <style> — Illustrator and Figma both
    emit one — is removed by `removeEmptyContainers`, which is not on the rail
    and does not care what `inlineStyles` is set to (measured: dropped with
    `disabled: ["inlineStyles"]` too). Firing on the bare element count printed
    the whole inlining explanation over a stylesheet that never had a rule in
    it, and ended with a remedy that provably does not bring the element back.
  */
  const ruleBlocksGone = Math.max(
    0,
    before.styleElementsWithRules - after.styleElementsWithRules,
  );
  if (ruleBlocksGone > 0 && !off("inlineStyles")) {
    notes.push(
      `The <style> block is gone. Its rules were written onto the elements they matched, and the class attribute they matched on was then removed — after which the leftovers were dropped as unused. A rule that only applies in a state or a context does not survive that: :hover, :focus and anything inside an @media block have nothing left to attach to. Untick ${riskyLabel("inlineStyles")} to keep the block whole.`,
    );
  }

  if (result.dimensionsLost) {
    notes.push(
      `width and height are gone from the root, so this SVG now takes the size of whatever box you put it in.${
        after.hasViewBox && !before.hasViewBox
          ? " A viewBox was written from the old width and height first, so the aspect ratio is intact."
          : ""
      } Anything that relied on the intrinsic size — an <img> with no CSS size on it, a print layout — will lay out differently.`,
    );
  }

  /*
    The pass was asked for and did nothing. `removeDimensions` only drops the
    two attributes when the root already has a viewBox, or when both values are
    plain numbers it can build one from (svgo/plugins/removeDimensions.js). A
    root sized in mm, in, pt, em or % fails that test and the plugin is a silent
    no-op — measured: width="210mm" height="297mm" came back untouched, and
    8.5in/11in came back as width="816" height="11in" because cleanupNumericValues
    converted one and not the other. Before this note the page said nothing at
    all, so the user shipped a file they believed was responsive.
  */
  if (settings.removeDimensions && before.hasDimensions && !result.dimensionsLost) {
    const blocked = ([
      ["width", after.rootWidth],
      ["height", after.rootHeight],
    ] as const)
      .filter(([, value]) => value !== null && !isPlainLength(value))
      .map(([name, value]) => `${name}="${value}"`);
    if (blocked.length > 0) {
      notes.push(
        `${OPT_IN_LABELS.removeDimensions.toUpperCase()} is ticked and they are still on the root, because ${andList(blocked)} ${plural(blocked.length, "is not a plain number", "are not plain numbers")}. SVGO drops the two attributes only when it can write a viewBox from them, and turning a length in mm, in, pt, em or % into user units would mean guessing at a scale, so it left the file alone. This SVG still carries its intrinsic size; give it a viewBox yourself and the checkbox will work.`,
      );
    }
  }

  if (result.viewBoxLost) {
    notes.push(
      `The viewBox is gone from the root, which means this file no longer scales. That is not something SVGO 4's default set does, so it came from the file's own structure rather than from a setting here.`,
    );
  }

  /*
    Entity expansion costs bytes and the rest of the run may or may not make
    them back — `result.savedBytes` already holds the answer, so the direction
    is read off it. This sentence used to end "which makes a file like that
    longer, not shorter" unconditionally, and printed under a SAVED tile that
    had measured 44.6% SMALLER on an editor export whose entity was one colour.
  */
  if (before.hasEntityDeclarations) {
    const bytes = Math.abs(result.savedBytes).toLocaleString();
    const outcome =
      result.savedBytes > 0
        ? `it did: the output is ${bytes} bytes smaller (${result.savedPercent}%)`
        : result.savedBytes < 0
          ? `it did not: the output is ${bytes} bytes larger (${Math.abs(result.savedPercent)}%)`
          : `the two cancelled out exactly, at ${result.outputBytes.toLocaleString()} bytes either way`;
    notes.push(
      `This file declared XML entities inside its DOCTYPE. Every use is expanded in place and the declaration is dropped, so text that was written once and referenced many times is now written out in full each time. That costs bytes, and whether the rest of the run makes them back depends on the file — on this one ${outcome}.`,
    );
  }

  if (result.savedBytes < 0) {
    notes.push(
      `The result is ${Math.abs(result.savedBytes).toLocaleString()} bytes LARGER than the input, not smaller. Keep the original.`,
    );
  } else if (result.savedBytes === 0) {
    notes.push(
      `Nothing changed: ${result.inputBytes.toLocaleString()} bytes in, ${result.outputBytes.toLocaleString()} bytes out. This file has already been through an optimiser, or there was nothing in it to take out.`,
    );
  }

  return notes;
}

/**
 * What the file's encoding did to the numbers on the page — which is NOTHING,
 * and saying so is the whole point of this sentence.
 *
 * `decodeSvgBytes` hands back a JS string with any byte-order mark already
 * consumed, and every figure the page prints is `utf8Bytes` of that string. So
 * BEFORE, AFTER and SAVED are UTF-8 counts on both sides, and converting from
 * UTF-16 or dropping a BOM contributes exactly zero to the saving. This used to
 * say the opposite — "roughly half the saving below is the encoding change" for
 * a UTF-16 file, and "3 of the bytes saved are the mark" for a BOM. Measured: a
 * 268-byte UTF-16LE fixture reported 133 in, 102 out, 31 saved, and the same
 * source with and without a UTF-8 BOM both saved 31. The on-disk delta is real
 * and worth stating, so it is stated separately and derived from `file.size`.
 *
 * @param onDiskBytes the file's own `size` — the bytes that were actually read
 * @param sourceBytes `utf8Bytes` of the decoded text, i.e. what goes into the run
 */
export function encodingNote(
  decoded: DecodedSvg,
  onDiskBytes: number,
  sourceBytes: number,
): string | null {
  const delta = onDiskBytes - sourceBytes;
  const sides = `${onDiskBytes.toLocaleString()} bytes on disk, ${sourceBytes.toLocaleString()} going into the run`;

  if (decoded.encoding !== "utf-8") {
    const worth =
      delta > 0
        ? `worth ${delta.toLocaleString()} bytes on its own, before a single pass runs`
        : delta < 0
          ? `worth ${Math.abs(delta).toLocaleString()} bytes AGAINST you on its own, before a single pass runs`
          : `worth nothing either way here`;
    return `This file is ${decoded.encoding.toUpperCase()} on disk, which is legal XML and rare. The download is UTF-8. Both panes and every figure below are UTF-8 counts of the same text, so the encoding change is not part of the saving — it is a separate change, ${worth}: ${sides}.`;
  }

  if (decoded.bomBytes > 0) {
    return `This file starts with a UTF-8 byte-order mark. Those ${decoded.bomBytes} bytes are dropped as the file is read, before anything is counted, so they are not part of the saving below — ${sides}. Nothing needs a byte-order mark to read an SVG.`;
  }

  return null;
}

/** `logo.svg` → `logo.min.svg`; anything else gets `.min.svg` appended. */
export function optimizedFileName(name: string): string {
  const trimmed = name.trim() || "image.svg";
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  return `${stem}.min.svg`;
}
