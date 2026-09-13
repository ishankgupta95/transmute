export interface Category {
  name: string;
  slug: string;
  description: string;
  icon: string;
  /** Nav-pill label — the medium, not the page title. */
  shortName: string;
  /** What actually does the work, shown in the hub's stat strip. */
  engine: string;
  /**
   * What the hub's DOWNLOAD stat says. This used to be a hardcoded "0 KB" in
   * `CategoryHubPage`, which was false on three of the five hubs: the FFmpeg
   * core is a ~31 MB first-use fetch on /audio-tools and /video-tools, qpdf is
   * 2.3 MB on /pdf-tools, and libheif is 1.4 MB on /image-tools.
   *
   * The range is min–max over the engines the homepage table enumerates
   * (`ENGINES` in `src/app/page.tsx`, whose ruler is "a file this origin
   * serves, and the byte count of that file"), so the two surfaces quote one
   * ruler. The low end is real — every category below has at least one tool
   * whose engine is already in the browser — and the high end is the heaviest
   * engine any tool in the category can pull. `0 KB` is reserved for the
   * categories where no tool fetches an engine at all.
   *
   * The ceiling may never UNDERSHOOT, which is a separate check from quoting
   * the table: the homepage's `BUNDLED` list covers libraries that arrive
   * inside a tool's own chunk rather than as a served file, and one of those
   * could in principle out-weigh the category's heaviest served engine. Today
   * none does — the biggest is bwip-js at about 925 KB on /barcode-generator,
   * under developer-tools' 1.0 MB zxing ceiling — and
   * `category-hub-claims.test.tsx` is where that stops being a coincidence.
   */
  download: string;
  /** The "I have a…" chips in the hub sidebar. */
  formats: string[];
}

