export interface FAQ {
  question: string;
  answer: string;
}

export type ToolFAQs = Record<string, FAQ[]>;

const PRIVACY_FAQ: FAQ = {
  question: "Is my file uploaded to a server?",
  answer: "No. Transmute processes everything locally in your browser using JavaScript and the Canvas API. Your files never leave your device — there is no server, no upload, no cloud processing.",
};

export const faqs: ToolFAQs = {
  "heic-to-jpg": [
    {
      question: "What is a HEIC file?",
      answer: "HEIC (High Efficiency Image Container) is the default photo format on iPhones and iPads since iOS 11. It offers roughly 50% better compression than JPG while maintaining similar quality.",
    },
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
    {
      question: "Will my image look bad at 100 KB?",
      answer: "It depends on the image dimensions. A small image (under 1000px) can look great at 100 KB. For larger images, you may notice some quality loss. The tool finds the best possible quality that fits within the limit.",
    },
  ],
  "compress-image-to-200kb": [
    {
      question: "When would I need to compress to 200 KB?",
      answer: "Many job application portals, university admission forms, and document upload systems cap images at 200 KB. This is also a good target for email signatures and web thumbnails.",
    },
    PRIVACY_FAQ,
  ],
  "compress-image-to-1mb": [
    {
      question: "Why compress to 1 MB?",
      answer: "Social media platforms like WhatsApp, some email providers, and many CMS platforms have a 1 MB limit for image uploads. This size offers a good balance between quality and file size for most photos.",
    },
    PRIVACY_FAQ,
  ],
  "resize-image": [
    {
      question: "What is Lanczos3 resampling?",
      answer: "Lanczos3 is a high-quality image resampling algorithm that produces sharp, artifact-free results when scaling images up or down. It's the same algorithm used by professional image editors like Photoshop.",
    },
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
    {
      question: "What sizes are included in the ICO file?",
      answer: "The generated ICO file contains three sizes: 16×16 (browser tab), 32×32 (browser tab on high-DPI), and 48×48 (Windows shortcut). These cover all standard favicon use cases.",
    },
  ],
  "favicon-generator": [
    {
      question: "What sizes do I need for favicons?",
      answer: "A complete favicon set includes: 16×16 and 32×32 for browser tabs, 48×48 for Windows, 180×180 for Apple Touch (iOS home screen), and 192×192 + 512×512 for Progressive Web Apps (PWA).",
    },
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
    PRIVACY_FAQ,
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
  ],
  "uuid-generator": [
    { question: "What's the difference between UUID v4 and v7?", answer: "UUID v4 is fully random. UUID v7 is time-ordered — the first 48 bits encode a millisecond timestamp, making it ideal for database primary keys because it preserves insertion order and improves index performance." },
    { question: "Are the UUIDs cryptographically random?", answer: "Yes. Both versions use the Web Crypto API (crypto.getRandomValues) for their random components." },
  ],
  "password-generator": [
    { question: "Are generated passwords stored anywhere?", answer: "No. Passwords are generated using the Web Crypto API in your browser and are never stored or transmitted. Close the tab and they're gone." },
    { question: "What does the strength meter measure?", answer: "It calculates the entropy (randomness) of the password based on its length and the character pool size. Higher entropy means more possible combinations and a stronger password." },
  ],
  "hash-generator": [
    { question: "Is my data sent to a server?", answer: "No. SHA hashes are computed using the Web Crypto API and MD5 using the js-md5 library — both run entirely in your browser." },
    { question: "Which hash algorithm should I use?", answer: "SHA-256 is the most widely used for checksums and data integrity. SHA-512 provides more security. MD5 and SHA-1 are considered cryptographically broken and should only be used for non-security purposes like checksums." },
  ],
  "regex-tester": [
    { question: "Which regex flavor does this use?", answer: "It uses JavaScript's built-in RegExp engine, which follows the ECMAScript specification. This is the same regex flavor used in Node.js, browsers, and most JavaScript frameworks." },
    { question: "What do the flag buttons mean?", answer: "g = global (find all matches), i = case-insensitive, m = multiline (^ and $ match line boundaries), s = dotAll (. matches newlines), u = Unicode." },
  ],
  "qr-code-generator": [
    { question: "Is my data sent to a server?", answer: "No. QR codes are generated entirely in your browser using the qrcode library." },
    { question: "What's the maximum text length for a QR code?", answer: "QR codes can encode up to about 4,296 alphanumeric characters or 2,953 bytes. In practice, keeping content under 500 characters ensures reliable scanning." },
  ],
  "timestamp-converter": [
    { question: "What timezone is used?", answer: "Unix timestamps are timezone-independent (they represent seconds since 1970-01-01 UTC). The human-readable output uses your browser's local timezone." },
    { question: "What's the difference between seconds and milliseconds?", answer: "Unix timestamps in seconds are 10 digits (e.g., 1700000000). Milliseconds are 13 digits (e.g., 1700000000000). JavaScript's Date.now() returns milliseconds." },
  ],
  "color-picker": [
    { question: "What color formats are supported?", answer: "HEX (#RRGGBB), RGB (0-255 per channel), and HSL (hue 0-360°, saturation 0-100%, lightness 0-100%). All formats update in sync." },
  ],

  // ── PDF Tools ──────────────────────────────────────────────────────
  "merge-pdf": [
    { question: "Is there a limit to how many PDFs I can merge?", answer: "There is no hard limit. The tool processes everything in your browser, so the practical limit depends on your device's memory. Merging dozens of average-sized PDFs should work fine." },
    PRIVACY_FAQ,
    { question: "Will the merged PDF keep bookmarks and links?", answer: "Yes. The merge operation copies pages as-is, preserving internal links, annotations, and other page-level features." },
    { question: "Can I reorder the files before merging?", answer: "Yes. Drag and drop the files in the list to set the order before you click merge." },
  ],
  "split-pdf": [
    { question: "How do I specify which pages to extract?", answer: "Click individual page thumbnails to select them, or type a range like '1-3, 5, 8-10' in the text input. Selected pages are extracted into a new PDF." },
    PRIVACY_FAQ,
    { question: "Can I split a PDF into individual pages?", answer: "Yes. Select all pages and each will be included. For truly separate files per page, you can run the tool multiple times or select one page at a time." },
  ],
  "compress-pdf": [
    { question: "How much smaller will my PDF get?", answer: "Results vary. PDFs with lots of metadata or redundant internal objects see the biggest reduction. Heavily optimized PDFs may not shrink much. The tool shows the before and after file sizes." },
    PRIVACY_FAQ,
    { question: "Does compression reduce image quality?", answer: "This tool focuses on structural optimization (removing metadata, using object streams). It does not re-compress embedded images, so visual quality is preserved." },
  ],
  "pdf-to-jpg": [
    { question: "What resolution are the output images?", answer: "By default, pages are rendered at 2× scale for crisp output. You can adjust the scale to get higher or lower resolution images." },
    PRIVACY_FAQ,
    { question: "Can I choose PNG instead of JPG?", answer: "Yes. Toggle between JPG and PNG output. PNG is lossless and larger; JPG is smaller with adjustable quality." },
  ],
  "images-to-pdf": [
    { question: "What image formats are supported?", answer: "JPG/JPEG and PNG images are supported. Other formats should be converted to JPG or PNG first using our image converter tools." },
    PRIVACY_FAQ,
    { question: "Can I choose the page size?", answer: "Yes. Choose between A4, US Letter, or 'Fit to Image' which makes each page exactly the size of the image." },
    { question: "Are images stretched to fill the page?", answer: "No. Images are scaled proportionally to fit within the page margins while maintaining their aspect ratio." },
  ],
  "rotate-pdf": [
    { question: "Can I rotate individual pages?", answer: "Yes. Select specific pages by clicking their thumbnails, then apply the rotation. Unselected pages remain unchanged." },
    PRIVACY_FAQ,
    { question: "What rotation angles are available?", answer: "You can rotate pages by 90° (clockwise), 180°, or 270° (counter-clockwise). Rotation is cumulative — rotating a page that's already at 90° by another 90° gives 180°." },
  ],
  "add-page-numbers": [
    { question: "Where can I place page numbers?", answer: "You can place numbers at the top or bottom of each page, aligned to the left, center, or right. Six positions in total." },
    PRIVACY_FAQ,
    { question: "Can I start numbering from a number other than 1?", answer: "Yes. Set the starting number to any value. This is useful when your PDF is part of a larger document." },
  ],
  "pdf-page-reorder": [
    { question: "How do I reorder pages?", answer: "After uploading your PDF, you'll see thumbnail previews of every page. Drag and drop the thumbnails into your desired order, then click download." },
    PRIVACY_FAQ,
    { question: "Can I remove pages while reordering?", answer: "This tool focuses on reordering. To remove pages, use the Split PDF tool to extract only the pages you want to keep." },
  ],
};
