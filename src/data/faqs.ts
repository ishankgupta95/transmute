export interface FAQ {
  question: string;
  answer: string;
}

export type ToolFAQs = Record<string, FAQ[]>;

export const PRIVACY_FAQ: FAQ = {
  question: "Is my file uploaded to a server?",
  answer: "No. Transmute processes everything locally in your browser using JavaScript and the Canvas API. Your files never leave your device — there is no server, no upload, no cloud processing.",
};

export const faqs: ToolFAQs = {
  "heic-to-jpg": [
    {
      question: "What is a HEIC file?",
      answer: "HEIC (High Efficiency Image Container) is the default photo format on iPhones and iPads since iOS 11. It offers roughly 50% better compression than JPG while maintaining similar quality.",
    },
    {
      question: "Does converting HEIC to JPG lose quality?",
      answer: "There is minimal quality loss when converting to JPG. You can adjust the quality slider to balance file size and visual fidelity — 85-90% quality is usually indistinguishable from the original.",
    },
    {
      question: "Can I convert multiple HEIC files at once?",
      answer: "Yes. You can drag and drop multiple HEIC files and they will all be converted. Each file is processed independently in your browser.",
    },
    {
      question: "Why can't I open HEIC files on my PC?",
      answer: "Windows doesn't natively support HEIC without installing the HEIF Image Extensions from the Microsoft Store. Converting to JPG is the quickest way to make your iPhone photos viewable everywhere.",
    },
  ],
  "webp-to-jpg": [
    {
      question: "What is WebP?",
      answer: "WebP is a modern image format developed by Google. It provides superior compression to both JPG and PNG, resulting in smaller file sizes at similar quality. Most websites use WebP to speed up page loading.",
    },
    {
      question: "Why convert WebP to JPG?",
      answer: "While all modern browsers support WebP, some older software, email clients, and image editors don't. JPG is universally supported on every device and application.",
    },
    {
      question: "Does converting WebP to JPG increase file size?",
      answer: "Usually yes, because JPG compression is less efficient than WebP. The file may be 20-40% larger, but it will be compatible everywhere. Adjust the quality slider to control the trade-off.",
    },
  ],
  "webp-to-png": [
    {
      question: "Does WebP to PNG preserve transparency?",
      answer: "Yes. If your WebP image has transparent areas, they are preserved when converting to PNG. PNG fully supports alpha channel transparency.",
    },
    {
      question: "Will converting WebP to PNG increase file size?",
      answer: "Yes, PNG files are typically larger than WebP because PNG uses less aggressive compression. However, PNG is lossless — no quality is lost during conversion.",
    },
    {
      question: "When should I use PNG instead of WebP?",
      answer: "Use PNG when you need lossless quality, full transparency support, or compatibility with software that doesn't support WebP — such as some image editors, print workflows, or older applications.",
    },
  ],
  "png-to-jpg": [
    {
      question: "Why convert PNG to JPG?",
      answer: "JPG files are typically 60-80% smaller than PNGs for photographs. If your image doesn't need transparency, converting to JPG dramatically reduces file size — great for email attachments, social media, or web use.",
    },
    {
      question: "Does PNG to JPG lose transparency?",
      answer: "Yes. JPG does not support transparency. Transparent areas in your PNG will be filled with a white background. If you need to keep transparency, consider WebP instead.",
    },
    {
      question: "What quality setting should I use?",
      answer: "For photographs, 80-85% quality is a good balance of size and quality. For images with text or sharp edges, use 90-95% to avoid compression artifacts around edges.",
    },
  ],
  "jpg-to-png": [
    {
      question: "Why convert JPG to PNG?",
      answer: "PNG is a lossless format — converting to PNG prevents further quality degradation if you plan to edit the image multiple times. PNG also supports transparency, which JPG does not.",
    },
    {
      question: "Will the file be larger after converting to PNG?",
      answer: "Yes, PNG files are typically 2-5x larger than JPGs for photographs because PNG uses lossless compression. This is the trade-off for zero additional quality loss.",
    },
    {
      question: "Can I add transparency after converting to PNG?",
      answer: "The conversion itself doesn't add transparency — it converts all pixels as-is. But since the result is now a PNG, you can open it in an image editor and add transparency by removing the background.",
    },
  ],
  "jpg-to-webp": [
    {
      question: "How much smaller will my WebP file be?",
      answer: "WebP files are typically 25-35% smaller than equivalent JPG files at the same visual quality. For a 1 MB JPG, you can expect a WebP around 650-750 KB.",
    },
    {
      question: "Do all browsers support WebP?",
      answer: "Yes, all modern browsers — Chrome, Firefox, Safari, Edge, and Opera — support WebP. The only browsers that don't are Internet Explorer and very old versions of Safari (pre-14).",
    },
    {
      question: "Should I use WebP for my website?",
      answer: "Absolutely. WebP is the recommended image format for the web. It offers the best balance of quality and file size, directly improving page load times and Core Web Vitals scores.",
    },
  ],
  "png-to-webp": [
    {
      question: "How much smaller is WebP compared to PNG?",
      answer: "WebP files can be 60-80% smaller than PNGs, especially for photographs. For graphics with flat colors, the savings are typically 30-50%. Either way, you'll see significant size reduction.",
    },
    {
      question: "Does WebP support transparency like PNG?",
      answer: "Yes! WebP supports alpha channel transparency just like PNG, but with much better compression. It's the best of both worlds — small files with full transparency support.",
    },
    {
      question: "Is converting PNG to WebP lossy?",
      answer: "By default, the conversion uses lossy WebP compression (like JPG). You can increase the quality slider to maximum for near-lossless results, though the file will be larger.",
    },
  ],
  "svg-to-png": [
    {
      question: "What resolution should I export at?",
      answer: "For web use, export at 1x (e.g. 200×200 for a 200px icon) or 2x for retina displays. For print, export at 300 DPI equivalent — multiply your desired print size in inches by 300.",
    },
    {
      question: "Can I set custom dimensions for the PNG?",
      answer: "Yes. Since SVG is a vector format, you can export it at any resolution without quality loss. Enter your desired width and height, or leave them blank to use the SVG's default dimensions.",
    },
    {
      question: "Why can't I use SVG directly?",
      answer: "While SVGs work great on the web, many platforms — social media, messaging apps, email, document editors — require raster formats like PNG. Converting SVG to PNG lets you use your graphics anywhere.",
    },
    {
      question: "Will the PNG look blurry?",
      answer: "No, as long as you export at the right resolution. Since the source is a vector, the PNG will be perfectly crisp. For high-DPI screens, export at 2x or 3x your display size.",
    },
  ],
  "avif-to-jpg": [
    {
      question: "What is AVIF?",
      answer: "AVIF (AV1 Image File Format) is a next-generation image format based on the AV1 video codec. It offers up to 50% better compression than JPG and 20% better than WebP, making it ideal for the web.",
    },
    {
      question: "Does my browser support AVIF?",
      answer: "Chrome (85+), Firefox (93+), and Safari (16.4+) all support AVIF. If your browser can load this page, it very likely supports AVIF decoding. The conversion uses your browser's native decoding.",
    },
    {
      question: "Why convert AVIF to JPG?",
      answer: "While AVIF offers superior compression, many older applications, image editors, and platforms don't support it yet. Converting to JPG ensures your images work everywhere.",
    },
  ],
  "bmp-to-jpg": [
    {
      question: "Why are BMP files so large?",
      answer: "BMP (Bitmap) stores every pixel's color data without any compression. A 12-megapixel photo can be over 36 MB as a BMP. Converting to JPG applies lossy compression that typically reduces size by 90% or more.",
    },
    {
      question: "Will I lose quality converting BMP to JPG?",
      answer: "JPG uses lossy compression, so there is some quality reduction. However, at 85-90% quality, the difference is virtually invisible to the human eye while the file size drops dramatically.",
    },
    {
      question: "Where do BMP files come from?",
      answer: "BMP files are common in legacy Windows applications, screenshots from older software, scanned documents, and certain embedded systems. They're rarely used today because of their enormous file size.",
    },
  ],
  "compress-image": [
    {
      question: "How does image compression work?",
      answer: "This tool re-encodes your image as a JPEG with adjustable quality. Lower quality means smaller files but more compression artifacts. In target-size mode, the tool uses binary search to find the optimal quality that produces a file at or under your target size.",
    },
    {
      question: "What's the difference between quality mode and target-size mode?",
      answer: "Quality mode lets you set a specific quality level (e.g., 80%) and see the resulting file size. Target-size mode lets you specify an exact file size (e.g., 100 KB) and the tool automatically finds the best quality that fits within that limit.",
    },
    {
      question: "Can I compress multiple images at once?",
      answer: "Yes! You can drag and drop multiple images and they will all be compressed with the same settings. Each result shows the original and compressed size.",
    },
  ],
  "compress-image-to-100kb": [
    {
      question: "Why do I need to compress to 100 KB?",
      answer: "Many websites, email providers, and online forms have a 100 KB file size limit for image uploads. Passport applications, visa forms, and government websites often have this restriction.",
    },
    {
      question: "Will my image look bad at 100 KB?",
      answer: "It depends on the image dimensions. A small image (under 1000px) can look great at 100 KB. For larger images, you may notice some quality loss. The tool finds the best possible quality that fits within the limit.",
    },
    {
      question: "Which input formats can I compress?",
      answer: "JPG, PNG, WebP, and AVIF are all accepted. The output is JPG by default because JPG hits target sizes most reliably; for transparency, switch to WebP.",
    },
  ],
  "compress-image-to-200kb": [
    {
      question: "When would I need to compress to 200 KB?",
      answer: "Many job application portals, university admission forms, and document upload systems cap images at 200 KB. This is also a good target for email signatures and web thumbnails.",
    },
    {
      question: "Will my image look good at 200 KB?",
      answer: "For most photos under 2000px wide, 200 KB produces very good quality. The tool automatically finds the highest quality level that fits within the limit.",
    },
    {
      question: "What image formats can I compress?",
      answer: "You can upload JPG, PNG, WebP, HEIC, BMP, and other common image formats. The compressed output is saved as JPEG, which offers the best compression for photographs.",
    },
  ],
  "compress-image-to-1mb": [
    {
      question: "Why compress to 1 MB?",
      answer: "Social media platforms like WhatsApp, some email providers, and many CMS platforms have a 1 MB limit for image uploads. This size offers a good balance between quality and file size for most photos.",
    },
    {
      question: "Will a 1 MB image look good?",
      answer: "Yes. At 1 MB, most photos retain excellent quality with no visible artifacts. This size is sufficient for high-resolution images up to about 4000px wide.",
    },
    {
      question: "What if my image is already under 1 MB?",
      answer: "If your image is already smaller than 1 MB, the tool will still process it but the output may be similar in size to the original. There is no benefit to compressing an already-small file.",
    },
  ],
  "resize-image": [
    {
      question: "What is Lanczos3 resampling?",
      answer: "Lanczos3 is a high-quality image resampling algorithm that produces sharp, artifact-free results when scaling images up or down. It's the same algorithm used by professional image editors like Photoshop.",
    },
    {
      question: "Will resizing make my image blurry?",
      answer: "Downscaling (making smaller) always looks great with Lanczos3 resampling. Upscaling (making larger) preserves detail well but cannot add information that isn't in the original — very large upscales may appear slightly soft.",
    },
    {
      question: "What dimensions should I use for social media?",
      answer: "Use the preset buttons: Instagram Post is 1080×1080, Instagram Story is 1080×1920, Twitter Header is 1500×500, LinkedIn Banner is 1584×396, YouTube Thumbnail is 1280×720.",
    },
  ],
  "crop-image": [
    {
      question: "How do I crop to a specific aspect ratio?",
      answer: "Click one of the aspect ratio buttons (1:1, 4:3, 16:9, 3:2) above the crop area. The crop selection will lock to that ratio. Choose 'Free' to crop without any ratio constraint.",
    },
    {
      question: "Can I rotate the image before cropping?",
      answer: "Yes! Use the rotation slider below the crop area to rotate the image from -180° to 180°. The crop area adjusts automatically.",
    },
    {
      question: "What format is the cropped image saved in?",
      answer: "Cropped images are saved as PNG to preserve quality and support transparency. If you need a different format, use our image converter tools after cropping.",
    },
  ],
  "exif-viewer": [
    {
      question: "What is EXIF data?",
      answer: "EXIF (Exchangeable Image File Format) is metadata embedded in photos by cameras and phones. It includes camera model, lens info, shutter speed, ISO, aperture, GPS coordinates, date/time, and more.",
    },
    {
      question: "Why should I remove EXIF data?",
      answer: "EXIF data can contain your exact GPS location, device information, and timestamps. Removing it before sharing photos online protects your privacy. Social media platforms strip some EXIF data, but not all services do.",
    },
    {
      question: "How does metadata removal work?",
      answer: "The image is re-encoded through the HTML5 Canvas API, which only preserves pixel data. All metadata — EXIF, IPTC, XMP, ICC profiles — is naturally stripped during this re-encoding process.",
    },
  ],
  "image-to-base64": [
    {
      question: "What is Base64 encoding?",
      answer: "Base64 is a way to represent binary data (like images) as a text string. This allows you to embed images directly in HTML, CSS, or JSON without needing a separate file. It's commonly used for small icons, logos, and email templates.",
    },
    {
      question: "When should I use Base64 images?",
      answer: "Base64 is ideal for very small images (under 10 KB) like icons and logos. For larger images, it's better to use regular image files because Base64 increases the data size by about 33%.",
    },
    {
      question: "What's the difference between Data URI and Raw Base64?",
      answer: "A Data URI includes the MIME type prefix (e.g., data:image/png;base64,...) and can be used directly in HTML <img> tags. Raw Base64 is just the encoded string without the prefix.",
    },
  ],
  "png-to-ico": [
    {
      question: "What is an ICO file?",
      answer: "ICO (Icon) is a file format that contains one or more images at multiple sizes and color depths. It's the standard format for website favicons (the small icon in browser tabs) and Windows desktop icons.",
    },
    {
      question: "What sizes are included in the ICO file?",
      answer: "The generated ICO file contains three sizes: 16×16 (browser tab), 32×32 (browser tab on high-DPI), and 48×48 (Windows shortcut). These cover all standard favicon use cases.",
    },
    {
      question: "Where do I install the favicon on my site?",
      answer: "Drop the .ico file at the root of your domain as /favicon.ico — browsers request it automatically. For full coverage, also add <link rel=\"icon\" href=\"/favicon.ico\" sizes=\"any\"> to your HTML <head>.",
    },
  ],
  "favicon-generator": [
    {
      question: "What sizes do I need for favicons?",
      answer: "A complete favicon set includes: 16×16 and 32×32 for browser tabs, 48×48 for Windows, 180×180 for Apple Touch (iOS home screen), and 192×192 + 512×512 for Progressive Web Apps (PWA).",
    },
    {
      question: "What's in the ZIP download?",
      answer: "The ZIP contains all PNG sizes (favicon-16x16.png, favicon-32x32.png, favicon-48x48.png, apple-touch-icon.png, android-chrome-192x192.png, android-chrome-512x512.png) plus a favicon.ico file containing all three small sizes.",
    },
    {
      question: "What image should I upload?",
      answer: "Upload a square image at least 512×512 pixels. PNG with a transparent background works best. Simple designs with bold shapes work better than photographs because favicons are very small.",
    },
  ],
  "image-color-palette": [
    {
      question: "How does color extraction work?",
      answer: "The tool samples your image, then uses median-cut color quantization to group similar pixels together and find the most dominant colors. Each color's frequency indicates what percentage of the image it represents.",
    },
    {
      question: "How many colors can I extract?",
      answer: "You can choose to extract 4, 6, 8, 10, or 12 colors. Fewer colors gives you the most dominant themes; more colors captures subtle variations.",
    },
    {
      question: "Can I copy the color codes?",
      answer: "Yes! Click any color swatch to copy its hex code to your clipboard. Each color also shows its RGB values and frequency percentage.",
    },
  ],
  "tiff-to-jpg": [
    {
      question: "What is TIFF used for?",
      answer: "TIFF (Tagged Image File Format) is commonly used in photography, publishing, scanning, and archival. It supports high color depths, multiple layers, and lossless compression — but produces large files.",
    },
    {
      question: "Can browsers normally open TIFF files?",
      answer: "No, most web browsers cannot display TIFF images natively. This tool uses the utif2 library to decode the TIFF data in your browser, then re-encodes it as a widely compatible JPG.",
    },
    {
      question: "Will converting TIFF to JPG lose quality?",
      answer: "Some quality is lost because JPG uses lossy compression while TIFF is typically lossless. For most uses, setting the quality slider to 90-95% produces results that are visually identical to the original.",
    },
    {
      question: "Does this support multi-page TIFFs?",
      answer: "Currently, this tool converts the first page of a multi-page TIFF. For multi-page documents, consider splitting the TIFF into individual pages first.",
    },
  ],

  // ── Developer Tools FAQs ─────────────────────────────────────────
  "json-formatter": [
    { question: "Is my JSON data sent to a server?", answer: "No. All formatting happens in your browser using JSON.parse and JSON.stringify. No data leaves your device." },
    { question: "What's the difference between Format and Minify?", answer: "Format adds indentation and line breaks for readability. Minify removes all whitespace to produce the smallest possible output — useful for APIs and configuration files." },
    { question: "Can it handle large JSON files?", answer: "It works well for JSON up to a few megabytes. Very large files may cause the browser tab to slow down due to rendering the formatted output." },
  ],
  "base64-encode-decode": [
    { question: "Is my data sent to a server?", answer: "No. Encoding and decoding happen entirely in your browser using the built-in btoa/atob functions and TextEncoder/TextDecoder APIs." },
    { question: "Can I encode files to Base64?", answer: "Yes. Switch to File mode when encoding to upload any file and get its Base64 representation." },
    { question: "Does it handle Unicode text?", answer: "Yes. The tool uses TextEncoder/TextDecoder to properly handle UTF-8 characters including emoji, CJK characters, and other non-ASCII text." },
  ],
  "jwt-decoder": [
    { question: "Can this tool verify JWT signatures?", answer: "This tool decodes and displays the JWT header and payload, and checks expiration. It does not verify cryptographic signatures — that requires the signing secret or public key, which should never be pasted into a web tool." },
    { question: "Is my JWT token sent to a server?", answer: "No. The decoding happens entirely in your browser. Your token never leaves your device." },
    { question: "What are the three parts of a JWT?", answer: "A JWT is three Base64URL-encoded segments separated by dots: header (algorithm and token type), payload (your claims like sub, iat, exp), and signature (the HMAC or RSA signature over the first two segments)." },
  ],
  "uuid-generator": [
    { question: "What's the difference between UUID v4 and v7?", answer: "UUID v4 is fully random. UUID v7 is time-ordered — the first 48 bits encode a millisecond timestamp, making it ideal for database primary keys because it preserves insertion order and improves index performance." },
    { question: "Are the UUIDs cryptographically random?", answer: "Yes. Both versions use the Web Crypto API (crypto.getRandomValues) for their random components." },
    { question: "Are collisions a real concern?", answer: "Practically, no. UUID v4 has 122 bits of randomness — you would need to generate roughly a billion UUIDs per second for a hundred years before a single collision becomes likely. Treat them as unique." },
  ],
  "password-generator": [
    { question: "Are generated passwords stored anywhere?", answer: "No. Passwords are generated using the Web Crypto API in your browser and are never stored or transmitted. Close the tab and they're gone." },
    { question: "What does the strength meter measure?", answer: "It calculates the entropy (randomness) of the password based on its length and the character pool size. Higher entropy means more possible combinations and a stronger password." },
    { question: "How long should my password be?", answer: "For most accounts, 16 characters with mixed case, digits, and symbols puts you well past 80 bits of entropy — comfortably out of reach of brute force. For high-value accounts or master passwords, aim for 24+ characters." },
  ],
  "hash-generator": [
    { question: "Is my data sent to a server?", answer: "No. SHA hashes are computed using the Web Crypto API and MD5 using the js-md5 library — both run entirely in your browser." },
    { question: "Which hash algorithm should I use?", answer: "SHA-256 is the most widely used for checksums and data integrity. SHA-512 provides more security. MD5 and SHA-1 are considered cryptographically broken and should only be used for non-security purposes like checksums." },
    { question: "Can I verify a downloaded file's checksum here?", answer: "Yes. Paste or drop the file into the input area, pick the algorithm the publisher specified (usually SHA-256), and compare the resulting hash against their published value. Matching hashes mean the file was not tampered with in transit." },
  ],
  "regex-tester": [
    { question: "Which regex flavor does this use?", answer: "It uses JavaScript's built-in RegExp engine, which follows the ECMAScript specification. This is the same regex flavor used in Node.js, browsers, and most JavaScript frameworks." },
    { question: "What do the flag buttons mean?", answer: "g = global (find all matches), i = case-insensitive, m = multiline (^ and $ match line boundaries), s = dotAll (. matches newlines), u = Unicode." },
    { question: "Can I use named capture groups?", answer: "Yes. JavaScript regex supports named groups via (?<name>...). The matched group appears in the results panel labelled with its name, alongside numeric capture groups." },
  ],
  "qr-code-generator": [
    { question: "Is my data sent to a server?", answer: "No. QR codes are generated entirely in your browser using the qrcode library." },
    { question: "What's the maximum text length for a QR code?", answer: "QR codes can encode up to about 4,296 alphanumeric characters or 2,953 bytes. In practice, keeping content under 500 characters ensures reliable scanning." },
    { question: "Can I customize the foreground and background colors?", answer: "Yes — both colors are configurable. Just keep enough contrast between them: scanners need a clear difference in luminance to detect the modules. Avoid light-on-light or busy backgrounds." },
  ],
  "timestamp-converter": [
    { question: "What timezone is used?", answer: "Unix timestamps are timezone-independent (they represent seconds since 1970-01-01 UTC). The human-readable output uses your browser's local timezone." },
    { question: "What's the difference between seconds and milliseconds?", answer: "Unix timestamps in seconds are 10 digits (e.g., 1700000000). Milliseconds are 13 digits (e.g., 1700000000000). JavaScript's Date.now() returns milliseconds." },
    { question: "What is ISO 8601 and when should I use it?", answer: "ISO 8601 is the international standard for representing dates and times as a string, like 2026-05-03T14:30:00Z. Use it whenever a date crosses a system or API boundary — it removes any ambiguity about format or time zone." },
  ],
  "color-picker": [
    { question: "What color formats are supported?", answer: "HEX (#RRGGBB), RGB (0-255 per channel), and HSL (hue 0-360°, saturation 0-100%, lightness 0-100%). All formats update in sync." },
    { question: "Why use HSL instead of HEX or RGB?", answer: "HSL separates hue from saturation and lightness, so you can dial in a tint or shade without re-mixing the entire color. Designers prefer it for building palettes, hover states, and accessible contrast pairs." },
    { question: "Can I copy the color in CSS-ready form?", answer: "Yes. Click any value to copy it to your clipboard exactly as it should appear in CSS — for example #56b8e6, rgb(86 184 230), or hsl(202 75% 62%)." },
  ],

  // ── PDF Tools ──────────────────────────────────────────────────────
  "merge-pdf": [
    { question: "Is there a limit to how many PDFs I can merge?", answer: "There is no hard limit. The tool processes everything in your browser, so the practical limit depends on your device's memory. Merging dozens of average-sized PDFs should work fine." },
    { question: "Will the merged PDF keep bookmarks and links?", answer: "Yes. The merge operation copies pages as-is, preserving internal links, annotations, and other page-level features." },
    { question: "Can I reorder the files before merging?", answer: "Yes. Drag and drop the files in the list to set the order before you click merge." },
  ],
  "split-pdf": [
    { question: "How do I specify which pages to extract?", answer: "Click individual page thumbnails to select them, or type a range like '1-3, 5, 8-10' in the text input. Selected pages are extracted into a new PDF." },
    { question: "Can I split a PDF into individual pages?", answer: "Yes. Select all pages and each will be included. For truly separate files per page, you can run the tool multiple times or select one page at a time." },
    { question: "Are bookmarks and metadata preserved?", answer: "Document-level metadata (title, author) is preserved. Bookmarks that point to extracted pages are kept; bookmarks pointing to discarded pages are dropped automatically since their targets no longer exist." },
  ],
  "compress-pdf": [
    { question: "How much smaller will my PDF get?", answer: "Results vary. PDFs with lots of metadata or redundant internal objects see the biggest reduction. Heavily optimized PDFs may not shrink much. The tool shows the before and after file sizes." },
    { question: "Does compression reduce image quality?", answer: "This tool focuses on structural optimization (removing metadata, using object streams). It does not re-compress embedded images, so visual quality is preserved." },
    { question: "Will compression work on scanned PDFs?", answer: "Scanned PDFs are mostly raster image data, so structural optimization makes only a small dent. For scans, the highest-leverage move is reducing image resolution before producing the PDF; this tool can still strip redundant metadata on top of that." },
  ],
  "pdf-to-jpg": [
    { question: "What resolution are the output images?", answer: "By default, pages are rendered at 2× scale for crisp output. You can adjust the scale to get higher or lower resolution images." },
    { question: "Can I choose PNG instead of JPG?", answer: "Yes. Toggle between JPG and PNG output. PNG is lossless and larger; JPG is smaller with adjustable quality." },
    { question: "How do I convert just one page?", answer: "Use the page selector to pick the page or page range you want — for example, 5 or 3-7. Only those pages are rendered to images, and the result downloads as a single image or a small ZIP." },
  ],
  "images-to-pdf": [
    { question: "What image formats are supported?", answer: "JPG/JPEG and PNG images are supported. Other formats should be converted to JPG or PNG first using our image converter tools." },
    { question: "Can I choose the page size?", answer: "Yes. Choose between A4, US Letter, or 'Fit to Image' which makes each page exactly the size of the image." },
    { question: "Are images stretched to fill the page?", answer: "No. Images are scaled proportionally to fit within the page margins while maintaining their aspect ratio." },
  ],
  "rotate-pdf": [
    { question: "Can I rotate individual pages?", answer: "Yes. Select specific pages by clicking their thumbnails, then apply the rotation. Unselected pages remain unchanged." },
    { question: "What rotation angles are available?", answer: "You can rotate pages by 90° (clockwise), 180°, or 270° (counter-clockwise). Rotation is cumulative — rotating a page that's already at 90° by another 90° gives 180°." },
    { question: "Does rotating a page break text selection or search?", answer: "No. Rotation only changes the page's display orientation in the PDF; the underlying text layer and its coordinates are untouched, so copy, search, and screen-reader access keep working." },
  ],
  "add-page-numbers": [
    { question: "Where can I place page numbers?", answer: "You can place numbers at the top or bottom of each page, aligned to the left, center, or right. Six positions in total." },
    { question: "Can I start numbering from a number other than 1?", answer: "Yes. Set the starting number to any value. This is useful when your PDF is part of a larger document." },
    { question: "Can I skip the first few pages — like a cover or title?", answer: "Yes. Set the starting page to skip the cover and title pages so numbering begins on the first body page. The starting number is independent, so you can begin at any value." },
  ],
  "pdf-page-reorder": [
    { question: "How do I reorder pages?", answer: "After uploading your PDF, you'll see thumbnail previews of every page. Drag and drop the thumbnails into your desired order, then click download." },
    { question: "Can I remove pages while reordering?", answer: "This tool focuses on reordering. To remove pages, use the Split PDF tool to extract only the pages you want to keep." },
    { question: "Is there a limit on how many pages I can reorder?", answer: "No fixed limit. Performance scales with browser memory — documents up to a few hundred pages reorder smoothly on a modern laptop. Very large PDFs may take longer to render thumbnails." },
  ],
  "markdown-to-pdf": [
    { question: "Why does the print dialog open instead of an instant download?", answer: "The browser's native print engine is the only way to produce a PDF with selectable text, embedded fonts, and crisp vector code blocks. Pick 'Save as PDF' (Chrome/Edge), 'Save to PDF' (Safari), or 'Save to File' (Firefox) as the destination — the rest of the layout is already taken care of." },
    { question: "Does it support GitHub-Flavored Markdown?", answer: "Yes. Tables, fenced code blocks, task lists (rendered as Unicode glyphs so they print consistently), strikethrough, autolinks, and footnotes are all handled. Standard headings, lists, blockquotes, images, and inline emphasis work as expected." },
    { question: "What languages are syntax-highlighted in code blocks?", answer: "About twenty popular languages out of the box: js, ts, tsx, jsx, py, go, rust, java, c, cpp, json, yaml, toml, bash, sh, sql, html, css, md, and diff. Code fences with an unrecognised language fall back to plain monospace without throwing." },
    { question: "Can I customize the styling?", answer: "Yes — toggle between Light and Dark themes and between a Serif body (default, MD Peek-inspired) and a Sans body. Margins, page size (A4 by default), and code-block colors are tuned for legible long-form prose; per-document custom CSS is on the roadmap." },
    { question: "Why are colors missing from my exported PDF in Firefox?", answer: "Firefox disables 'Print backgrounds' by default, which strips the code-block backgrounds and table headers from the print preview. Toggle 'Print backgrounds' (or 'Print background graphics') in the print dialog before saving to fix it." },
  ],

  // ── Audio Tools ──────────────────────────────────────────────────
  "mp3-to-wav": [
    { question: "Why convert MP3 to WAV?", answer: "WAV is an uncompressed format required by many audio editors, DAWs, and professional workflows. While converting MP3 to WAV won't restore quality lost during MP3 compression, it gives you a lossless container for further editing without additional quality degradation." },
    { question: "Will the WAV file be larger than the MP3?", answer: "Yes, significantly. A typical 3-minute MP3 at 192 kbps is about 4 MB, while the equivalent WAV is roughly 30 MB. WAV stores uncompressed PCM audio data." },
    { question: "What sample rate and bit depth is the output WAV?", answer: "The output WAV matches the sample rate of your input MP3 (usually 44.1 kHz) and uses 16-bit PCM encoding — CD quality." },
  ],
  "wav-to-mp3": [
    { question: "What bitrate should I choose?", answer: "128 kbps is fine for speech and podcasts. 192 kbps is a good balance for music. 256-320 kbps is nearly indistinguishable from the original for most listeners." },
    { question: "How much smaller will the MP3 be?", answer: "Typically 80-90% smaller. A 30 MB WAV file at 192 kbps becomes about 4 MB as MP3." },
    { question: "Is there any quality loss?", answer: "Yes, MP3 is a lossy format — it discards audio data that's less perceptible to human hearing. At 192 kbps or higher, the difference is very hard to notice for most listeners." },
  ],
  "m4a-to-mp3": [
    { question: "What is M4A?", answer: "M4A is an audio container format used by Apple. It typically contains AAC (Advanced Audio Coding) data. iPhones use M4A for voice memos, and iTunes/Apple Music downloads are M4A files." },
    { question: "Why convert M4A to MP3?", answer: "While M4A offers better compression than MP3, some older devices, car stereos, and media players don't support it. MP3 is universally compatible with virtually every device and application." },
    { question: "Can I convert iPhone voice memos?", answer: "Yes! iPhone voice memos are saved as M4A files. Simply transfer the file to your computer (via AirDrop, email, or Files app) and upload it here." },
  ],
  "audio-trimmer": [
    { question: "What audio formats are supported?", answer: "You can trim MP3, WAV, OGG, M4A, FLAC, and AAC files — any format your browser can decode. The trimmed output is available as either MP3 or WAV." },
    { question: "Can I preview before trimming?", answer: "Yes. After uploading your file, you can play the audio and adjust start/end times. The playback lets you verify your selection before exporting." },
    { question: "Is there a maximum file duration?", answer: "There is no hard limit, but very long files (over 30 minutes) may take longer to process since all decoding happens in your browser." },
  ],
  "merge-audio": [
    { question: "Can I merge different audio formats?", answer: "Yes! You can mix MP3, WAV, OGG, M4A, FLAC, and other formats. Each file is decoded to raw audio before merging, so the input format doesn't matter." },
    { question: "What if my files have different sample rates?", answer: "The tool automatically resamples all files to match the highest sample rate among your inputs, ensuring consistent quality throughout the merged output." },
    { question: "Can I reorder the files before merging?", answer: "Yes. After uploading, you can drag and drop the files to arrange them in the order you want before merging." },
    { question: "Is there a limit on how many files I can merge?", answer: "There is no fixed limit. However, since all processing happens in your browser, merging many large files may be slower on devices with limited memory." },
  ],

  // ── Video Tools ──────────────────────────────────────────────────
  "video-to-gif": [
    { question: "What video formats are supported?", answer: "MP4, WebM, and MOV — whatever your browser can play back natively, since the tool decodes frames straight from a video element rather than shipping its own decoder." },
    { question: "Why is my GIF so large?", answer: "GIF stores every frame in full — there is no compression between frames the way there is in a video codec. Reduce the width, lower the frame rate (10-15 fps is usually smooth enough), and keep clips short to minimize file size." },
    { question: "How do I get the best GIF quality?", answer: "Each frame gets its own 256-color palette, computed from that frame's actual colors, which holds up far better than a single fixed palette across the whole clip. Lowering the width helps quality too, since fewer pixels means less to quantize." },
    { question: "Is there a duration limit?", answer: "No hard limit, but GIFs longer than 10-15 seconds become very large. For longer clips, consider keeping the video format and using lower resolution." },
  ],
  "video-trimmer": [
    { question: "What video formats can I trim?", answer: "MP4, WebM, MOV, AVI, and MKV. The trimmed output uses the same format as your input." },
    { question: "Is the video re-encoded when trimming?", answer: "No. The tool uses stream copy mode (-c copy) which copies the video and audio data without re-encoding. This is nearly instant and preserves original quality." },
    { question: "Why doesn't the trim start exactly where I set it?", answer: "Stream copy mode can only cut at keyframes. The actual start time may be slightly before your requested time. For frame-accurate trimming, re-encoding would be needed." },
  ],
  "mp4-to-mp3": [
    { question: "What bitrate should I choose?", answer: "128 kbps is fine for speech and podcasts. 192 kbps is a good balance for music. 256-320 kbps provides near-transparent quality for audiophiles." },
    { question: "Can I extract audio from non-MP4 videos?", answer: "Yes! Despite the name, this tool accepts MP4, WebM, MOV, AVI, and MKV files. Any video with an audio track can be converted to MP3." },
    { question: "What if the video has no audio?", answer: "FFmpeg will report an error if there is no audio stream to extract. Make sure your video file contains an audio track." },
  ],
  "webm-to-mp4": [
    { question: "Why convert WebM to MP4?", answer: "WebM is great for web playback but has limited support on iOS, some Android apps, and many video editors. MP4 (H.264/AAC) is the most universally compatible video format." },
    { question: "Will the quality change?", answer: "Yes — the video is fully re-encoded from VP8/VP9 to H.264, so this is not a lossless remux. The target is 5 Mbps, high enough that the difference is hard to see on typical screen recordings. The output may be larger or smaller than the original depending on the content." },
    { question: "How long does conversion take?", answer: "It depends on the video length and your device. Encoding runs through the browser's built-in WebCodecs API, which uses your hardware encoder where one is available, so a 1-minute clip is usually well under a minute. This needs Chrome or Edge — Firefox and older Safari don't expose the encoder." },
  ],
  "compress-video": [
    { question: "Which preset should I choose?", answer: "WhatsApp: optimized for mobile sharing (720p, ~1 Mbps). Email: small enough for email attachments (480p, ~500 kbps). Web: balanced quality for websites and social media (original resolution, higher bitrate)." },
    { question: "How much smaller will my video get?", answer: "Results vary by content. Typical reductions: WhatsApp preset 60-80% smaller, Email preset 70-90% smaller, Web preset 30-60% smaller than the original." },
    { question: "Is there a file size limit?", answer: "No limit is enforced, but everything runs in your browser tab, so files much beyond ~100 MB risk exhausting its memory. Trimming the clip first is usually the better route for very long recordings." },
  ],
  "screen-recorder": [
    { question: "Do I need to install anything?", answer: "No. This tool uses the browser's built-in Screen Capture API (getDisplayMedia). It works in Chrome, Edge, Firefox, and other modern browsers without any extensions." },
    { question: "Can I record with audio?", answer: "Yes. You can include microphone audio for narration. System audio capture depends on your browser and OS — Chrome on Windows and macOS supports it when sharing a tab." },
    { question: "What format is the recording?", answer: "Recordings are saved as WebM (VP8/VP9 video with Opus audio), which is the native format for browser MediaRecorder. Use our WebM to MP4 tool if you need MP4." },
    { question: "Is there a recording time limit?", answer: "No built-in limit. Recording length is only constrained by your device's available memory and disk space. Very long recordings (30+ minutes) may use significant memory." },
  ],

  // ── Developer Tools FAQs (continued) ─────────────────────────────
  "json-to-csv": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What JSON structure does this tool expect?", answer: "It expects a JSON array of objects, where each object represents a row. For example: [{\"name\": \"Alice\", \"age\": 30}, {\"name\": \"Bob\", \"age\": 25}]. Nested objects are flattened automatically." },
    { question: "How are nested objects handled?", answer: "Nested properties are flattened using dot notation. For example, {\"address\": {\"city\": \"NYC\"}} becomes a column named \"address.city\"." },
    { question: "What if my objects have different keys?", answer: "The tool collects all unique keys across every object. Rows missing a key will have an empty value in that column." },
    { question: "Can I use the CSV in Excel?", answer: "Yes. The output is standard comma-separated CSV that opens directly in Excel, Google Sheets, LibreOffice Calc, and any other spreadsheet application." },
  ],
  "csv-to-json": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "Does it use the first row as keys?", answer: "Yes. The first row of the CSV is treated as column headers and used as the property names in each JSON object." },
    { question: "Can I paste CSV text directly?", answer: "Yes. You can paste CSV content into the text area or upload a .csv file. Both methods produce the same JSON output." },
    { question: "How are numeric values handled?", answer: "Values that look like numbers are automatically converted to JSON numbers. Everything else is kept as a string." },
    { question: "Does it handle quoted fields with commas?", answer: "Yes. The parser correctly handles fields enclosed in double quotes, including fields that contain commas, newlines, or escaped quotes." },
  ],
  "sql-formatter": [
    { question: "Is my SQL sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What SQL dialects are supported?", answer: "The formatter supports standard SQL, PostgreSQL, MySQL, MariaDB, SQLite, BigQuery, Transact-SQL (SQL Server), and PL/SQL (Oracle)." },
    { question: "Does formatting change query behavior?", answer: "No. Formatting only changes whitespace, indentation, and capitalization of keywords. The query logic and results remain exactly the same." },
    { question: "Can I customize the indentation style?", answer: "Yes. You can choose between spaces and tabs, adjust the indent width, and control keyword capitalization (uppercase, lowercase, or preserve)." },
  ],
  "markdown-to-html": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "Which Markdown features are supported?", answer: "The tool supports standard Markdown including headings, bold, italic, links, images, code blocks, lists, blockquotes, tables, and horizontal rules." },
    { question: "Can I preview the rendered HTML?", answer: "Yes. The tool shows both the raw HTML output and a live preview of how it looks rendered in a browser." },
    { question: "Does it support GitHub-Flavored Markdown?", answer: "Yes. Features like tables, task lists, strikethrough, and fenced code blocks with syntax highlighting are all supported." },
  ],
  "html-to-markdown": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "Why convert HTML to Markdown?", answer: "Markdown is easier to read and edit than raw HTML. It's widely used in README files, documentation, blogs, and note-taking apps like Obsidian and Notion." },
    { question: "Does it preserve links and images?", answer: "Yes. HTML links become [text](url) and images become ![alt](src) in the Markdown output." },
    { question: "How are complex HTML elements handled?", answer: "Tables, lists, and headings are converted to their Markdown equivalents. Elements with no Markdown equivalent (like custom divs) are simplified or kept as inline HTML." },
  ],
  "xml-formatter": [
    { question: "Is my XML sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "Does formatting change the XML data?", answer: "No. Formatting only affects whitespace and indentation. Element names, attributes, and text content remain unchanged." },
    { question: "Can it handle large XML files?", answer: "It works well for XML documents up to a few megabytes. Very large files may cause the browser tab to slow down due to parsing and rendering." },
    { question: "Does it validate my XML?", answer: "The tool checks for well-formedness (proper nesting, matching tags, valid syntax) and will report parsing errors if your XML is malformed." },
  ],
  "url-encode-decode": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What is URL encoding?", answer: "URL encoding (percent-encoding) replaces special characters with a % followed by their hex code. For example, a space becomes %20 and an ampersand becomes %26. This ensures URLs are valid and unambiguous." },
    { question: "When should I URL-encode text?", answer: "Encode text when including it in query parameters, form data, or any part of a URL that might contain special characters like spaces, ampersands, or non-ASCII characters." },
    { question: "Does it handle Unicode characters?", answer: "Yes. Non-ASCII characters like emoji and international text are encoded as UTF-8 byte sequences, each byte represented as a percent-encoded value." },
  ],
  "html-entity-encode-decode": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What are HTML entities?", answer: "HTML entities are special codes that represent characters in HTML. For example, &lt; represents <, &amp; represents &, and &nbsp; represents a non-breaking space. They prevent browsers from interpreting characters as HTML markup." },
    { question: "When should I use HTML entities?", answer: "Use HTML entities when displaying special characters in HTML content — especially <, >, &, and quotes — to prevent them from being interpreted as HTML tags or attributes." },
    { question: "Does it support named and numeric entities?", answer: "Yes. The tool handles both named entities (like &amp;) and numeric entities (like &#38; or &#x26;)." },
  ],
  "lorem-ipsum-generator": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What is Lorem Ipsum?", answer: "Lorem Ipsum is placeholder text used in design and typesetting since the 1500s. It has a natural letter distribution similar to English, making layouts look realistic before final copy is written." },
    { question: "Can I generate paragraphs, sentences, or words?", answer: "Yes. You can choose to generate a specific number of paragraphs, sentences, or words depending on your layout needs." },
    { question: "Is the text random each time?", answer: "The text is shuffled from a pool of classical Lorem Ipsum phrases, so each generation produces a slightly different arrangement while maintaining natural-looking Latin text." },
  ],
  "css-gradient-generator": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What types of gradients can I create?", answer: "You can create linear gradients (with adjustable angle), radial gradients (circular or elliptical), and conic gradients. Each type supports multiple color stops." },
    { question: "Do CSS gradients work in all browsers?", answer: "Yes. The linear-gradient, radial-gradient, and conic-gradient CSS functions are supported in all modern browsers including Chrome, Firefox, Safari, and Edge." },
    { question: "Can I add more than two colors?", answer: "Yes. You can add multiple color stops to create complex multi-color gradients. Each stop can have its position adjusted along the gradient axis." },
  ],
  "box-shadow-generator": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What do the shadow values mean?", answer: "The box-shadow property takes: horizontal offset, vertical offset, blur radius, spread radius, and color. Blur controls softness, spread controls size, and the offsets control direction." },
    { question: "Can I add multiple shadows?", answer: "Yes. You can layer multiple shadows on a single element to create depth effects, glows, or complex shadow compositions. Each shadow is listed comma-separated in the CSS output." },
    { question: "What is an inset shadow?", answer: "An inset shadow appears inside the element instead of outside, creating a pressed or recessed effect. Toggle the inset option to switch between inner and outer shadows." },
  ],
  "cron-expression-generator": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What is a cron expression?", answer: "A cron expression is a string of five (or six) fields that defines a schedule: minute, hour, day of month, month, and day of week. It's used by Unix cron, CI/CD systems, and task schedulers to run jobs automatically." },
    { question: "What does * mean in a cron field?", answer: "An asterisk (*) means \"every\" — so * in the minute field means every minute, and * in the day-of-week field means every day. Other special characters include , (list), - (range), and / (step)." },
    { question: "Does this show when the next runs will be?", answer: "Yes. The tool displays the next several scheduled run times so you can verify your cron expression triggers at the correct times." },
    { question: "What's the difference between 5-field and 6-field cron?", answer: "Standard Unix cron uses 5 fields (minute through day-of-week). Some systems like Quartz and AWS add a 6th field for seconds. This tool generates standard 5-field expressions." },
  ],
  "text-diff": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What diff algorithm is used?", answer: "The tool uses a standard line-by-line diff algorithm that highlights additions, deletions, and modifications — similar to what git diff produces." },
    { question: "Can I compare code files?", answer: "Yes. The diff tool works with any plain text including source code, configuration files, JSON, XML, or prose. Line-by-line comparison makes it easy to spot changes." },
    { question: "What do the colors mean?", answer: "Green highlights indicate added lines (present only in the second text), red highlights indicate removed lines (present only in the first text), and unchanged lines are shown without highlighting." },
  ],
  "text-case-converter": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "What case formats are supported?", answer: "The tool supports camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case, Title Case, UPPERCASE, lowercase, and Sentence case." },
    { question: "When would I use snake_case vs camelCase?", answer: "snake_case is the convention in Python, Ruby, and SQL. camelCase is standard in JavaScript, Java, and TypeScript. PascalCase is used for class names in most languages." },
    { question: "Does it handle multi-line text?", answer: "Yes. Each line is converted independently, so you can paste a list of variable names or phrases and convert them all at once." },
  ],
  "word-counter": [
    { question: "Is my data sent to a server?", answer: "No. All processing happens locally in your browser. No data leaves your device." },
    { question: "How are words counted?", answer: "Words are counted by splitting text on whitespace boundaries. Hyphenated words like 'well-known' count as one word, and numbers count as words." },
    { question: "Does it show reading time?", answer: "Yes. The tool estimates reading time based on an average reading speed of about 200-250 words per minute." },
    { question: "What statistics are displayed?", answer: "The tool shows word count, character count (with and without spaces), sentence count, paragraph count, and estimated reading time." },
  ],
};
