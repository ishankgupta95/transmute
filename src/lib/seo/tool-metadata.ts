import type { Metadata } from "next";
import { getToolBySlug } from "@/data/tools";
import type { ToolType } from "@/data/tools";

const BASE_URL = "https://transmute.tools";

export const DEFAULT_HOW_TO_STEPS = [
  "Upload your file by dragging it into the drop zone or clicking to browse.",
  "Adjust the quality slider to balance file size and visual fidelity (optional).",
  "Click Download to save your converted file.",
];

const HOW_TO_STEPS_BY_TOOL_TYPE: Record<ToolType, string[]> = {
  // ── Image ────────────────────────────────────────────────────────
  "image-convert": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Adjust the quality slider to balance file size and visual fidelity (optional).",
    "Click Download to save your converted image.",
  ],
  "image-compress": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Adjust the quality slider or target size to control how aggressively to compress.",
    "Click Download to save your compressed image.",
  ],
  "image-resize": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Enter a target width or height — the aspect ratio is preserved automatically.",
    "Click Download to save your resized image.",
  ],
  "image-crop": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Drag the crop region to select the area you want to keep.",
    "Click Download to save your cropped image.",
  ],
  "exif-viewer": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "View the extracted EXIF metadata, including camera, lens, and GPS info.",
    "Optionally export the metadata as JSON.",
  ],
  "image-to-base64": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "The Base64 string and data URL are generated automatically.",
    "Copy the result and paste it directly into your CSS, HTML, or JSON.",
  ],
  "png-to-ico": [
    "Upload a PNG image by dragging it into the drop zone or clicking to browse.",
    "Choose which icon sizes to include (16, 32, 48, 64, 128, 256 px).",
    "Click Download to save the multi-resolution .ico file.",
  ],
  "favicon-generator": [
    "Upload a square image by dragging it into the drop zone or clicking to browse.",
    "Preview how the favicon looks at every standard size.",
    "Click Download to save the complete favicon package.",
  ],
  "color-palette": [
    "Upload an image by dragging it into the drop zone or clicking to browse.",
    "The dominant colors are extracted automatically.",
    "Click any swatch to copy its HEX, RGB, or HSL value.",
  ],
  "jfif-to-jpg": [
    "Upload your JFIF file by dragging it into the drop zone or clicking to browse.",
    "The tool verifies the bytes really are JPEG — a .jfif file already is one.",
    "Click Download to save the same bytes under a .jpg name — nothing is re-encoded.",
  ],

  // ── PDF ──────────────────────────────────────────────────────────
  "merge-pdf": [
    "Upload two or more PDFs by dragging them into the drop zone or clicking to browse.",
    "Drag the files to set the order they should appear in the merged PDF.",
    "Click Download to save the combined PDF.",
  ],
  "split-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Choose which pages or page ranges to extract.",
    "Click Download to save the resulting PDF(s).",
  ],
  "compress-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Pick a compression level to balance file size and quality.",
    "Click Download to save your compressed PDF.",
  ],
  "pdf-to-jpg": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Pick the output format and scale; a quality slider appears for the lossy formats.",
    "Convert, then download pages individually or all at once as a ZIP.",
  ],
  "images-to-pdf": [
    "Upload one or more images by dragging them into the drop zone or clicking to browse.",
    "Drag the images to set the page order.",
    "Click Download to save the combined PDF.",
  ],
  "rotate-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Rotate individual pages or the whole document by 90, 180, or 270 degrees.",
    "Click Download to save your rotated PDF.",
  ],
  "add-page-numbers": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Choose the position, format, and starting number for the page numbers.",
    "Click Download to save your numbered PDF.",
  ],
  "pdf-page-reorder": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Drag the page thumbnails to reorder them.",
    "Click Download to save the rearranged PDF.",
  ],
  "markdown-to-pdf": [
    "Paste your Markdown into the editor or upload a .md / .markdown / .txt file.",
    "Tweak the theme (Light / Dark) and font (Serif / Sans) — the live preview updates as you type.",
    "Click Export to PDF and choose 'Save as PDF' as the destination in your browser's print dialog.",
  ],

  // ── Audio ────────────────────────────────────────────────────────
  "mp3-to-wav": [
    "Upload your MP3 by dragging it into the drop zone or clicking to browse.",
    "Click Convert to decode and re-encode as WAV — everything runs locally.",
    "Click Download to save your WAV file.",
  ],
  "wav-to-mp3": [
    "Upload your WAV by dragging it into the drop zone or clicking to browse.",
    "Click Convert to encode as MP3 — everything runs locally in your browser.",
    "Click Download to save your MP3 file.",
  ],
  "m4a-to-mp3": [
    "Upload your M4A by dragging it into the drop zone or clicking to browse.",
    "Click Convert to re-encode as MP3 — everything runs locally in your browser.",
    "Click Download to save your MP3 file.",
  ],
  "audio-trimmer": [
    "Upload your audio file by dragging it into the drop zone or clicking to browse.",
    "Drag the start and end handles to set the trim range.",
    "Click Download to save the trimmed clip.",
  ],
  "merge-audio": [
    "Upload two or more audio files by dragging them into the drop zone or clicking to browse.",
    "Drag the tracks to set the order they should play in.",
    "Click Download to save the merged audio file.",
  ],

  // ── Video ────────────────────────────────────────────────────────
  "video-to-gif": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Choose the start time, duration, frame rate, and resolution for the GIF.",
    "Click Download to save your animated GIF.",
  ],
  "video-trimmer": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Set the clip start and end times, then click Trim.",
    "Click Download to save the trimmed video.",
  ],
  "mp4-to-mp3": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "The audio track is extracted and encoded as MP3 in your browser.",
    "Click Download to save the resulting MP3.",
  ],
  "webm-to-mp4": [
    "Upload your WebM video by dragging it into the drop zone or clicking to browse.",
    "Click Convert to MP4 — the video is re-encoded to H.264 so it plays anywhere.",
    "Click Download to save your MP4.",
  ],
  "compress-video": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Pick a preset — WhatsApp, Email, or Web — then click Compress.",
    "Click Download to save your compressed video.",
  ],
  "screen-recorder": [
    "Choose whether to include microphone audio, then click Start Recording.",
    "Pick the screen, window, or tab to capture in the browser prompt.",
    "Click Stop when you're done, then download the recorded video.",
  ],

  // ── Developer: text-input ─────────────────────────────────────────
  "json-formatter": [
    "Paste your JSON into the input area.",
    "Choose Format to pretty-print or Minify to strip whitespace.",
    "Copy the result with one click.",
  ],
  "json-to-csv": [
    "Paste your JSON array into the input area.",
    "Click Convert to CSV to process the data — no row limits.",
    "Copy or download the resulting CSV.",
  ],
  "csv-to-json": [
    "Paste your CSV (with or without a header row) into the input area.",
    "Click Convert to JSON to parse the rows into an array.",
    "Copy or download the resulting JSON.",
  ],
  "sql-formatter": [
    "Paste your SQL query into the input area and pick a dialect.",
    "Click Format SQL to reformat with consistent indentation and keyword casing.",
    "Copy the formatted SQL with one click.",
  ],
  "markdown-to-html": [
    "Paste your Markdown into the input area.",
    "The HTML preview updates as you type.",
    "Copy the rendered HTML with one click.",
  ],
  "html-to-markdown": [
    "Paste your HTML into the input area.",
    "Click Convert to Markdown to generate the equivalent Markdown.",
    "Copy the resulting Markdown with one click.",
  ],
  "xml-formatter": [
    "Paste your XML into the input area.",
    "Click Format XML (or Minify XML) to reformat the document.",
    "Copy the result with one click.",
  ],
  "base64-encode-decode": [
    "Paste your text or Base64 string into the input area.",
    "Choose whether to encode or decode.",
    "Copy the result with one click.",
  ],
  "url-encode-decode": [
    "Paste your URL or component string into the input area.",
    "Choose whether to encode or decode.",
    "Copy the result with one click.",
  ],
  "jwt-decoder": [
    "Paste your JWT into the input area.",
    "The header, payload, and signature are decoded automatically.",
    "Inspect the claims — the token never leaves your browser.",
  ],
  "html-entity-encode-decode": [
    "Paste your text or encoded entities into the input area.",
    "Choose whether to encode or decode.",
    "Copy the result with one click.",
  ],

  // ── Developer: generators ─────────────────────────────────────────
  "uuid-generator": [
    "Choose UUID v4 or v7 and how many to generate.",
    "Click Generate to create the IDs.",
    "Copy any individual UUID or all of them at once.",
  ],
  "password-generator": [
    "Set the desired length and which character types to include.",
    "Click Generate to create a new password.",
    "Copy the password to your clipboard with one click.",
  ],
  "hash-generator": [
    "Type or paste your text into the input area.",
    "MD5, SHA-1, SHA-256, and SHA-512 hashes are computed automatically.",
    "Copy any hash with one click.",
  ],
  "lorem-ipsum-generator": [
    "Choose how many paragraphs, sentences, or words you need.",
    "Click Generate to create the placeholder text.",
    "Copy the result with one click.",
  ],
  "qr-code-generator": [
    "Type or paste the text, URL, or contact info you want to encode.",
    "Customize the colors and size if desired.",
    "Click Download to save the QR code as PNG or SVG.",
  ],
  "color-picker": [
    "Pick a color using the swatch or enter a HEX, RGB, or HSL value.",
    "The other formats update automatically.",
    "Click any value to copy it to your clipboard.",
  ],
  "css-gradient-generator": [
    "Configure the gradient direction, colors, and stops.",
    "Preview the gradient live as you tweak it.",
    "Copy the generated CSS with one click.",
  ],
  "box-shadow-generator": [
    "Adjust the offset, blur, spread, and color sliders.",
    "Preview the shadow on a sample element in real time.",
    "Copy the generated CSS with one click.",
  ],
  "cron-expression-generator": [
    "Build the schedule using the visual editor.",
    "The cron expression and a plain-English description update as you go.",
    "Copy the expression with one click.",
  ],

  // ── Developer: other ──────────────────────────────────────────────
  "regex-tester": [
    "Enter a regex pattern and toggle the flags you need.",
    "Paste a test string — matches and capture groups are highlighted live.",
    "Copy the pattern when it matches what you expect.",
  ],
  "timestamp-converter": [
    "Paste a Unix timestamp or pick a date and time.",
    "The other format updates automatically across multiple time zones.",
    "Copy any value with one click.",
  ],
  "text-diff": [
    "Paste the original text on the left and the changed text on the right.",
    "Differences are highlighted line by line as you type.",
    "Copy or share the diff result.",
  ],
  "text-case-converter": [
    "Paste your text into the input area.",
    "Click a case style (upper, lower, title, camel, snake, kebab, and more) to convert.",
    "Copy the converted text with one click.",
  ],
  "word-counter": [
    "Paste your text into the input area.",
    "Word, character, sentence, and reading-time stats update as you type.",
    "Copy the stats or your text with one click.",
  ],
};

export function getHowToSteps(toolType: ToolType): string[] {
  return HOW_TO_STEPS_BY_TOOL_TYPE[toolType] ?? DEFAULT_HOW_TO_STEPS;
}

export function getToolMetadata(slug: string): Metadata {
  const tool = getToolBySlug(slug);
  if (!tool) {
    return { title: "Tool Not Found" };
  }

  return {
    // Plain string — the root layout's title.template adds " | Transmute".
    // Returning "... | Transmute" here produced a doubled "| Transmute | Transmute".
    title: tool.titleTag ?? tool.h1,
    description: tool.description,
    keywords: tool.keywords,
    alternates: {
      // Relative on purpose — layout.tsx's metadataBase absolutises it, same
      // as every other page (verified in the export: full https URLs).
      canonical: `/${tool.slug}`,
    },
    openGraph: {
      title: `${tool.name} | Transmute`,
      description: tool.description,
      url: `${BASE_URL}/${tool.slug}`,
      siteName: "Transmute",
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: `${tool.name} — free, browser-based tool on Transmute`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${tool.name} | Transmute`,
      description: tool.description,
      images: ["/og-image.png"],
    },
  };
}
