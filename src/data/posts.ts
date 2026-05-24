export interface BlogPost {
  slug: string;
  title: string;
  description: string;
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
      "webp-to-jpg",
      "png-to-jpg",
      "compress-image",
      "jpg-to-webp",
      "mp4-to-mp3",
      "video-trimmer",
      "exif-viewer",
      "avif-to-jpg",
    ],
  },
  {
    slug: "compress-images-without-losing-quality",
    title: "How to Compress Images Without Losing Quality",
    description:
      "A practical guide to image compression: what JPG quality really means, when to resize before compressing, and how to hit a target file size without obvious artifacts.",
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
      "compress-image-to-100kb",
      "compress-image-to-200kb",
      "compress-image-to-1mb",
      "resize-image",
      "jpg-to-webp",
      "avif-to-jpg",
      "exif-viewer",
      "crop-image",
      "image-to-base64",
      "png-to-ico",
      "favicon-generator",
      "image-color-palette",
    ],
  },
  {
    slug: "modern-image-formats-webp-avif-jpeg-xl",
    title: "A Complete Guide to Modern Image Formats: WebP, AVIF, and JPEG XL",
    description:
      "WebP, AVIF, and JPEG XL all promise smaller files at higher quality than JPG. Here's how they actually compare — file size, browser support, and when to pick each.",
    publishedAt: "2026-05-03",
    readingTime: 14,
    keywords: [
      "webp vs avif",
      "jpeg xl",
      "modern image formats",
      "image format comparison",
      "next-gen image formats",
    ],
    relatedTools: [
      "jpg-to-webp",
      "png-to-webp",
      "webp-to-jpg",
      "webp-to-png",
      "avif-to-jpg",
      "heic-to-jpg",
      "jpg-to-png",
      "bmp-to-jpg",
      "tiff-to-jpg",
      "svg-to-png",
    ],
  },
  {
    slug: "how-to-merge-pdfs-in-browser",
    title: "How to Merge PDFs in Your Browser (No Upload Required)",
    description:
      "A step-by-step guide to combining PDFs locally — including how to reorder pages, keep bookmarks, and handle large documents without sending anything to a server.",
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
      "images-to-pdf",
      "rotate-pdf",
    ],
  },
  {
    slug: "reduce-pdf-file-size-for-email",
    title: "Reduce PDF File Size for Email — 3 Practical Methods",
    description:
      "Most email providers cap attachments at 25 MB. Here are three browser-only ways to shrink a PDF: structural compression, image down-sampling, and page splitting.",
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
      "split-pdf",
      "pdf-to-jpg",
      "merge-pdf",
      "images-to-pdf",
      "rotate-pdf",
    ],
  },
  {
    slug: "video-to-gif-tradeoffs",
    title: "Convert Video to GIF — Frame Rate, Size, and Quality Tradeoffs",
    description:
      "GIFs are larger than the videos they replace. Here's how frame rate, resolution, and palette size interact — and how to ship a small, sharp GIF without re-encoding twice.",
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
    ],
  },
  {
    slug: "browser-based-developer-tools",
    title: "10 Free Browser-Based Developer Tools You Didn't Know Existed",
    description:
      "JSON formatting, regex testing, JWT decoding, hash generation — ten utilities every developer reaches for, all running locally in your browser with zero install.",
    publishedAt: "2026-05-03",
    readingTime: 12,
    keywords: [
      "developer tools",
      "browser tools",
      "online dev tools",
      "free developer utilities",
      "web-based dev tools",
    ],
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
    ],
  },
  {
    slug: "why-browser-based-tools-are-private",
    title: "Why Browser-Based Tools Are More Private Than Online Converters",
    description:
      "Most online converters upload your files to a server. Browser-based tools never do. Here's exactly what changes for your privacy — and how to verify it yourself.",
    publishedAt: "2026-05-03",
    readingTime: 8,
    keywords: [
      "browser-based tools",
      "private file conversion",
      "no upload converter",
      "client-side processing",
      "privacy file converter",
    ],
    relatedTools: [
      "heic-to-jpg",
      "compress-pdf",
      "jwt-decoder",
      "hash-generator",
      "password-generator",
      "mp3-to-wav",
      "wav-to-mp3",
      "m4a-to-mp3",
      "audio-trimmer",
      "merge-audio",
      "screen-recorder",
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
