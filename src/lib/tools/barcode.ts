/**
 * Barcodes — checked, derived, and then drawn by BWIPP.
 *
 * The engine is bwip-js's `generic` entry, which is BWIPP (the reference
 * PostScript barcode library) cross-compiled to JavaScript plus an SVG drawing
 * context. That entry is chosen deliberately: it touches no DOM at all — it was
 * run here with `typeof document === "undefined"` — so every function below is
 * testable under jsdom and none of it needs a canvas to produce a barcode.
 *
 * Three jobs live in this file and it is worth saying which is which, because
 * the whole value of a barcode tool is that the number under the bars and the
 * number a scanner reads are the same number:
 *
 *  1. `checkBarcodeInput` and `checkBarcodeColors` are a PRE-FLIGHT, not the
 *     authority. BWIPP is the authority, and `renderBarcodeSvg` surfaces its
 *     refusal verbatim. The pre-flight exists so the page can say "EAN-13 needs
 *     12 or 13 digits, you have 5" while you are still typing, and so it can
 *     refuse the cases BWIPP happily accepts and a scanner will not read back
 *     as typed — non-ASCII in a byte symbology, and a colour pair that grades
 *     F for symbol contrast.
 *  2. `scannedValue` and `ean13Equivalent` DERIVE what a scanner will actually
 *     report. For four of the eleven symbologies that is not the string you
 *     typed — a 12-digit EAN-13 gains a check digit, and a UPC-E is expanded
 *     back into the 12-digit UPC-A it compresses. Printing the typed string as
 *     though it were the encoded one is the lie these functions exist to
 *     prevent.
 *  3. `bwipOptions` is the whole option set handed to the engine, as a pure
 *     value, so a test can assert that `height` never reaches a matrix
 *     symbology (it stretches a QR code into a rectangle) and that an option a
 *     symbology does not implement is never sent.
 *
 * Every number quoted in a `note` below was binary-searched against the shipped
 * engine and is pinned by a test in `barcode.test.ts`, because a capacity
 * figure copied out of a spec table is a capacity figure for a different build.
 */

/** The eleven symbologies this page offers, by their BWIPP `bcid`. */
export type SymbologyId =
  | "code128"
  | "code39"
  | "ean13"
  | "ean8"
  | "upca"
  | "upce"
  | "itf14"
  | "qrcode"
  | "datamatrix"
  | "pdf417"
  | "azteccode";

export interface Symbology {
  id: SymbologyId;
  /** As printed on the page and in the file name. */
  name: string;
  /**
   * Linear codes are a row of bars with a settable height; matrix codes are a
   * square grid whose height is fixed by the data. The distinction is not
   * cosmetic — passing `height` to a matrix symbology stretches it, and a
   * stretched QR code is a broken QR code.
   */
  kind: "linear" | "matrix";
  /**
   * BWIPP implements `includetext` — the human-readable line under the bars.
   * Read off each symbology's own option list in BWIPP, not guessed: the four
   * matrix codes declare no such option and passing it is silently ignored, so
   * offering the checkbox there would be a control that does nothing.
   */
  supportsText: boolean;
  /**
   * BWIPP implements `includecheck` — an OPTIONAL check character it appends.
   * Only Code 39 among these eleven has one. EAN, UPC and ITF-14 check digits
   * are mandatory and always computed, which is a different thing and is
   * handled by `scannedValue`.
   */
  supportsCheckDigit: boolean;
  placeholder: string;
  /** One line, shown under the picker. States the rule the validator enforces. */
  note: string;
}

