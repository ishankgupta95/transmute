import { getToolBySlug } from "./tools";
import { getCategoryBySlug } from "./categories";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  /**
   * The one-line blurb the blog index shows under the title. `description` is
   * the SEO/meta lede reused in the page head and the article's own standfirst;
   * at index size it runs long. Where an `indexBlurb` exists the list prefers it.
   */
  indexBlurb?: string;
  /**
   * Overrides the tag derived from `primaryTool`'s category. Only for posts
   * whose subject is not the category their headline tool lives in — a label,
   * not a taxonomy entry.
   */
  tag?: string;
  publishedAt: string; // ISO date (YYYY-MM-DD)
  updatedAt?: string;
  readingTime: number; // minutes
  keywords: string[];
  /** Slug of the single tool this post is most directly about — used for back-links from the tool page. */
  primaryTool?: string;
  /** Tool slugs the post links to — used for the "Try it" rail and internal-link auditing. */
  relatedTools: string[];
}

export const posts: BlogPost[] = [
  {
    slug: "heic-vs-jpg",
    title: "HEIC vs JPG: Which Format Should You Use?",
    description:
      "HEIC files are half the size of JPGs at the same quality, but compatibility is uneven. Here's when to pick each — and how to convert without losing detail.",
    indexBlurb:
      "Half the size at the same quality, but uneven compatibility. When to pick each.",
    tag: "IMAGE FORMATS",
    publishedAt: "2026-05-03",
    readingTime: 9,
    keywords: [
      "heic vs jpg",
      "heic format",
      "iphone photo format",
      "heic compatibility",
      "convert heic",
    ],
    primaryTool: "heic-to-jpg",
    relatedTools: [
      "heic-to-jpg",
      "heic-to-pdf",
      "webp-to-jpg",
      "png-to-jpg",
      "compress-image",
      "jpg-to-webp",
      "exif-viewer",
      "avif-to-jpg",
    ],
  },
  {
    slug: "compress-images-without-losing-quality",
    title: "How to Compress Images Without Losing Quality",
    description:
      "A practical guide to image compression: what JPG quality really means, when to resize before compressing, and how to hit a target file size without obvious artifacts.",
    indexBlurb:
      "What JPG quality really means, when to resize first, and how to hit a target size cleanly.",
    publishedAt: "2026-05-03",
    readingTime: 11,
    keywords: [
      "compress images",
      "lossless compression",
      "image quality",
      "reduce image file size",
      "image optimization",
    ],
    primaryTool: "compress-image",
    relatedTools: [
      "compress-image",
      "compress-image-to-20kb",
      "compress-image-to-50kb",
      "compress-image-to-100kb",
      "compress-image-to-200kb",
      "compress-image-to-500kb",
      "compress-image-to-1mb",
      "compress-image-to-target-size",
      "resize-image-to-20kb",
      "resize-image-to-50kb",
      "resize-image-to-100kb",
      "photo-resizer-in-kb",
      "resize-image",
      "jpg-to-webp",
      "avif-to-jpg",
      "exif-viewer",
      "crop-image",
      "image-to-base64",
      "png-to-ico",
      "favicon-generator",
      "image-color-palette",
      /*
        Wave 4. `compress-png` belongs here more squarely than anywhere else:
        the body already names "re-packing PNG files" as one of the only two
        genuinely lossless things a compressor can do, and until now that
        sentence pointed at no tool on this site. The other two are the
        size-and-geometry siblings of the resize ladder this post already
        carries end to end.
      */
      "compress-png",
      "social-media-image-resizer",
      "change-image-dpi",
    ],
  },
  {
    slug: "modern-image-formats-webp-avif-jpeg-xl",
    title: "A Complete Guide to Modern Image Formats: WebP, AVIF, and JPEG XL",
    description:
      "WebP, AVIF, and JPEG XL all promise smaller files at higher quality than JPG. Here's how they actually compare — file size, browser support, and when to pick each.",
    indexBlurb:
      "What each format actually does, where support stands, and which one to reach for.",
    tag: "IMAGE FORMATS",
    publishedAt: "2026-05-03",
    readingTime: 14,
    keywords: [
      "webp vs avif",
      "jpeg xl",
      "modern image formats",
      "image format comparison",
      "next-gen image formats",
    ],
    primaryTool: "jpg-to-webp",
    relatedTools: [
      "jpg-to-webp",
      "png-to-webp",
      "webp-to-jpg",
      "webp-to-png",
      "webp-to-pdf",
      "pdf-to-webp",
      "avif-to-jpg",
      "heic-to-jpg",
      "jpg-to-png",
      "bmp-to-jpg",
      "tiff-to-jpg",
      "jfif-to-jpg",
      "svg-to-png",
      /*
        Wave 4's format fills, appended here rather than given a post of their
        own because every one of them IS this piece's subject — a pairwise
        conversion whose only interesting content is the caveat attached to
        that particular pair. Grouped as the article groups them: the two
        AVIF routes beside the AVIF section, the two SVG rasterisations
        beside svg-to-png, then the lossless targets and the HEIC route. The
        rail renders four, so length costs nothing on the page.
      */
      "avif-to-png",
      "avif-to-webp",
      "svg-to-jpg",
      "svg-to-webp",
      "tiff-to-png",
      "bmp-to-png",
      "ico-to-png",
      "heic-to-webp",
    ],
  },
  {
    slug: "how-to-merge-pdfs-in-browser",
    title: "How to Merge PDFs in Your Browser (No Upload Required)",
    // "keep bookmarks" was in this dek from the post's first day and was never
    // true: mergePdfs grafts pages into a fresh document and never reads
    // /Outlines, so a merged file has none — measured, output catalog after
    // mergePdfs contains no /Outlines key at all. The post's own body has said
    // so since the copy-honesty pass ("the outline tree does not survive the
    // copy"), and the merge FAQ says it too, so the dek was contradicting the
    // paragraph two inches below it — and, because this string is also the
    // meta/OG/JSON-LD description, advertising a capability to search for a
    // query the tool cannot answer. What the guide actually teaches is what
    // survives the copy and what does not; say that instead.
    description:
      "A step-by-step guide to combining PDFs locally — including how to reorder pages, what survives the merge and what does not, and how to handle large documents without sending anything to a server.",
    indexBlurb:
      "Combining documents without handing a contract to a stranger.",
    publishedAt: "2026-05-03",
    readingTime: 8,
    keywords: [
      "merge pdf",
      "combine pdf",
      "merge pdf in browser",
      "join pdf files",
      "no upload pdf merge",
    ],
    primaryTool: "merge-pdf",
    relatedTools: [
      "merge-pdf",
      "split-pdf",
      "pdf-page-reorder",
      "compress-pdf",
      "add-page-numbers",
      "pdf-to-jpg",
      "pdf-to-png",
      "images-to-pdf",
      "jpg-to-pdf",
      "png-to-pdf",
      "tiff-to-pdf",
      "rotate-pdf",
      "extract-pdf-pages",
      "delete-pdf-pages",
      "crop-pdf",
      "change-pdf-page-size",
    ],
  },
  {
    slug: "reduce-pdf-file-size-for-email",
    title: "Reduce PDF File Size for Email — 3 Practical Methods",
    description:
      "Most email providers cap attachments at 25 MB. Here are three browser-only ways to shrink a PDF: structural compression, image down-sampling, and page splitting.",
    indexBlurb:
      "Structural compression, image down-sampling and page splitting, in the order worth trying.",
    publishedAt: "2026-05-03",
    readingTime: 9,
    keywords: [
      "reduce pdf size",
      "compress pdf",
      "pdf for email",
      "pdf file size",
      "smaller pdf",
    ],
    primaryTool: "compress-pdf",
    relatedTools: [
      "compress-pdf",
      "recompress-pdf-images",
      "pdf-resizer",
      "split-pdf",
      "pdf-to-jpg",
      "merge-pdf",
      "images-to-pdf",
      "rotate-pdf",
      "delete-pdf-pages",
      /*
        Deliberately last. The render site slices this list to four after
        dropping `primaryTool`, and the heading it renders under is ALSO
        MENTIONED — a claim about the body, which does not name this tool. From
        position nine it makes no such claim, and what it does do is give
        /extract-images-from-pdf the "From the blog" back-link on its own page,
        pointing at the guide anyone with a photo-heavy PDF should read.
      */
      "extract-images-from-pdf",
    ],
  },
  {
    slug: "video-to-gif-tradeoffs",
    title: "Convert Video to GIF — Frame Rate, Size, and Quality Tradeoffs",
    description:
      "GIFs are larger than the videos they replace. Here's how frame rate, resolution, and palette size interact — and how to ship a small, sharp GIF without re-encoding twice.",
    indexBlurb:
      "Why every frame costs you bytes, and how to pick a palette that holds up.",
    publishedAt: "2026-05-03",
    readingTime: 10,
    keywords: [
      "video to gif",
      "gif quality",
      "gif file size",
      "convert mp4 to gif",
      "gif frame rate",
    ],
    primaryTool: "video-to-gif",
    relatedTools: [
      "video-to-gif",
      "video-trimmer",
      "compress-video",
      "mp4-to-mp3",
      "webm-to-mp4",
      // Same frame walk, no palette step: both reuse `playAndExtractFrames`
      // from video-to-gif.ts, which is exactly the "every frame costs you
      // bytes" arithmetic this piece works through.
      "video-to-images",
      "video-thumbnail",
    ],
  },
  {
    slug: "browser-based-developer-tools",
    title: "10 Free Browser-Based Developer Tools You Didn't Know Existed",
    description:
      "JSON formatting, regex testing, JWT decoding, hash generation — ten utilities every developer reaches for, all running locally in your browser with zero install.",
    indexBlurb:
      "JWT decoding, cron expressions, regex testing and more — none of it leaving your machine.",
    publishedAt: "2026-05-03",
    readingTime: 12,
    keywords: [
      "developer tools",
      "browser tools",
      "online dev tools",
      "free developer utilities",
      "web-based dev tools",
    ],
    primaryTool: "json-formatter",
    relatedTools: [
      "json-formatter",
      "regex-tester",
      "jwt-decoder",
      "hash-generator",
      "uuid-generator",
      "base64-encode-decode",
      "url-encode-decode",
      "timestamp-converter",
      "cron-expression-generator",
      "sql-formatter",
      "markdown-to-html",
      "html-to-markdown",
      "markdown-to-pdf",
      "xml-formatter",
      "csv-to-json",
      "json-to-csv",
      "text-diff",
      "text-case-converter",
      "word-counter",
      "html-entity-encode-decode",
      "lorem-ipsum-generator",
      "qr-code-generator",
      "color-picker",
      "css-gradient-generator",
      "box-shadow-generator",
      /*
        Wave 4's developer fills. `relatedTools` is the internal-link audit
        list and the rail renders only the first four, so length here costs
        nothing on the page — and every one of these is the piece's own
        subject: a utility a developer reaches for that would otherwise mean
        pasting a config, a token, a spreadsheet or a network log into a
        stranger's server. Grouped the way /developer-tools groups them.
      */
      "yaml-to-json",
      "json-to-yaml",
      "yaml-formatter",
      "json-minify",
      "sort-dedupe-lines",
      "crlf-lf",
      "xlsx-to-csv",
      "har-viewer",
      "charset-converter",
      "jwt-encoder",
      "hmac-generator",
      "file-checksum",
      "wifi-qr-code",
      "chmod-calculator",
      "http-status-codes",
      "byte-converter",
      "timezone-converter",
      "aspect-ratio-calculator",
      "url-parser",
      /*
        Wave 4's second batch, same argument. Four of them are the file you
        least want to hand to a stranger's server, because you cannot see what
        is in it until it is open — an archive, or the .docx somebody else
        wrote. The other three are the work itself: an unreleased logo, a
        label about to be printed, and a code out of a photo whose payload
        nobody has read yet.
      */
      "extract-archive",
      "create-zip",
      "unzip-files",
      "docx-to-markdown",
      "svg-optimizer",
      "barcode-generator",
      "qr-code-reader",
    ],
  },
  {
    slug: "why-browser-based-tools-are-private",
    title: "Why Browser-Based Tools Are More Private Than Online Converters",
    description:
      "Most online converters upload your files to a server. Browser-based tools never do. Here's exactly what changes for your privacy — and how to verify it yourself.",
    indexBlurb:
      "What actually happens to a file when you upload it, and what happens when you do not.",
    tag: "PRIVACY",
    publishedAt: "2026-05-03",
    readingTime: 8,
    keywords: [
      "browser-based tools",
      "private file conversion",
      "no upload converter",
      "client-side processing",
      "privacy file converter",
    ],
    primaryTool: "compress-pdf",
    relatedTools: [
      "heic-to-jpg",
      "compress-pdf",
      "pdf-to-text",
      "crop-pdf",
      "jwt-decoder",
      "hash-generator",
      "password-generator",
      "mp3-to-wav",
      "wav-to-mp3",
      "m4a-to-mp3",
      "audio-trimmer",
      "merge-audio",
      // The three recorders together. Capture is the sharpest case the piece
      // makes: an uploader has your camera and microphone feed, and these do
      // not — the stream exists in the tab and in the file you save.
      "screen-recorder",
      "audio-recorder",
      "webcam-recorder",
      // The four pages that are handed a live credential. This piece argues
      // about what an upload costs you, and these are the sharpest cases on
      // the site: a HAR carries working session cookies and Authorization
      // headers, a Wi-Fi QR carries the passphrase, and the two signing pages
      // are given the shared secret itself. A hosted version of any of them
      // receives that in a form POST.
      "har-viewer",
      "wifi-qr-code",
      "jwt-encoder",
      "hmac-generator",
      // The reader belongs with them for the same reason from the other end.
      // Nobody types a credential into it, but a scanned square routinely
      // holds one — a Wi-Fi passphrase, a two-factor enrolment secret, a
      // session URL — and an uploader would have been sent the picture before
      // anyone knew what was in it.
      "qr-code-reader",
    ],
  },
  {
    slug: "password-protect-a-pdf-in-your-browser",
    title: "Password-Protecting a PDF: What the Password Actually Does",
    // The dek promises exactly the four things the body delivers, and one of
    // them is unflattering: permission flags are advisory and this site ships
    // the tool that removes them. Saying so in the meta description is the
    // point — it is what separates this from every other page on the subject,
    // and it stops the "restrict printing = nobody can print it" reader from
    // clicking through expecting a guarantee the format cannot give.
    description:
      "The difference between a user password and an owner password, why AES-256 is the one to pick, why permission flags are advisory rather than enforced, and why none of it needs an upload.",
    indexBlurb:
      "What a PDF password protects, what the restriction checkboxes do not, and the 127-byte trap.",
    publishedAt: "2026-09-03",
    readingTime: 9,
    keywords: [
      "password protect pdf",
      "pdf encryption",
      "pdf owner password",
      "pdf permissions",
      "remove pdf password",
    ],
    primaryTool: "protect-pdf",
    relatedTools: [
      "protect-pdf",
      "unlock-pdf",
      "pdf-permissions",
      "repair-pdf",
      "compress-pdf",
      "merge-pdf",
      "split-pdf",
      "pdf-to-text",
    ],
  },
  {
    slug: "container-swaps-without-re-encoding",
    title: "Container Swaps: Converting Video Without Re-Encoding It",
    // The dek names the measured ratio and the caveat in the same breath. The
    // caveat is the reason the article exists: the fast path is genuinely a
    // thousand times faster AND it silently produces the wrong file for an
    // H.265 iPhone recording, so a piece that only sold the speed would be
    // repeating the exact mistake the tools were built to stop making.
    description:
      "Most video 'conversions' only need the box around the file rewritten — milliseconds instead of minutes, and lossless. Here is when that works, and the iPhone case where it quietly does not.",
    indexBlurb:
      "Rewrapping is ~1,000× faster than re-encoding and lossless — except when it hands you a file that still won't play.",
    publishedAt: "2026-09-03",
    readingTime: 11,
    keywords: [
      "remux video",
      "convert video without re-encoding",
      "mov to mp4",
      "mkv to mp4",
      "rotate video without re-encoding",
    ],
    primaryTool: "video-to-mp4",
    relatedTools: [
      "video-to-mp4",
      "mov-to-mp4",
      "mp4-to-mov",
      "mkv-to-mp4",
      "mp4-to-mkv",
      "avi-to-mp4",
      "mute-video",
      "rotate-video",
      "video-trimmer",
      "webm-to-mp4",
      "compress-video",
      // Two more `-c copy` jobs, and the piece's caveat lands on both: a copy
      // cannot cut anywhere but a keyframe, and it cannot join clips whose
      // streams differ.
      "split-video",
      "merge-video",
    ],
  },
  {
    slug: "audio-formats-and-generational-loss",
    title: "Audio Formats and the Cost of Converting Between Them",
    // The dek leads with the thing every other "free audio converter" page
    // omits: converting lossy to lossy stacks a second round of damage on the
    // first. The article exists to name the three cases and say which of the
    // site's own tools falls into which — including the one that costs
    // nothing.
    description:
      "Converting MP3 to OGG to MP3 is not a format change, it is a second round of damage. Here is what each audio conversion actually costs, and the two that cost nothing.",
    indexBlurb:
      "Lossy to lossy stacks damage. Which audio conversions cost you something, and which genuinely do not.",
    publishedAt: "2026-09-04",
    readingTime: 10,
    keywords: [
      "audio format conversion",
      "generational loss audio",
      "lossy vs lossless",
      "convert audio in browser",
      "flac vs mp3",
    ],
    primaryTool: "mp3-converter",
    relatedTools: [
      "mp3-converter",
      "flac-to-mp3",
      "ogg-to-mp3",
      "aac-to-mp3",
      "opus-to-mp3",
      "wma-to-mp3",
      "m4a-to-wav",
      "wav-to-flac",
      "extract-audio",
      "video-to-wav",
      "mp4-to-wav",
      "wav-to-mp3",
      "mp3-to-wav",
      "m4a-to-mp3",
      /*
        The four audio-effects pages. Every one of them decodes and re-encodes,
        which is precisely this piece's subject: reverse-audio and
        change-audio-volume touch nothing but sample order and level, so their
        WAV and FLAC arms are the "costs nothing" case the dek names, while
        their MP3 arm is a second lossy generation. normalize-audio and
        remove-silence are re-encodes by construction — FFmpeg filters cannot
        stream-copy.
      */
      "normalize-audio",
      "change-audio-volume",
      "reverse-audio",
      "remove-silence",
    ],
  },
  {
    slug: "get-a-video-under-a-size-limit",
    title: "How to Get a Video Under 25 MB",
    description:
      "Email stops at 25 MB, WhatsApp at 16, Discord at 10. Here is the arithmetic that turns a size limit into a bitrate — and why the number is a target rather than a promise.",
    indexBlurb:
      "Turning somebody else's size limit into a bitrate, and why an encoder aims rather than lands.",
    publishedAt: "2026-09-04",
    readingTime: 8,
    keywords: [
      "compress video to 25mb",
      "video size limit",
      "compress video for discord",
      "whatsapp video size limit",
      "video bitrate for file size",
    ],
    primaryTool: "compress-video-to-size",
    /*
      The first four after the primary is filtered are what the ALSO MENTIONED
      rail renders, so all four are tools the body genuinely names and links:
      the preset sibling, the trim-first advice, the sidecar subtitle file, and
      the "you did not want the video" escape hatch.
    */
    relatedTools: [
      "compress-video",
      "video-trimmer",
      "subtitle-converter",
      "mp4-to-mp3",
      "compress-video-to-size",
      "webm-to-mp4",
      "video-to-gif",
    ],
  },
  {
    slug: "editing-images-without-an-editor",
    title: "Editing Images Without an Editor",
    // The dek names the mechanism and the one risk, because the risk is the
    // reason this piece exists. Seven of the eight operations it covers cost
    // you a re-encode and nothing else; pixelation looks like redaction and is
    // not, and a guide that listed it beside "add a border" without saying so
    // would be the exact failure the tools were written to avoid.
    description:
      "Rotate, flip, crop, border, watermark, pixelate, split. Every one is a decode, a draw and a re-encode — here is what that costs, and the one of them that is not the safety measure it looks like.",
    indexBlurb:
      "Eight one-shot edits, what each costs your pixels, and why pixelation is not redaction.",
    publishedAt: "2026-09-06",
    readingTime: 12,
    keywords: [
      "edit image in browser",
      "rotate image online",
      "pixelate image",
      "add border to image",
      "watermark image",
    ],
    primaryTool: "rotate-image",
    /*
      Ordered so the four the rail renders after `primaryTool` is filtered are
      the four the body spends the most words on — the EXIF section leads to
      flip, and pixelate, crop-circle and add-border are the three that carry a
      claim a reader could act on wrongly. Every slug below is named and linked
      in the article; `crop-image` is last because the body reaches for it once,
      as the escape hatch from pixelation, rather than teaching it.
    */
    relatedTools: [
      "rotate-image",
      "flip-image",
      "pixelate-image",
      "crop-circle",
      "add-border",
      "watermark-image",
      "image-splitter",
      "base64-to-image",
      "crop-image",
    ],
  },
  {
    slug: "pdf-forms-and-what-a-file-says-about-you",
    title: "PDF Forms, Flattening, and What a File Says About You",
    // The dek names the measured fact the piece is built on, because it is the
    // one thing a reader cannot find on the other pages about this subject:
    // clearing a PDF's /Info through the obvious setters leaves the XMP packet
    // naming the author, AND leaves the /Info keys themselves in place as empty
    // strings. A tool built the obvious way reports success over a document
    // that still names you, and this string is also the meta/OG/JSON-LD
    // description — so it says the unflattering half rather than promising a
    // clean the format does not give.
    description:
      "How a PDF form actually works, why flattening is permanent and is not redaction, and the measured reason clearing a document's properties leaves it still naming its author.",
    indexBlurb:
      "Filling, flattening, and the metadata that survives a clean that only touched /Info.",
    publishedAt: "2026-09-10",
    readingTime: 12,
    keywords: [
      "fill pdf form",
      "flatten pdf form",
      "remove pdf metadata",
      "pdf xmp metadata",
      "strip exif from photo",
    ],
    primaryTool: "fill-pdf-form",
    /*
      Every slug here is named and linked in the body. The rail renders the
      first four after `primaryTool` is filtered, which lands on the article's
      other two headline tools, the photo-metadata sibling the body sends you to
      for reading tags rather than removing them, and the "what does this
      document still say out loud" check. `compress-pdf` is last: the body
      reaches for it once, as the answer to "flattening did not make my file
      smaller", rather than teaching it.
    */
    relatedTools: [
      "fill-pdf-form",
      "flatten-pdf",
      "remove-metadata",
      "exif-viewer",
      "pdf-to-text",
      "compress-pdf",
    ],
  },
  {
    slug: "marking-up-a-pdf-without-uploading-it",
    title: "Marking Up a PDF Without Uploading It",
    // The dek promises the three limits the body actually delivers, and leads
    // with the unflattering one. That ordering is the point: "sign pdf" is the
    // query, a picture of a signature is what every tool in this category
    // ships, and almost none of them say so. A reader who arrives expecting a
    // certificate should learn that from the search result rather than from a
    // counterparty. The 218 is quoted because it is measured against this
    // repo's own pdf-lib, and a number a reader can check is worth more in a
    // meta description than an adjective.
    description:
      "Four ways to put something on a PDF page in your browser — a watermark, a signature, an image, a highlight. What each one writes into the file, why a drawn signature is not a digital signature, why a highlight is a rectangle rather than selected text, and the 218 characters a text stamp can draw.",
    indexBlurb:
      "A drawn signature is not a digital signature, a highlight is a rectangle, and a text stamp draws 218 characters.",
    publishedAt: "2026-09-10",
    readingTime: 16,
    keywords: [
      "sign pdf online",
      "drawn signature vs digital signature",
      "watermark a pdf",
      "annotate pdf",
      "add image to pdf",
    ],
    primaryTool: "sign-pdf",
    /*
      Every slug is named and linked in the body. The four stamping pages come
      first so the rail — which renders the first four after `primaryTool` is
      filtered — lands on the other three tools the article is about plus
      Protect PDF, which is where the "a watermark is a label, not a lock"
      section sends anyone who wanted a lock. The last four are the body's
      escape hatches, each reached once: unlock a file that cannot be read,
      type into real form fields instead of stamping over them, make those
      answers uneditable, and bake a page's rotation into the file.
    */
    relatedTools: [
      "sign-pdf",
      "watermark-pdf",
      "annotate-pdf",
      "add-image-to-pdf",
      "protect-pdf",
      "unlock-pdf",
      "fill-pdf-form",
      "flatten-pdf",
      "rotate-pdf",
          "pdf-editor",
    ],
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function getPostsByPrimaryTool(toolSlug: string): BlogPost | undefined {
  return posts.find((p) => p.primaryTool === toolSlug);
}

/**
 * Posts that mention this tool — the post for which the tool is the primary first,
 * then any other posts that include this tool in their relatedTools list.
 */
export function getPostsLinkingToTool(toolSlug: string): BlogPost[] {
  const primary = posts.find((p) => p.primaryTool === toolSlug);
  const others = posts.filter(
    (p) => p.primaryTool !== toolSlug && p.relatedTools.includes(toolSlug),
  );
  return primary ? [primary, ...others] : others;
}

/**
 * The short label shown beside a post's date. Derived from the tool the post is
 * most directly about, so it stays correct as the registry moves.
 */
export function postTag(post: BlogPost): string {
  if (post.tag) return post.tag;

  // The headline tool's category, when there is one. `relatedTools[0]` is only
  // a last resort: it is an internal-link list, not a subject, so a privacy
  // essay that happens to link HEIC to JPG first must not come out tagged IMAGE.
  const fromPrimary = post.primaryTool
    ? getToolBySlug(post.primaryTool)?.category
    : undefined;
  if (fromPrimary) {
    return (getCategoryBySlug(fromPrimary)?.shortName ?? "GUIDE").toUpperCase();
  }

  if (post.keywords.some((k) => k.includes("privacy"))) return "PRIVACY";

  const fromRelated = post.relatedTools[0]
    ? getToolBySlug(post.relatedTools[0])?.category
    : undefined;
  if (fromRelated) {
    return (getCategoryBySlug(fromRelated)?.shortName ?? "GUIDE").toUpperCase();
  }
  return "GUIDE";
}
