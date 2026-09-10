/**
 * The registry-dependent half of "a file arrived from outside the tab":
 * which extensions this site is willing to be the operating system's handler
 * for, and which tools can actually do something with a given file.
 *
 * Split from share-target.ts because that module is imported by the service
 * worker and must stay free of the 3,479-line tool registry. Everything here
 * is DERIVED from `acceptFormats` — the same string that becomes the
 * `<DropZone accept=…>` on each tool page — so the manifest cannot claim a
 * format no page opens, and cannot go stale when a tool is added.
 */

import { tools, type Tool } from "@/data/tools";

/** `"photo.HEIC"` → `".heic"`. `""` when there is no extension at all. */
export function extensionOf(filename: string): string {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const base = slash === -1 ? filename : filename.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  // `dot <= 0` also rejects a dotfile: ".bashrc" is a name, not an extension.
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot).toLowerCase();
}

/**
 * The extension tokens one tool accepts. `acceptFormats` is an `<input accept>`
 * string, so it may hold MIME types as well — `markdown-to-pdf` carries a
 * literal `text/markdown` beside its extensions — and those are dropped here
 * rather than matched, because this function answers "what does the filename
 * say" and a filename does not carry a MIME type.
 */
function acceptedExtensions(tool: Tool): string[] {
  return tool.acceptFormats
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.startsWith(".") && token.length > 1);
}

/**
 * Every tool whose drop zone would accept this filename, most specific first.
 *
 * "Most specific" is the count of extensions the tool accepts, ascending: a
 * page that takes `.heic,.heif` and nothing else was built for the file the
 * user just shared, while one that takes seven image formats merely tolerates
 * it. That ranking is derived from the same field the picker uses, so it can
 * never disagree with what the destination page will actually open. Ties break
 * alphabetically, so the list is stable across builds.
 *
 * Tools with no extensions at all never match — the 24 `takesNoFile`
 * generators, plus `hash-generator` and `base64-encode-decode`, whose zones
 * take any file but advertise no list (tools.ts:268-275). Offering a QR-code
 * generator for a shared MP4 would be noise.
 */
export function toolsForFile(filename: string): Tool[] {
  const ext = extensionOf(filename);
  if (!ext) return [];
  return tools
    .map((tool) => ({ tool, accepts: acceptedExtensions(tool) }))
    .filter(({ accepts }) => accepts.includes(ext))
    .sort(
      (a, b) => a.accepts.length - b.accepts.length || a.tool.name.localeCompare(b.tool.name),
    )
    .map(({ tool }) => tool);
}

/** How many tools accept each extension in the registry. */
export function toolCountByExtension(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    for (const ext of new Set(acceptedExtensions(tool))) {
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Declaring `file_handlers` puts Transmute in the operating system's "Open
 * with" menu for a file type, and there is a real cost to over-claiming it: a
 * user who picks it for a format only one page touches gets a worse experience
 * than the app they had. So the bar is a MEASURED one — an extension is
 * declared only when at least this many tools accept it — and it is enforced
 * by a test rather than by judgement, so adding a tool cannot quietly promote
 * a format and removing one cannot quietly leave a false claim standing.
 *
 * Five is where the registry's own distribution puts the line. Counted over
 * `acceptFormats`: the media formats sit at 5 and up (`.heic` 5, `.tiff` 5,
 * `.svg` 6, `.avi` 7, up to `.png` 34), and the next rung down is `.txt` at 4,
 * then `.md`/`.json`/`.csv` at 3 and `.zip` at 2 — the text, data and archive
 * formats, which are exactly the ones a general-purpose converter has no
 * business being the default opener for.
 */
export const FILE_HANDLER_MIN_TOOLS = 5;

/**
 * The MIME type each extension is declared under. Only extensions listed here
 * can ever be declared, so this map is the second half of the gate: crossing
 * the tool threshold is necessary and not sufficient.
 *
 * Three extensions share `audio/ogg` and two share `video/mp4` because that is
 * what those containers are; the manifest groups by MIME, and an extension may
 * appear only once across the whole `file_handlers` array.
 */
const EXTENSION_MIME: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wma": "audio/x-ms-wma",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

function buildAccept(): Record<string, readonly string[]> {
  const counts = toolCountByExtension();
  const accept: Record<string, string[]> = {};
  // Iterated over EXTENSION_MIME rather than over `counts`, so the order in
  // the built manifest is this file's declaration order and a rebuild with no
  // source change produces a byte-identical manifest.
  for (const [ext, mime] of Object.entries(EXTENSION_MIME)) {
    if ((counts.get(ext) ?? 0) < FILE_HANDLER_MIN_TOOLS) continue;
    (accept[mime] ??= []).push(ext);
  }
  return accept;
}

/**
 * `file_handlers[0].accept` — MIME type to the extensions declared under it.
 * Derived at module scope from the registry; see `buildAccept`.
 */
export const FILE_HANDLER_ACCEPT: Readonly<Record<string, readonly string[]>> = buildAccept();

/** Flat list of every declared extension, for tests and for page copy. */
export const FILE_HANDLER_EXTENSIONS: readonly string[] =
  Object.values(FILE_HANDLER_ACCEPT).flat();

/**
 * `share_target.params.files[].accept`. The same MIME types, from the same
 * derivation, so the share sheet and the "Open with" menu can never offer
 * Transmute for two different sets of formats.
 */
export const SHARE_ACCEPT_TYPES: readonly string[] = Object.keys(FILE_HANDLER_ACCEPT);