export const SYMBOLOGIES: readonly Symbology[] = [
  {
    id: "code128",
    name: "Code 128",
    kind: "linear",
    supportsText: true,
    supportsCheckDigit: false,
    placeholder: "SHIP-4417-B",
    note: "Any printable ASCII, up to 500 characters. The default for shipping labels and asset tags.",
  },
  {
    id: "code39",
    name: "Code 39",
    kind: "linear",
    supportsText: true,
    supportsCheckDigit: true,
    placeholder: "PART-1024",
    note: "Digits, capitals, space and - . $ / + % only, up to 500 characters. Older and wider than Code 128, still everywhere in warehouses.",
  },
  {
    id: "ean13",
    name: "EAN-13",
    kind: "linear",
    supportsText: true,
    supportsCheckDigit: false,
    placeholder: "590123412345",
    note: "12 or 13 digits. Give 12 and the check digit is computed for you.",
  },
  {
    id: "ean8",
    name: "EAN-8",
    kind: "linear",
    supportsText: true,
    supportsCheckDigit: false,
    placeholder: "9520000",
    note: "7 or 8 digits. The short retail code, for packs too small for an EAN-13.",
  },
  {
    id: "upca",
    name: "UPC-A",
    kind: "linear",
    supportsText: true,
    supportsCheckDigit: false,
    placeholder: "01234500005",
    note: "11 or 12 digits. Shown both ways — many readers report a UPC-A as the EAN-13 it also is, with a leading zero.",
  },
  {
    id: "upce",
    name: "UPC-E",
    kind: "linear",
    supportsText: true,
    supportsCheckDigit: false,
    placeholder: "0123456",
    note: "7 or 8 digits starting 0 or 1. A compressed UPC-A — readers report the expansion, not what you type.",
  },
  {
    id: "itf14",
    name: "ITF-14",
    kind: "linear",
    supportsText: true,
    supportsCheckDigit: false,
    placeholder: "0952123454321",
    note: "13 or 14 digits, spaces ignored. The outer-case code, drawn inside its bearer bar.",
  },
  {
    id: "qrcode",
    name: "QR Code",
    kind: "matrix",
    supportsText: false,
    supportsCheckDigit: false,
    placeholder: "https://example.com",
    note: "Any text, any script. Roughly 5 500 digits or 2 300 Latin characters at the engine's default M correction level.",
  },
  {
    id: "datamatrix",
    name: "Data Matrix",
    kind: "matrix",
    supportsText: false,
    supportsCheckDigit: false,
    placeholder: "LOT-88421",
    note: "Any text. Stays readable much smaller than a QR code, which is why it marks circuit boards and instruments.",
  },
  {
    id: "pdf417",
    name: "PDF417",
    kind: "matrix",
    supportsText: false,
    supportsCheckDigit: false,
    placeholder: "PDF417 payload",
    note: "Any text. The wide stacked code on driving licences and boarding passes.",
  },
  {
    id: "azteccode",
    name: "Aztec",
    kind: "matrix",
    supportsText: false,
    supportsCheckDigit: false,
    placeholder: "Aztec payload",
    note: "Any text. Needs no quiet zone of its own, which is why rail tickets use it.",
  },
];

const BY_ID = new Map(SYMBOLOGIES.map((s) => [s.id, s]));