export const categories: Category[] = [
  {
    name: "Image Tools",
    slug: "image-tools",
    description: "Convert, compress, and resize images in your browser.",
    icon: "Image",
    shortName: "Image",
    /*
      Canvas draws almost everything here, but it is no longer the only answer
      and saying so alone understated the hub: /image-to-text pulls Tesseract,
      which is now the heaviest engine this category can fetch (see `download`
      below). That went out of step for exactly as long as it took someone to
      notice — the ceiling comment underneath was updated and this line was
      not, because until 2026-09-10 the only `Category.engine` assertion in the
      suite was the audio hub's. There is now a general one.
    */
    engine: "CANVAS 2D · TESSERACT",
    // Canvas is built in, so most of these tools cost nothing. THE CEILING
    // MOVED on 2026-09-10, for the first time since this hub was written:
    // /image-to-text fetches the Tesseract OCR engine and its English language
    // model, 5,088,998 bytes across five files, rowed on the homepage at
    // "4.9 MB". That is 3.4x libheif's 1,513,632 bytes, so it is the new
    // heaviest thing this hub can make a browser fetch and the range moves
    // with it — unlike oxipng (164,172 bytes, a ninth of libheif), which
    // got a homepage row in 2026-09 and correctly left this line alone.
    // pica (resizing) and utif2 (TIFF) are bundled into the importing tool's
    // chunk instead — about 36 KB and 60 KB — so they are disclosed under the
    // homepage table rather than rowed in it, and they do not move this range.
    download: "0–4.9 MB",
    // The chip strip is headed "I HAVE A…", so every chip has to be a format
    // some image page's DropZone ACCEPTS. ICO was not one — png-to-ico writes
    // .ico, nothing on the site read it — and GIF was missing even though
    // compress-image, resize-image and crop-image all take it. ICO is back
    // because that premise expired: /ico-to-png accepts .ico,.cur and unpacks
    // every size the directory declares, so somebody who says "I have an ICO"
    // now has somewhere to go. .cur rides along without a chip of its own, the
    // way .oga does on the audio hub — a chip is a thing people say out loud.
    formats: ["JPG", "PNG", "HEIC", "WEBP", "AVIF", "SVG", "BMP", "TIFF", "GIF", "ICO"],
  },
  {
    name: "PDF Tools",
    slug: "pdf-tools",
    description: "Merge, split, and manipulate PDF files — no upload needed.",
    icon: "FileText",
    shortName: "PDF",
    // Three real engines now: pdf-lib does the document surgery, pdfjs renders
    // and reads, and qpdf (WebAssembly) does encryption, decryption and repair.
    engine: "PDF-LIB · PDFJS · QPDF · TESSERACT",
    /*
      THE CEILING MOVED on 2026-09-10: /ocr-pdf pulls the Tesseract OCR engine
      and its English model, 5,088,998 bytes, rowed on the homepage at
      "4.9 MB" — 2.1x qpdf's 2.3 MB, which had been the ceiling. The floor is
      still markdown-to-pdf, which pulls none of them. The engine itself is
      shared with /image-to-text, so a visitor who has used that one pays
      nothing here; the range states what a browser CAN be made to fetch, not
      what it always will.
    */
    download: "0–4.9 MB",
    formats: ["PDF", "JPG", "PNG", "WEBP", "MD"],
  },
  {
    name: "Audio Tools",
    slug: "audio-tools",
    description: "Convert between audio formats, trim clips, and merge files — all in your browser.",
    icon: "Music",
    shortName: "Audio",
    // Three engines, not one. Web Audio decodes, lamejs writes every MP3 the
    // category produces (browsers decode MP3 but will not encode it), and
    // FFmpeg is the decoder of last resort — `decodeViaFFmpeg` in
    // `lib/tools/audio-decode.ts` is what opens M4A/AAC in Firefox and Ogg in
    // Safari, the exact case /m4a-to-mp3 advertises. "WEB AUDIO" alone hid a
    // 31 MB fetch behind a stat strip that also said DOWNLOAD 0 KB.
    engine: "WEB AUDIO · LAMEJS · FFMPEG",
    // FFmpeg is the ceiling at 31 MB, and for most of the category it is a
    // fallback rather than a certainty: a Chrome user converting M4A never
    // fetches it. Two pages always do — /wma-to-mp3, because no browser has a
    // WMA decoder at all, and /wav-to-flac, because the FLAC encoder is
    // FFmpeg's. lamejs (254 KB) is the usual cost everywhere else, and
    // mp3-to-wav on a browser-decodable MP3 fetches neither.
    download: "0–31 MB",
    // Audited against the registry: the union of `acceptFormats` across the
    // thirteen audio tools is exactly .aac .flac .m4a .mp3 .oga .ogg .opus
    // .wav .wma, so every chip here is a format some audio page's DropZone
    // actually accepts and none is missing. (.oga rides along with OGG on the
    // one page that takes it; it is not a format anybody says out loud.)
    // OPUS and WMA joined when the format matrix shipped.
    formats: ["MP3", "WAV", "M4A", "AAC", "FLAC", "OGG", "OPUS", "WMA"],
  },
  {
    name: "Video Tools",
    slug: "video-tools",
    description: "Swap containers, trim, mute, rotate, compress and record video — FFmpeg.wasm and WebCodecs, in your tab.",
    icon: "Video",
    shortName: "Video",
    // FFmpeg does the stream copies (trim, the container tools, mute, rotate)
    // and the audio extraction; WebCodecs does the two real encodes
    // (compress-video, webm-to-mp4). Both names are load-bearing.
    engine: "FFMPEG · WEBCODECS",
    // The FFmpeg core is a ~31 MB first-use fetch and most of this category
    // needs it; screen-recorder and the WebCodecs encodes fetch nothing.
    download: "0–31 MB",
    // MKV and AVI joined when the container tools shipped; every chip here is
    // a format some video page's DropZone actually accepts. GIF was not one —
    // video-to-gif WRITES a GIF and reads .mp4/.webm/.mov, and no video tool
    // on the site accepts .gif — so under this strip's "I HAVE A…" heading it
    // was the one chip that pointed nowhere.
    formats: ["MP4", "MOV", "MKV", "AVI", "WEBM", "M4V"],
  },
  {
    name: "Developer Tools",
    slug: "developer-tools",
    description: "Format JSON, encode Base64, generate hashes, and more.",
    icon: "Code",
    shortName: "Developer",
    // Was "NATIVE JS", and that was true right up until 2026-09-05. Most of
    // these tools still run on nothing but the language and WebCrypto, but two
    // of them now instantiate a WebAssembly module: /qr-code-reader decodes
    // through the zxing-cpp reader and /extract-archive reads through
    // libarchive. The homepage workshop card no longer keeps a copy of this
    // string to drift from: `WORKSHOPS` in src/app/page.tsx dropped its own
    // `engine` field and renders `cat.engine` off this object, because the
    // hand-sync it relied on had already failed once — that card said
    // "WEB AUDIO" while the audio hub said "WEB AUDIO · LAMEJS · FFMPEG".
    engine: "NATIVE JS · ZXING · LIBARCHIVE",
    // This used to read "0 KB", and the comment here used to explain that this
    // was the one hub where that was true because nothing in the category
    // appeared in the homepage ENGINES table. Both halves died on the same
    // commit: zxing-wasm and libarchive are in that table now, and the two
    // tools above fetch them. The ceiling is zxing_reader.wasm — 1,093,289
    // bytes, 1.0 MB on the table's own binary ruler.
    //
    // The floor needs more care than it used to get. This comment said "the
    // other fifty-odd tools here fetch nothing at all", and that was simply
    // untrue: /barcode-generator pulls about 925 KB of bwip-js,
    // /svg-optimizer about 566 KB of svgo, /docx-to-markdown about 478 KB of
    // mammoth, /sql-formatter about 288 KB of sql-formatter, and /create-zip
    // and /unzip-files about 124 KB of jszip. None of
    // them is a file this origin serves under its own name — they are bundled
    // into each tool's own code-split chunk — which is why they are not
    // ENGINES rows and why they do not raise this ceiling (925 KB < 1.0 MB).
    // It is not why they can be described as nothing. The homepage discloses
    // all four under its table; "0" here means the many tools that genuinely
    // fetch no library, which is still most of them.
    //
    // With this line, no hub on the site quotes a flat "0 KB" any more. The
    // success colour in CategoryHubPage is therefore unspent — the branch is
    // kept, not deleted, because it is the thing that would light up again if a
    // category ever went back to costing nothing.
    //
    // 1.0 and not 1.1: the ruler is the served artifact, so this is
    // zxing_reader.wasm alone. /qr-code-reader's ADVANCED rail adds its
    // bundled loader and renders 1.1 MB, which is the one surface on the site
    // quoting the pair. faqs.ts ("1,093,289 bytes") and the ENGINES row
    // ("1.0 MB") are on this ruler, so the rail is the outlier — and
    // category-hub-claims.test.tsx now derives this string from the bytes of
    // zxing_reader.wasm on disk rather than from another sentence on the site,
    // so the two guards no longer form a closed loop.
    download: "0–1.0 MB",
    // YAML, HAR and XLSX joined with Wave 4's developer fills, and all three
    // clear the "I HAVE A…" bar the media hubs are held to: /yaml-to-json and
    // /yaml-formatter take .yaml/.yml, /har-viewer takes .har, /xlsx-to-csv
    // takes .xlsx. The batch also put .log and .sh in front of a DropZone
    // (/sort-dedupe-lines, /crlf-lf) and neither is here — a chip is a thing
    // somebody says they HAVE, and nobody arrives thinking "I have a .sh".
    //
    // The archive and document batch adds six more, each backed by a DropZone:
    // ZIP (/unzip-files, /extract-archive), TAR, 7Z and RAR (/extract-archive),
    // SVG (/svg-optimizer) and DOCX (/docx-to-markdown). GZ, BZ2 and XZ are
    // accepted too and are deliberately not chips — they name a compressor
    // wrapped around a tar, and TAR is the thing people say they have.
    // /qr-code-reader accepts PNG, JPG, WEBP, GIF and BMP, and those are not
    // chips either: someone holding a PNG is looking for the image hub, and a
    // chip here would send them to the wrong half of the site.
    //
    // XML, SQL, HTML and JWT are the four chips with no DropZone behind them —
    // /xml-formatter, /sql-formatter, /html-to-markdown and /jwt-decoder all
    // take pasted text. They are honest under "I HAVE A…" (you do have an XML
    // file; you paste it) but they are not accept-checkable, so the chip test
    // exempts exactly those four by name rather than skipping this whole hub.
    formats: [
      "JSON",
      "YAML",
      "CSV",
      "XLSX",
      "XML",
      "SQL",
      "MD",
      "HTML",
      "TXT",
      "JWT",
      "HAR",
      "ZIP",
      "TAR",
      "7Z",
      "RAR",
      "SVG",
      "DOCX",
    ],
  },
];

export function getCategoryBySlug(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}