export function getSymbology(id: SymbologyId): Symbology {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown symbology: ${id}`);
  return found;
}

/* ── The number under the bars ─────────────────────────────────────── */

/**
 * The GS1 modulo-10 check digit, over the body WITHOUT its check digit.
 *
 * Weights alternate 3 and 1 starting from the RIGHTMOST body digit, which is
 * why this walks the string backwards: weighting from the left gets the right
 * answer only for even-length bodies and is the classic way to ship a barcode
 * that scans to a number nobody ordered. EAN-13, EAN-8, UPC-A, UPC-E and
 * ITF-14 all use this one function.
 */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** The 43 Code 39 characters, in the order that gives each its check value. */
export const CODE39_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";

/**
 * Code 39's optional modulo-43 check character.
 *
 * Unlike the retail check digits this one is NOT part of the number: a scanner
 * that is not configured to strip it reports it as an extra character on the
 * end. `scannedValue` says so rather than hiding it.
 */
export function code39CheckChar(text: string): string | null {
  let sum = 0;
  for (const char of text) {
    const value = CODE39_CHARSET.indexOf(char);
    if (value < 0) return null;
    sum += value;
  }
  return CODE39_CHARSET[sum % 43];
}

/**
 * The 11-digit UPC-A body a UPC-E compresses, or null if this is not a UPC-E.
 *
 * UPC-E is not a short barcode, it is a SHORTHAND: the last digit before the
 * check digit selects one of five substitution rules for putting a run of
 * zeroes back. A scanner therefore reports twelve digits you never typed, and
 * `0123456` comes back as `012345000065`. The table below is the one in the
 * GS1 spec; every branch is checked against a real decode in the unit tests.
 */
export function expandUpceBody(upce: string): string | null {
  const digits = upce.slice(0, 7);
  if (!/^[01]\d{6}$/.test(digits)) return null;
  const system = digits[0];
  const x = digits.slice(1, 6);
  const last = digits[6];
  switch (last) {
    case "0":
    case "1":
    case "2":
      return `${system}${x[0]}${x[1]}${last}0000${x[2]}${x[3]}${x[4]}`;
    case "3":
      return `${system}${x[0]}${x[1]}${x[2]}00000${x[3]}${x[4]}`;
    case "4":
      return `${system}${x[0]}${x[1]}${x[2]}${x[3]}00000${x[4]}`;
    default:
      return `${system}${x}0000${last}`;
  }
}

/** ITF-14 is the one symbology BWIPP strips spaces from before encoding. */
export function normaliseInput(id: SymbologyId, text: string): string {
  return id === "itf14" ? text.replace(/ /g, "") : text;
}

/**
 * The engine's own character ceiling, where it is a flat number.
 *
 * Binary-searched against the shipped bwip-js: Code 128 and Code 39 both take
 * exactly 500 characters and refuse the 501st, whatever the content and
 * whether or not the optional check character is on. Every other symbology
 * here has a capacity that moves with the encoding mode — a QR code holds
 * 5,596 digits but 2,331 byte-mode characters — so quoting one number for
 * those would be its own lie, and BWIPP's refusal is left to speak for them.
 * `barcode.test.ts` pins 500/501 against the engine.
 */
const MAX_TEXT_LENGTH: Partial<Record<SymbologyId, number>> = {
  code128: 500,
  code39: 500,
};

/** How many body digits each fixed-length numeric symbology carries. */
const NUMERIC_BODY_LENGTH: Partial<Record<SymbologyId, number>> = {
  ean13: 12,
  ean8: 7,
  upca: 11,
  upce: 7,
  itf14: 13,
};

/**
 * What a scanner will actually report for this input, or null when the tool
 * cannot say for certain.
 *
 * This is the honest half of the page. Four of the eleven symbologies do not
 * hand back what you typed, and the difference is never cosmetic:
 *  · a 12-digit EAN-13 gains its computed check digit;
 *  · a UPC-E is expanded into its UPC-A, so seven typed digits become twelve;
 *  · Code 39 with the optional check character on gains that character.
 *
 * This returns ONE form: the number printed under the bars. For UPC-A and
 * UPC-E there is a second one, and `ean13Equivalent` derives it — the page
 * shows both, because showing one and calling it "what a scanner reads back"
 * is wrong for whichever kind of reader the user happens to hold.
 */
export function scannedValue(
  id: SymbologyId,
  text: string,
  includeCheckDigit = false,
): string | null {
  const value = normaliseInput(id, text);
  const bodyLength = NUMERIC_BODY_LENGTH[id];

  if (bodyLength !== undefined) {
    if (!/^\d+$/.test(value)) return null;
    if (value.length !== bodyLength && value.length !== bodyLength + 1) return null;
    const body = value.slice(0, bodyLength);
    if (id === "upce") {
      const upcaBody = expandUpceBody(body);
      if (!upcaBody) return null;
      return `${upcaBody}${gs1CheckDigit(upcaBody)}`;
    }
    return `${body}${gs1CheckDigit(body)}`;
  }

  if (id === "code39" && includeCheckDigit) {
    const check = code39CheckChar(value);
    return check === null ? null : `${value}${check}`;
  }

  return value === "" ? null : value;
}

/**
 * The 13-digit EAN-13 a UPC symbol ALSO is, or null where there is no second
 * form to report.
 *
 * UPC-A is exactly the EAN-13 whose leading digit is zero — the same article
 * number, written with one digit that nobody prints. Readers genuinely
 * disagree about which of the two they hand back, so a page that shows one and
 * calls it "what a scanner reads back" is wrong for half its readers. Measured
 * rather than assumed: drawing `01234500005` as UPC-A here and reading it back
 * with zxing-cpp — the same decoder behind this site's own /qr-code-reader —
 * returns `0012345000058`, thirteen digits, and the same is true of a UPC-E.
 * The twelve digits `scannedValue` returns are what is printed under the bars
 * and what a POS scanner transmits unless it has been configured to convert.
 * Both are right, so both are shown, and the round-trip test asserts this one
 * against a real decode.
 */
export function ean13Equivalent(id: SymbologyId, text: string): string | null {
  if (id !== "upca" && id !== "upce") return null;
  const value = scannedValue(id, text);
  return value === null ? null : `0${value}`;
}

/* ── The pre-flight ────────────────────────────────────────────────── */

export type IssueLevel = "error" | "warning";

export interface BarcodeIssue {
  /** Stable key, for React and for the tests. */
  id: string;
  level: IssueLevel;
  message: string;
}

export function hasBlockingIssue(issues: readonly BarcodeIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}

/** Quote a few offending characters without dumping the whole string back. */
function nameCharacters(chars: string[]): string {
  const unique = [...new Set(chars)];
  const shown = unique.slice(0, 6).map((c) => JSON.stringify(c)).join(", ");
  return unique.length > 6 ? `${shown} and ${unique.length - 6} more` : shown;
}

const CONTROL_NAMES: Record<string, string> = {
  "\n": "a newline",
  "\r": "a carriage return",
  "\t": "a tab",
};

function numericIssues(
  id: SymbologyId,
  value: string,
  label: string,
  bodyLength: number,
): BarcodeIssue[] {
  const nonDigits = [...value].filter((c) => !/\d/.test(c));
  if (nonDigits.length > 0) {
    return [
      {
        id: "digits",
        level: "error",
        message: `${label} is a numeric symbology — digits only, and this contains ${nameCharacters(nonDigits)}. Code 128 encodes text of any kind if that is what you need.`,
      },
    ];
  }
  if (value.length !== bodyLength && value.length !== bodyLength + 1) {
    return [
      {
        id: "length",
        level: "error",
        message: `${label} needs ${bodyLength} or ${bodyLength + 1} digits — ${bodyLength} and the check digit is computed here, ${bodyLength + 1} and yours is verified. You have ${value.length}.`,
      },
    ];
  }
  if (id === "upce" && !/^[01]/.test(value)) {
    return [
      {
        id: "upce-system",
        level: "error",
        message: `UPC-E only exists for number systems 0 and 1, so the first digit has to be 0 or 1. Yours starts with ${value[0]}. A number outside that range has no UPC-E form at all — encode it as UPC-A.`,
      },
    ];
  }
  if (value.length === bodyLength + 1) {
    const body = value.slice(0, bodyLength);
    const expected =
      id === "upce"
        ? (() => {
            const upca = expandUpceBody(body);
            return upca === null ? null : gs1CheckDigit(upca);
          })()
        : gs1CheckDigit(body);
    if (expected !== null && String(expected) !== value[bodyLength]) {
      return [
        {
          id: "check-digit",
          level: "error",
          message:
            id === "upce"
              ? `That check digit does not match. A UPC-E check digit is computed over the UPC-A it expands to (${expandUpceBody(body)}), not over the seven digits themselves, and that gives ${expected}, not ${value[bodyLength]}. Drop the last digit and it will be worked out here.`
              : `That check digit does not match: ${body} checks to ${expected}, not ${value[bodyLength]}. Either a digit is mistyped or the check digit is — drop it and give ${bodyLength} digits, and the right one is computed here.`,
        },
      ];
    }
  }
  return [];
}

/**
 * Everything wrong with this input, worst first, BEFORE the engine is asked.
 *
 * Errors block generation. Warnings do not: they describe something the code
 * WILL encode faithfully that you may not have meant to encode.
 */
export function checkBarcodeInput(
  id: SymbologyId,
  text: string,
  includeCheckDigit = false,
): BarcodeIssue[] {
  const symbology = getSymbology(id);
  const value = normaliseInput(id, text);

  if (value === "") {
    return [
      {
        id: "empty",
        level: "error",
        message: `Enter the ${NUMERIC_BODY_LENGTH[id] === undefined ? "text" : "number"} to encode. ${symbology.note}`,
      },
    ];
  }

  const bodyLength = NUMERIC_BODY_LENGTH[id];
  if (bodyLength !== undefined) {
    const issues = numericIssues(id, value, symbology.name, bodyLength);
    if (issues.length > 0) return issues;
    if (id === "itf14" && text.includes(" ")) {
      issues.push({
        id: "itf14-spaces",
        level: "warning",
        message: `The spaces are not encoded — ITF-14 is drawn from the ${value.length} digits alone, and the grouping you typed is only a reading aid. That matches how the number is printed on a case.`,
      });
    }
    return issues;
  }

  const issues: BarcodeIssue[] = [];

  const maxLength = MAX_TEXT_LENGTH[id];
  if (maxLength !== undefined && value.length > maxLength) {
    return [
      {
        id: "too-long",
        level: "error",
        message: `${symbology.name} stops at ${maxLength} characters — that is the encoder's own ceiling, not a limit set here — and you have ${value.length}. QR Code, Data Matrix and Aztec hold thousands, if the payload has to travel whole.`,
      },
    ];
  }

  if (id === "code39") {
    const invalid = [...value].filter((c) => !CODE39_CHARSET.includes(c));
    if (invalid.length > 0) {
      const lowercaseOnly = invalid.every((c) => c >= "a" && c <= "z");
      return [
        {
          id: "code39-charset",
          level: "error",
          message: lowercaseOnly
            ? `Code 39 has no lower case at all — its alphabet is 43 characters and every letter in it is a capital. Type ${value.toUpperCase()} instead, or switch to Code 128, which encodes any printable ASCII.`
            : `Code 39 cannot encode ${nameCharacters(invalid)}. Its whole alphabet is digits, capital letters, space and the six symbols - . $ / + % — nothing else exists in the symbology. Code 128 encodes any printable ASCII.`,
        },
      ];
    }
    if (includeCheckDigit) {
      issues.push({
        id: "code39-check-in-text",
        level: "warning",
        message: `With the check character on, this code scans as ${scannedValue(id, value, true)} — the modulo-43 character is appended to the data, and a scanner only hides it if it has been configured to verify Code 39 check characters. Most are not, out of the box.`,
      });
    }
  }

  if (symbology.kind === "linear") {
    /*
      The one case where BWIPP is happy and the result is a wrong barcode.
      Code 128 and Code 39 are byte symbologies whose defined character set is
      Latin-1; bwip-js writes a JavaScript string's UTF-8 bytes. Round-tripped
      through a spec-compliant reader, "héllo" comes back "hÃ©llo" and an emoji
      comes back as one stray byte. There is no option that fixes it, so this
      refuses instead of printing something that scans to nonsense. The matrix
      symbologies carry an ECI declaring UTF-8 and are exempt — they round-trip
      Japanese and emoji intact.
    */
    const nonAscii = [...value].filter((c) => c.codePointAt(0)! > 0x7e);
    if (nonAscii.length > 0) {
      return [
        {
          id: "non-ascii",
          level: "error",
          message: `${symbology.name} carries bytes, not characters, and its defined alphabet stops at ASCII. Encoding ${nameCharacters(nonAscii)} here writes UTF-8 bytes that a scanner reads back as Latin-1 — "é" comes out "Ã©" — so the code would scan to something you did not type. Use QR Code, Data Matrix, PDF417 or Aztec, which declare their encoding and read back exactly.`,
        },
      ];
    }
    const controls = [...value].filter((c) => c.codePointAt(0)! < 0x20);
    if (controls.length > 0) {
      issues.push({
        id: "control-chars",
        level: "warning",
        message: `This contains ${nameCharacters(controls.map((c) => CONTROL_NAMES[c] ?? c))}. ${symbology.name} encodes control characters faithfully, and a keyboard-wedge scanner types them: a newline presses Enter, a tab moves to the next field. That is sometimes exactly what you want and is otherwise a surprise.`,
      });
    }
    if (value !== value.trim()) {
      issues.push({
        id: "surrounding-space",
        level: "warning",
        message: `There is a space at the start or end, and it is encoded like any other character — the code scans back with it attached. Trim it unless you meant it.`,
      });
    }
  }

  return issues;
}

/* ── The pre-flight, part two: the two colours ─────────────────────── */

/** `#rrggbb` → `[r, g, b]` in 0–255, or null if that is not a hex colour. */
function rgbChannels(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const value = match[1];
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Relative luminance, 0 for black and 1 for white, sRGB-linearised.
 *
 * A stand-in for the reflectance ISO/IEC 15416 grades a printed symbol on —
 * the standard measures light coming back off paper, and a screen colour is
 * the closest thing this page has to that number.
 */
export function relativeLuminance(color: string): number | null {
  const channels = rgbChannels(color);
  if (!channels) return null;
  const [r, g, b] = channels.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Everything wrong with the two colours, worst first.
 *
 * The colours were the one input on this page with no derived check: every
 * other risk produces a message computed from what you actually typed, while
 * contrast got a paragraph of general advice and the header went on saying
 * READY over a symbol that decodes to nothing. These three checks were each
 * measured by drawing an EAN-13 and a QR code at the colours in question and
 * reading them back with zxing-cpp:
 *
 *  · Symbol contrast below 20% is ISO 15416 grade F, the lowest there is.
 *    `#eeeeee` bars on white is 15% and decoded to nothing; `#888888` on white
 *    is 75% and decoded. Identical colours are the degenerate case of the same
 *    rule. 20% to 40% is grade D, which is a warning: `#ffcc00` on white is
 *    36% and did decode.
 *  · Inverted — light bars on a dark ground — is refused by linear readers:
 *    white-on-black EAN-13 decoded to nothing even with the reader's own
 *    invert pass on, and so did `#cccccc` on `#333333` and `#eeeeee` on
 *    `#111111`, while white-on-black as a QR code decoded fine. So it blocks a
 *    linear symbology and warns on a matrix one.
 *  · A laser scanner sees reflected red light, so what matters to it is the
 *    RED channel alone. Red bars on white have full red on both sides —
 *    invisible to the gun, however plain they look on screen and however
 *    happily a phone camera reads them (`#ff0000` on white decoded here). That
 *    is a warning rather than a block, because a camera-based reader is fine.
 *    Yellow on white is the same fault twice over: it decoded here too, but at
 *    7% luminance contrast the grade-F rule blocks it first, so the message
 *    for it must not claim nothing could read it — a camera can, and a
 *    round-trip test in `barcode.test.ts` holds that message to it.
 */
export function checkBarcodeColors(
  foreground: string,
  background: string,
  kind: "linear" | "matrix",
): BarcodeIssue[] {
  const fgChannels = rgbChannels(foreground);
  const bgChannels = rgbChannels(background);
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  if (fgChannels === null || bgChannels === null || fg === null || bg === null) return [];

  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const contrast = Math.abs(fg - bg);
  const redContrast = Math.abs(fgChannels[0] - bgChannels[0]) / 255;

  if (contrast < 0.2) {
    /*
      Luminance equality is safe as a stand-in for "the same colour" here, and
      it was checked rather than assumed: no two of the 16,777,216 sRGB colours
      share a relative luminance exactly, so this branch cannot name a colour
      the background is not.
    */
    const identical = fg === bg;
    /*
      Yellow on white and blue on black are the two shapes of this error a
      user actually reaches: obviously different on screen, and different only
      in a channel a laser does not use. Pale grey on white is NOT that case —
      there the red channel is close because every channel is — so the red
      sentence is attached only where the colours differ plainly somewhere.
    */
    const plainlyDifferent = Math.max(...fgChannels.map((c, i) => Math.abs(c - bgChannels[i]))) / 255;
    return [
      {
        id: "contrast",
        level: "error",
        message: identical
          ? `The bars and the background are the same colour (${foreground}), so there is nothing on the page to read. Open SIZE & COLOUR and darken the bars.`
          : /*
              What this can honestly say is the grade, not the outcome. Pale
              grey bars in this band were drawn and read back here and no
              reader found a code at all — but yellow on white lands in the
              same band and DID decode with a camera-style reader, so a blanket
              "nothing can read this" would be false for exactly the colours a
              user is most likely to try. The grade is true for both, and for
              the yellow case the red-channel sentence says why it is still
              refused.
            */
            `Bars ${foreground} on ${background} is ${percent(contrast)} symbol contrast, and ISO 15416 grades anything under 20% an F — the lowest grade there is, and one no scanner is obliged to read.${
              redContrast < 0.2 && plainlyDifferent >= 0.2
                ? ` They look plainly different here, but only in a channel a scanner does not use: in RED they are within ${percent(redContrast)} of each other, and a laser scanner sees reflected red light and nothing else.`
                : ""
            } Open SIZE & COLOUR and darken the bars.`,
      },
    ];
  }

  const issues: BarcodeIssue[] = [];

  if (fg > bg) {
    issues.push(
      kind === "linear"
        ? {
            id: "inverted",
            level: "error",
            message: `The bars (${foreground}) are lighter than the background (${background}), and a linear code drawn that way is refused by nearly every reader — including this site's own, which found nothing in it even with its invert pass on. Swap the two colours in SIZE & COLOUR.`,
          }
        : {
            id: "inverted",
            level: "warning",
            message: `The modules (${foreground}) are lighter than the background (${background}). Matrix readers usually cope — this one decoded when it was tried — but plenty of fixed-mount and laser units will not, so test the actual scanner before printing a run.`,
          },
    );
  } else if (contrast < 0.4) {
    issues.push({
      id: "low-contrast",
      level: "warning",
      message: `Bars ${foreground} on ${background} is only ${percent(contrast)} symbol contrast — an ISO 15416 grade D, one step above failing. It reads on a screen and gets marginal once it is printed, photocopied or read at an angle. Under 20% it is graded F and refused here.`,
    });
  }

  if (redContrast < 0.2) {
    issues.push({
      id: "red-light",
      level: "warning",
      message: `The bars and the background differ by ${percent(redContrast)} in the RED channel, and a laser scanner sees reflected red light and nothing else — red on white is the classic case, and it is invisible to the gun however obvious it looks here. A phone camera will still read it. Give the bars a low red value if a hardware scanner has to.`,
    });
  }

  return issues;
}

/* ── The engine ────────────────────────────────────────────────────── */

export interface BarcodeRequest {
  symbology: SymbologyId;
  text: string;
  /** Unit multiplier. 1 unit is one narrow bar, or half a matrix module. */
  scale: number;
  /** Bar height in BWIPP's own units. Ignored for matrix symbologies. */
  barHeight: number;
  includeText: boolean;
  includeCheckDigit: boolean;
  /** `#rrggbb`. */
  foreground: string;
  background: string;
}

/**
 * Quiet zone — the blank margin a scanner needs to find a symbol at all —
 * in the barcode's own pre-scale units.
 *
 * A matrix module is two units wide in every BWIPP renderer here, so 8 units
 * is the four modules the QR, Data Matrix and Aztec specs ask for. A linear
 * narrow bar is one unit, so 10 units is the ten-bar margin EAN, UPC and
 * Code 128 ask for. These are not decoration: a code cropped flush to the bars
 * is the commonest reason a printed barcode will not scan.
 */
const QUIET_ZONE = { matrix: 8, linearX: 10, linearY: 4 } as const;

const hex = (color: string) => color.replace(/^#/, "").toUpperCase();

/**
 * The complete option set handed to BWIPP, as a plain value.
 *
 * Exported so a test can prove the two rules that matter: `height` never
 * reaches a matrix symbology, and an option a symbology does not implement is
 * never sent at all.
 */
export function bwipOptions(request: BarcodeRequest): Record<string, unknown> {
  const symbology = getSymbology(request.symbology);
  const matrix = symbology.kind === "matrix";
  const wantsText = symbology.supportsText && request.includeText;
  const wantsCheck = symbology.supportsCheckDigit && request.includeCheckDigit;

  return {
    bcid: request.symbology,
    text: normaliseInput(request.symbology, request.text),
    scale: request.scale,
    ...(matrix
      ? { paddingwidth: QUIET_ZONE.matrix, paddingheight: QUIET_ZONE.matrix }
      : {
          height: request.barHeight,
          paddingwidth: QUIET_ZONE.linearX,
          paddingheight: QUIET_ZONE.linearY,
        }),
    ...(wantsText ? { includetext: true } : {}),
    // `includecheckintext` keeps the printed line and the scanned string equal.
    // Without it the check character is encoded but not printed, and the two
    // disagree by one character with nothing on the page to explain it.
    ...(wantsCheck ? { includecheck: true, includecheckintext: wantsText } : {}),
    barcolor: hex(request.foreground),
    textcolor: hex(request.foreground),
    backgroundcolor: hex(request.background),
  };
}

/**
 * BWIPP's own refusal, in a form worth showing someone.
 *
 * Its messages are good — "EAN-13 must be 12 or 13 digits" — but they arrive
 * prefixed with an internal identifier and a line number in the generated
 * source (`bwipp.ean13badLength#6878: `), which reads as a crash rather than as
 * an answer. The prefix goes; the sentence stays exactly as BWIPP wrote it,
 * because BWIPP is the authority here and paraphrasing it would drift.
 */
export function cleanEngineError(message: string): string {
  const stripped = message.replace(/^bwipp\.[A-Za-z0-9_]+#\d+:\s*/, "").trim();
  if (/bar code text not specified/i.test(stripped)) {
    return "Enter the text or number to encode.";
  }
  const withoutTag = stripped.replace(/^bwip-js:\s*/i, "");
  return /[.!?]$/.test(withoutTag) ? withoutTag : `${withoutTag}.`;
}

export interface BarcodeSvg {
  svg: string;
  /** The SVG's own viewBox, in pixels — what the PNG is rasterised at. */
  width: number;
  height: number;
}

/** `viewBox="0 0 W H"` → `{ width, height }`, or null if it is not there. */
export function readViewBox(svg: string): { width: number; height: number } | null {
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * The same SVG with explicit `width`/`height` attributes.
 *
 * bwip-js emits a `viewBox` and nothing else, which is correct SVG and is also
 * the one form an `<img>` cannot reliably size: without intrinsic dimensions
 * some browsers report `naturalWidth` 0 and the preview collapses. The markup
 * is otherwise untouched.
 */
export function svgWithPixelSize(svg: string, width: number, height: number): string {
  return svg.replace(/^<svg /, `<svg width="${width}" height="${height}" `);
}

/**
 * A data URL for the SVG.
 *
 * A `data:` URL rather than a `blob:` one on purpose: a blob URL has to be
 * revoked, and revoking it while an `<img>` is still decoding aborts the decode
 * — a bug this repo has already hit once. There is nothing to revoke here, and
 * a barcode SVG is a few kilobytes.
 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * A file name that says what the code is without leaking a long payload into
 * the file system. The text is used when it is short and tame; otherwise the
 * symbology name carries it alone.
 */
export function barcodeFileName(id: SymbologyId, text: string, extension: string): string {
  const slug = getSymbology(id).name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fromText = normaliseInput(id, text)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return fromText ? `${slug}-${fromText}.${extension}` : `${slug}.${extension}`;
}

/*
  The engine is loaded on demand and cached, so a page that has been opened but
  not used never pays for it. The promise itself is cached rather than the
  module, so two clicks in quick succession share one load rather than racing.
*/
let enginePromise: Promise<{ toSVG(options: Record<string, unknown>): string }> | null = null;

async function loadEngine() {
  if (!enginePromise) {
    enginePromise = import("bwip-js/generic")
      .then((module) => {
        const engine = (
          module as unknown as { default?: { toSVG(o: Record<string, unknown>): string } }
        ).default;
        return engine ?? (module as unknown as { toSVG(o: Record<string, unknown>): string });
      })
      /*
        A failed load clears the memo so a retry can actually retry. Without
        this, one chunk fetch lost to a tunnel or to a redeploy that rehashed
        the file leaves the rejected promise cached, and every later press of
        Generate fails instantly with the same message until the tab is
        reloaded. Same arrangement as the reader loader in qr-decode.ts.
      */
      .catch((error: unknown) => {
        enginePromise = null;
        throw error;
      });
  }
  return enginePromise;
}

/**
 * Draw the barcode, or throw with BWIPP's own explanation.
 *
 * Nothing here touches the DOM, the network or a canvas: BWIPP builds the
 * symbol and bwip-js's SVG drawing context writes it out, glyph outlines for
 * the human-readable line included, so the finished SVG references no font and
 * no image and renders identically wherever it is opened.
 */
export async function renderBarcodeSvg(request: BarcodeRequest): Promise<BarcodeSvg> {
  /*
    The load is the one step here that touches the network, and a bundler's
    chunk-load message ("Failed to fetch dynamically imported module") is not
    something to put in front of someone. It is caught separately from the
    engine's own refusals, which are sentences worth showing verbatim.
  */
  let engine: { toSVG(options: Record<string, unknown>): string };
  try {
    engine = await loadEngine();
  } catch {
    throw new Error(
      "The barcode engine could not be loaded — it is fetched the first time you press Generate, and that fetch failed. Check the connection and press Generate again.",
    );
  }
  let svg: string;
  try {
    svg = engine.toSVG(bwipOptions(request));
  } catch (error) {
    throw new Error(
      cleanEngineError(error instanceof Error ? error.message : String(error)),
    );
  }
  const box = readViewBox(svg);
  if (!box) throw new Error("The barcode engine returned something that is not an SVG.");
  return { svg: svgWithPixelSize(svg, box.width, box.height), ...box };
}
