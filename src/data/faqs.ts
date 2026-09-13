export interface FAQ {
  question: string;
  answer: string;
}

export type ToolFAQs = Record<string, FAQ[]>;

/*
  This answer is appended to EVERY tool's FAQ list (src/app/[slug]/page.tsx), so
  it has to be true of every tool. It used to name "the Canvas API", which was
  never true of the PDF text extractor and is not true of the four qpdf tools —
  encryption, decryption and repair run in WebAssembly and touch no canvas.
  "JavaScript and WebAssembly" is the honest superset; the question string is
  unchanged because a registry test keys off it.
*/
export const PRIVACY_FAQ: FAQ = {
  question: "Is my file uploaded to a server?",
  answer:
    "No. Transmute processes everything locally in your browser using JavaScript and WebAssembly. Your files never leave your device — there is no server, no upload, no cloud processing.",
};

export const faqs: ToolFAQs = {
  "heic-to-jpg": [
    {
      question: "What is a HEIC file?",
      answer:
        "HEIC (High Efficiency Image Container) is the default photo format on iPhones and iPads since iOS 11. It offers roughly 50% better compression than JPG while maintaining similar quality.",
    },
    {
      question: "Does converting HEIC to JPG lose quality?",
      answer:
        "There is minimal quality loss when converting to JPG. You can adjust the quality slider to balance file size and visual fidelity — 85-90% quality is usually indistinguishable from the original.",
    },
    {
      question: "Can I convert multiple HEIC files at once?",
      answer:
        "Yes. You can drag and drop multiple HEIC files and they will all be converted. Each file is processed independently in your browser.",
    },
    {
      question: "Why can't I open HEIC files on my PC?",
      answer:
        "Windows doesn't natively support HEIC without installing the HEIF Image Extensions from the Microsoft Store. Converting to JPG is the quickest way to make your iPhone photos viewable everywhere.",
    },
  ],
  "webp-to-jpg": [
    {
      question: "What is WebP?",
      answer:
        "WebP is a modern image format developed by Google. It provides superior compression to both JPG and PNG, resulting in smaller file sizes at similar quality. Most websites use WebP to speed up page loading.",
    },
    {
      question: "Why convert WebP to JPG?",
      answer:
        "While all modern browsers support WebP, some older software, email clients, and image editors don't. JPG is universally supported on every device and application.",
    },
    {
      question: "Does converting WebP to JPG increase file size?",
      answer:
        "Usually yes, because JPG compression is less efficient than WebP. The file may be 20-40% larger, but it will be compatible everywhere. Adjust the quality slider to control the trade-off.",
    },
    {
      question: "What happens if my WebP is animated?",
      answer:
        "JPG can't hold animation, so only the first frame is converted. The tool detects this from the file's own bytes and shows a notice — \"This WebP is animated — only its first frame was kept.\" — so the loss is never silent.",
    },
    {
      question: "What happens to transparent areas in my WebP?",
      answer:
        "JPG has no alpha channel, so the tool paints a white background behind the image before encoding — transparent regions come out white rather than black. If you need to keep the transparency, use the WebP to PNG converter instead.",
    },
  ],
  "webp-to-png": [
    {
      question: "Does WebP to PNG preserve transparency?",
      answer:
        "Yes. If your WebP image has transparent areas, they are preserved when converting to PNG. PNG fully supports alpha channel transparency.",
    },
    {
      question: "Will converting WebP to PNG increase file size?",
      answer:
        "Yes, PNG files are typically larger than WebP because PNG uses less aggressive compression. However, PNG is lossless — no quality is lost during conversion.",
    },
    {
      question: "When should I use PNG instead of WebP?",
      answer:
        "Use PNG when you need lossless quality, full transparency support, or compatibility with software that doesn't support WebP — such as some image editors, print workflows, or older applications.",
    },
    {
      question: "Can I convert an animated WebP to PNG?",
      answer:
        "Only its first frame — PNG is a still format, and the decoder keeps frame one of any animation. A notice on the result tells you whenever this happens, so you'll know why the motion is gone.",
    },
    {
      question: "Why is there no quality slider on this tool?",
      answer:
        "PNG is lossless, so there is no quality trade-off to make — the encoder keeps every pixel exactly as decoded. The slider and presets only appear on tools with lossy outputs like JPG and WebP.",
    },
  ],
  "png-to-jpg": [
    {
      question: "Why convert PNG to JPG?",
      answer:
        "JPG files are typically 60-80% smaller than PNGs for photographs. If your image doesn't need transparency, converting to JPG dramatically reduces file size — great for email attachments, social media, or web use.",
    },
    {
      question: "Does PNG to JPG lose transparency?",
      answer:
        "Yes. JPG does not support transparency. Transparent areas in your PNG will be filled with a white background. If you need to keep transparency, consider WebP instead.",
    },
    {
      question: "What quality setting should I use?",
      answer:
        "For photographs, 80-85% quality is a good balance of size and quality. For images with text or sharp edges, use 90-95% to avoid compression artifacts around edges.",
    },
    {
      question: "Can I convert several PNGs at once?",
      answer:
        "Yes — drop in multiple files and they convert in parallel across a pool of Web Workers, one file per thread. A single result downloads on its own; two or more come down together as one ZIP.",
    },
    {
      question: "What do the Web ready and Keep quality presets do?",
      answer:
        "Web ready sets the quality slider to 72%, a sensible size-versus-quality point for images headed to a web page. Keep quality sets it to 94% for when you mainly want the format change — and the slider itself runs from 10% to 100% if neither fits.",
    },
  ],
  "jpg-to-png": [
    {
      question: "Why convert JPG to PNG?",
      answer:
        "PNG is a lossless format — converting to PNG prevents further quality degradation if you plan to edit the image multiple times. PNG also supports transparency, which JPG does not.",
    },
    {
      question: "Will the file be larger after converting to PNG?",
      answer:
        "Yes, PNG files are typically 2-5x larger than JPGs for photographs because PNG uses lossless compression. This is the trade-off for zero additional quality loss.",
    },
    {
      question: "Can I add transparency after converting to PNG?",
      answer:
        "The conversion itself doesn't add transparency — it converts all pixels as-is. But since the result is now a PNG, you can open it in an image editor and add transparency by removing the background.",
    },
    {
      question: "Does the PNG keep my photo's EXIF data?",
      answer:
        "No. The conversion redraws the image through a canvas, which carries pixels only — EXIF tags, GPS coordinates, and color profiles are all dropped from the output. If you want to see what's being removed first, the EXIF Data Viewer & Remover lists every tag.",
    },
    {
      question:
        "Can converting to PNG bring back quality the JPG already lost?",
      answer:
        "No — JPG's compression artifacts are baked into the pixels, and the PNG preserves them faithfully along with everything else. There is no enhancement step; converting locks in the quality you have rather than restoring what was lost.",
    },
  ],
  "jpg-to-webp": [
    {
      question: "How much smaller will my WebP file be?",
      answer:
        "WebP files are typically 25-35% smaller than equivalent JPG files at the same visual quality. For a 1 MB JPG, you can expect a WebP around 650-750 KB.",
    },
    {
      question: "Do all browsers support WebP?",
      answer:
        "Yes, all modern browsers — Chrome, Firefox, Safari, Edge, and Opera — support WebP. The only browsers that don't are Internet Explorer and very old versions of Safari (pre-14).",
    },
    {
      question: "Should I use WebP for my website?",
      answer:
        "Absolutely. WebP is the recommended image format for the web. It offers the best balance of quality and file size, directly improving page load times and Core Web Vitals scores.",
    },
    {
      question: "What quality setting should I use for WebP?",
      answer:
        "The default 85% keeps photographic detail intact. Drop to the Web ready preset (72%) when file size matters more, or pick Keep quality (94%) when the point is just the format change.",
    },
    {
      question: "Will my photo come out sideways?",
      answer:
        "No. Phone cameras often store the image rotated and rely on an EXIF orientation tag, and the tool applies that rotation to the pixels while decoding — so the WebP displays upright everywhere, even though the EXIF tags themselves don't survive the re-encode.",
    },
  ],
  "png-to-webp": [
    {
      question: "How much smaller is WebP compared to PNG?",
      answer:
        "WebP files can be 60-80% smaller than PNGs, especially for photographs. For graphics with flat colors, the savings are typically 30-50%. Either way, you'll see significant size reduction.",
    },
    {
      question: "Does WebP support transparency like PNG?",
      answer:
        "Yes! WebP supports alpha channel transparency just like PNG, but with much better compression. It's the best of both worlds — small files with full transparency support.",
    },
    {
      question: "Is converting PNG to WebP lossy?",
      answer:
        "By default, the conversion uses lossy WebP compression (like JPG). You can increase the quality slider to maximum for near-lossless results, though the file will be larger.",
    },
    {
      question: "Can the WebP end up larger than my PNG?",
      answer:
        "Occasionally, yes — tiny icons and heavily optimized flat-color PNGs can grow, because lossy WebP is tuned for photographic detail. The Delta stat shows the true size change before you download, and it loses its green tint whenever the output grew, so a bad trade is never hidden.",
    },
    {
      question: "Can I convert the WebP back to PNG later?",
      answer:
        "Yes — the WebP to PNG tool does the reverse. But this conversion is lossy, so a round trip gives you a PNG of the compressed pixels, not your original; keep the source PNG if you might need it again.",
    },
  ],
  "svg-to-png": [
    {
      question: "What resolution should I export at?",
      answer:
        "For web use, export at 1x (e.g. 200×200 for a 200px icon) or 2x for retina displays. For print, export at 300 DPI equivalent — multiply your desired print size in inches by 300.",
    },
    {
      question: "Can I set custom dimensions for the PNG?",
      answer:
        "Yes. Since SVG is a vector format, you can export it at any resolution without quality loss. Enter your desired width and height, or leave them blank to use the SVG's default dimensions.",
    },
    {
      question: "Why can't I use SVG directly?",
      answer:
        "While SVGs work great on the web, many platforms — social media, messaging apps, email, document editors — require raster formats like PNG. Converting SVG to PNG lets you use your graphics anywhere.",
    },
    {
      question: "Will the PNG look blurry?",
      answer:
        "No, as long as you export at the right resolution. Since the source is a vector, the PNG will be perfectly crisp. For high-DPI screens, export at 2x or 3x your display size.",
    },
  ],
  "avif-to-jpg": [
    {
      question: "What is AVIF?",
      answer:
        "AVIF (AV1 Image File Format) is a next-generation image format based on the AV1 video codec. It offers up to 50% better compression than JPG and 20% better than WebP, making it ideal for the web.",
    },
    {
      question: "Does my browser support AVIF?",
      answer:
        "Chrome (85+), Firefox (93+), and Safari (16.4+) all support AVIF. If your browser can load this page, it very likely supports AVIF decoding. The conversion uses your browser's native decoding.",
    },
    {
      question: "Why convert AVIF to JPG?",
      answer:
        "While AVIF offers superior compression, many older applications, image editors, and platforms don't support it yet. Converting to JPG ensures your images work everywhere.",
    },
    {
      question: "What happens to transparency in my AVIF?",
      answer:
        "AVIF can carry an alpha channel but JPG can't, so transparent regions are flattened onto a white background during encoding — white, not black. There is no setting to keep the transparency; JPG simply has nowhere to store it.",
    },
    {
      question: "Will the JPG be bigger than my AVIF?",
      answer:
        "Almost always — AVIF compresses far more efficiently, so at similar visual quality the JPG can approach twice the size. That's the price of compatibility; lower the quality slider if size matters more than fidelity.",
    },
  ],
  "bmp-to-jpg": [
    {
      question: "Why are BMP files so large?",
      answer:
        "BMP (Bitmap) stores every pixel's color data without any compression. A 12-megapixel photo can be over 36 MB as a BMP. Converting to JPG applies lossy compression that typically reduces size by 90% or more.",
    },
    {
      question: "Will I lose quality converting BMP to JPG?",
      answer:
        "JPG uses lossy compression, so there is some quality reduction. However, at 85-90% quality, the difference is virtually invisible to the human eye while the file size drops dramatically.",
    },
    {
      question: "Where do BMP files come from?",
      answer:
        "BMP files are common in legacy Windows applications, screenshots from older software, scanned documents, and certain embedded systems. They're rarely used today because of their enormous file size.",
    },
    {
      question: "Can I convert a JPG back to BMP?",
      answer:
        "Not here — browser canvas encoders can't write BMP (asking for one silently produces PNG bytes wearing a .bmp name), so BMP works as an input format only. If you need a lossless copy, PNG fills the same role at a fraction of the size.",
    },
    {
      question: "Will the JPG keep the original resolution?",
      answer:
        "Yes — the image is re-encoded pixel-for-pixel at its original width and height; only the compression changes. For scanned documents that means the detail you keep is decided by the quality slider, not by any resizing.",
    },
  ],
  "compress-image": [
    {
      question: "How does image compression work?",
      answer:
        "This tool re-encodes your image as a JPEG with adjustable quality. Lower quality means smaller files but more compression artifacts. In target-size mode, the tool uses binary search to find the optimal quality that produces a file at or under your target size.",
    },
    {
      question:
        "What's the difference between quality mode and target-size mode?",
      answer:
        "Quality mode lets you set a specific quality level (e.g., 80%) and see the resulting file size. Target-size mode lets you specify an exact file size (e.g., 100 KB) and the tool automatically finds the best quality that fits within that limit.",
    },
    {
      question: "Can I compress multiple images at once?",
      answer:
        "Yes! You can drag and drop multiple images and they will all be compressed with the same settings. Each result shows the original and compressed size.",
    },
    {
      question: "Can I compress an animated GIF?",
      answer:
        "You can upload a .gif, but the output is a still image of its first frame — the result warns you whenever that happens. The GIF re-encodes to JPG, or to WebP when it has transparency, so this works for single-frame GIFs but won't compress an animation.",
    },
    {
      question: "Does compressing remove EXIF metadata?",
      answer:
        "Yes — the compressor re-encodes only the pixels, so EXIF, GPS, and other metadata don't carry into the output, and the photo's EXIF rotation is baked in first so it won't come out sideways. One exception: if re-encoding wouldn't make your file smaller, you get your original back untouched, metadata included.",
    },
  ],
  "compress-image-to-100kb": [
    {
      question: "Why do I need to compress to 100 KB?",
      answer:
        "Many websites, email providers, and online forms have a 100 KB file size limit for image uploads. Passport applications, visa forms, and government websites often have this restriction.",
    },
    {
      question: "Will my image look bad at 100 KB?",
      answer:
        "It depends on the image dimensions. A small image (under 1000px) can look great at 100 KB. For larger images, you may notice some quality loss. The tool finds the best possible quality that fits within the limit.",
    },
    {
      question: "Which input formats can I compress?",
      answer:
        "JPG, PNG, WebP, AVIF, and BMP are all accepted. Opaque images come out as JPG because it hits target sizes most reliably; images with transparency are saved as WebP automatically so the transparency survives.",
    },
    {
      question: "Will the output be exactly 100 KB?",
      answer:
        "No — the tool aims at or just under the limit, never over it when the target is reachable. The quality search stops refining once it lands within 5% of the ceiling, so a large photo typically comes out between 95 and 100 KB; an image already under 100 KB at full quality just stays smaller.",
    },
    {
      question: "What if my photo can't reach 100 KB at full size?",
      answer:
        "The tool lowers encoder quality first. When quality alone can't get there, it scales the image down in bounded steps — each between 50% and 90% of the current size, never below 64 px on the longest side — and the result reports the new dimensions. If even that can't reach 100 KB, you get the smallest file it managed, and never one larger than your original.",
    },
  ],
  "compress-image-to-200kb": [
    {
      question: "When would I need to compress to 200 KB?",
      answer:
        "Many job application portals, university admission forms, and document upload systems cap images at 200 KB. This is also a good target for email signatures and web thumbnails.",
    },
    {
      question: "Will my image look good at 200 KB?",
      answer:
        "For most photos under 2000px wide, 200 KB produces very good quality. The tool automatically finds the highest quality level that fits within the limit.",
    },
    {
      question: "What image formats can I compress?",
      answer:
        "You can upload JPG, PNG, WebP, AVIF, or BMP files. The compressed output is JPEG for photographs and other opaque images; images with transparency are saved as WebP so the transparency survives.",
    },
    {
      question: "Am I stuck with the 200 KB target on this page?",
      answer:
        "No — 200 KB is just the preloaded default. You can type any target from 10 KB up to 10,240 KB (10 MB) into the size field, or pick one of the 50 KB, 100 KB, 200 KB, 500 KB, or 1 MB presets.",
    },
    {
      question: "Can compression ever make my file bigger?",
      answer:
        "No. Every result is compared against your original, and if the re-encode comes out the same size or larger, the tool hands back your original file unchanged instead — a compressor should never grow a file.",
    },
  ],
  "compress-image-to-1mb": [
    {
      question: "Why compress to 1 MB?",
      answer:
        "Social media platforms like WhatsApp, some email providers, and many CMS platforms have a 1 MB limit for image uploads. This size offers a good balance between quality and file size for most photos.",
    },
    {
      question: "Will a 1 MB image look good?",
      answer:
        "Yes. At 1 MB, most photos retain excellent quality with no visible artifacts. This size is sufficient for high-resolution images up to about 4000px wide.",
    },
    {
      question: "What if my image is already under 1 MB?",
      answer:
        "If your image is already smaller than 1 MB, the tool will still process it but the output may be similar in size to the original. There is no benefit to compressing an already-small file.",
    },
    {
      question: "How can I tell how much quality I lost?",
      answer:
        "Compress a single image and you get a draggable before/after comparison plus an SSIM score — a structural-similarity measure where 1.000 means identical to the original. Scores above roughly 0.95 are usually hard to tell apart by eye.",
    },
    {
      question: "Can I compress a whole batch to 1 MB at once?",
      answer:
        "Yes — drop in multiple files and they're compressed in parallel across a pool of Web Workers, one file per thread, with a live queue tracking each file's progress. When the batch finishes, everything downloads as a single compressed-images.zip.",
    },
  ],
  "compress-image-to-20kb": [
    {
      question: "Who needs an image under 20 KB?",
      answer:
        "Signature uploads on exam registrations and government portals are the classic case — many specify 10–20 KB for signatures and 20–50 KB for photos. Tiny avatar and thumbnail fields on older systems carry limits this small too.",
    },
    {
      question: "Will a photo survive compression to 20 KB?",
      answer:
        "Not at full resolution — 20 KB cannot hold a multi-megapixel photo at any quality, so the engine scales large images down and tells you the new dimensions. Expect a few hundred pixels on the longest side, which is usually exactly what fields with this limit want.",
    },
    {
      question: "Does this tool change my image's dimensions?",
      answer:
        "Only when it has to. Quality is lowered first at the original dimensions; the image is scaled down in bounded steps — 50% to 90% at a time, never below 64 px on the longest side — only when no quality can reach 20 KB, and the result reports the new size whenever that happens.",
    },
    {
      question: "What format does the output use?",
      answer:
        "JPG for opaque images, because it reaches small targets most reliably; images with transparency come out as WebP so the transparency survives.",
    },
    {
      question: "What if even scaling can't reach 20 KB?",
      answer:
        "You get the smallest file the engine managed across all of its attempts — and never one larger than your original.",
    },
  ],
  "compress-image-to-50kb": [
    {
      question: "Where do 50 KB limits come up?",
      answer:
        "Exam registration portals, admit-card and hall-ticket systems, visa and ID photo uploads, and older content management systems commonly cap image uploads at 50 KB.",
    },
    {
      question: "How does the tool find the right quality?",
      answer:
        "A binary search runs up to ten encode passes and keeps the largest result at or under 50 KB, stopping once it lands within 5% of the ceiling — so a typical output sits just under 50 KB rather than far below it.",
    },
    {
      question: "Can I use a different target than 50 KB on this page?",
      answer:
        "Yes — 50 KB is just the preloaded default. Type any target from 10 KB to 10,240 KB (10 MB) into the size field, or pick one of the 50 KB, 100 KB, 200 KB, 500 KB, or 1 MB presets.",
    },
    {
      question: "Will my image be resized?",
      answer:
        "Only if quality alone can't reach 50 KB at the original dimensions. Then the image steps down in bounded increments and the result reports the new width and height — a changed picture is never silent.",
    },
    {
      question: "Can I compress several photos at once?",
      answer:
        "Yes — drop in multiple files and they compress in parallel across a pool of Web Workers, with a live queue tracking each file. The batch downloads as a single ZIP.",
    },
  ],
  "compress-image-to-500kb": [
    {
      question: "When is 500 KB the right target?",
      answer:
        "Content management systems, marketplace listings, forum attachments, and many email gateways cap images around 500 KB. It is also a sensible default for web pages that should stay fast without visibly degrading photos.",
    },
    {
      question: "Will my photo lose visible quality at 500 KB?",
      answer:
        "Usually not — photos up to roughly 3000 px on the long side keep high quality at half a megabyte. Compress a single image and the before/after slider plus the SSIM score show you exactly how close to the original it stayed.",
    },
    {
      question: "Can the output ever be bigger than my original?",
      answer:
        "No. Every result is compared against your original, and if the re-encode comes out the same size or larger, you get your original file back unchanged — a compressor should never grow a file.",
    },
    {
      question: "Does compressing to 500 KB shrink my image's dimensions?",
      answer:
        "Almost never at this target — quality alone reaches 500 KB for all but enormous sources. If a downscale ever were needed, the result would report the new dimensions explicitly.",
    },
  ],
  "compress-image-to-target-size": [
    {
      question: "What targets can I enter?",
      answer:
        "Anything from 10 KB to 10,240 KB (10 MB), typed directly into the size field. The 50 KB, 100 KB, 200 KB, 500 KB, and 1 MB presets are one-tap shortcuts to the common ceilings.",
    },
    {
      question: "Why does the page open at 200 KB?",
      answer:
        "It's only a preloaded default so the field isn't empty — not a recommendation and not a limit. Type your form's exact figure over it and that number drives the run.",
    },
    {
      question: "How close to my target will the result be?",
      answer:
        "At or just under it, never over when the target is reachable — the quality search stops refining once it lands within 5% of the ceiling. A file already under your target at full quality simply stays smaller.",
    },
    {
      question: "What happens if I enter a very small target?",
      answer:
        "Quality is lowered first; when that can't get there, the image is scaled down in bounded steps — 50% to 90% at a time, never below 64 px on the longest side — and the result reports the new dimensions. If even the floor can't reach it, you get the smallest file the engine managed.",
    },
    {
      question: "Which formats can I upload?",
      answer:
        "JPG, PNG, WebP, AVIF, and BMP. Opaque images come out as JPG because it hits byte targets most reliably; images with transparency are saved as WebP so the transparency survives.",
    },
  ],
  "resize-image": [
    {
      question: "What is Lanczos3 resampling?",
      answer:
        "Lanczos3 is a high-quality image resampling algorithm that produces sharp, artifact-free results when scaling images up or down. It's the same algorithm used by professional image editors like Photoshop.",
    },
    {
      question: "Will resizing make my image blurry?",
      answer:
        "Downscaling (making smaller) always looks great with Lanczos3 resampling. Upscaling (making larger) preserves detail well but cannot add information that isn't in the original — very large upscales may appear slightly soft.",
    },
    {
      question: "What dimensions should I use for social media?",
      answer:
        "Use the preset buttons: Instagram Post is 1080×1080, Instagram Story is 1080×1920, Twitter Header is 1500×500, LinkedIn Banner is 1584×396, YouTube Thumbnail is 1280×720.",
    },
    {
      question: "What format does the resized image come out in?",
      answer:
        "It follows the input: PNG and GIF sources come out as PNG (keeping transparency), WebP and AVIF come out as WebP, and JPG or BMP come out as JPG. There's no format picker here — resize first, then run the result through a converter tool if you need a different format.",
    },
    {
      question: "Is there a maximum output size?",
      answer:
        "Yes — both dimensions are capped at 8192 px, and percentage mode goes up to 500% of the original, still within that cap. Anything larger is clamped to the limit rather than rejected.",
    },
  ],
  "resize-image-to-20kb": [
    {
      question: "Does this tool let me choose the output dimensions?",
      answer:
        "No — this page targets a file size, not a pixel size. If you need exact output dimensions, use the Image Resizer; if you need both, resize there first and then meet the 20 KB ceiling here.",
    },
    {
      question: "Will my image's dimensions change?",
      answer:
        "For photos, almost certainly — 20 KB is below what full-resolution images can reach at any quality, so the engine scales them down in bounded steps (50% to 90% at a time, never below 64 px on the longest side) and the result reports the new size whenever it does.",
    },
    {
      question: "How small will my photo end up?",
      answer:
        "Typically a few hundred pixels on the longest side — the engine keeps the largest dimensions that still fit under 20 KB. Small images like signature crops may fit with no downscale at all.",
    },
    {
      question: "Why did I get a WebP file back?",
      answer:
        "Your image has transparency. Opaque images come out as JPG, which reaches small targets most reliably; transparent ones are saved as WebP so the transparency survives instead of turning black.",
    },
  ],
  "resize-image-to-50kb": [
    {
      question: "Does this change my image's dimensions?",
      answer:
        "Only when it must. Quality is lowered first at the original dimensions; dimensions step down in bounded increments only when no quality can reach 50 KB — and the result reports the new width and height whenever that happens.",
    },
    {
      question: "What does 'resize to 50 KB' actually do?",
      answer:
        "KB measures file size, so this page runs a target-size compressor: a binary search finds the best encoder quality at or under 50 KB, and bounded downscaling engages only as a last resort. You don't pick pixel dimensions here — the Image Resizer does that.",
    },
    {
      question: "Which images reach 50 KB without a downscale?",
      answer:
        "Roughly anything around 1000 px on the long side or smaller — at those dimensions a quality level under 50 KB exists. Larger phone photos will be scaled, and the result will say to what size.",
    },
    {
      question: "Can I set a different KB number on this page?",
      answer:
        "Yes — 50 KB is just the preloaded default. The size field takes anything from 10 KB to 10,240 KB, and there are one-tap presets for 50 KB, 100 KB, 200 KB, 500 KB, and 1 MB.",
    },
  ],
  "resize-image-to-100kb": [
    {
      question: "Does this change my image's dimensions?",
      answer:
        "Only when quality alone can't reach 100 KB. Most photos up to about 1500 px on the long side fit on quality alone; larger ones step down in bounded increments, and the result reports the new dimensions whenever that happens.",
    },
    {
      question: "How is this different from the Image Resizer?",
      answer:
        "The Image Resizer targets exact pixel dimensions; this page targets a byte ceiling. They combine well: set your pixels there first, then meet the 100 KB limit here.",
    },
    {
      question: "How accurate is the 100 KB result?",
      answer:
        "The quality search stops once it lands within 5% of the ceiling, so a large photo typically comes out between 95 and 100 KB — at or under the target, never over it when the target is reachable.",
    },
    {
      question: "Can I process a whole folder of photos at once?",
      answer:
        "Yes — drop in multiple files and they compress in parallel, one file per worker thread, then download together as a single ZIP.",
    },
  ],
  "photo-resizer-in-kb": [
    {
      question: "What does resizing a photo 'in KB' mean?",
      answer:
        "KB measures file size, not pixels — so this tool compresses to a byte target. Quality is lowered first, and pixel dimensions shrink in bounded steps only when quality alone can't reach your number, with the result reporting any new size.",
    },
    {
      question: "Which KB values do forms usually ask for?",
      answer:
        "Government and exam portals commonly want signatures at 10–20 KB, photos at 20–50 KB, and documents under 100 or 200 KB. Type the exact figure your form specifies — the field takes anything from 10 KB to 10,240 KB.",
    },
    {
      question: "Why does the page start at 100 KB?",
      answer:
        "100 KB is the most common ceiling in this family of forms, so it makes a sensible preloaded default — but it's only a default. Change it to whatever your portal demands before compressing.",
    },
    {
      question: "Will the tool change my photo's dimensions?",
      answer:
        "Only when it must to reach your target — in bounded steps of 50% to 90% at a time, never below 64 px on the longest side — and the result reports the new dimensions whenever that happens. Small targets like 20 KB usually require it; 100 KB often doesn't.",
    },
    {
      question: "My form also demands exact pixel dimensions — what do I do?",
      answer:
        "Run the photo through the Image Resizer first to set the pixels, then bring the result here to meet the KB ceiling. This page never lets you pick output dimensions directly.",
    },
  ],
  "crop-image": [
    {
      question: "How do I crop to a specific aspect ratio?",
      answer:
        "Click one of the aspect ratio buttons (1:1, 4:3, 16:9, 3:2) above the crop area. The crop selection will lock to that ratio. Choose 'Free' to crop without any ratio constraint.",
    },
    {
      question: "Can I rotate the image before cropping?",
      answer:
        "Yes! Use the rotation slider below the crop area to rotate the image from -180° to 180°. The crop area adjusts automatically.",
    },
    /*
      These three answers were written when the cropper could only write PNG,
      and Wave 0 deferred them on purpose: "crop-image stays PNG-only until the
      Wave 4 image-edit-verbs cluster adds a shared format picker; its copy must
      keep saying PNG plainly." The picker has landed, so the first of the three
      — which asked what format the crop is saved in and answered "PNG" — was
      the page's only remaining false claim. PNG is still the default; it is no
      longer the whole answer.
    */
    {
      question: "What format is the cropped image saved in?",
      answer:
        "Whichever of PNG, JPG and WebP you pick under FORMAT. PNG is the default: lossless, and it keeps transparency. JPG and WebP are re-encoded and add a quality slider. The OUTPUT panel's Format row is read back off the file you are about to download, so it can never disagree with the extension on the button.",
    },
    {
      question: "Does cropping reduce image quality?",
      answer:
        "On PNG, no — the pixels you keep are taken from the image at its full resolution and saved losslessly, so no new compression artifacts are added. The trade-off is size: a PNG crop of a JPG photo can be larger in bytes than the original file even though it holds fewer pixels. Choose JPG or WebP and the crop is re-encoded at the quality you set, which is smaller but does add compression.",
    },
    {
      question: "Why does my cropped image have transparent corners?",
      answer:
        "That happens when you rotate before cropping — any part of the crop box the rotated image no longer covers is left transparent. PNG and WebP keep it that way. JPG cannot store an alpha channel, so those areas come back white instead, and the result says when that happened. Pull the crop box fully inside the rotated image if you want neither.",
    },
  ],
  "exif-viewer": [
    {
      question: "What is EXIF data?",
      answer:
        "EXIF (Exchangeable Image File Format) is metadata embedded in photos by cameras and phones. It includes camera model, lens info, shutter speed, ISO, aperture, GPS coordinates, date/time, and more.",
    },
    {
      question: "Why should I remove EXIF data?",
      answer:
        "EXIF data can contain your exact GPS location, device information, and timestamps. Removing it before sharing photos online protects your privacy. Social media platforms strip some EXIF data, but not all services do.",
    },
    {
      question: "How does metadata removal work?",
      answer:
        "The image is decoded and re-encoded through the HTML5 Canvas API, and a canvas holds nothing but pixels, so EXIF, IPTC, XMP and the colour profile are all left behind. The pixels are re-encoded rather than copied, though: a JPEG comes back recompressed at 92% quality, colour lands in sRGB, and anything deeper than 8 bits per channel is reduced to 8. When the output is a JPEG the tool also sweeps every APP1 segment out of the finished bytes, because Safari's encoder writes a fresh Exif block into JPEGs of its own accord and a re-encode on its own would not be enough.",
    },
    {
      question: "How do I know if my photo contains GPS coordinates?",
      answer:
        "Location tags are grouped under a 'GPS Location' heading with a 'Contains location data' warning beside it, and the output panel shows Location: present or none. GPS-prefixed tags that cameras file elsewhere in the EXIF block get bucketed into that group too, so location data can't hide under another heading.",
    },
    {
      question: "Can I strip metadata from iPhone HEIC photos?",
      answer:
        "Yes — HEIC and HEIF files are decoded right in the browser, and the cleaned copy is saved as a JPEG at 92% quality, since browsers can't write HEIC. PNG stays PNG and WebP stays WebP; everything else, including TIFF, comes out as JPEG.",
    },
  ],
  "image-to-base64": [
    {
      question: "What is Base64 encoding?",
      answer:
        "Base64 is a way to represent binary data (like images) as a text string. This allows you to embed images directly in HTML, CSS, or JSON without needing a separate file. It's commonly used for small icons, logos, and email templates.",
    },
    {
      question: "When should I use Base64 images?",
      answer:
        "Base64 is ideal for very small images (under 10 KB) like icons and logos. For larger images, it's better to use regular image files because Base64 increases the data size by about 33%.",
    },
    {
      question: "What's the difference between Data URI and Raw Base64?",
      answer:
        "A Data URI includes the MIME type prefix (e.g., data:image/png;base64,...) and can be used directly in HTML <img> tags. Raw Base64 is just the encoded string without the prefix.",
    },
    {
      question: "Will an animated GIF stay animated?",
      answer:
        "Yes. This tool encodes the file's exact bytes rather than redrawing it through a canvas, so every frame survives — paste the data URI into an img tag and it plays normally. That makes it one of the few tools on this site where animation passes through untouched.",
    },
    {
      question: "Does the Base64 string contain my photo's EXIF data?",
      answer:
        "Yes — the encoding is byte-for-byte, so EXIF tags and any GPS location travel inside the string, and decoding it returns your original file exactly. Run the photo through the EXIF Data Viewer & Remover's clean-copy download first if you're embedding it somewhere public.",
    },
  ],
  "png-to-ico": [
    {
      question: "What is an ICO file?",
      answer:
        "ICO (Icon) is a file format that contains one or more images at multiple sizes and color depths. It's the standard format for website favicons (the small icon in browser tabs) and Windows desktop icons.",
    },
    {
      question: "What sizes are included in the ICO file?",
      answer:
        "The generated ICO file contains three sizes: 16×16 (browser tab), 32×32 (browser tab on high-DPI), and 48×48 (Windows shortcut). These cover all standard favicon use cases.",
    },
    {
      question: "Where do I install the favicon on my site?",
      answer:
        'Drop the .ico file at the root of your domain as /favicon.ico — browsers request it automatically. For full coverage, also add <link rel="icon" href="/favicon.ico" sizes="any"> to your HTML <head>.',
    },
    {
      question: "Does my PNG have to be square?",
      answer:
        "No — a non-square image is scaled to fit inside each square frame and centered, with the leftover margin left transparent. It is never stretched, so an 800×600 logo won't come out squashed.",
    },
    {
      question: "Is transparency preserved in the ICO?",
      answer:
        "Yes. Each of the three frames is stored inside the ICO as a 32-bit PNG, so your PNG's alpha channel survives intact — including the transparent padding around a non-square image.",
    },
  ],
  "favicon-generator": [
    {
      question: "What sizes do I need for favicons?",
      answer:
        "A complete favicon set includes: 16×16 and 32×32 for browser tabs, 48×48 for Windows, 180×180 for Apple Touch (iOS home screen), and 192×192 + 512×512 for Progressive Web Apps (PWA).",
    },
    {
      question: "What's in the ZIP download?",
      answer:
        "The ZIP contains all PNG sizes (favicon-16x16.png, favicon-32x32.png, favicon-48x48.png, apple-touch-icon.png, android-chrome-192x192.png, android-chrome-512x512.png) plus a favicon.ico file containing all three small sizes.",
    },
    {
      question: "What image should I upload?",
      answer:
        "Upload a square image at least 512×512 pixels. PNG with a transparent background works best. Simple designs with bold shapes work better than photographs because favicons are very small.",
    },
    {
      question: "Do I get the HTML tags too?",
      answer:
        "Yes — after generating, the page shows a ready-to-copy head snippet with five link tags covering the favicon.ico, the 16 and 32 px PNGs, the Apple Touch icon, and the web manifest. Paste it into your page's head and the whole set is wired up.",
    },
    {
      question: "Why are the name fields in site.webmanifest empty?",
      answer:
        "The ZIP includes a site.webmanifest that points at the two android-chrome PNGs, but its name and short_name are left blank on purpose — this tool never learns your site's name, so inventing one would be wrong. Fill in those two fields before deploying.",
    },
  ],
  "image-color-palette": [
    {
      question: "How does color extraction work?",
      answer:
        "The tool samples your image, then uses median-cut color quantization to group similar pixels together and find the most dominant colors. Each color's frequency indicates what percentage of the image it represents.",
    },
    {
      question: "How many colors can I extract?",
      answer:
        "You can choose to extract 4, 6, 8, 10, or 12 colors. Fewer colors gives you the most dominant themes; more colors captures subtle variations.",
    },
    {
      question: "Can I copy the color codes?",
      answer:
        "Yes! Click any color swatch to copy its hex code to your clipboard. Each color also shows its RGB values and frequency percentage.",
    },
    {
      question: "Why did I get fewer colors than I asked for?",
      answer:
        "The quantizer only splits color groups that actually span more than one color, so a flat-color graphic — say a three-color logo — returns three swatches even if you asked for 12. Padding the palette out further would only produce duplicate swatches.",
    },
    {
      question: "Why doesn't a hex code match the exact pixel I'm looking at?",
      answer:
        "Each swatch is the average of a whole group of similar pixels, not any single pixel, and the image is sampled at reduced resolution (up to 200 px on the longest side) before analysis. The palette describes the image's overall color character rather than one precise point.",
    },
  ],
  "tiff-to-jpg": [
    {
      question: "What is TIFF used for?",
      answer:
        "TIFF (Tagged Image File Format) is commonly used in photography, publishing, scanning, and archival. It supports high color depths, multiple layers, and lossless compression — but produces large files.",
    },
    {
      question: "Can browsers normally open TIFF files?",
      answer:
        "No, most web browsers cannot display TIFF images natively. This tool uses the utif2 library to decode the TIFF data in your browser, then re-encodes it as a widely compatible JPG.",
    },
    {
      question: "Will converting TIFF to JPG lose quality?",
      answer:
        "Some quality is lost because JPG uses lossy compression while TIFF is typically lossless. For most uses, setting the quality slider to 90-95% produces results that are visually identical to the original.",
    },
    {
      question: "Does this support multi-page TIFFs?",
      answer:
        "Currently, this tool converts the first page of a multi-page TIFF. For multi-page documents, consider splitting the TIFF into individual pages first.",
    },
  ],
  "jfif-to-jpg": [
    {
      question: "Is JFIF the same as JPEG?",
      answer:
        "Yes. JFIF (JPEG File Interchange Format) is the standard container that most JPEG files on disk already use — a .jfif file and a .jpg file hold the same kind of data. The extension is the only difference, which is why this tool renames instead of converting.",
    },
    {
      question: "Will the image quality change?",
      answer:
        "No — the output is byte-identical to the input. The tool never decodes or re-encodes the image; it verifies the bytes start with the JPEG SOI marker and hands the exact same bytes back under a .jpg name. Zero quality change, and EXIF, color profiles, and every other byte of metadata survive untouched.",
    },
    {
      question: "Why do websites reject .jfif files?",
      answer:
        "Their upload validators check the file name, not the bytes. A form that whitelists .jpg and .jpeg turns away a .jfif even though it is the same JPEG data underneath. Windows saves some downloaded JPEGs with the .jfif extension, which is how most people end up with one.",
    },
    {
      question: "Can I just rename the file myself?",
      answer:
        "Yes — renaming photo.jfif to photo.jpg in Finder or Explorer gives the same result, and if that works for you, do it. What this tool adds is a byte check: it confirms the file really is JPEG data before renaming, so a mislabeled PNG or WebP is caught here instead of failing at the upload it was headed for.",
    },
    {
      question: "What if my file isn't actually a JPEG?",
      answer:
        "The tool refuses and tells you so — \"This file isn't JPEG data underneath — only real JPEGs can be renamed to .jpg.\" A blind rename would hand you a .jpg that breaks wherever it lands; refusing is the honest outcome. Convert the file with the matching converter (PNG to JPG, WebP to JPG) instead.",
    },
  ],
  /*
    Wave 4's image-edit verbs. Every one of them decodes, redraws on a canvas
    and re-encodes, so the same two answers keep coming back — the turn is not
    lossless, and the metadata does not survive — and they are written out on
    each page rather than cross-referenced, because a reader arrives at one
    page and reads only that one.
  */
  "rotate-image": [
    {
      question: "Why does my phone photo already look upright before I rotate it?",
      answer:
        "Because the browser turned it for you. A phone writes the picture sideways and adds an EXIF Orientation tag saying how to display it, and the decoder applies that tag before this page sees any pixels. The turn you choose here is added on top of what you can see, which is why the preview, the dimension readout and the download always agree.",
    },
    {
      question: "Is rotating an image here lossless?",
      answer:
        "No, and the page never says it is. The image is decoded, redrawn onto a new canvas and re-encoded. Choosing PNG adds no new compression artefacts, but it is still a re-encode; choosing JPG costs a compression generation. A genuinely lossless JPEG turn rewrites the EXIF orientation tag instead of the pixels, and that is a different operation from this one.",
    },
    {
      question: "Can I rotate by an angle that is not a multiple of 90°?",
      answer:
        "Not here. A quarter, half or three-quarter turn maps every pixel onto a whole pixel and leaves a rectangle. An arbitrary angle leaves transparent corners and forces a decision about cropping, which is a different tool: the image cropper lets you straighten a tilted photo and then choose what to keep.",
    },
    {
      question: "What happens to my EXIF and GPS data?",
      answer:
        "It is not carried through. The download is written from the decoded pixels, so camera, timestamp and location tags do not survive the turn, and any ICC colour profile goes with them. If you want to read those tags before they go, open the file in the EXIF viewer first.",
    },
    {
      question: "Which output format should I pick?",
      answer:
        "The page starts on whatever you dropped, which is usually the right answer. PNG re-encodes losslessly and keeps transparency, but a photo written as PNG can be several times larger than the JPEG you started with. JPG is small and lossy and cannot store transparency at all, so anything transparent comes back white. WebP does both and is usually the smallest of the three.",
    },
  ],
  "flip-image": [
    {
      question: "What is the difference between flipping and rotating?",
      answer:
        "A rotation turns the picture about its centre; a quarter turn swaps its width and height. A flip reflects it across an axis and moves no edge at all, so the dimensions never change. Text is the giveaway: a rotated sign is still readable if you tilt your head, a flipped one is mirror writing.",
    },
    {
      question: "Why does my face look wrong after flipping a selfie?",
      answer:
        "Most phone cameras already mirror the front-facing preview, so the selfie you see while shooting is not the face other people see. Flipping horizontally undoes that mirror. Nothing is broken — you are just seeing yourself the way a photograph does rather than the way a mirror does.",
    },
    {
      question: "Does flipping change the dimensions or the file size?",
      answer:
        "The dimensions never change, because a mirror moves no edge. The byte count usually does: the picture is decoded and re-encoded, so the new file is whatever the encoder you chose produces at the quality you chose. That is stated on the page as IN and OUT rather than assumed.",
    },
    {
      question: "Is a flip here lossless?",
      answer:
        "No, and the page never says it is. The image is decoded, redrawn onto a new canvas and re-encoded. PNG output adds no new compression artefacts but is still a re-encode; JPG output costs a compression generation. There is no orientation flag for a mirror the way there is for a rotation, so the pixels have to move.",
    },
    {
      question: "What happens to my EXIF and GPS data?",
      answer:
        "It is not carried through. The download is written from the decoded pixels, so camera, timestamp and location tags do not survive the flip, and any ICC colour profile goes with them. Read them with the EXIF viewer first if you need them.",
    },
  ],
  "add-border": [
    {
      question: "How much bigger does the image get?",
      answer:
        "Exactly the sum of the edges, and the page shows the sum before you run it. An 800 × 600 picture with 20 pixels on every edge becomes 840 × 640: the width gains left plus right, the height gains top plus bottom. Nothing is resampled, so the picture inside the frame is the same size it always was.",
    },
    {
      question: "Can each edge have a different width?",
      answer:
        "Yes. The edges start linked so one number frames the whole picture. Click the chain-link button under BORDER and the single All edges field becomes four — Top, Right, Bottom and Left — each with its own width. That is how you build a caption strip along the bottom or an off-centre matte for printing.",
    },
    {
      question: "Can the border be transparent?",
      answer:
        "No. The frame is filled with the six-digit hex colour you choose, so it is always painted. A transparent margin is a different operation from painting one, and this tool does not offer it rather than pretending a white fill is the same thing.",
    },
    {
      question: "Does adding a border crop or shrink my picture?",
      answer:
        "Neither. The canvas is enlarged and your image is drawn into it whole at its original size, so the border is added around the picture rather than over it. If you want the frame to eat into the edges instead, crop first and then add the border.",
    },
    {
      question: "Which output format should I pick for a bordered image?",
      answer:
        "The page starts on whatever you dropped. PNG re-encodes losslessly and keeps any transparency inside the picture, but a photo written as PNG can be much larger than the JPEG you started with. JPG is smaller and cannot store an alpha channel, so anything transparent is painted white on the way out. WebP usually lands smallest.",
    },
  ],
  "watermark-image": [
    {
      question: "Does a watermark stop someone using my image?",
      answer:
        "No. The text becomes part of the picture, so it survives re-saving, screenshots and a format change — but anyone can crop it off, clone it out or cover it, and nothing here prevents a copy being made. Treat it as a visible credit and an obstacle, not as protection. Tiling puts the text over the subject itself, which is the version that is genuinely awkward to remove.",
    },
    {
      question: "Can I put the watermark across the whole image?",
      answer:
        "Yes — choose Tiled and the text repeats across the picture instead of sitting in one corner. Rotation applies to every repeat, so a diagonal tile is one slider away.",
    },
    {
      question: "Why does my transparent PNG come out with a white background?",
      answer:
        "Because the output format is JPG, which cannot carry an alpha channel. Transparent pixels are filled with white before the watermark is drawn. The tool probes the decoded image rather than guessing from the file extension, so it warns you only when your source really does carry transparency. Choose PNG or WebP to keep it.",
    },
    {
      question: "How is the watermark size decided?",
      answer:
        "Size is a share of the image's shorter edge, not a pixel count, so the same setting looks the same on a 900 px thumbnail and a 6000 px original. The preview is drawn at the output's own size, so the proportion you see is the proportion you get.",
    },
    {
      question: "Does the watermark change the image dimensions?",
      answer:
        "No. The output has exactly the pixel dimensions of the source; only the pixels under the text change. Metadata is a different story — the image is redrawn on a canvas to apply the mark, so EXIF and GPS tags are not carried over.",
    },
  ],
  "pixelate-image": [
    {
      question: "Can pixelation be reversed?",
      answer:
        "Not from the pixels alone — the original detail is not stored anywhere in the file. That is not the same as being safe. When the covered content comes from a small, known set — a six-digit code, a number plate, a date — someone can re-render every candidate at the same block size and compare it against your blocks, and pixelation has been undone that way. For anything that must stay secret, crop it out rather than pixelate it.",
    },
    {
      question: "Does this pixelate the whole image or just part of it?",
      answer:
        "Either. Drag a rectangle on the preview to cover one region; with no rectangle set, the whole image is pixelated. The dashed outline marks the region on screen only — it is not drawn into the file you download.",
    },
    {
      question: "What does block size actually mean?",
      answer:
        "It is the width of one flat square, measured in the image's own pixels. A 16 px block across a 4000 px wide photo is far less obvious than the same 16 px on a 400 px thumbnail, which is why the readout stays in the image's units instead of the preview's.",
    },
    {
      question: "Why do the region numbers not match where I dragged on screen?",
      answer:
        "They do — they are the same rectangle expressed in the image's pixels. The preview is scaled down to fit the stage, so a 150-pixel drag across a 1200 px image shown 600 px wide is 300 image pixels. The X, Y, Width and Height fields always show the numbers the engine is given.",
    },
    {
      question: "Which output format should I choose?",
      answer:
        "PNG keeps every block exactly as drawn and keeps transparency. WebP does both in a smaller file. JPG is smaller still but cannot carry an alpha channel, so a transparent source is painted white first, and its own compression softens the hard edges between blocks in a way PNG and WebP do not.",
    },
  ],
  "crop-circle": [
    {
      question: "Why is there no JPG option?",
      answer:
        "Because a JPEG cannot store transparency. The whole point of a circular crop is that the corners are empty, and a JPEG would fill them with white — you would get a circle painted on a white square. PNG and WebP both carry an alpha channel, so those are the two formats offered.",
    },
    {
      question: "Is the file I download actually circular?",
      answer:
        "No, and no tool can make it so: every raster image format is a rectangle. What you get is a square image whose corners are fully transparent. It reads as a circle anywhere transparency is honoured — a web page, a slide, an app that masks avatars — and as a square on a viewer that paints its own background behind the image.",
    },
    {
      question: "How do I crop a circle that is not in the middle?",
      answer:
        "Lower the Diameter slider first — that creates slack — then use the Horizontal and Vertical sliders to move the circle within it. Each slider's readout shows the result in pixels. At 100% diameter the circle already spans the shorter edge, so it can only move along the longer one, and the slider that cannot move anything is disabled rather than left to slide with no effect.",
    },
    {
      question: "Can I use the result as a profile picture?",
      answer:
        "Yes. Save it as PNG or WebP and upload it wherever you need it. Many apps mask avatars to a circle themselves, in which case a square crop would have worked too — but a pre-cut circle is what you want for anywhere that does not, such as a slide deck, a document or an email signature.",
    },
    {
      question: "Does cropping to a circle reduce image quality?",
      answer:
        "The pixels inside the circle are taken at full resolution, and PNG output is lossless from that point on. What does cost something is the decode-and-re-encode this tool has to do: if your source was a JPEG, the crop is one more generation away from the original. Saving as PNG stops any further loss.",
    },
  ],
  "image-splitter": [
    {
      question: "Do the tiles add up to the original picture?",
      answer:
        "Yes, exactly, and the page shows the addition rather than asking you to take it on trust. Under the grid it prints the tile widths term by term with their total — for example 333 + 334 + 333 = 1000 — beside the source dimensions in the header. Reassembled, the tiles are the picture you started with, with no seam and no missing strip.",
    },
    {
      question: "What happens when the picture does not divide evenly?",
      answer:
        "The leftover pixels are handed out one per tile rather than being padded, stretched or dropped. That means an axis can have two tile sizes that differ by one pixel — 1000 across three columns is 333, 334 and 333 — and the rail's Tile size row shows that as a range so the difference is never a surprise.",
    },
    {
      question: "How many tiles can I make?",
      answer:
        "Up to ten rows by ten columns, so a hundred tiles at most. A picture with fewer pixels than the grid asks for is cut into as many tiles as it has pixels on that axis, and the page says so rather than silently giving you a different grid than the one you typed.",
    },
    {
      question: "How are the tiles named?",
      answer:
        "After their position in the grid, one-based and row-major: photo-r1c1.png is the top-left tile and photo-r2c3.png is the third tile in the second row. A file browser sorting by name puts them back in reading order, which is what you want when you upload a carousel in sequence.",
    },
    {
      question: "Can I save just one tile?",
      answer:
        "Yes. Click any tile in the grid and it downloads on its own under its own name. The button in the sidebar takes the whole set as one ZIP instead, because browsers throttle or cancel a burst of separate downloads fired at once and you would only get the first few.",
    },
  ],
  "social-media-image-resizer": [
    {
      question: "Are these the sizes each platform requires right now?",
      answer:
        "They are the pixel sizes this tool writes, which is the only thing it can honestly promise. Platform specifications change and this page ships as a static file with no way to check one, so the numbers are stated as dimensions and the platform names beside them as what that size is commonly used for. If a network's current requirement matters for what you are posting, check it there.",
    },
    {
      question: "What is the difference between Cover and Contain?",
      answer:
        "Cover scales the picture until it fills the frame in both directions and crops whatever hangs over the edges — it is the one that loses parts of the picture. Contain scales it until the whole thing fits inside the frame and fills the space left over with the pad colour. Each preview card shows the framing your current setting will produce, so the crop is visible before you run it.",
    },
    {
      question: "What happens if my picture is smaller than the frame?",
      answer:
        "It is enlarged to fill it, which no resizer can do without softening the result. Rather than a general caveat, the page measures your picture against the frames you have actually selected and names how many of them are bigger than it, so you know which of the files you are about to save will look soft.",
    },
    {
      question: "Can I choose the colour of the padding?",
      answer:
        "Yes, whenever Contain is selected. A Pad colour swatch appears in the sidebar and the preview cards repaint to that colour immediately, so you can match the background you are posting onto. Cover crops instead of padding, so there is nothing to colour and the control is not shown.",
    },
    {
      question: "How are the output files named?",
      answer:
        "Each file is named after your original plus the frame it was written for — photo-square-1080.jpg, photo-story-1080x1920.jpg, photo-link-1200x630.jpg. Picking several at once saves them together as one ZIP, because browsers throttle a burst of separate downloads; picking one saves that file directly rather than zipping a single item.",
    },
  ],

  /*
    The three tools that touch bytes rather than pixels. Their answers carry
    real measurements — oxipng's ratios, the ICO directory layout, the two
    places a file can state its resolution — because in each case the number
    IS the product claim and a rounded-off version of it would be a promise
    the run cannot keep.
  */
  "bcrypt-generator": [
    {
      question: "Is my password sent anywhere?",
      answer:
        "No, and that is the reason to use this one rather than the first result on a search. Hashing happens in your tab — there is no request carrying the password, no server-side hashing, and no log. Every online bcrypt tool that hashes on its server has, by definition, seen the plaintext of whatever you typed. If the password is one you actually use somewhere, that distinction is the whole thing.",
    },
    {
      question: "What work factor should I use?",
      answer:
        "Ten is what most frameworks default to and twelve is the common current advice, but the number that should decide it is the one this page shows you: how long the hash actually took on your own machine. Each step DOUBLES the work, so twelve is roughly four times ten, not twenty per cent more. Pick the highest cost your server can afford at your login rate — the same multiple falls on anyone attacking a stolen database.",
    },
    {
      question: "Why does the same password give a different hash every time?",
      answer:
        "Because bcrypt generates a fresh random salt for each hash, and the salt is stored inside the result. That is the property that makes bcrypt worth using: two people with the same password get different hashes, so an attacker cannot precompute a lookup table or spot that two accounts share a password. Both hashes still verify against the original password — the checker on this page will confirm it.",
    },
    {
      question: "Why does the page freeze at high cost settings?",
      answer:
        "Because bcrypt is deliberately expensive and the work happens on the page's own thread. That is the algorithm doing exactly what it is for, not a hang, and the page says so before it starts. The slider stops at 14 for this reason: each further step doubles the wait, and past that point a browser tab looks broken rather than busy.",
    },
    {
      question: "Can I check a password against a hash I already have?",
      answer:
        "Yes — paste the hash into the checker in the sidebar and it will compare it against the password in the field above. It reports three outcomes, not two: match, no match, and 'that is not a bcrypt hash'. The third exists because collapsing it into 'no match' tells you your password is wrong when what is actually wrong is the string you pasted, which wastes a great deal of time.",
    },
    {
      question: "Is bcrypt still the right choice?",
      answer:
        "For most applications, yes — it is well understood, available everywhere, and correctly used it is a sound default. Argon2id is the current recommendation where you can choose freely, because it resists GPU and custom-hardware attacks better, and scrypt sits between them. What matters far more than the choice between them is not using a fast general-purpose hash: SHA-256 and MD5 are designed to be quick, which is exactly the wrong property for a stored password.",
    },
  ],
  "gif-maker": [
    {
      question: "What order do my images end up in?",
      answer:
        "Sorted by filename, using a numeric comparison rather than a plain alphabetical one — so frame-2 comes before frame-10, which is what you meant and not what a naive sort does. Files dropped onto a page arrive in whatever order the operating system hands them over, which is rarely the order you intended, so leaving it to chance would make the tool unpredictable. If your pictures are named in sequence, you get that sequence.",
    },
    {
      question: "My photos are different shapes. What happens?",
      answer:
        "Each one is fitted inside the canvas with its proportions kept, and the spare space is left transparent. Every frame of a GIF has to be the same size — the format has one screen and places frames on it — so something has to give when the inputs differ. The alternative is stretching each picture to fill the frame, which distorts faces and is what makes a home-made GIF look subtly wrong. The canvas is sized from the largest picture, capped, so nothing is ever enlarged.",
    },
    {
      question: "How fast can it go?",
      answer:
        "Down to about twenty milliseconds a frame, which is roughly fifty frames a second. That is not an arbitrary cap: a GIF stores each frame's delay in hundredths of a second, so shorter delays cannot be described by the format at all, and browsers substitute their own timing for anything they consider implausible. The slider shows the delay and the equivalent frame rate together so you can see both.",
    },
    {
      question: "Why is the file so large?",
      answer:
        "Because GIF is an old format with no interframe compression worth the name — every frame is stored close to whole, so the size is roughly the pixel count multiplied by the frame count. Fewer frames and smaller dimensions are the two levers that matter, and dimensions matter most because they reduce every frame at once. If the result is for the web and it does not have to be a GIF, a short video file will be a fraction of the size.",
    },
    {
      question: "Is anything uploaded?",
      answer:
        "No. The pictures are decoded in your tab and the animation is built there with gifenc, the encoder this site already carries for its video-to-GIF tool. Nothing is sent anywhere and no engine is downloaded for this.",
    },
  ],
  "csv-markdown-table": [
    {
      question: "Why does it escape pipes?",
      answer:
        "Because a pipe ends a cell in Markdown, so one unescaped pipe silently changes the shape of your table. A single URL with a query string in it turns a two-column table into a three-column one — and the output is still a valid Markdown table, just not the one your data describes, which is why it is easy to miss. Backslashes are escaped too, since otherwise they would consume the escape character.",
    },
    {
      question: "What happens to a cell with a line break in it?",
      answer:
        "It becomes a break tag. A Markdown table row cannot contain a real newline at all — the row ends there — so the choice is between a break tag, dropping the break, or refusing the file. The break tag is what every Markdown renderer understands, and it survives a round trip back to CSV, which the other two options do not.",
    },
    {
      question: "Can it go the other way?",
      answer:
        "Yes, and the swap button feeds the current result back in, so a round trip is one click. That is worth doing on anything important: if a table comes back out as the CSV you put in, nothing was lost in between. Going from Markdown to CSV, the alignment row is recognised as structure rather than read as data — which is the mistake that inserts a row of dashes into your spreadsheet.",
    },
    {
      question: "What does 'line the columns up' actually change?",
      answer:
        "Only the source. It pads each cell with spaces so the table is readable as plain text and in a diff, which is where you will actually look at it. Every Markdown renderer ignores that padding entirely, so the rendered table is identical either way. It is on by default because an unpadded table is unpleasant to read in a pull request, and it can be turned off when you want the smallest possible output.",
    },
    {
      question: "What if some rows have fewer columns than others?",
      answer:
        "They are padded out to the widest row rather than rejected. A ragged CSV is common — a trailing comma, an export that omits empty trailing fields — and a table with a couple of empty cells is far more useful than an error message. The row count and column count are shown so you can see what it decided.",
    },
  ],
  "resize-gif": [
    {
      question: "Will this turn my animation into a still?",
      answer:
        "No, and that is the main reason this page exists. The ordinary way a browser reads an image keeps only the first frame, which is why so many tools that claim to resize a GIF quietly hand back a single picture. This decodes the whole animation first, scales every frame, and writes them back with the delays the original stored.",
    },
    {
      question: "How much smaller will the file get?",
      answer:
        "It depends on the picture, but scaling down is by far the most effective lever available. A GIF's size is roughly its pixel count multiplied by its frame count, so halving the dimensions removes three quarters of the pixels in every frame at once — that usually does more than any amount of palette tuning. The page shows the resulting file size so you can judge it against the original rather than take a promise.",
    },
    {
      question: "Why can I only scale down, not up?",
      answer:
        "Because scaling up cannot add detail that is not there. Enlarging a GIF gives you a bigger, softer version of the same picture and a considerably larger file, which is almost never what someone wants from a tool called 'resize'. If you genuinely need a larger canvas, that is a different job.",
    },
    {
      question: "Does re-encoding lose quality?",
      answer:
        "Re-encoding a GIF is not lossless, and it is worth knowing why. A GIF holds at most 256 colours per frame, so rebuilding the file means choosing that palette again from the decoded pixels. Flat colour, line art, screenshots and text come through cleanly. Photographic frames and fine gradients can band slightly, because the second palette is not guaranteed to be the first one. Your original file is untouched either way, so you can always compare.",
    },
    {
      question: "Is my GIF uploaded?",
      answer:
        "The animation is decoded frame by frame in your tab and written back with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no extra engine is downloaded. Two decoders are used depending on your browser: Chrome, Edge and Firefox have a built-in image decoder that returns frames directly, and Safari does not, so a small bundled JavaScript reader handles it there. Both produce the same frames; the difference is only in who does the work.",
    },
  ],
  "gif-speed-changer": [
    {
      question: "Does speeding it up drop frames?",
      answer:
        "No. Changing speed here means rescaling how long each frame is displayed, not adding or removing frames. That distinction matters: a tool that speeds things up by dropping frames makes the result visibly choppier while appearing to do what you asked. Every frame in your file survives, at every speed setting.",
    },
    {
      question: "Why does it stop getting faster past a point?",
      answer:
        "Because the format runs out of room to describe it. A GIF stores each frame's delay in hundredths of a second, so around twenty milliseconds per frame is as fast as the file can honestly say — and browsers substitute their own timing for anything shorter, which means different people would see different speeds. The page states the floor rather than letting you drag a slider that has quietly stopped doing anything. Slowing down has no such limit.",
    },
    {
      question: "Can I set a specific frame rate instead?",
      answer:
        "Not directly. GIF has no frame rate — it has a delay per frame, and those delays do not have to be equal. Many real GIFs hold one frame much longer than the rest, and imposing a single frame rate would flatten that deliberate pause. Working in percentages keeps the original rhythm and just stretches or compresses it.",
    },
    {
      question: "Does re-encoding lose quality?",
      answer:
        "Re-encoding a GIF is not lossless, and it is worth knowing why. A GIF holds at most 256 colours per frame, so rebuilding the file means choosing that palette again from the decoded pixels. Flat colour, line art, screenshots and text come through cleanly. Photographic frames and fine gradients can band slightly, because the second palette is not guaranteed to be the first one. Your original file is untouched either way, so you can always compare.",
    },
    {
      question: "Is my GIF uploaded?",
      answer:
        "The animation is decoded frame by frame in your tab and written back with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no extra engine is downloaded. Two decoders are used depending on your browser: Chrome, Edge and Firefox have a built-in image decoder that returns frames directly, and Safari does not, so a small bundled JavaScript reader handles it there. Both produce the same frames; the difference is only in who does the work.",
    },
  ],
  "reverse-gif": [
    {
      question: "Does it reverse the timing too?",
      answer:
        "Yes, and this is the part most implementations get subtly wrong. A GIF's delay belongs to the frame it is stored with — it means 'show this picture for this long' — so flipping the picture order while leaving the delays in place produces an animation whose timing no longer matches its own frames. If the original paused on its last frame, a naively reversed copy pauses on whatever is now last. Here the pairs are reversed together, so a GIF that lingered at the end lingers at the beginning.",
    },
    {
      question: "Can I make it play forwards then backwards?",
      answer:
        "Not from this page — it produces a straight reversal. A boomerang effect means appending the reversed frames to the originals, which doubles the frame count and therefore roughly doubles the file size, and it needs a decision about whether the first and last frames are repeated at the turn. That is a different tool rather than a checkbox on this one.",
    },
    {
      question: "There is nothing to configure. Is that right?",
      answer:
        "Yes. Reversing has no settings — the frames come back in the opposite order with their delays attached, and there is no meaningful option to offer. The file starts converting as soon as it has been read.",
    },
    {
      question: "Does re-encoding lose quality?",
      answer:
        "Re-encoding a GIF is not lossless, and it is worth knowing why. A GIF holds at most 256 colours per frame, so rebuilding the file means choosing that palette again from the decoded pixels. Flat colour, line art, screenshots and text come through cleanly. Photographic frames and fine gradients can band slightly, because the second palette is not guaranteed to be the first one. Your original file is untouched either way, so you can always compare.",
    },
    {
      question: "Is my GIF uploaded?",
      answer:
        "The animation is decoded frame by frame in your tab and written back with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no extra engine is downloaded. Two decoders are used depending on your browser: Chrome, Edge and Firefox have a built-in image decoder that returns frames directly, and Safari does not, so a small bundled JavaScript reader handles it there. Both produce the same frames; the difference is only in who does the work.",
    },
  ],
  "split-gif": [
    {
      question: "Why are the frames PNG and not GIF?",
      answer:
        "Because decoding an animation composites each frame into a complete picture — most GIF frames store only the rectangle that changed since the last one, so the decoder has to rebuild the whole image before it can hand it over. Writing those complete frames back through a 256-colour palette would throw away exactly what the decode just recovered, for no benefit. PNG keeps them as they were reconstructed.",
    },
    {
      question: "What order are the files in?",
      answer:
        "Playing order, numbered from one and zero-padded to the length of the frame count — frame-001.png, frame-002.png and so on. The padding is what makes a two-hundred-frame archive unzip and sort in the right sequence instead of putting frame-10 before frame-2.",
    },
    {
      question: "Do I get the frame timings as well?",
      answer:
        "Not as a separate file. Each frame is exported as a picture, and PNG has nowhere to record how long it was displayed. If you need the timings, the speed-changer page reads and shows them; for reassembling an animation, the video-to-GIF tool builds one from frames at a rate you choose.",
    },
    {
      question: "Is there a limit on how many frames?",
      answer:
        "Nothing is enforced, but there is a real ceiling: every frame is held decoded in memory at once while the archive is built, and a long animation at full size can exhaust the tab before it finishes. A few hundred frames is comfortable; several thousand at full resolution may not be.",
    },
    {
      question: "Is my GIF uploaded?",
      answer:
        "The animation is decoded frame by frame in your tab and written back with gifenc, which this site already carries for its video-to-GIF tool — so nothing is uploaded and no extra engine is downloaded. Two decoders are used depending on your browser: Chrome, Edge and Firefox have a built-in image decoder that returns frames directly, and Safari does not, so a small bundled JavaScript reader handles it there. Both produce the same frames; the difference is only in who does the work.",
    },
  ],
  "vcf-to-csv": [
    {
      question: "Are my contacts uploaded?",
      answer:
        "No. The file is read in this tab and nothing is sent anywhere — no upload, no temporary copy on a server, no request carrying any part of it. That matters more for this file than for almost anything else on the site: a .vcf is every name, phone number, email address and home address of everyone you know, in one plain-text file. Every free VCF-to-CSV converter that asks you to upload it has taken a copy of exactly that.",
    },
    {
      question: "What happens to contacts with several emails or phone numbers?",
      answer:
        "Each one gets its own numbered column — Email 1, Email 2, and so on — and the number of columns is worked out from your file, so a list whose busiest contact has two emails gets two columns rather than a fixed ten mostly empty ones. This is deliberate and it is the main reason to prefer this over a quick script. The common alternative is to cram them into one cell separated by semicolons, which looks fine and then loses every address after the first when you import the sheet somewhere else, because that cell is a single string to every importer.",
    },
    {
      question: "Why are some properties listed as left out?",
      answer:
        "Because they were in your file and there is no column for them, and telling you is better than dropping them in silence. vCard allows arbitrary extensions — X-SOCIALPROFILE, X-ABRELATEDNAMES and whatever an exporter felt like inventing — and no fixed set of columns can cover them. Photos are left out on purpose too: a portrait is stored as base64 inside the card, and putting a few hundred kilobytes of it into a spreadsheet cell helps nobody.",
    },
    {
      question: "My file has one long note that came out mangled elsewhere. Will it work here?",
      answer:
        "It should. vCard splits any line longer than 75 characters across several lines, continuing each with a leading space, so long notes and addresses routinely arrive in pieces. A converter that reads line by line does not crash on this — it silently truncates the field and can invent extra rows, which is worse than an error because the output still looks like a contact list. This unfolds those lines before parsing anything, and there is a test for the three-line case specifically.",
    },
  ],
  "ics-to-csv": [
    {
      question: "Is my calendar uploaded?",
      answer:
        "No. The file is read in this tab and nothing leaves it. A calendar export is a diary — who you meet, where you go, and by implication when you are not at home — so it is worth being explicit that no part of it is sent anywhere at any point.",
    },
    {
      question: "Why are the times not converted to my time zone?",
      answer:
        "Because converting them means guessing, and a wrong guess is invisible. An iCalendar time can be UTC, it can be floating with no zone at all, or it can name a zone whose rules are defined elsewhere in the same file. Rewriting all three into one zone would move some appointments by hours with nothing on screen to say it had happened. So the wall-clock time is written exactly as your calendar stores it and the zone goes in its own column, where you can see which is which and convert deliberately if you need to.",
    },
    {
      question: "A weekly meeting only appears once. Is that a bug?",
      answer:
        "No, that is what the file says. A repeating event is stored once with a rule describing how it repeats — it is not stored as fifty-two events — and the rule is written into the Repeats column. Expanding it here would turn one row into hundreds and would mean resolving counts, end dates, cancelled occurrences and the calendar's own time zone, each of which is a chance to put an appointment in your spreadsheet that does not exist in your calendar. If you want the individual occurrences, a calendar application is the right thing to ask.",
    },
    {
      question: "What about reminders, to-dos and free/busy blocks?",
      answer:
        "Only events become rows. A reminder is stored inside its event, and its own summary is deliberately kept out of the event's columns — otherwise the text of an alert ends up where the meeting title should be. To-dos and journal entries are different block types and are not listed, so a calendar containing only those will come back empty and say so. Anything present on an event with no column of its own is named on the page rather than dropped quietly.",
    },
  ],
  "ocr-pdf": [
    {
      question: "Does this change how my PDF looks?",
      answer:
        "No, and that is the point of doing it this way. The recognised words are written into the file as text in rendering mode 3 — the PDF instruction for 'lay this text out and draw none of it' — so a viewer runs the whole text machinery and rasterises nothing. Your pages are not rebuilt or re-encoded: the scan's own images, their compression and any vector artwork are exactly the bytes you gave us, and the text is appended alongside them. Rendered side by side, a page before and after is pixel-for-pixel identical. That is measured, not assumed — in two independent renderers, at every page rotation.",
    },
    {
      question: "How accurate is the searchable text?",
      answer:
        "It is OCR, so it is a guess, and here the mistakes are harder to catch than usual. On a page of ordinary text you can see when a word has been misread. Here you cannot: what you see is the original scan, which is right, and what you search or copy is the recognition, which may not be. A misread digit in an invoice total does not announce itself. Clean, high-contrast, straight scans of printed text do very well; photographs of pages, low-resolution scans, heavy skew and text over busy backgrounds all do noticeably worse. The page shows Tesseract's own mean confidence, but treat it as a hint — a confident wrong answer is entirely possible.",
    },
    {
      question: "Can I edit the text now?",
      answer:
        "No. This makes a document searchable, not editable, and the difference is the whole design. The words are an invisible layer positioned over a picture of the page — they are not a retyping of it, and the picture underneath is still a picture. Nothing on this site can turn a scan into an editable document, and anything that claims to is really rebuilding the page from its own guess, which is how a signature or a figure quietly changes. If you want to add text, white something out or sign a page, PDF Editor does that on top of the page as it stands.",
    },
    {
      question: "My PDF already has selectable text — should I use this?",
      answer:
        "No, and the page will warn you if it spots that. A PDF that was exported rather than scanned already carries the real characters the file stores, which are exact rather than recognised. Adding OCR on top means search and copy return everything twice, and the less accurate copy is the one you just added. PDF to Text will give you that existing text as a .txt file with no guessing involved. The one case where this tool still makes sense is a mixed document — a scan bound into a digital report — where some pages have text and some do not; the warning names which pages already have it.",
    },
    {
      question: "Why did my file get bigger?",
      answer:
        "Because a text layer is new content. It is usually small — the words themselves plus a font dictionary of about 1.3 KB for the whole document, since the font carries no glyph outlines at all (nothing is ever drawn, so none are needed). Growth of a few kilobytes per page is normal. Nothing is removed to make room, and the original page content is untouched, so the increase is close to the size of the text you gained.",
    },
    {
      question: "Is my document uploaded?",
      answer:
        "No. Tesseract is compiled to WebAssembly and served from this site as a file — about 4.9 MB, fetched the first time you run OCR and not before — and it reads pages your browser has already rendered in the tab. The PDF never leaves your device at any point, which matters more here than almost anywhere else on this site: the documents people run OCR over are contracts, invoices, medical records and identity papers. It is the same engine Image to Text uses, so if you have used that already, this costs no extra download.",
    },
  ],
  "image-to-text": [
    {
      question: "Is my image uploaded anywhere?",
      answer:
        "No, and this is the tool where that matters most. The engine is what travels: Tesseract is compiled to WebAssembly and fetched from this site as a file, then it reads a picture your browser already has in memory. Nothing about the image is sent anywhere at any point, and the page makes no network request at all until you actually drop something. That is worth stating plainly here because of what people run OCR over — receipts, invoices, passports, prescriptions, contracts, screenshots of private conversations. Every free OCR site that asks you to upload one of those has taken a copy of it.",
    },
    {
      question: "How accurate is it, really?",
      answer:
        "Very good on clean printed text, and noticeably worse on everything else. A screenshot, a PDF page rendered to an image, or a flatbed scan of a printed document is close to the ideal case. A photograph taken at an angle, a low-resolution image, text over a busy background, or a decorative typeface will all produce mistakes, and the mistakes look like ordinary words rather than obvious garbage — a misread digit in an invoice total does not announce itself. The page shows Tesseract's own mean confidence, but treat that as a hint rather than a verdict: a confident wrong answer is entirely possible. Check anything that matters against the picture.",
    },
    {
      question: "Can it read handwriting?",
      answer:
        "No. Not badly — not at all. Handwriting recognition is a different class of model from printed-text OCR, not a setting you can turn on, and the English model here is trained on printed type. A page of handwriting will come back as empty or as nonsense. The same goes for heavily stylised display lettering and most handwriting-imitation fonts.",
    },
    {
      question: "Why does the first image take so long?",
      answer:
        "Because the first one also downloads the engine. Tesseract plus its English language model is about 4.9 MB, and none of it is fetched when you open the page — only when you give it something to read. After that first fetch the browser has it cached, and later images pay only for the recognition itself, which is usually a second or two for a screenshot and longer for a full-page scan. If you want it available with no network at all, the offline-access page will store it for you, by name and with the size in front of you.",
    },
    {
      question: "What happens to columns and tables?",
      answer:
        "They lose their shape. Tesseract reads down the page, so a two-column article comes back as the whole left column followed by the whole right column rather than in reading order. A table is worse: the cells arrive as separate lines with nothing recording which row or column each came from, so you get the contents without the structure. If the text is in a PDF that was exported rather than scanned, PDF to Text will give you the characters the file already stores, exactly as it stores them, with no guessing at all — that is the better tool whenever it applies.",
    },
    {
      question: "Which languages does it handle?",
      answer:
        "English, in the Latin alphabet. Tesseract supports over a hundred languages, but each one needs its own model file of a few megabytes, and serving all of them would mean asking every visitor to think about which to download. Only English is served here. Text in another language that uses the Latin alphabet will often partly work — the letter shapes are the same — but the accuracy comes from the language model as much as the shapes, so expect mistakes on accented characters and on words English does not contain.",
    },
  ],
  "compress-png": [
    {
      question: "How much smaller will my PNG actually get?",
      answer:
        "It depends on what wrote the file, and the range is wide enough that a single number would be a lie. A PNG exported from a browser, a screenshot tool or a design app typically comes down 20–35%: this site's own 1200 × 630 social image, rendered by Chromium, went from 171,221 bytes to 117,326 at level 2 (31.5%) and 110,876 at level 4 (35.2%). A PNG that has already been optimized comes down 0–3%. A photograph saved as PNG is the worst case measured, at 8.5–9.6%. The page shows the number it actually achieved on your file, not a promise made before the run.",
    },
    {
      question: "Is it really lossless, or is that marketing?",
      answer:
        "It is lossless. oxipng re-encodes the image data — it searches filter strategies and re-deflates — without ever decoding to pixels and re-drawing, so every pixel round-trips. You can check it yourself: the compare view on the page has a DIFF tab that computes a real pixel difference between your original and the result, and for a lossless run it is black everywhere. One thing does change and is worth knowing about: oxipng rewrites the pixel format when the image does not use it, so an all-opaque RGBA image can come back as greyscale or as a palette image. The pixels are the same; the encoding of them is smaller. The page reports the before and after format whenever it changes.",
    },
    {
      question: "What does it mean when the tool gives my file back unchanged?",
      answer:
        "It means there was nothing left to win, and it is a normal outcome rather than a failure. oxipng never returns a bigger file; when its search cannot beat what is already there, it returns the input byte for byte. That happens to any PNG that has been through pngcrush, through oxipng before, or through an exporter set to maximum compression, and 0–3% is the whole range available on a file in that state. The page tells you and hands you your original rather than inventing a saving.",
    },
    {
      question: "Why do the effort levels stop at 4?",
      answer:
        "Because 5 and 6 do not buy anything. Measured on this site's own social image, levels 4, 5 and 6 all produced exactly 110,876 bytes — byte-identical output — while taking 2.3 s, 4.5 s and 5.5 s respectively. Offering them would sell twice the wait for zero bytes. Level 2 is the default because it is the best bytes-per-second of the four; level 4 is the knee, worth it when you care about the last few percent more than the wait.",
    },
    {
      question: "Why is there a 12-megapixel limit, and why is the progress bar not a percentage?",
      answer:
        "Both come from how the engine works. oxipng's WebAssembly heap was measured at roughly eight times the decoded picture and WebAssembly memory can never shrink, so a large image leaves a high-water mark that stays for the life of the tab — about 300 MB at 12 megapixels of 8-bit colour, and 372–751 MB measured on deeper 4000 × 3000 exports. That is why two limits are enforced rather than one: 12 megapixels, and 48 MB of decoded raster. And the codec is a single synchronous call that reports nothing until it returns, so there is no progress to display — the bar is indeterminate rather than fabricated. Throughput was measured at roughly 570 ms per megapixel at level 2, which makes a 12-megapixel file about a five-second job, and the page reports the time your run actually took.",
    },
  ],
  "ico-to-png": [
    {
      question: "Does this give me every size in the .ico, or just one?",
      answer:
        "Every size. The page reads the icon directory itself, so it can list all of them and let you choose; each one you pick comes out as its own PNG named after its dimensions. This is the difference between this tool and dropping an .ico onto a canvas: hand the whole file to a browser and it decodes exactly one image and does not tell you which. Chromium and WebKit both prefer the largest entry and then the greatest colour depth, so a 16 × 16 you specifically wanted is the one you are least likely to get that way.",
    },
    {
      question: "Is the PNG I get identical to what was inside the file?",
      answer:
        "For some entries, yes — and the page tells you which. An .ico may store each image either as a complete PNG or as a headerless bitmap, and the two can appear in the same file. A PNG entry is copied out as a byte slice with no decode and no re-encode, so it is byte for byte what was in the container. A bitmap entry has to be decoded and written out again to become a PNG, so it is a re-encoding; nothing is quantized and no quality setting applies, because a bitmap in an .ico is uncompressed, but it is not the original bytes. Each icon carries a badge saying which of the two it is, taken from the directory rather than inferred.",
    },
    {
      question: "Why are some icons in my file stored as bitmaps?",
      answer:
        "History. The .ico format predates PNG, and its original payload was a bitmap with no file header, stored upside down with a separate transparency mask stacked underneath it. PNG entries were added later and are now the norm for anything 256 × 256, because a 256 × 256 bitmap is a quarter of a megabyte. Windows icon editors still write small sizes as bitmaps, so a real favicon.ico frequently mixes both. This site's own PNG to ICO tool writes every entry as a PNG, which is why files made there come back through here untouched.",
    },
    {
      question: "Can I open a .cur cursor file here?",
      answer:
        "Yes. A cursor uses the identical container — the same six-byte directory header and the same sixteen bytes per entry — with only the type field distinguishing the two, so every image inside one comes out the same way. The page reads that field and tells you when the file you dropped is a cursor rather than an icon. The one thing that does not survive is the hotspot: the coordinates that say where the click actually lands are stored in the directory, and a PNG has nowhere to put them.",
    },
    {
      question: "The page lists fewer images than my file is supposed to have. Why?",
      answer:
        "Because the directory and the file disagree, and the page will not invent the missing images. Every entry lists where its payload begins and how long it is; when that runs past the end of the file — the usual sign of a truncated or interrupted download — or when the payload starts with neither a PNG signature nor a bitmap header, there is nothing to extract. Those entries are counted and reported above the icons rather than dropped in silence, so the count you see is what the file can actually deliver.",
    },
  ],
  "base64-to-image": [
    {
      question: "What can I paste in — does it have to be a bare Base64 string?",
      answer:
        "No. A bare payload, a whole data: URI (parameters and all), a block that a terminal wrapped at 76 columns, and the entire img tag you copied out of a page's source all work. The payload is pulled out of the wrapper, whitespace is stripped, URL-safe characters are translated and missing padding is added back before anything is decoded.",
    },
    {
      question: "The data URI said image/png but the file saved as .jpg. Why?",
      answer:
        "Because the bytes were JPEG. The mediatype in front of a data URI is a label somebody typed, and it is wrong often enough that this tool reads the format out of the decoded magic bytes instead. When the label and the bytes disagree, the download is named from the bytes and the page tells you that it happened rather than renaming your file quietly.",
    },
    {
      question: "It says my paste is not Base64, but I copied it straight out of my terminal.",
      answer:
        "Two different faults produce that, and the page names which one you hit. A length one character past a whole four-character group cannot come from any Base64 string, so it means the copy was cut short — grab the whole thing again. A data: URI with no ;base64 marker is percent-encoded rather than Base64, so there is nothing there to decode at all.",
    },
    {
      question: "Does it handle URL-safe Base64 from a JWT or an API?",
      answer:
        "Yes. The URL-safe alphabet swaps + and / for - and _, which plain atob rejects outright; both are translated back and any missing = padding is restored. The OUTPUT panel says whether that translation was needed, so you can see what the tool had to do to your string.",
    },
    {
      question: "Can it decode an SVG data URI?",
      answer:
        "Yes, if the payload is genuinely Base64. The SVG is shown by handing it to an img element, which is the only way this site ever renders SVG — the markup is never inlined into the page, so nothing inside it can run. A data: URI whose SVG is percent-encoded rather than Base64 is refused with that reason named.",
    },
  ],
  "change-image-dpi": [
    {
      question: "Will changing the DPI make my image bigger or smaller?",
      answer:
        "Not on screen and not in bytes. The pixel dimensions are untouched — the page shows them before and after so you can see that — and the file grows by at most 21 bytes when a PNG needs a pHYs chunk added, or 18 when a JPEG needs a JFIF segment. What changes is how large the picture comes out when something prints or places it.",
    },
    {
      /*
        This answer used to be JPEG-only. It is not: a PNG can state its
        resolution twice as well — pHYs and an eXIf chunk — and E2 measured
        that the eXIf wins there exactly as an Exif APP1 wins over a JFIF
        APP0 in a JPEG. Writing pHYs alone on such a file is a silent no-op,
        so the engine writes both on both formats and the answer says both.
      */
      question: "I set 300 DPI but Photoshop still says 72. What happened?",
      answer:
        "An image can state its resolution in two places, and where the two disagree it is the second one a reader believes — a JPEG's Exif block outranks its JFIF density, and a PNG's eXIf chunk outranks its pHYs. Both were measured here rather than assumed. So a tool that writes only the first looks correct in a quick preview and changes nothing in a layout app; this one writes both, on both formats. The case it cannot fix is a file whose Exif block carries no resolution tags at all — adding one means relocating every offset inside that block — and when that happens the page says so instead of reporting a clean success.",
    },
    {
      question: "Is my image re-compressed or re-encoded?",
      answer:
        "No. Nothing is decoded on the way out. The compressed image data — a PNG's IDAT chunks, a JPEG's scan — is copied through untouched, so there is no generation loss and no quality setting to get wrong. Only the header fields that state the density are rewritten, and the page lists which ones it wrote.",
    },
    {
      question: "Can I change the DPI of a WebP?",
      answer:
        "No, and no tool honestly can. The WebP format has no resolution field: the one place a density could hide is a bolted-on EXIF chunk that WebP readers do not consult, so writing one would add bytes and change nothing. Drop a WebP here and the tool says that rather than pretending to work.",
    },
    {
      question: "Which DPI should I pick?",
      answer:
        "72 and 96 are what screens and browsers assume, 150 is fine for a draft or an office printer, 300 is the usual commercial print target, and 600 suits line art and scanned text. The number only matters where something prints or places your image — a browser ignores it entirely, which is why the same file can look identical on screen at every setting.",
    },
  ],

  /*
    Wave 4's format fills. No component of their own — they mount the shipped
    image converter with a pre-picked source and target, so what earns each of
    them a page is the caveat that is specific to ITS pair: the TIFF page that
    is silently dropped, the AVIF decode that belongs to the browser and not
    to us, the second lossy generation, the one-way rasterisation. The AVIF
    support numbers are the same ones "avif-to-jpg" already states; a third
    set of numbers on the same site would be a defect, not a detail.
  */
  "tiff-to-png": [
    {
      question: "My TIFF has several pages — do I get all of them?",
      answer:
        "No. Only the first page is converted, and the page says so on screen, naming the number of pages it counted in your file rather than leaving you to notice the loss later. That matters more here than for most formats, because scans and faxes are routinely multi-page and nothing on the outside of the file tells you. If you need the whole document rather than its first sheet, TIFF to PDF keeps every page in one file.",
    },
    {
      question: "Why PNG rather than JPG?",
      answer:
        "Because a TIFF is usually the archival copy and PNG is the format that keeps it that way. PNG is losslessly compressed, so the pixels that come out are the pixels the decoder read; JPG would add compression artifacts to exactly the things a scan is full of — text edges, line art, ruled tables. If the file is a photograph and you want it small, TIFF to JPG is the page for that trade.",
    },
    {
      question: "Why can't most browsers open a TIFF on their own?",
      answer:
        "Safari is the only one that can — MDN lists TIFF as \"Safari only\" — and everywhere else the format never became a web format: it is enormous, and it carries dozens of optional compression schemes a browser would have to ship code for. This page does not depend on that difference. It decodes the file with utif2, a JavaScript TIFF reader served from this site, and re-encodes the result as a PNG through the canvas, the same way in Safari as in everything else. Nothing is uploaded; the decoder runs beside your file rather than the other way round.",
    },
    {
      question: "Will the PNG be smaller than the TIFF?",
      answer:
        "Usually, but not always, and it depends entirely on how the TIFF was written. An uncompressed TIFF — still the common case out of scanners and microscopes — shrinks a lot, because PNG deflates the pixels and the TIFF did not. A TIFF that already used LZW or Deflate lands somewhere near the same size. The page shows the IN and OUT byte counts so you get the real answer for your file rather than an average.",
    },
    {
      question: "Does transparency survive the conversion?",
      answer:
        "Where the decode produces it, yes — PNG carries a full alpha channel, so nothing is flattened onto a background the way a JPG conversion would flatten it. What does not survive is everything that is not pixels: TIFF tags, embedded ICC profiles, geo-referencing and layer information are all read past, because the output is written from the decoded raster.",
    },
  ],
  "avif-to-png": [
    {
      question: "Does my browser support AVIF?",
      answer:
        "Almost certainly. AVIF decoding landed in Chrome 85, Firefox 93 and Safari 16.4, which between them covers every browser still receiving updates — so if this page loaded, the decode will almost certainly work. The one way to be sure is to try the file: nothing here guesses from a version string.",
    },
    {
      question: "Who actually decodes the AVIF — this page or my browser?",
      answer:
        "Your browser, and that is worth knowing because it decides what happens when something goes wrong. No AVIF decoder is downloaded here; the file is handed to the same image pipeline the browser uses for a page's own images. So a browser that cannot read AVIF cannot be rescued by this tool, and a file that fails here will also fail as an ordinary image on any page.",
    },
    {
      question: "Why PNG rather than JPG?",
      answer:
        "Two reasons. PNG is lossless, so nothing further is thrown away after the decode — what you get is exactly what the AVIF decoded to. And AVIF can carry an alpha channel, which PNG can store and JPG cannot; converting to JPG flattens every transparent pixel onto white. If you do not need either property, AVIF to JPG produces a much smaller file.",
    },
    {
      question: "Why is the PNG so much bigger than the AVIF?",
      answer:
        "Because you are moving from one of the most efficient lossy formats to a lossless one. AVIF is built on the AV1 video codec and routinely stores a photograph in a fraction of what any lossless format needs; PNG stores every pixel exactly and can only win back what deflate finds. A large increase is the expected outcome, not a fault — the page shows both byte counts so you can see the trade before you save.",
    },
    {
      question: "Does converting to PNG improve the image?",
      answer:
        "No. Lossless output preserves what it is given; it cannot recover detail an AVIF encoder already discarded. Whatever softening or blocking is in the AVIF is in the PNG too, now stored exactly rather than compressed further. The value of PNG here is that nothing is added to it — not that anything is taken back.",
    },
  ],
  "avif-to-webp": [
    {
      question: "Why convert between two modern formats?",
      answer:
        "Because compatibility is not the same as modernity. WebP arrived a decade before AVIF and is read by essentially every browser, most image editors, the major messaging apps and a long tail of upload forms; AVIF is still refused by plenty of them. This is the conversion you want when the file has to go somewhere AVIF is rejected and you would rather not fall all the way back to JPG.",
    },
    {
      question: "Is this a second generation of loss?",
      answer:
        "Yes, and it is worth saying plainly. AVIF is lossy and WebP is lossy, so the encoder here is deciding what to discard from a picture that has already had detail discarded by a different encoder with a different model. You do not get the better of the two; you get the damage from both. Set the quality high and do it once from the best source you have, rather than repeatedly.",
    },
    {
      question: "Which format produces the smaller file?",
      answer:
        "AVIF, in general — it is the newer codec and the more efficient of the two at the same visual quality. So expect the WebP to be the larger of the two at a comparable setting, and treat any saving as a bonus rather than the reason to convert. Rather than average anybody's benchmark, the page prints the IN and OUT sizes for the file you actually dropped.",
    },
    {
      question: "Does my browser need to support AVIF for this to work?",
      answer:
        "Yes. The decode is your browser's — Chrome (85+), Firefox (93+) and Safari (16.4+) all do it — and nothing here can substitute for it. The encode is the browser's too: writing WebP has been supported far longer and far more widely, so in practice the input side is the one that decides whether the conversion runs.",
    },
    {
      question: "Does transparency survive?",
      answer:
        "Yes. Both formats carry a full alpha channel, so a transparent AVIF comes out as a transparent WebP and nothing is flattened onto a background. That is the main practical advantage over converting to JPG, which has nowhere to store an alpha channel at all.",
    },
  ],
  "bmp-to-png": [
    {
      question: "Will the PNG really be smaller?",
      answer:
        "Almost always, and by a lot. A BMP stores each pixel's bytes with no compression at all — a 12-megapixel image is over 36 MB — while PNG runs the same pixels through filtering and deflate. Photographs shrink least because their pixels are noisy; screenshots, diagrams and anything with flat colour shrink dramatically. The page shows the IN and OUT byte counts, so the number you see is your file's, not an average.",
    },
    {
      question: "Does anything change in the picture?",
      answer:
        "No. PNG is losslessly compressed, so every pixel that came out of the BMP goes into the PNG unchanged — this is a re-packing, not a re-encoding. That is the whole appeal of this pair: the file gets much smaller and there is no quality setting to get wrong, because there is no quality decision to make.",
    },
    {
      question: "Why not convert to JPG instead?",
      answer:
        "Because JPG throws detail away to get its size, and most BMPs are exactly the material that shows it — screenshots, UI captures, scanned line art, images with sharp edges and flat colour. If your BMP is a photograph and you want the smallest possible file, BMP to JPG is the right page and will beat PNG comfortably. For everything else, PNG is smaller than the BMP and identical to it.",
    },
    {
      question: "Where do BMP files still come from?",
      answer:
        "Legacy Windows software, screenshots from older tools, some scanner drivers, medical and industrial capture devices, and embedded systems that could not afford a decoder. They are rarely chosen deliberately any more — a BMP usually turns up because something old wrote it, which is also why it usually needs converting before anything modern will accept it.",
    },
    {
      question: "Can I convert a PNG back to BMP here?",
      answer:
        "Not here — browser canvas encoders cannot write BMP, and asking one for it silently produces PNG bytes wearing a .bmp name. So BMP works as an input format only. If you need a lossless copy that everything can open, PNG already fills that role at a fraction of the size.",
    },
  ],
  "svg-to-jpg": [
    {
      question: "What pixel size will the JPG be?",
      answer:
        "The SVG decides. If the document declares its own width and height, those pixels are used as-is; if it only carries a viewBox, the drawing is scaled up until its longest edge is at least 1024 pixels, so a 24 × 24 icon rasterizes into something usable rather than a thumbnail. That is a floor and not a target: a viewBox already past 1024 units is rasterized at its own size, never shrunk to fit. There is no resolution control on this page — set width and height on the SVG before uploading, or run the result through the Image Resizer afterwards.",
    },
    {
      question: "What happens to the transparent background?",
      answer:
        "It becomes white. JPG has nowhere to store an alpha channel, so the canvas is painted white before the drawing goes onto it — deliberately, because an unpainted canvas flattens to black instead, which is the failure people actually report. If the transparency matters, SVG to PNG and SVG to WebP both keep it.",
    },
    {
      question: "Can I turn the JPG back into an SVG?",
      answer:
        "No. Rasterizing is one-way: the SVG's shapes, paths and text become a grid of pixels, and nothing in the JPG records what they were. Keep the SVG — it is the master copy, it stays sharp at any size, and it is usually the smaller file. Export a raster only for the place that will not accept a vector.",
    },
    {
      question: "Should I be exporting to JPG at all?",
      answer:
        "Only if the destination insists on it. Most SVGs are logos, icons and diagrams — flat colour and hard edges — and that is the worst case for JPG's compression, which smears ringing artifacts around every sharp boundary. SVG to PNG gives a smaller and cleaner file for that material. JPG earns its place when the SVG is a photographic composition, or when a form refuses everything else.",
    },
    {
      question: "Is it safe to drop an SVG here — can the file run anything?",
      answer:
        "It cannot. The SVG is rendered by handing it to an image element, which is the only way this site ever draws one: markup passed to an img is not part of the page, so scripts inside it never execute and external references it names are never fetched. The file is never inlined into the document. And nothing leaves your browser either way — the rasterization happens on your machine.",
    },
  ],
  "svg-to-webp": [
    {
      question: "What pixel size will the WebP be?",
      answer:
        "The SVG decides. A document that declares its own width and height is rasterized at exactly those pixels; a document carrying only a viewBox is scaled up until its longest edge is at least 1024 pixels, which keeps a 24 × 24 icon from coming out as a 24 × 24 raster. It only ever scales up, so a viewBox of 2000 × 1000 rasterizes at 2000 × 1000. There is no resolution control here — set the size on the SVG first, or resize the result afterwards.",
    },
    {
      question: "Does the transparency survive?",
      answer:
        "Yes. WebP carries a full alpha channel, so the empty area around a logo stays empty instead of being painted onto a background. That is the practical difference between this page and SVG to JPG, which has to flatten it to white.",
    },
    {
      question: "Should I pick WebP or PNG for a rasterized vector?",
      answer:
        "It depends on the artwork. WebP is normally the smaller file and is now supported essentially everywhere, which makes it the better default for the web. But PNG is lossless, and for flat-colour line art — the kind of thing most SVGs are — lossless output can be both exact and competitively small. If the raster is going somewhere old or somewhere fussy, PNG remains the safest thing to hand over.",
    },
    {
      question: "Can I get the vector back from the WebP?",
      answer:
        "No. Rasterizing is one-way: paths, text and shapes become a grid of pixels and nothing in the output records what drew them. Keep the SVG as the master — it stays sharp at any size and it is usually smaller than the raster you exported from it.",
    },
    {
      question: "Can a malicious SVG do anything when I drop it here?",
      answer:
        "No. The drawing is rasterized by handing the file to an image element rather than by inlining its markup into this page — and an SVG loaded that way is sandboxed by the browser: its scripts do not run and the external resources it references are not fetched. The file is also never uploaded anywhere; the whole conversion happens in your own browser.",
    },
  ],
  "heic-to-webp": [
    {
      question: "Why WebP rather than JPG?",
      answer:
        "Because WebP is meaningfully smaller than JPG at the same quality and is now read by every current browser, which makes it the better target when the photo is headed for a website or a web app. JPG is still the safer choice for anything older — print shops, desktop editors, upload forms with a hardcoded list — and HEIC to JPG is the page for that.",
    },
    {
      question: "Is this a second generation of loss?",
      answer:
        "Yes. HEIC is lossy and WebP is lossy, so the photo is decoded from one encoder's decisions and handed to another with a different model of what you will not notice. The result is the damage from both, not the better of the two. Convert once from the original HEIC rather than through an intermediate, and keep the quality high if the photo matters.",
    },
    {
      question: "Why does the first conversion take a moment to start?",
      answer:
        "Because no browser can decode HEIC on its own, so the page fetches a decoder — libheif, about 1.4 MB across its loader and its WebAssembly binary, served from this site rather than a content delivery network. It downloads once and your browser caches it; every conversion after that starts immediately. That download is the whole reason a HEIC page feels slower on its first run than any other image page here.",
    },
    {
      question: "Will the WebP be smaller than the HEIC?",
      answer:
        "Not necessarily. HEIC is built on the HEVC video codec and is extremely efficient, so a WebP at a comparable quality can land close to it or above it. The size win here is against JPG, not against the HEIC you started with. The page prints the IN and OUT byte totals so you can see what actually happened rather than assuming a saving.",
    },
    {
      question: "What happens to the photo's metadata and to a Live Photo?",
      answer:
        "The metadata does not come through: the WebP is written from the decoded pixels, so EXIF, GPS and the camera's own tags are dropped — open the file in the EXIF viewer first if you want to read them. A Live Photo loses its motion for a different reason: the moving half was never in the HEIC at all, it is a separate video file sitting beside it on the phone, and only the still is uploaded here.",
    },
  ],


  // ── Developer Tools FAQs ─────────────────────────────────────────
  "json-formatter": [
    {
      question: "Is my JSON data sent to a server?",
      answer:
        "No. All formatting happens in your browser using JSON.parse and JSON.stringify. No data leaves your device.",
    },
    {
      question: "What's the difference between Format and Minify?",
      answer:
        "Format adds indentation and line breaks for readability. Minify removes all whitespace to produce the smallest possible output — useful for APIs and configuration files.",
    },
    {
      question: "Can it handle large JSON files?",
      answer:
        "It works well for JSON up to a few megabytes. Very large files may cause the browser tab to slow down due to rendering the formatted output.",
    },
    {
      question: "Will formatting change my numbers or precision?",
      answer:
        "No. Format and Minify rewrite only the whitespace — every string, number, and keyword is copied byte for byte, so a 19-digit database id, a trailing .0, or 1e2 comes out exactly as you pasted it instead of being rounded through a floating-point double.",
    },
    {
      question: "How do I find the syntax error in my JSON?",
      answer:
        "Paste the JSON and the output pane becomes the failure report: the parser's own message, the line and column where it stopped (when your browser's parser reports a position), and a three-line excerpt with the offending character highlighted. Everything before that character parsed fine, so the mistake is at or just before the mark.",
    },
  ],
  // The JSON minifier and the three YAML pages sit with the formatter
  // because they answer its questions: `json-minify` calls the same
  // whitespace-only scanner, and the YAML pair keeps having to explain what
  // the JSON.parse round trip costs on the way back.
  "json-minify": [
    {
      question: "Will this round my long numeric ids?",
      answer:
        "No, and that is the whole reason this page exists. The usual way to minify JSON is JSON.parse followed by JSON.stringify, which is a round trip through a 64-bit float: an id like 12345678901234567890 comes back as 12345678901234567000, 1.0 comes back as 1, and 1e2 comes back as 100. This tool never re-serialises. It scans the characters you gave it and rewrites only the whitespace between them, so every string, number and keyword is copied through exactly as you typed it. Parsing happens separately, and only to decide whether the input is valid.",
    },
    {
      question: "My file is valid JSON but this says it is not.",
      answer:
        "Four things cause that. A UTF-8 byte-order mark at the start, which RFC 8259 does not permit and the browser's parser rejects before it reads a key — there is a box in the rail to drop it, and a warning on screen when one is found. Trailing commas, comments and unquoted keys, which are JSON5 or JSONC rather than JSON, and which no browser parser accepts. Single-quoted strings, same story. And NaN or Infinity, which JavaScript will print but JSON cannot hold. The error line shows the parser's own message, plus the line and column when the engine reports one.",
    },
    {
      question: "Can it handle NDJSON or a .jsonl file?",
      answer:
        "No. In NDJSON every line is a separate JSON document with no commas and no enclosing array, so the file as a whole does not parse and this page will report an error at the start of the second line. That is honest rather than helpful: minifying each line independently would be a different tool with different semantics, and quietly wrapping your lines in an array would change the shape of your data. For now, split the file and run the documents one at a time, or use the JSON formatter's validate pass on a single record.",
    },
    {
      question: "How much smaller should I expect the file to get?",
      answer:
        "It depends entirely on how it was indented, and the page prints the real figure rather than a promise. Two-space-indented JSON from an API browser or a pretty-printer typically loses 20 to 40 percent, because most of the whitespace is leading indentation that grows with nesting depth. JSON that was already written compactly, or that is mostly long string values, may lose almost nothing. The stat strip shows the source size, the minified size, the percentage and the line count, and the rail reports how many of the removed bytes were whitespace as opposed to a byte-order mark.",
    },
    {
      question: "Does it shorten keys or drop empty fields?",
      answer:
        "No to both, and no to reordering. Those are transformations of your data, not of its formatting, and a button labelled Minify has no business making them. Duplicate keys survive too: JSON.parse would collapse two keys of the same name into the last one, and because this tool rewrites the raw text rather than re-serialising a parsed value, both are still in the output. Null values, empty strings, empty objects and empty arrays are all kept. The only thing that leaves is whitespace between tokens, plus the byte-order mark if you tick that box.",
    },
  ],
  "yaml-to-json": [
    {
      question: "My file has --- separators and every other converter chokes on it.",
      answer:
        "Because most of them call the parser's single-document entry point, which throws \"expected a single document in the stream\" the moment it meets the second one. This page reads the whole stream instead and tells you how many documents came out. JSON has no document separator, so more than one can only be written as a JSON array — that is what you get, with the count printed above the panes. If your consumer expects a single object, read the array's first element rather than assuming the rest were never there.",
    },
    {
      question: "Why is my JSON so much bigger than the YAML it came from?",
      answer:
        "Almost certainly anchors. An anchor and alias pair (&defaults and *defaults) stores a block once and points at it from everywhere else, and JSON has no way to express a reference — so every alias is written out as a full copy of the block. The count of expanded aliases is shown on screen for exactly this reason. It also changes the meaning slightly: in the YAML those were one node, so editing it changed every user of it; in the JSON they are independent copies and editing one changes nothing else.",
    },
    {
      question: "The dates in my output grew a time and a Z that I never wrote.",
      answer:
        "YAML has a real timestamp type, so 2026-01-01 is parsed as a date rather than a string, and JSON has no date type at all — the only way to write one is as text, and the standard text form is the full ISO string with a time and a zone. So 2026-01-01 becomes \"2026-01-01T00:00:00.000Z\". The number of values this happened to is counted on screen. If you want the original characters back, quote the value in the YAML source so it is read as a string in the first place.",
    },
    {
      question: "It says one of my keys is not a string, but it looks fine to me.",
      answer:
        "YAML lets a key be any value: 1, true, null, 2026-01-01 and even a whole sequence are all legal keys. JSON keys can only be strings, so the parser calls String() on yours and moves on. Usually that is harmless — 1 becomes \"1\". A date key is not harmless: String() on a date produces a sentence built from your browser's own time zone and locale, so the same file converted on a colleague's laptop produces a different key. Every non-string key is listed with the string it turns into so you can quote the ones that matter.",
    },
    {
      question: "Can I convert the JSON back and get my original YAML file?",
      answer:
        "No, and nothing can. The comments are gone the moment the file is parsed, because the parser does not record where they were. So are the blank lines, your choice of quotes, your block scalar styles, and the names you gave your anchors. Converting back gives you a valid YAML file that means the same thing and reads differently. If what you want is a tidy version of the same file rather than a round trip, use the YAML Formatter, which at least keeps anchors as anchors instead of expanding them.",
    },
  ],
  "json-to-yaml": [
    {
      question: "My user ids came out ending in a run of zeroes.",
      answer:
        "That is the JSON parse, not the YAML writer. The YAML writer takes a JavaScript value, so the text has to be parsed first, and JavaScript holds every JSON number as a 64-bit float — which stops being able to count exactly at 9007199254740991. A Snowflake id, a Twitter id or a database bigint is longer than that, so it lands on the nearest representable value and the last few digits become zeroes. Every literal this happens to is listed on screen with the value it becomes, before you download anything. The fix is in the source: quote the ids so they arrive as strings.",
    },
    {
      question: "Why did 1.0 turn into 1, and 1e2 into 100?",
      answer:
        "Same reason, smaller stakes. Once the text has been parsed into a number, the spelling you used is not stored anywhere — 1.0, 1.00 and 1 are all the same double, and the writer prints the shortest form that reads back as that value. The value a program sees is unchanged, so nothing is broken; the characters in the file are different, so a line-by-line diff against a hand-written original will light up. These are listed separately from the ids that actually changed value, so you can tell the cosmetic ones from the harmful ones at a glance.",
    },
    {
      question: "One of my keys just vanished from the YAML.",
      answer:
        "You had it twice in the same object. JSON parsing keeps the last occurrence and discards the earlier value silently — no error, no warning, from any parser. YAML is stricter and rejects a duplicate key outright, which is why this only bites in this direction. The raw JSON text is scanned before the parse for exactly this, and every repeated key is named with the line of the occurrence that won. If both values mattered, the object needed to be an array in the first place.",
    },
    {
      question: "My long strings got broken across lines with a > sign.",
      answer:
        "That is a folded block scalar, and it reads back as the same single string — the line breaks are folded into spaces when parsed. It happens because the writer wraps at 80 columns by default. If a tool downstream compares your file line by line, or a human has to read the value, set LONG LINES to 120 or to Never wrap and the string is written on one line however long it is. Nothing about the data changes either way; only where the writer is allowed to break.",
    },
    {
      question: "It rejects my file and it is definitely JSON.",
      answer:
        "It has to be strict JSON, which is narrower than what most editors accept. A trailing comma after the last item, a // or /* */ comment, single-quoted strings, unquoted keys and NaN are all JSON5 or JSONC rather than JSON, and the browser's parser refuses every one of them. The error reports the parser's own message with the line and column so you can find the character it stopped on. Strip the comments and trailing commas, or run the file through the JSON Formatter first to find them.",
    },
  ],
  "yaml-formatter": [
    {
      question: "All my comments are gone.",
      answer:
        "They are, and that is a property of the parser rather than a setting. This formats by reading the file into values and printing them again, and the reader throws comments away without recording where they were — so by the time there is anything to print, there is nothing left to put back. Blank lines go the same way. If your file is heavily commented and you only wanted the indentation fixed, this is the wrong tool: use your editor's YAML formatter, which works on the text rather than the values, and keep this one for checking that the file parses at all.",
    },
    {
      question: "Why did it put quotes around yes and no?",
      answer:
        "Because unquoted they are not strings. YAML 1.1 reads y, yes, on, n, no and off as booleans, and plenty of parsers still in use follow that rule — so a value you meant as the word \"no\" would come back as false. The writer quotes them to keep them strings, which is the safe reading and the reason the Norway problem has its own name. The same applies to a bare 1.0 or a bare date. If you actually wanted a boolean, write true or false, which no parser has ever misread.",
    },
    {
      question: "Will this tell me why my CI config will not run?",
      answer:
        "Only if the problem is syntax. It reports the parser's own message, line, column and excerpt for anything that is not well-formed YAML — a tab in the indentation, an unclosed flow sequence, a duplicate key — and those are the majority of YAML failures. It does not know anything about your CI provider's schema, so a perfectly valid file with a misspelled step key or a job that references a stage that does not exist passes here and still fails there. Valid means parses, not means what you intended.",
    },
    {
      question: "Should I turn on sort keys?",
      answer:
        "Only when comparing two files. Sorting makes two hand-edited copies of the same config line up so a diff shows real differences rather than ordering, which is genuinely useful once. It is a permanent edit to the output, not a view: the order the author chose is not recoverable afterwards, and most configs read worse sorted — a Compose service with image somewhere after environment tells you less at a glance. It is off by default for that reason, and the warning above the panes says so whenever it is on.",
    },
    {
      question: "My anchors came back named ref_0 and ref_1.",
      answer:
        "The structure survived; the names did not. The parser resolves an alias to the node it points at and keeps no record of what the anchor was called, so when the writer notices the same node appearing twice it invents a fresh name. Your data is identical and the file still round-trips — it just reads worse, because &postgres-defaults meant something and &ref_0 does not. The number of nodes this happens to is counted on screen. One case does not survive even that far: an anchor on a plain value rather than on a mapping or a sequence — a version string tagged &tag and pointed at from three services, say. The writer only re-anchors a shared mapping or sequence, so that value is written out again at every use and both &tag and *tag leave the file entirely. The link is gone with them: editing one copy afterwards changes nothing else. That one is not in the re-anchored count, because it is not re-anchored — it is named in the warning above the panes instead. If the names matter more than the reformatting, do not run this over that file.",
    },
  ],
  "base64-encode-decode": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. Encoding and decoding happen entirely in your browser using the built-in btoa/atob functions and TextEncoder/TextDecoder APIs.",
    },
    {
      question: "Can I encode files to Base64?",
      answer:
        "Yes. Switch to File mode when encoding to upload any file and get its Base64 representation.",
    },
    {
      question: "Does it handle Unicode text?",
      answer:
        "Yes. The tool uses TextEncoder/TextDecoder to properly handle UTF-8 characters including emoji, CJK characters, and other non-ASCII text.",
    },
    {
      question: "Can I decode line-wrapped or URL-safe Base64?",
      answer:
        "Yes. Whitespace is stripped, - and _ are converted to + and /, and missing padding is restored before decoding — so PEM bodies, secret values wrapped at 76 columns, and JWT segments all decode without any cleanup.",
    },
    {
      question: "Can I decode Base64 back into a file?",
      answer:
        "No — decoding always produces text. A Base64 string that encodes an image or PDF will decode to garbled characters, because the output is interpreted as UTF-8 text rather than saved back as a file.",
    },
  ],
  "jwt-decoder": [
    {
      question: "Can this tool verify JWT signatures?",
      answer:
        "This tool decodes and displays the JWT header and payload, and checks expiration. It does not verify cryptographic signatures — that requires the signing secret or public key, which should never be pasted into a web tool.",
    },
    {
      question: "Is my JWT token sent to a server?",
      answer:
        "No. The decoding happens entirely in your browser. Your token never leaves your device.",
    },
    {
      question: "What are the three parts of a JWT?",
      answer:
        "A JWT is three Base64URL-encoded segments separated by dots: header (algorithm and token type), payload (your claims like sub, iat, exp), and signature (the HMAC or RSA signature over the first two segments).",
    },
    {
      question: "How does the expiry check work?",
      answer:
        "The tool reads the exp claim — a Unix timestamp in seconds — converts it to an ISO date, and compares it against your device's clock to show a 'Token is valid' or 'Token is expired' banner with the exact expiry time. Tokens without an exp claim show 'none' in the rail and get no banner.",
    },
    {
      question: "Why won't my token decode?",
      answer:
        "Usually because it isn't a signed JWT at all: the decoder needs exactly three dot-separated segments. Encrypted tokens (JWE) have five — their payload is actually encrypted, not just encoded, so it can't be inspected here — and opaque session tokens have no dots at all.",
    },
  ],
  // The two signing pages, beside the decoder. Both answer the same first
  // question people bring to a JWT — whether signing hides anything — so
  // the honest answer lives on all three.
  "jwt-encoder": [
    {
      question: "Can I sign with RS256? I have the private key.",
      answer:
        "No, and not because it was forgotten. RS256, PS256 and ES256 sign with an RSA or elliptic-curve private key, which would mean pasting a private key into a web page — a credential-handling pattern this site will not ship, whatever the page then does with it. HS256, HS384 and HS512 cover every case where both sides hold the same secret, which is most internal APIs. For an asymmetric token, sign it where the private key already lives: your language's JWT library, or the openssl command line. The JWT Decoder here will still inspect the result.",
    },
    {
      question: "Is the payload encrypted? Can I put a password in it?",
      answer:
        "No, and no. A JWT is signed, not encrypted. The header and payload are base64url — an encoding, reversible by anyone, with no key involved at all. Paste any token into this site's JWT Decoder, or into any base64 decoder, and every claim comes straight back out. The signature proves the token has not been altered and that whoever made it held the secret; it hides nothing whatsoever. Treat the payload as public: a user id and a role are fine, an email address is a judgement call, and a password or an API key is never fine.",
    },
    {
      question: "My token is rejected with 'invalid signature' and I copied it exactly.",
      answer:
        "Three usual causes, in order. First the secret's encoding: an API that gives you a base64 or hex secret expects those bytes, and typing it with the encoding left on Text makes a different key out of the same characters. The rail prints the key length in bytes — compare it with what your library reports. Second the algorithm: the header's alg has to match what the verifier expects, and this page refuses to sign at all while the picker and the header disagree, rather than emitting a token that cannot verify. Third, whitespace copied along with the token.",
    },
    {
      question: "Why does my exp claim say 1970, or the year 56000?",
      answer:
        "Because exp, iat and nbf are seconds since 1 January 1970, not milliseconds. Date.now() in JavaScript gives milliseconds, and pasting that straight into exp produces a token that expires roughly fifty-four thousand years from now, which some verifiers reject outright as implausible. Dividing by a thousand and rounding down fixes it. The claim buttons in the rail do exactly that, and print the resulting instant in UTC underneath with a plain-English distance from now, so a wrong magnitude is visible on the page instead of being discovered later by somebody else's verifier.",
    },
    {
      question: "Does the secret I type here get sent anywhere?",
      answer:
        "No. Signing happens in this tab through the browser's Web Crypto API: there is no request, no server, and no analytics event carrying the secret. What that does not do is make the resulting token trustworthy — a token is only as strong as the secret behind it, and a secret weak enough to guess makes a token anyone can forge. The page seeds jwt.io's debugger placeholder, your-256-bit-secret, so that it produces something on load, and warns on screen for as long as that placeholder is still in the box. It is worth knowing what that string is not: it appears in no JWT or JOSE RFC, and it is 19 bytes of text — 152 bits — whatever its name says. RFC 7515's own HS256 worked example signs a different header and payload with a 64-byte key.",
    },
  ],
  "hmac-generator": [
    {
      question: "My webhook signature never matches and I am sure the key is right.",
      answer:
        "Then it is probably the encoding, or the message. A secret given as 64 hex characters is 32 bytes, and using those characters as text makes a 64-byte key: same secret, different MAC, no error anywhere. Set the key encoding to match how you were given it, and compare the byte count in the rail with what your library reports. If that is right, the message is the suspect. An HMAC covers exact bytes, so a trailing newline, CRLF line endings, or a JSON body your framework re-serialised with different spacing all change the answer.",
    },
    {
      question: "Should I use SHA-1? My provider's docs say HMAC-SHA1.",
      answer:
        "Use it if the other side does — you have no choice, and the situation is better than it sounds. SHA-1's famous weakness is collision resistance, and HMAC does not rest on collision resistance, so HMAC-SHA1 is not broken the way a bare SHA-1 signature is. It is still not something to design around today: for anything new, use SHA-256. The option is here because AWS Signature v2, older provider webhooks and a long tail of internal services still specify it, and a tool that omitted it would be useless for exactly those cases.",
    },
    {
      question: "Is the verify field safe to copy into my server?",
      answer:
        "No, and the page says so beside it. The comparison here is an ordinary string compare, which stops as soon as two characters differ — the time it takes to fail leaks roughly how much of the MAC was right, which is enough to reconstruct one guess at a time. A real verifier compares raw bytes in constant time: compare_digest in Python, timingSafeEqual in Node, hash_equals in PHP. This field exists to tell you why a delivery is failing, in a browser, where there is no attacker standing by with a stopwatch.",
    },
    {
      question: "How is this different from the Hash Generator?",
      answer:
        "A key. The Hash Generator computes SHA-256 of your data and anyone can recompute it — a fingerprint, good for checking that a download arrived intact. An HMAC folds a secret into the same hash, so only someone holding that secret can produce the value or check it. That is what makes it a signature rather than a checksum: a hash tells you the bytes did not change by accident, an HMAC tells you they were not changed by someone without the key. Different jobs, and the Hash Generator is the one that takes files.",
    },
    {
      question: "Can I HMAC a file instead of typing a message?",
      answer:
        "Not here. This page takes text, because the things people sign are text: request bodies, canonical strings, query parameters. The message box is UTF-8, so anything you can type or paste is covered, including CJK and emoji, and the stat strip prints how many bytes actually went in. For a file, the Hash Generator reads one from disk — though it computes unkeyed digests, MD5 and the SHA family, rather than an HMAC. Signing a file's contents with a shared key is not something this page does.",
    },
  ],
  "uuid-generator": [
    {
      question: "What's the difference between UUID v4 and v7?",
      answer:
        "UUID v4 is fully random. UUID v7 is time-ordered — the first 48 bits encode a millisecond timestamp, making it ideal for database primary keys because it preserves insertion order and improves index performance.",
    },
    {
      question: "Are the UUIDs cryptographically random?",
      answer:
        "Yes. Both versions use the Web Crypto API (crypto.getRandomValues) for their random components.",
    },
    {
      question: "Are collisions a real concern?",
      answer:
        "Practically, no. UUID v4 has 122 bits of randomness — you would need to generate roughly a billion UUIDs per second for a hundred years before a single collision becomes likely. Treat them as unique.",
    },
    {
      question: "Do v7 UUIDs leak when they were created?",
      answer:
        "Yes — anyone who sees a v7 UUID can read its creation time back out to the millisecond, since the timestamp sits in plain sight at the front. That's harmless in most databases but worth knowing before putting them in public URLs; use v4 there if creation time is sensitive.",
    },
    {
      question: "How many UUIDs can I generate at once?",
      answer:
        "Pick a batch of 1, 5, 10, 25, 50, or 100 per generate. Copy any single UUID with a click, or use Copy all to get the whole batch as one newline-separated list.",
    },
  ],
  "password-generator": [
    {
      question: "Are generated passwords stored anywhere?",
      answer:
        "No. Passwords are generated using the Web Crypto API in your browser and are never stored or transmitted. Close the tab and they're gone.",
    },
    {
      question: "What does the strength meter measure?",
      answer:
        "It calculates the entropy (randomness) of the password based on its length and the character pool size. Higher entropy means more possible combinations and a stronger password.",
    },
    {
      question: "How long should my password be?",
      answer:
        "For most accounts, 16 characters with mixed case, digits, and symbols puts you well past 80 bits of entropy — comfortably out of reach of brute force. For high-value accounts or master passwords, aim for 24+ characters.",
    },
    {
      question: "Is every character type I check guaranteed to appear?",
      answer:
        "Yes. One character from each checked class is picked first (as far as the length allows), the rest are drawn from the combined pool, and the result is shuffled — so a 16-character password with Symbols checked will never happen to contain zero symbols.",
    },
    {
      question: "Are some characters more likely than others?",
      answer:
        "No. The generator uses rejection sampling on 32-bit random draws instead of a plain modulo, which removes the slight statistical bias toward early pool characters that naive generators have. Every character in the pool has an equal chance on each draw.",
    },
  ],
  "hash-generator": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. SHA hashes are computed using the Web Crypto API and MD5 using the js-md5 library — both run entirely in your browser.",
    },
    {
      question: "Which hash algorithm should I use?",
      answer:
        "SHA-256 is the most widely used for checksums and data integrity. SHA-512 provides more security. MD5 and SHA-1 are considered cryptographically broken and should only be used for non-security purposes like checksums.",
    },
    {
      question: "Can I verify a downloaded file's checksum here?",
      answer:
        "Yes. Paste or drop the file into the input area, pick the algorithm the publisher specified (usually SHA-256), and compare the resulting hash against their published value. Matching hashes mean the file was not tampered with in transit.",
    },
    {
      question: "Can I hash large files?",
      answer:
        "Yes, and there is no size at which it stops working. The file is handed to a background worker and hashed as it is read, in chunks off the file stream, so it is never held in memory whole — the page stays responsive and a progress bar tracks the work. What a large file costs is time: all four digests are computed in JavaScript at roughly 40 MB a second together, measured in the browser. That is slower than the browser's own crypto, which this page used until September 2026, and it is the trade that removed the ceiling — the native digest has one entry point and it takes the entire file at once, so it cannot be streamed.",
    },
    {
      question: "Why doesn't my hash match the one from my terminal?",
      answer:
        "Almost always a trailing newline — echo appends one, so piping 'hello' through it hashes six bytes while this tool hashes exactly the five characters you typed, encoded as UTF-8. Use printf or echo -n in the terminal to compare like for like.",
    },
  ],
  // `file-checksum` is the same four digests with a comparison on top, so
  // its answers repeat this page's memory disclosure rather than assume it.
  "file-checksum": [
    {
      question: "The checksum on the site is in capitals and mine came out lowercase.",
      answer:
        "Hexadecimal has no case, so those are the same number. Both sides are lower-cased before they are compared — the digest you pasted and the four this page computed — so a match is reported whichever way either was written. What is not the same is a digest with a character missing. A paste that is 63 or 65 hex characters long is refused outright rather than compared against its first 32 or 40, because a truncated paste that quietly reported NO MATCH would send you off to re-download a file that was fine.",
    },
    {
      question: "How is this different from the hash generator?",
      answer:
        "The hash generator computes digests. This page compares them, which is a different job with different ways to go wrong. You paste the line exactly as the release page printed it — a bare digest, the two-space sha256sum form, the BSD SHA256 (file) = form, an OCI sha256: prefix, or a whole SHA256SUMS file — and it works out the algorithm from the digest's length, compares every one of the four digests it computed, and states which matched. Drop several files at once and each is matched to the sums line that names it, so a directory of downloads is one operation.",
    },
    {
      question: "It says MATCH. Does that mean the download is safe to run?",
      answer:
        "It means the bytes on your disk are the bytes that checksum was taken from: nothing was corrupted in transit and no mirror served you something else. It does not mean the publisher is trustworthy, and it does not mean the checksum itself is genuine — whoever can replace a download can usually also edit the page listing its hash, and then the two change together. A signature you can verify against a key you already had is the stronger check. This is the fast one, and it catches the failure that actually happens most often, which is a bad transfer.",
    },
    {
      question: "I pasted a whole SHA256SUMS file and it says my file is not in the list.",
      answer:
        "With more than one line pasted, each dropped file is matched by name, because the filename is the only thing in a sums file that says which line applies. Directory prefixes are stripped, so a line reading ./dists/ubuntu.iso matches a file called ubuntu.iso, and a case-insensitive match is tried as well. What will not match is a file your browser renamed on download — ubuntu(1).iso, say. Rename it back, or delete every line but the one you want and paste that single digest, which is compared against whatever you drop regardless of its name.",
    },
    {
      question: "Can I check a 4 GB ISO?",
      answer:
        "Yes. Each file is hashed as it is read — the digests are fed in chunks off the file stream, so nothing is ever held in memory whole and there is no size at which the read fails. This was not true before September 2026: the file used to be read into one allocation first, browsers hand out roughly 2 GB in a single piece, and a 4 GB ISO could not be opened at all. What a very large file costs now is time rather than failure. All four digests are computed in JavaScript at roughly 40 MB a second together, measured in the browser, so a 4 GB image takes a couple of minutes with a progress bar, and the tab stays responsive because the work happens in a worker."
    },
  ],
  "regex-tester": [
    {
      question: "Which regex flavor does this use?",
      answer:
        "It uses JavaScript's built-in RegExp engine, which follows the ECMAScript specification. This is the same regex flavor used in Node.js, browsers, and most JavaScript frameworks.",
    },
    {
      question: "What do the flag buttons mean?",
      answer:
        "g = global (find all matches), i = case-insensitive, m = multiline (^ and $ match line boundaries), s = dotAll (. matches newlines), u = Unicode.",
    },
    {
      question: "Can I use named capture groups?",
      answer:
        "Yes. JavaScript regex supports named groups via (?<name>...). The matched group appears in the results panel labelled with its name, alongside numeric capture groups.",
    },
    {
      question: "Why did I get a 'pattern took too long' error?",
      answer:
        "Your pattern likely triggers catastrophic backtracking — nested quantifiers like (a+)+$ can take exponential time against a non-matching string. Evaluation runs in a background worker with a 2-second cap, so the runaway pattern gets stopped instead of freezing the tab; rewrite it to avoid a quantifier inside a quantifier.",
    },
    {
      question: "Can I do find-and-replace here?",
      answer:
        "No — this is a tester, so it highlights matches and lists capture groups but never rewrites the text. You can copy every match with 'Copy all hits', which puts one match per line on your clipboard.",
    },
  ],
  "qr-code-generator": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. QR codes are generated entirely in your browser using the qrcode library.",
    },
    {
      question: "What's the maximum text length for a QR code?",
      answer:
        "QR codes can encode up to about 4,296 alphanumeric characters or 2,953 bytes. In practice, keeping content under 500 characters ensures reliable scanning.",
    },
    {
      question: "Can I customize the foreground and background colors?",
      answer:
        "Yes — both colors are configurable. Just keep enough contrast between them: scanners need a clear difference in luminance to detect the modules. Avoid light-on-light or busy backgrounds.",
    },
    {
      question: "Should I download the PNG or the SVG?",
      answer:
        "The PNG is a 300×300 pixel bitmap — fine for screens, chat, and slides. For print or anything large, download the SVG: it is vector, so it stays sharp at any size and resolution.",
    },
    {
      question: "Will the code still scan if part of it is covered or damaged?",
      answer:
        "Usually — codes are generated at medium error correction, which can reconstruct roughly 15% of damaged or obscured modules. A small sticker over the middle often survives; covering one of the three corner finder squares usually breaks scanning.",
    },
  ],
  // The Wi-Fi payload, beside the general QR page it draws with. The
  // difference worth answering is the escaping and who can read the
  // password off the screen.
  "wifi-qr-code": [
    {
      question: "The code scans, my phone offers to join, and then it says it can't.",
      answer:
        "Almost always the network name rather than the password. It is case-sensitive and it is encoded exactly as typed, so a trailing space you cannot see is enough to break it — this page warns when the name starts or ends with one. Check the hidden-network tick too: setting it on a network that does broadcast makes some Android builds refuse the join outright. Then check the passphrase length. WPA takes 8 to 63 characters or exactly 64 hex digits, and anything else is flagged here, because no access point will accept it however cleanly the code scans.",
    },
    {
      question: "Is the password encrypted inside the QR code?",
      answer:
        "No, and nothing about a QR code ever is. It is a picture of a string, and the string here contains your passphrase in plain text — any scanner app will read it back out and show it to you. Anyone who photographs the square, screenshots this page, or picks the printed card up off the table has your Wi-Fi password. That is inherent to the format rather than something this page does badly. Nothing is uploaded to build it, so the only copies that exist are the ones you make; point it at a guest network wherever you can.",
    },
    {
      question: "My network name has a semicolon in it and other generators make a broken code.",
      answer:
        "That is the bug this format invites. A semicolon ends a field and a colon ends a key, so a name like Cafe; Bar written straight into the payload hands the reader a network called Cafe and a stray field called Bar — and the code still scans, which is why it is so hard to debug. Backslash, semicolon, comma, colon and double quote are each escaped here before the payload is assembled, in one pass so an escape character does not get escaped a second time. The payload is printed on screen exactly as encoded, backslashes and all.",
    },
    {
      question: "Why is my network name wrapped in double quotes in the payload?",
      answer:
        "Because it is entirely hex digits. A reader is entitled to treat a bare run of hex in those fields as the byte-wise spelling of the value rather than as its text, so a network genuinely called ABCD would be looked for as the two bytes AB CD and matched against nothing on air. The quotes say these are characters. The same rule is applied to an all-numeric passphrase, where the failure is worse because nothing looks wrong — the join simply never authenticates. A handful of very old scanners do not understand the quotes and show them as part of the name.",
    },
    {
      question: "Can I make one for WPA3, or for the enterprise network at work?",
      answer:
        "For enterprise, no. An 802.1X network needs an identity, an EAP method and a phase-2 method, and this page writes only the T, S, P and H fields — it does not emit the E, I, A or PH2 fields some readers understand, and it never asks you for a certificate. For WPA3-Personal, pick WPA/WPA2: SAE uses the same passphrase, and phones join transition-mode networks from a T:WPA payload perfectly well. A WPA3-only network paired with a device that insists on the newer T:SAE spelling may still refuse, and neither that nor the DPP format is generated here.",
    },
  ],
  "timestamp-converter": [
    {
      question: "What timezone is used?",
      answer:
        "Unix timestamps are timezone-independent (they represent seconds since 1970-01-01 UTC). The human-readable output uses your browser's local timezone.",
    },
    {
      question: "What's the difference between seconds and milliseconds?",
      answer:
        "Unix timestamps in seconds are 10 digits (e.g., 1700000000). Milliseconds are 13 digits (e.g., 1700000000000). JavaScript's Date.now() returns milliseconds.",
    },
    {
      question: "What is ISO 8601 and when should I use it?",
      answer:
        "ISO 8601 is the international standard for representing dates and times as a string, like 2026-05-03T14:30:00Z. Use it whenever a date crosses a system or API boundary — it removes any ambiguity about format or time zone.",
    },
    {
      question:
        "Can I see the human-readable time in UTC instead of my local zone?",
      answer:
        "Yes — a Local/UTC toggle switches the human-readable line, and the rail always shows the UTC clock time plus the name of your local zone, so you can compare a server log against your wall clock without guessing.",
    },
    {
      question: "Do dates before 1970 work?",
      answer:
        "Yes — use a negative Unix timestamp. Entering -86400 in the seconds field gives midnight December 31, 1969 UTC, and the range extends about 273,000 years in either direction (JavaScript's Date limit). Outside that range the other fields just stop updating.",
    },
  ],
  // The reference and calculator pages. The zone board goes first because
  // it is the one people arrive at from this page, and the rest are the
  // no-file lookups that ship their data with the bundle.
  "timezone-converter": [
    {
      question: "The time it gives me is an hour out.",
      answer:
        "Check the anchor zone first — the row marked anchor is the one your typed clock reading belongs to, and changing it keeps the reading and moves the instant. If that is right, the remaining cause is a stale zone database. Every offset here comes from your browser's own copy of the IANA rules, so a machine that has not had an OS update since a country last changed its clocks will be wrong by exactly one hour, and this page will faithfully repeat that. Nothing on the page can correct for it; updating the operating system can.",
    },
    {
      question: "What happens if I pick a time daylight saving skipped?",
      answer:
        "It says so instead of quietly moving on. There is no 02:30 on the morning a zone springs forward — the clock goes straight from 02:00 to 03:00, so that reading never existed. The board still computes, using the offset in force before the jump, and a banner names the zone, the size of the jump and the reading the instant actually lands on. That is the same instant a calendar invite for the missing time would end up at, which is usually what you wanted to know. The half-hour jumps are detected too, not just the sixty-minute kind.",
    },
    {
      question: "Why does it say my time happens twice?",
      answer:
        "Because it does. When a zone falls back, the hour before the change and the hour after read the same on a clock face, sixty minutes apart, at two different offsets. Nothing about the digits you typed distinguishes them, so the page shows both instants with their offsets and tells you it is using the earlier one. Most libraries pick one silently; that is fine until you are reconciling a log against a calendar and an hour of events appears to be in the wrong order. The banner gives both UTC instants so you can name the one you meant.",
    },
    {
      question: "Why is my zone labelled GMT+5:30 instead of IST?",
      answer:
        "Because that is what the browser calls it, and it is passed through rather than dressed up. Only some zones have a customary letter abbreviation in the browser's English data; the rest get a GMT offset form. The abbreviations that do exist are not unique either — IST is claimed by India, Ireland and Israel, and CST by China, Cuba and the North American central zone — so they are shown as labels, never as identifiers. The IANA name in the small type under each city, and the UTC offset on the right, are the parts that unambiguously identify what you are looking at.",
    },
    {
      question: "Can I convert a whole list of timestamps at once?",
      answer:
        "No. This page converts one instant into many zones, which is the meeting-planner shape; it is not a batch converter and there is no file input. If you have a column of timestamps, the Timestamp Converter handles them one at a time between Unix seconds, milliseconds, ISO 8601 and a human-readable line. What this page does add is the Copy button on the board, which gives you the whole table as plain text — every zone with its date, time, offset and abbreviation, plus the UTC instant — ready to paste into an invite or a ticket.",
    },
  ],
  "chmod-calculator": [
    {
      question: "Why does my symbolic string show a capital S instead of an s?",
      answer:
        "Because the special bit is set and the execute bit under it is not. ls overloads the execute column: with setuid on and owner-execute on you get s, with setuid on and owner-execute off you get S. The capital is a warning rather than a variant spelling — mode 4644 stores the setuid bit and there is no program there to run as the owner, so the bit does nothing at all. The same rule applies to setgid in the group column and to the sticky bit in the other column, where the two letters are t and T. Ticking the matching execute box turns the capital back into lower case.",
    },
    {
      question: "I set 644 on a folder and now nothing inside it opens.",
      answer:
        "Execute on a directory does not mean run, it means traverse. Without it nothing can resolve a path through the directory, so every file inside becomes unreachable no matter what its own mode says. Read without execute lets you list the names and open none of them; execute without read lets you open a file whose name you already know and refuses to tell you what is in there. Directories almost always want 755 or 700. Switch the APPLIES TO control to A directory and the sentences under the grid change to the directory meaning of each bit.",
    },
    {
      question: "Why does the symbolic command say +t on its own instead of o+t?",
      answer:
        "Because o+t does not work. POSIX gives the t permission effect only when the who-list is a or is omitted, and BSD chmod follows that literally: chmod u=rwx,go=rx,o+t file leaves the sticky bit unset, while chmod u=rwx,go=rx,+t file sets it. That was measured against real chmod rather than assumed. The s permission behaves differently — it does take effect from a u or g who-list, which is why setuid comes out as u=rwxs. It is also why the command splits u=, g= and o= apart whenever a special bit is set: an s on a merged ug= clause would set setuid and setgid together.",
    },
    {
      question: "Should I just use 777 to fix a permissions problem?",
      answer:
        "No, and it usually does not fix it. 777 means every account on the machine can modify the file, or delete anything in the directory, and a lot of software actively refuses to work with it: ssh ignores a private key or a .ssh directory that is group- or world-writable, cron skips world-writable crontabs, and several sudo and PHP-FPM configurations check the same thing. When 777 appears to help, the real problem was almost always ownership, or a missing execute bit on a parent directory. For a genuinely shared directory you want 1777 or 2775, and both are in the preset row.",
    },
    {
      question: "Does this actually change permissions on my files?",
      answer:
        "No. Nothing here touches a filesystem. It is arithmetic over twelve bits plus two strings to copy, and the path you type into PATH IN THE COMMAND is only ever pasted into the two commands shown — nothing reads it, opens it, or runs anything. You copy the command and run it yourself, which also means you get to read it before you do. Nothing is sent anywhere either: the whole calculator is a few hundred lines of JavaScript that ship with the page and run in this tab.",
    },
  ],
  "http-status-codes": [
    {
      question: "What is the difference between 502 and 504?",
      answer:
        "Both come from something in front of your application, and the difference tells you where to look. 502 Bad Gateway means the proxy got an invalid response: the upstream process crashed, is not listening, or returned something that is not HTTP. 504 Gateway Timeout means the upstream was reachable and simply did not answer in time. So 502 sends you to crash logs and process supervision, while 504 sends you to slow queries, connection pools and timeouts. Cloudflare splits the timeout case further — 522 is a connection that never established, 524 is one that established and then produced nothing.",
    },
    {
      question: "Why did my POST turn into a GET after a redirect?",
      answer:
        "Because you redirected with a 301 or a 302. The specification permits a user agent to change the method to GET on those two, for historical reasons, and every browser does, so the body is dropped and the request arrives as a GET. 303 is the same behaviour stated deliberately: the follow-up is always a GET, which is what makes the POST/redirect/GET pattern work. If you need the method and body to survive, use 307 for a temporary move and 308 for a permanent one — both forbid the rewrite. Every 3xx on this page carries a chip saying which of those it is.",
    },
    {
      question: "Is 418 I'm a teapot a real HTTP status code?",
      answer:
        "No. RFC 2324 was an April Fools' joke from 1998 defining the Hyper Text Coffee Pot Control Protocol, and 418 came from there. It is not part of HTTP. What is real is that so many servers and frameworks implemented the joke that RFC 9110 now reserves 418 as unusable, so nothing legitimate can ever take the number. That is how it appears here: registered, with the phrase (Unused), and the teapot explained in the description. Sending it from a real service is a way of returning an error that no client library will understand.",
    },
    {
      question: "Where do 520 and 499 come from? They are not in any RFC.",
      answer:
        "They are vendor codes. 499 is nginx's, logged when the client hangs up before nginx can answer — it is the commonest non-standard code in a real access log and it is usually not a server fault. The 520 to 530 range is Cloudflare's, describing what went wrong between the edge and your origin. This page keeps all of them in a separate group below a rule, each labelled with the software that emits it, and the Include vendor codes checkbox hides them. They are worth knowing and they are not HTTP, and merging the two lists would make the page more convenient and less true.",
    },
    {
      question: "Can I paste a URL in and have it tell me the status?",
      answer:
        "No — this is a reference table, not a checker. There is no field to type a site into, and the page makes no network requests at all: every entry ships with the page and is searched locally. That is deliberate. A status checker has to send your URL somewhere, and a URL is very often the interesting part of a bug report — the token in the query string, the internal hostname. If you want the real status of a request, curl -I or your browser's network panel will tell you, and this page will tell you what the answer means.",
    },
  ],
  "byte-converter": [
    {
      question: "Why does my 1 TB drive show up as 931 GB?",
      answer:
        "Nothing is missing. The drive holds 10^12 bytes, which is exactly what 1 TB means to a drive manufacturer and to the SI prefixes everyone else uses. Your operating system then divides by 2^30, which is 1,073,741,824, and prints the result under the name GB instead of GiB. 10^12 divided by 2^30 is 931.32, so that is the number you see. The gap is 6.87% at every giga-sized capacity, and it widens one prefix at a time: 2.34% at kilo, 4.63% at mega, 9.05% at tera. macOS has used decimal units since 10.6, which is why the same drive reads differently on a Mac and on Windows.",
    },
    {
      question: "My connection says 100 Mbps but I only get 12 MB/s.",
      answer:
        "That is the correct answer rather than a fault. A link speed is quoted in bits per second and a file size in bytes, and a byte is eight bits, so 100 Mbit/s is 12.5 MB/s at the absolute best. The lower-case b and the upper-case B carry the whole difference and are easy to miss on a spec sheet. The transfer-time helper on this page divides bits by bits for exactly that reason. Real throughput is lower still — TCP headers, TLS, HTTP framing and the fact that almost no link sustains its rated rate all take a cut — so treat the number as a floor.",
    },
    {
      question: "Is the exact byte count actually exact?",
      answer:
        "Yes, and it says so when it is not. Every value is held as an exact fraction of two arbitrary-precision integers, so a conversion is whole-number arithmetic rather than floating point. That matters because a JavaScript number stops representing integers exactly above 9,007,199,254,740,991, which is 9.007 PB, and quietly rounds beyond it — inside the range people ask this page about. Where a value is not a whole number of bytes at all, such as 5 bits, the byte count reads not a whole byte instead of a rounded integer, and rows whose displayed value has more digits than fit are marked ROUNDED.",
    },
    {
      question: "Which unit should I actually use — MB or MiB?",
      answer:
        "Follow whatever produced the number. Drive and network vendors use decimal, so a 500 GB SSD really is 5 times 10^11 bytes. RAM is genuinely binary, because address lines come in powers of two, so a 16 GB stick really is 16 GiB. Linux tools and Windows Explorer report binary, while macOS has reported decimal since 10.6. The trap is that Windows prints the binary value under the decimal name, which is the single largest source of this confusion. When you are writing the number down yourself, kB/MB/GB for powers of 1000 and KiB/MiB/GiB for powers of 1024 is unambiguous and costs one letter.",
    },
    {
      question: "Can I paste something like 4.7 GB and have it just work?",
      answer:
        "Type the number into the GB row rather than pasting the unit along with it — the fields hold a number, and a unit inside one is refused rather than guessed at. The same goes for a lone comma: 1,234,567 is read as grouped thousands, but 1,5 is refused, because it means one and a half in much of Europe and one thousand five hundred nowhere, and guessing between them would change the answer by a factor of 1000. Scientific notation works, so 1e9 is fine, and so do underscores in 1_000_000.",
    },
  ],
  "aspect-ratio-calculator": [
    {
      question: "Why does it say 1366×768 is not 16:9?",
      answer:
        "Because it is not. Divide both sides by their greatest common divisor, which is 2, and you get 683:384. That works out to 1.7786 against 16:9's 1.7778 — about 0.05% wider, or roughly half a pixel across a 1366-pixel screen. It is invisible and it is still not the same ratio, which matters the moment you are matching a panel exactly rather than approximately. The page shows the exact reduced pair, the nearest named ratio, and the percentage between them, so you can decide which of the two you actually want.",
    },
    {
      question: "I asked for 16:9 and the height it gave me is not 16:9.",
      answer:
        "Pixels are whole numbers and most widths do not divide cleanly. 1366 at 16:9 is 768.375 high, and there is no such thing as three-eighths of a pixel, so it rounds to 768 — and 1366×768 is 683:384, not 16:9. The footnote under the fields names the exact value it rounded from, and the banner explains that the rounding is what caused the drift. If you need an exact 16:9 box, change the width to a multiple of 16: 1360×765 and 1376×774 are both exact.",
    },
    {
      question: "Is 21:9 a real aspect ratio?",
      answer:
        "No, it is a marketing name — and it does not even name one shape. The 2560×1080 ultrawides sold as 21:9 reduce to 64:27, which is 2.370:1, but the 3440×1440 ones reduce to 43:18, which is 2.389:1, and the 3840×1600 panels badged the same way are 12:5, or 2.4:1. Three ratios, one name. Literal 21:9 would be 2.333:1 and nothing ships at it. The preset on this page is labelled 21:9 because that is what people search for and is stored as 64:27, the commonest of the three; type 3440×1440 into the fields and the page will tell you it is 43:18, because it is.",
    },
    {
      question: "How do I work out the black bars for a widescreen clip in a square frame?",
      answer:
        "Tick FIT INTO A FRAME in the rail, leave the mode on Contain, and enter the frame size. For a 1920×1080 clip in a 1080×1080 post, the picture scales to 1080×608 and the page reports 236 pixels of empty frame above and below, plus the share of the frame the picture covers. Switch to Cover and it reports the opposite: the picture fills the square at 1920×1080 and 420 pixels come off each side. The numbers are the ones you type into an editor; this page does not touch any video or image itself.",
    },
    {
      question: "Does this actually resize my image or video?",
      answer:
        "No. This page is arithmetic — it takes numbers and gives back numbers, and never opens a file. There is no drop zone here because there is nothing to drop. Once you have the dimensions, Resize Image will apply them to a picture, Crop Image will cut a region to a fixed ratio, and the video compressors take a target resolution. Keeping the calculator separate is deliberate: you often want the numbers for something this site cannot do at all, like a CSS rule, a print layout or an editor's export dialog.",
    },
  ],
  "color-picker": [
    {
      question: "What color formats are supported?",
      answer:
        "HEX (#RRGGBB), RGB (0-255 per channel), and HSL (hue 0-360°, saturation 0-100%, lightness 0-100%). All formats update in sync.",
    },
    {
      question: "Why use HSL instead of HEX or RGB?",
      answer:
        "HSL separates hue from saturation and lightness, so you can dial in a tint or shade without re-mixing the entire color. Designers prefer it for building palettes, hover states, and accessible contrast pairs.",
    },
    {
      question: "Can I copy the color in CSS-ready form?",
      answer:
        "Yes. Click any value to copy it to your clipboard exactly as it should appear in CSS — for example #56b8e6, rgb(86 184 230), or hsl(202 75% 62%).",
    },
    {
      question: "If I slide lightness down to 0, do I lose my color?",
      answer:
        "No. Hue and saturation are held while you edit the HSL fields, so taking lightness to black or white and back returns the exact color you started with instead of grey. Entering a new HEX or RGB value resyncs all three formats to that color.",
    },
    {
      question: "Can I paste a 3-digit hex like #f80?",
      answer:
        "Yes — shorthand expands each digit, so #f80 becomes #ff8800, and the # itself is optional. A half-typed value is ignored until it parses, so the other fields never flash a wrong color mid-edit.",
    },
  ],

  // ── PDF Tools ──────────────────────────────────────────────────────
  "merge-pdf": [
    {
      question: "Is there a limit to how many PDFs I can merge?",
      answer:
        "There is no hard limit. The tool processes everything in your browser, so the practical limit depends on your device's memory. Merging dozens of average-sized PDFs should work fine.",
    },
    {
      // PRE-EXISTING defect, fixed here rather than inherited: this answer
      // listed "form fields" among the page-level features that survive. They
      // do not. mergePdfs uses the same graft as split/extract/delete, and the
      // measurement is in the block comment above extract-pdf-pages in
      // tools.ts — a source whose getForm().getFields() is
      // [applicant.name, agreed] comes back through mergePdfs with no
      // /AcroForm at all and no fields. The widget annotation survives, so the
      // field is still drawn; it is simply no longer a form. The same run
      // showed /Names and /PageLabels going with it, so the answer names those
      // too instead of implying the outline is the only document-level loss.
      question: "Will the merged PDF keep bookmarks and links?",
      answer:
        "Page-level features — annotations, and the widgets a form field draws — are copied with their pages, and the first file's document title and author are carried over. What is not merged is anything that hangs off the document rather than a page: the outline tree, the interactive form, named destinations and page labels. So the combined file starts with no bookmarks, and a merged form still shows its boxes and their filled-in text but can no longer be filled in. Internal links are repointed at the pages they name, so a cross-reference inside one of the documents you merged still lands where it should, whichever file it came from. A link that pointed at a named destination rather than at a page has nothing left to resolve against and does nothing.",
    },
    {
      question: "Can I reorder the files before merging?",
      answer:
        "Yes. Drag and drop the files in the list to set the order before you click merge.",
    },
    {
      question: "Can I merge PDFs with different page sizes?",
      answer:
        "Yes. Each page keeps its own dimensions and orientation — an A4 page stays A4 next to a Letter or landscape page. Nothing is scaled, cropped, or normalized during the merge.",
    },
    {
      question: "Can I include the same PDF more than once?",
      answer:
        "Yes — pick the file again and it appears as a second card in the assembly strip, so you can repeat a cover sheet or a form between documents. Each copy's pages are written out in full.",
    },
  ],
  "split-pdf": [
    {
      question: "How do I specify which pages to extract?",
      answer:
        "Click individual page thumbnails to select them, or type a range like '1-3, 5, 8-10' in the text input. Selected pages are extracted into a new PDF.",
    },
    {
      question: "Can I split a PDF into individual pages?",
      answer:
        "Yes. Select all pages and each will be included. For truly separate files per page, you can run the tool multiple times or select one page at a time.",
    },
    {
      question: "Are bookmarks and metadata preserved?",
      answer:
        "The extracted file keeps the document title and author. Bookmarks are not carried over — the pages are copied into a fresh document, so the outline tree is rebuilt empty. Page-level links and annotations travel with their pages.",
    },
    {
      question: "Why do the thumbnails stop after page 50?",
      answer:
        "Only the first 50 pages are rendered as thumbnails, to keep long documents from stalling the page. Every page is still selectable — type a range like 51-60 in the range field and it works exactly the same.",
    },
    {
      question: "If I type 5, 1, 3 — do the pages come out in that order?",
      answer:
        "No. Extracted pages always keep the order they had in the original document — the selection is sorted before extraction, and the range field normalizes what you typed (3, 1, 2 becomes 1-3). To change the sequence itself, run the result through Reorder PDF Pages.",
    },
  ],
  "compress-pdf": [
    {
      question: "How much smaller will my PDF get?",
      answer:
        "It depends entirely on what is inside the file. A PDF carrying objects nothing references any more, or content streams that were never compressed, can lose the large majority of its size. A PDF that has already been through this treatment loses nothing at all. The readout shows the before and after sizes, so you never have to guess which case you were in.",
    },
    {
      question: "Does compression reduce image quality?",
      answer:
        "No. The work is structural only: unreferenced objects are dropped, streams that arrived uncompressed are deflated, and the objects are repacked into compressed object streams. Embedded images are never re-encoded or downsampled, so every pixel comes out identical to the one that went in.",
    },
    {
      question: "Will compression work on scanned PDFs?",
      answer:
        "Scanned PDFs are mostly raster image data, already compressed by the scanner, so structural work makes only a small dent. For scans the highest-leverage move is reducing image resolution before the PDF is produced. This tool can still drop whatever the file no longer references on top of that, which on a scanner’s output is sometimes more than you would expect.",
    },
    {
      question: "What happens if compression would make my file bigger?",
      answer:
        "You get your original bytes back. A PDF that is already garbage-collected, already deflated and already packed into object streams has nothing left to give, and rewriting it can come out the same size or a shade larger. The two files are compared and whichever is smaller is what you get — the readout then shows 0% saved and a note explains that the original won.",
    },
    {
      question: "Why are there no quality settings?",
      answer:
        "There is nothing to trade. The whole operation is lossless — unreferenced objects dropped, uncompressed streams deflated, the structure repacked — and it starts the moment you drop the file. Because it never re-encodes your images or your text, a quality dial would have nothing to turn down.",
    },
  ],
  "recompress-pdf-images": [
    {
      question: "How is this different from Compress PDF?",
      answer:
        "Compress PDF is lossless. It drops objects nothing references, deflates streams that arrived uncompressed and repacks the file, and every pixel and character comes out identical — it has no image encoder at all, which is why a PDF that is mostly photographs often comes back the same size to the byte. This tool is the lossy counterpart: it decodes the JPEG images the document carries and writes them back at a lower quality, which is the only way a photo-heavy file gets meaningfully smaller. Try Compress PDF first if losing nothing matters, and this one when the size matters more than the pixels.",
    },
    {
      question: "Which images does it skip, and why?",
      answer:
        "Only images stored as JPEG are re-encoded. Anything else is written back byte for byte as it came in: JPEG 2000, CCITT fax, JBIG2 and deflated bitmaps, images carrying or acting as a transparency mask, images with their own decode array or predictor parameters, CMYK, indexed and ICC-tagged colour spaces, and anything that is not eight bits per channel. Each of those would need a codec or a colour conversion this tool does not carry, and guessing at one prints an inverted or falsely coloured page. Every skipped image is counted and its reason named on screen, so you always know how much of the file was actually in play.",
    },
    {
      question: "Can I get the original image quality back afterwards?",
      answer:
        "No. The re-encode is destructive and nothing in the output remembers the pixels that went in — detail a lower-quality JPEG pass throws away is gone, and running the result through again only compounds it. Keep your original file. Since the work happens on your own machine, the copy on your disk is the only copy that exists.",
    },
    {
      question: "Why didn't it reach the target size I typed?",
      answer:
        "Because some documents cannot get there. The search lowers JPEG quality first and then image dimensions, rebuilding the whole file each round, but text, fonts and vector artwork are never re-encoded and neither are the images it had to skip — so there is a floor below which the document will not go. When the run ends above your number it says so and reports the closest size it reached, rather than handing you a download that quietly missed the target. If every image was skipped, the only saving left is the structural one — the file is still repacked into object streams, which usually moves it a little — and it tells you that is all that happened.",
    },
    {
      question: "Will the text and line art get fuzzy too?",
      answer:
        "No. Only the embedded images are replaced. The text, the fonts it is set in and the vector drawing are never re-encoded, so a page of type comes out identical after a run — the loss is visible only where there was a photograph to lose it in.",
    },
    {
      question: "Does it help with a scanned PDF?",
      answer:
        "Usually, and that is the case it exists for: most scanners store each page as a JPEG, which is precisely what this tool re-encodes, so a multi-megabyte scan can lose a large share of its size. Two kinds of scan will not budge — a bilevel fax-style scan stored as CCITT or JBIG2, and one whose pages sit in a colour space this tool skips. Both are reported as skipped rather than quietly passed through.",
    },
  ],
  "pdf-to-jpg": [
    {
      question: "What resolution are the output images?",
      answer:
        "By default, pages are rendered at 2× scale for crisp output. You can adjust the scale to get higher or lower resolution images.",
    },
    {
      question: "Can I choose PNG or WebP instead of JPG?",
      answer:
        "Yes. Toggle between JPG, PNG, and WebP output. PNG is lossless and larger; JPG and WebP are smaller with adjustable quality. WebP needs a browser that can encode it — Chrome and Edge can, Safari cannot, and the tool shows a clear error there rather than mislabeling PNG bytes as WebP.",
    },
    {
      question: "How do I convert just one page?",
      answer:
        "Every page is rendered. The deck shows one tile per page — click a tile to save that page on its own, or use Download all (ZIP) to take the whole set. There is no page-range filter on this tool; to work with a subset, run Split PDF first and convert the extracted file.",
    },
    {
      question:
        "Why does Download all give me a ZIP instead of separate files?",
      answer:
        "Browsers throttle a burst of programmatic downloads — typically only the first few files would actually save. Bundling every page into one ZIP avoids that, and the archive is named after your PDF, so report.pdf comes down as report-pages.zip.",
    },
    {
      question: "Why do I get a 'page too large' error at high scale?",
      answer:
        "At 4× a physically large page can exceed the browser's canvas limits, and the error tells you the exact pixel dimensions it tried to render. Lower the scale and convert again — 2×, the default, is already crisp for screen use.",
    },
  ],
  "pdf-to-png": [
    {
      question: "Why choose PNG over JPG for PDF pages?",
      answer:
        "PNG is lossless — text edges, thin lines, and flat colors come out exactly as rendered, with none of the compression artifacts JPG introduces around sharp detail. The trade-off is size: a text-heavy page as PNG is usually several times larger than the same page as a JPG.",
    },
    {
      question: "Why is there no quality slider on this page?",
      answer:
        "PNG has no quality dial to turn — the encode is lossless, so there is nothing to trade away. The control that changes output size here is the scale slider; switch the format toggle to JPG or WebP if you want lossy compression with a quality setting.",
    },
    {
      question: "What resolution do the PNGs come out at?",
      answer:
        "Pages render at 2× scale by default, which is crisp for screen use, and the slider goes up to 4× for print or high-DPI displays. At 4× a physically large page can exceed the browser's canvas limits — the error names the exact pixel dimensions it attempted, and lowering the scale fixes it.",
    },
    {
      question: "How do I download all the pages?",
      answer:
        "Each page becomes page-1.png, page-2.png, and so on. Click a tile in the deck to save one page, or use Download all (ZIP) — the archive is named after your document, so report.pdf comes down as report-pages.zip.",
    },
    {
      question: "Is this a different tool from PDF to JPG?",
      answer:
        "Same renderer, different default: this page preselects PNG output, and the JPG and WebP toggles are right there if you change your mind. Nothing else differs — same scale control, same ZIP delivery.",
    },
  ],
  "pdf-to-webp": [
    {
      question: "Which browsers can convert PDF to WebP?",
      answer:
        "Chrome, Edge, and other Chromium-based browsers, which carry a native WebP encoder. Safari can display WebP images but cannot create them, so this page shows a clear error there instead of producing broken output — use PDF to PNG in Safari, or open this page in Chrome or Edge.",
    },
    {
      question: "What happens in a browser that can't encode WebP?",
      answer:
        "Canvas encoders don't fail on an unsupported format — they silently substitute PNG, which would leave you with PNG bytes wearing .webp names. This tool inspects the first page's encoded bytes and stops with an error before rendering the rest, so you never download a mislabeled ZIP.",
    },
    {
      question: "Why WebP instead of JPG?",
      answer:
        "At a comparable quality setting a WebP page is usually meaningfully smaller than the JPG equivalent, which adds up quickly on a long document headed for the web. If the images must open in older software, JPG remains the safer choice.",
    },
    {
      question: "Does the quality slider apply to WebP?",
      answer:
        "Yes. The WebP output here is a lossy encode, so the quality slider sets its encoder quality exactly as it does for JPG. PNG is the only output on this tool without a quality control.",
    },
    {
      question: "How are multi-page PDFs delivered?",
      answer:
        "One .webp per page — click a tile to save a single page, or Download all (ZIP) to take the whole set. The ZIP is named after your PDF, so slides.pdf comes down as slides-pages.zip.",
    },
  ],
  "images-to-pdf": [
    {
      question: "What image formats are supported?",
      answer:
        "JPG, PNG, WebP, HEIC, and TIFF are all accepted. JPG and PNG go into the PDF without a lossy re-encode; WebP and HEIC are decoded in your browser and re-encoded as PNG (when transparent) or JPEG at quality 0.92 (when opaque), and every page of a multi-page TIFF becomes its own PDF page.",
    },
    {
      question: "Can I choose the page size?",
      answer:
        "Yes. Choose between A4, US Letter, or 'Fit to Image' which makes each page exactly the size of the image.",
    },
    {
      question: "Are images stretched to fill the page?",
      answer:
        "No. Images are scaled proportionally to fit within the page margins while maintaining their aspect ratio.",
    },
    {
      question: "Do my images lose quality when they become a PDF?",
      answer:
        "JPG data is embedded byte-for-byte without re-encoding, and 8-bit PNGs are decoded and repacked losslessly (a rare 16-bit PNG is reduced to 8 bits per channel, with a notice). WebP, HEIC, and TIFF inputs are re-encoded on the way in: losslessly to PNG when they carry transparency, to JPEG at quality 0.92 when they are opaque — a slight and usually invisible cost.",
    },
    {
      question: "Why is there white space around my image?",
      answer:
        "A4 and Letter pages keep a 40-point margin (about 14 mm) with the image centered inside it, and images are never enlarged past their natural size. Choose 'Fit' instead — each page then matches its image's exact dimensions, edge to edge.",
    },
  ],
  "jpg-to-pdf": [
    {
      question: "Does converting JPG to PDF lose quality?",
      answer:
        "No. Your JPG bytes are embedded into the PDF exactly as they are — pdf-lib's JPEG path never decodes or re-encodes them, so the pixels in the PDF are the pixels in your file.",
    },
    {
      question: "Can I combine multiple JPGs into one PDF?",
      answer:
        "Yes. Each JPG becomes one page. Drag the thumbnail cards to set the page order, and use the Add image slot to append more photos before creating the PDF.",
    },
    {
      question: "What happens if my file is really a PNG renamed to .jpg?",
      answer:
        "It still works. The tool routes on the file's actual bytes, not its name, so a misnamed PNG is embedded through the PNG path instead of corrupting the document.",
    },
    {
      question: "How big will the PDF be?",
      answer:
        "Roughly the size of your JPG files combined, plus a small structural overhead — nothing is re-encoded, so nothing grows or shrinks. A 5 MB photo contributes about 5 MB to the PDF.",
    },
  ],
  "png-to-pdf": [
    {
      question: "Does PNG transparency survive in the PDF?",
      answer:
        "Yes. The alpha channel is carried into the PDF as a soft mask, so transparent regions stay transparent in the file and render over the page's white background in virtually every viewer.",
    },
    {
      question: "Is the conversion lossless?",
      answer:
        "For 8-bit PNGs — virtually every screenshot and export — yes: every pixel value survives exactly, and there is no quality slider because there is nothing to trade away. A rare 16-bit PNG is reduced to 8 bits per channel, and the tool shows a notice when that happens.",
    },
    {
      question: "Why is the PDF a different size than my PNG files?",
      answer:
        "The same pixels are stored under PDF's own Flate compression rather than PNG's container, so the total can come out a little smaller or larger. The pixels themselves are unchanged.",
    },
    {
      question: "Can I control where the image sits on the page?",
      answer:
        "The image is always centered. On A4 and Letter it sits inside a 40-point margin, scaled down to fit but never enlarged; choose 'Fit' to make each page exactly the size of its image instead.",
    },
  ],
  "heic-to-pdf": [
    {
      question: "Why turn HEIC photos into a PDF?",
      answer:
        "Application portals, government forms, and office workflows often accept only PDF — and many of them cannot read HEIC at all. Converting photos of documents into one PDF gets an iPhone camera roll past both problems at once.",
    },
    {
      question: "Does HEIC to PDF lose quality?",
      answer:
        "Slightly. HEIC cannot be embedded in a PDF directly, so each photo is decoded with libheif and re-encoded as JPEG at quality 0.92 — usually indistinguishable from the original. An image with transparency is saved as lossless PNG instead.",
    },
    {
      question: "Can I convert several HEIC photos at once?",
      answer:
        "Yes. Each photo becomes its own page in the order shown on the assembly strip — drag the cards to rearrange them before creating the PDF.",
    },
    {
      question: "What about burst or multi-image HEIC files?",
      answer:
        "A HEIC container that carries several images contributes its primary image only — that is the photo iOS shows you. The other frames are not read.",
    },
  ],
  "webp-to-pdf": [
    {
      question: "How does a WebP end up inside a PDF?",
      answer:
        "PDF has no WebP embedder, so the image is decoded in your browser with the Canvas API and re-encoded first: as lossless PNG if it carries any transparency, or as JPEG at quality 0.92 if it is fully opaque.",
    },
    {
      question: "What happens to animated WebP files?",
      answer:
        "Only the first frame becomes a PDF page, and the tool says so on screen the moment you add the file — before you convert — so the loss is never silent.",
    },
    {
      question: "Does WebP transparency survive?",
      answer:
        "Yes. Transparent WebPs take the PNG path, and the alpha channel rides into the PDF as a soft mask that viewers composite over the white page.",
    },
    {
      question: "Why is the PDF larger than my WebP files?",
      answer:
        "WebP compresses harder than JPEG or PNG, and PDF viewers cannot read WebP data — so the re-encode usually costs some bytes. That is the trade for a file every PDF reader can open.",
    },
  ],
  "tiff-to-pdf": [
    {
      question: "Do multi-page TIFFs keep all their pages?",
      answer:
        "Yes — that is the point of this tool. Every page of the TIFF becomes a page of the PDF, and the assembly strip shows the true page count the moment the file is added, before you convert.",
    },
    {
      question: "Is the conversion lossless?",
      answer:
        "Each page is decoded with utif2 and re-encoded for the PDF: losslessly to PNG when the page carries transparency, to JPEG at quality 0.92 when it is fully opaque — a slight, usually invisible cost on photographic scans.",
    },
    {
      question: "Can very long scans run out of memory?",
      answer:
        "Pages are decoded one at a time, never all at once, precisely so a long fax or scan TIFF does not exhaust a tab's memory. Very large individual pages are still bounded by your device's canvas limits.",
    },
    {
      question: "Is .tif the same as .tiff?",
      answer:
        "Yes — two extensions for the same format. Both are accepted, in either byte order (the II little-endian and MM big-endian variants).",
    },
  ],
  "rotate-pdf": [
    {
      question: "Can I rotate individual pages?",
      answer:
        "Yes. Select specific pages by clicking their thumbnails, then apply the rotation. Unselected pages remain unchanged.",
    },
    {
      question: "What rotation angles are available?",
      answer:
        "You can rotate pages by 90° (clockwise), 180°, or 270° (counter-clockwise). Rotation is cumulative — rotating a page that's already at 90° by another 90° gives 180°.",
    },
    {
      question: "Does rotating a page break text selection or search?",
      answer:
        "No. Rotation only changes the page's display orientation in the PDF; the underlying text layer and its coordinates are untouched, so copy, search, and screen-reader access keep working.",
    },
    {
      question: "Do I have to select pages before rotating?",
      answer:
        "No — every page starts selected when the file loads, so straightening a whole sideways scan is one click. Deselect the pages you want to leave alone, or hit Deselect all and pick just the odd ones out.",
    },
    {
      question: "Can I rotate some pages 90° and others 180° in one pass?",
      answer:
        "Not in one pass — a single angle applies to the whole selection, and every run starts from the file you uploaded, not from the previous result. Rotate the first group, download, then upload that file again for the second group.",
    },
  ],
  "add-page-numbers": [
    {
      question: "Where can I place page numbers?",
      answer:
        "You can place numbers at the top or bottom of each page, aligned to the left, center, or right. Six positions in total.",
    },
    {
      question: "Can I start numbering from a number other than 1?",
      answer:
        "Yes. Set the starting number to any value. This is useful when your PDF is part of a larger document.",
    },
    {
      question: "Can I skip the first few pages — like a cover or title?",
      answer:
        "No. Numbering always begins on page one and every page in the file gets a number; the only control over the sequence is the starting number. To leave a cover unnumbered, split it off with Split PDF, number the rest, then merge the two files back together.",
    },
    {
      question: "Can I change the font or size, or use 'Page X of Y'?",
      answer:
        "No — the numbers are plain numerals set in 10-point Helvetica, and the only controls are the position and the starting number. There is no format template, Roman numeral, or 'X of Y' option.",
    },
    {
      question:
        "Will the numbers overlap a header or footer my document already has?",
      answer:
        "They can. Each number is drawn on top of the existing page content — about 20 points up from the bottom edge (or 30 down from the top) and 40 points in from the sides — so if your document already prints something in that spot, the two will collide. Pick one of the other five positions in that case.",
    },
  ],
  "pdf-page-reorder": [
    {
      question: "How do I reorder pages?",
      answer:
        "After uploading your PDF, you'll see thumbnail previews of every page. Drag and drop the thumbnails into your desired order, then click download.",
    },
    {
      question: "Can I remove pages while reordering?",
      answer:
        "This tool focuses on reordering. To remove pages, use the Split PDF tool to extract only the pages you want to keep.",
    },
    {
      question: "Is there a limit on how many pages I can reorder?",
      answer:
        "No fixed limit. Performance scales with browser memory — documents up to a few hundred pages reorder smoothly on a modern laptop. Very large PDFs may take longer to render thumbnails.",
    },
    {
      question: "How do I reorder pages on a phone or with a keyboard?",
      answer:
        "Tap a page, then use the Move left / Move right buttons — touch screens can't start a desktop-style drag, so the buttons are the mobile path. With a keyboard, focus a tile and press the left or right arrow key; each move is announced for screen readers.",
    },
    {
      question:
        "Why don't the numbers on the thumbnails change when I move pages?",
      answer:
        "The number on each thumbnail is the page's position in your original file, so after shuffling you can still see where every page came from. The header switches to 'Order changed' once the sequence differs, and 'Restore original order' puts everything back in one click.",
    },
  ],
  "extract-pdf-pages": [
    {
      question: "How is this different from Split PDF?",
      answer:
        "Split PDF does one thing: the pages you pick come out as a single new document. This tool does that too, and adds the half it does not have — One per page mode writes a separate PDF for every page you selected and hands them over as one ZIP. The page deck, the range syntax and the selection behaviour are identical between the two.",
    },
    {
      question: "How are the separate PDFs named?",
      answer:
        "After the page they came from, not their position in the batch. Select pages 3 and 9 and the ZIP holds page-3.pdf and page-9.pdf — which is the only naming that still makes sense once the files are unzipped next to the original document.",
    },
    {
      question: "What happens if I select just one page in One per page mode?",
      answer:
        "There is nothing to zip, so the single PDF saves on its own as page-N.pdf rather than inside an archive. The output readout shows that exact filename before you run anything, so the button never promises a ZIP it will not produce.",
    },
    {
      question: "Do the pages come out in the order I clicked them?",
      answer:
        "No. The selection is sorted before extraction, so pages always keep the order they had in the original document — clicking 5, then 1, then 3 gives you 1, 3, 5. To change the sequence itself, run the result through Reorder PDF Pages.",
    },
    {
      // Measured against the shipped graft — see the block comment above
      // extract-pdf-pages in tools.ts. /AcroForm, /Names and /PageLabels are
      // dropped alongside /Outlines; the widget annots survive, so the field
      // still DRAWS but nothing can fill or read it.
      question: "Are bookmarks and formatting preserved?",
      answer:
        "Formatting is: pages are grafted across whole, so fonts, embedded images and vector art come over untouched, each page's annotations travel with it, and nothing is re-encoded. What is not preserved is anything that belongs to the document rather than to a page — the outline tree, the interactive form, named destinations and page labels. So an extracted file starts with no bookmarks, and a fillable form still draws its fields and whatever was typed into them but can no longer be filled in or read by a form tool. Links between the pages you extracted keep working: each one is repointed at the page it names. A link to a page you did not extract has its destination removed, so it does nothing rather than jumping to the front of the file, and a link that pointed at a named destination goes dead because the table of names is part of the document layer that does not travel. The same is true of merging and splitting here.",
    },
  ],
  "delete-pdf-pages": [
    {
      question: "Do I select the pages I want to keep or the ones I want gone?",
      answer:
        "The ones you want gone. This tool is the page picker inverted: every page you mark is removed and everything else is kept. The thumbnails you pick get a red cross, the header counts the pages that will be removed, and the rail shows Removing and Remaining side by side so the meaning is never in doubt.",
    },
    {
      question: "Can I delete every page?",
      answer:
        "No, and that is deliberate. A PDF with zero pages is a structurally valid file that no reader will open, so once every page is marked the tool shows a warning and leaves the Delete button disabled. Leave at least one page behind.",
    },
    {
      // Same measurement as extract-pdf-pages above: deletePdfPages is
      // graftPages, so the document-level layer is left behind wholesale.
      question: "What happens to the pages that stay?",
      answer:
        "They are copied into a fresh document whole — fonts, images, vector art and each page's own annotations travel with them, and they keep their original relative order. What is left behind is the document-level layer: the outline tree, the interactive form, named destinations and page labels. So the result starts with no bookmarks, roman-numeral front matter comes back as plain numbering, and a fillable form still shows every field and its filled-in text but is no longer fillable. Links between pages you kept still work; a link to a page you deleted has its destination removed, so it sits there inert instead of jumping somewhere arbitrary.",
    },
    {
      // The interesting half of this answer is the contrast with crop-pdf,
      // where the hidden content really is still in the file. Here it is not,
      // and that was worth proving rather than asserting: on a 4-page report
      // whose page 1 linked to page 4, deleting pages 3 and 4 used to return a
      // 2-page file that still held both dropped pages' content streams —
      // inflating one gave back the words "CONFIDENTIAL SALARY TABLE" — because
      // the link's destination kept the orphan reachable. It came down from 4
      // page objects and 1469 bytes to 2 and 1158 once destinations were
      // repointed or cut. Shared resources are the honest exception.
      question: "Are the deleted pages really gone from the file?",
      answer:
        "Yes — this is not like cropping, where what you hide is still in the document. A deleted page's own content is removed, not just left out of the page count, and that holds even when a page you kept carries a link pointing at one you removed: those links have their destination stripped rather than being allowed to hold the old page in the file. What can remain is anything a deleted page shared with a page you kept — a font, or an image used on both — because the surviving page still needs it.",
    },
    {
      question: "Does this change my original file?",
      answer:
        "No. The file on your disk is read and never written to. What you download is a new PDF; if you delete the wrong pages, just drop the original in again and start over.",
    },
    {
      question: "What is the downloaded file called?",
      answer:
        "pages-removed.pdf. It is a fixed name rather than one derived from your document, so a result is never mistaken for the original it came from.",
    },
  ],
  "crop-pdf": [
    {
      question: "Does cropping delete the content outside the frame?",
      answer:
        "No — and this is the one thing worth understanding before cropping anything sensitive. Cropping rewrites the page rectangles so a reader draws less of the page. Everything outside the frame is still in the file, and any tool that widens those rectangles back out gets it back. Cropping is not redaction, and this site has no redaction tool.",
    },
    {
      // "keeps whatever of the frame fits" was only true of the PARTIAL
      // overlap. A page the mapped frame misses entirely hits
      // `if (!box) continue;` in cropPdfPages and comes out at full original
      // size — measured numbers are in the block comment above crop-pdf in
      // tools.ts.
      question: "Can I crop each page differently?",
      answer:
        "No. You set one frame on page one and it is used for every page, clamped to each page's own visible area — so in a file whose pages are not all the same size, a page the frame only partly covers keeps the part that fits rather than ending up with a broken box. A page the frame does not reach at all is the case to watch: it is left uncropped at its original size rather than reduced to an empty sheet, and nothing on screen singles it out. Trimming a top band off a portrait document that also holds a landscape page will do it.",
    },
    {
      question: "Does cropping make the PDF smaller on disk?",
      answer:
        "Usually not by much. Nothing is deleted — the content outside the frame is still stored — so only the page geometry changes. If you need a smaller file, run the result through Compress PDF, which does structural work on the file itself.",
    },
    {
      question: "Will the text still be selectable after cropping?",
      answer:
        "Yes. The content is never scaled, moved, rasterised or re-encoded; only the page boxes change. Text stays real text, images keep their exact pixels, and a rotated page stays rotated.",
    },
    {
      question: "What do the numbers under the page mean?",
      answer:
        "They are the live size of the crop frame — in PDF points (72 to the inch) and in millimetres — plus page one's current size for comparison. They update as you drag, so you can hit a real measurement instead of eyeballing it.",
    },
  ],
  "change-pdf-page-size": [
    {
      question: "What is the difference between Scale to fit and Box only?",
      answer:
        "Scale to fit, the default, enlarges or shrinks everything on the page by one uniform factor and centres it on the new sheet, so nothing is cut off and nothing is distorted. It also draws only what the page was already showing, so marks a crop box was hiding — bleed, printer's marks, anything you just trimmed off with Crop PDF — do not come back on the bigger sheet. Box only leaves the content exactly where it is and changes the page rectangle around it, drawn from the bottom-left corner of the page as you see it — so a smaller sheet cuts into the page and a larger one adds blank space. That corner is the same one on a rotated page and on a page whose visible area does not start at the file's own origin.",
    },
    {
      // Re-measured after the engine started giving annotations the same
      // affine as the content. The drift this answer used to quote (36 / 108 /
      // 372 pt) is gone — the table of old-versus-new numbers is in the block
      // comment above change-pdf-page-size in tools.ts. What survives is the
      // /AP one, and it is narrower than the old wording implied: a viewer
      // stretches the stored appearance onto the new rectangle, so the residue
      // is the recorded font size, which only shows once the field is redrawn.
      question: "Will my form fields and annotations still line up?",
      answer:
        "Yes. Under Scale to fit, links, comments and form-field boxes get the same scale and the same centring shift as the content, so a link still covers the words it sat on and a field box still sits on its own label. That was checked by resizing a page whose link rectangle exactly covered a drawn button and measuring both in the output: no drift at all across ten shapes, including landscape flips, rotated pages and a page whose media box does not start at the origin. Box only does not move the content, so it does not move annotations either. One narrow limitation is left. A field's stored appearance — the picture a reader draws for it — keeps its original size, and so does the font size recorded with the field. Readers stretch that stored picture onto the field's new rectangle, so it normally looks right; but a reader that redraws the field instead, which is what happens as soon as someone types into it again, uses the point size the file still names and the text comes out too small for the enlarged box.",
    },
    {
      question: "Can I enter a custom size in millimetres?",
      answer:
        "No. The tool offers six standard sizes — A3, A4, A5, Letter, Legal and Tabloid — each in portrait or landscape. The exact dimensions of the size you pick are shown in millimetres and inches next to the control, so you always know what you are getting.",
    },
    {
      question: "Does it resize every page or only the ones that are the wrong size?",
      answer:
        "Every page in the document is set to the size you choose. That is the point of the tool for a mixed-size scan, but it does mean a file that deliberately mixes portrait and landscape pages comes out uniform.",
    },
    {
      question: "What happens to pages that are rotated?",
      answer:
        "The size you pick is the size you will see. A page carrying a 90-degree rotation is measured and resized in the orientation it displays in, and its rotation is left alone — so a sideways page stays sideways at the new size rather than snapping upright.",
    },
  ],
  "pdf-resizer": [
    {
      question: "Should I resize the page size or the file size?",
      answer:
        "Page size changes the physical sheet — A4, Letter, Legal and the rest — which is what you want when a document has to print or fit a template. File size leaves every page looking identical and makes the document smaller on disk, which is what you want for an email or an upload limit. The switch at the top of the panel moves between them and keeps the file you dropped.",
    },
    {
      question: "Can I ask for a PDF under a specific size, like 500 KB?",
      answer:
        "No. There is no target-size mode and no quality slider, because the underlying operation has nothing to trade away — it makes one lossless structural pass and reports what that was worth. Any tool that hits an arbitrary target does it by re-encoding your images, which this one never does.",
    },
    {
      question: "Why did my scanned PDF come back exactly the same size?",
      answer:
        "Because it is almost entirely image data that is already compressed, and this tool never re-encodes or downsamples an image — a stream that already carries a compression filter is skipped by design. Scans and photo-heavy PDFs routinely come back byte-for-byte identical. The savings here come from structure: unreferenced objects, uncompressed streams, an old-style cross-reference table.",
    },
    {
      question: "Do I have to upload the file again to switch modes?",
      answer:
        "No. The file is held by the page, not by either half, so flipping between Page size and File size keeps it loaded. Only that half's own settings and any finished output are dropped, since neither means anything under the other operation.",
    },
    {
      question: "How is the file-size half different from Compress PDF?",
      answer:
        "It is not — it runs the same engine and gives the same answer, including handing back your original bytes when the rewrite would not be smaller. What this page adds is the page-size half over the same dropped file, so you can try both without starting again.",
    },
  ],
  "pdf-to-text": [
    {
      question: "Why did my scanned PDF produce no text?",
      answer:
        "Because a scan is a picture of words, not words. This tool reads the text layer a PDF already carries, and a scanned page has none — there is no OCR here to turn pixels back into characters. When every page is like that the tool says so and does not offer you an empty download; when only some pages are, it names them.",
    },
    {
      question: "Does the extracted text keep the original layout?",
      answer:
        "No, and it does not pretend to. Text comes out in the order the file stores it, so a multi-column page arrives as one whole column after another rather than in reading order, and a table loses its rows and columns — the cells arrive as separate lines. This is text extraction, not layout reconstruction.",
    },
    {
      question: "Can I tell where one page ends and the next begins?",
      answer:
        "Yes. A 'Mark where each page starts' checkbox is on by default and writes a --- Page 2 --- line ahead of each page; turn it off for one continuous run of text. Switching it re-joins what was already extracted, so it is instant even on a long document, and a one-page PDF never gets a marker.",
    },
    {
      question: "Is the preview on screen the whole document?",
      answer:
        "Not always. The preview stops at 20,000 characters — around a dozen pages of ordinary text, fewer if they are dense — because a browser lays out every character it is given and a 500-page document would stall the page. Whenever the cap bites, a note under the pane says so. Copy and Download always carry the entire text.",
    },
    {
      question: "What format is the download?",
      answer:
        "A plain UTF-8 .txt file named after your PDF — report.pdf becomes report.txt. There is no formatting, no markup and no encoding to choose; it opens in any editor.",
    },
  ],
  // Every measured claim in the four blocks below comes from the block comment
  // above protect-pdf in tools.ts — the rejected user-password-only encrypt,
  // the 127-byte silent lockout, the rc 2 on re-encrypting, the P values that
  // make --accessibility=n a no-op, and the fact that a bare --decrypt with no
  // password strips a restrictions-only file. Do not soften any of them.
  "protect-pdf": [
    {
      question: "What is the difference between a user password and an owner password?",
      answer:
        "The user password is the one a reader is asked for when the document opens. The owner password is the one that lets a tool change the security settings afterwards — including taking the protection off. qpdf will not write a 256-bit file that has a user password and no owner password at all, so unless you set a separate owner password the tool uses the password you typed for both. That is almost always what people mean, and it is stated here rather than done silently.",
    },
    {
      question: "Should I choose AES-256 or AES-128?",
      answer:
        "AES-256 unless something forces your hand. It is the default here and it is what current readers expect. AES-128 exists for readers old enough not to understand the newer scheme — think a viewer that predates Acrobat X. The format also permits RC4, which is broken, and this tool will not write it at any setting.",
    },
    {
      question: "Is there a limit on how long the password can be?",
      answer:
        "Yes — 127 bytes of UTF-8, and the limit is bytes rather than characters, so an accented or CJK password reaches it sooner than an ASCII one. Anything longer is refused before the document is touched. That refusal is deliberate and it is the most important thing on this page: qpdf will happily encrypt with a longer password, report success, print no warning at all, and then never accept that password back — not the original, not any truncation of it. The file would be permanently unopenable and nothing would have told you.",
    },
    {
      question: "Can I add a password to a PDF that is already protected?",
      answer:
        "No. qpdf refuses to encrypt a document it cannot open, and it reports that as an invalid password rather than as a file it declines to touch. The tool checks the document before it runs and tells you plainly, instead of failing halfway through. Take the existing password off with Unlock PDF first, then protect the result.",
    },
    {
      question: "What happens if I lose the password?",
      answer:
        "The document is gone. There is no reset, no master key and no recovery — that is what encryption is for, and it is exactly why nothing on this site can open a file whose password you do not know. Keep the password somewhere before you close the tab. And be clear about the other direction too: anyone you give the password to can open the file and save a copy with the password removed.",
    },
  ],
  "unlock-pdf": [
    {
      question: "I forgot the password — can this open my file?",
      answer:
        "No. This tool decrypts a PDF using the password you type in; it does not search for one. There is no guessing, no dictionary and no queue that emails you a result later. If the password is genuinely lost, no tool on this site — and no honest tool anywhere — will get the file open for you. What it will do is take a document you can already open and hand you back a copy with the encryption removed.",
    },
    {
      question: "My PDF opens without asking for anything but will not let me print. Will this help?",
      answer:
        "Yes, and you will not have to type anything. A document that opens without a prompt but refuses to print is carrying restrictions and an owner password only, and that comes off with no password from you at all. That is not a trick this tool plays — it is what PDF permission flags are, and it is the plainest demonstration that they were never a lock. PDF Permissions is the page that explains what they can and cannot do.",
    },
    {
      question: "Does this remove the printing and copying restrictions too?",
      answer:
        "Yes. The permission flags live inside the same encryption dictionary as the password, so decrypting the document clears them together. There is no way to remove one and keep the other, and there would be little point: a reader that would honour those flags is one that would have asked for the password.",
    },
    {
      question: "What happens if I type the wrong password?",
      answer:
        "You are told the password was wrong, and no file is produced. qpdf reports an invalid password and stops before writing anything, so you never get a half-decrypted document that looks like it worked. Try again with the right password; nothing about the file has changed.",
    },
    {
      question: "What if the PDF turns out not to be protected at all?",
      answer:
        "The tool checks first and says so. That check is there for a specific reason: decrypting a document that was never encrypted succeeds quietly, so without it the page would report a successful unlock of a file that had nothing to unlock. Three states are distinguished before anything runs — not encrypted, restricted only, and password required — and you are told which one you have.",
    },
  ],
  "pdf-permissions": [
    {
      question: "Can someone just ignore these restrictions?",
      answer:
        "Yes, and you should assume they will if they want to. Permission flags are advisory. A reader honours them by choice; one that does not care simply ignores them, and any tool that can open the document can clear them outright. For a document that opens without a prompt, that takes no password at all — this site's own Unlock PDF does it in one pass. Set these flags to say what you intend, not to enforce it.",
    },
    {
      question: "Will the document still open without a password?",
      answer:
        "Yes — that is the shape this page writes. The restrictions go into the document's encryption dictionary alongside an owner password, and the user password is left empty, which is what lets any reader open the file while still recording what it may do with it. If you want a document that will not open without a password, use Protect PDF instead.",
    },
    {
      question: "Why is there no control for screen readers or accessibility?",
      answer:
        "Because it would be a checkbox that does nothing. The format defines an accessibility-extraction flag, but at the encryption revision this tool writes, setting it leaves the permission bits exactly as they were — measured, byte for byte. A control that appears to restrict something and does not is worse than no control at all, so it is not offered.",
    },
    {
      question: "What do the three printing options actually mean?",
      answer:
        "Full allows printing normally. Low allows printing but marks the document as degraded-resolution only, which a conforming reader honours by printing a coarse copy — the usual reason to reach for it is to allow a reference print while discouraging a clean reproduction. None denies printing altogether. All three are recorded as permission bits in the file, and all three depend on the reader choosing to respect them.",
    },
    {
      question: "How is this different from Protect PDF?",
      answer:
        "Protect PDF sets a password the reader must type to open the document, and that part is real encryption. This page leaves the document openable by anyone and writes only the intention flags. Both run the same qpdf encryption pass over your file; the difference is whether the user password is filled in or left empty. If what you actually need is for people not to read the document, the flags are not the tool — the password is.",
    },
  ],
  "repair-pdf": [
    {
      question: "What does 'repair' actually mean here?",
      answer:
        "A PDF stores its objects and, separately, a table saying where in the file each one lives. When that table stops matching the file — an interrupted download, a crash mid-save, a producer that miscounted — readers refuse the document. qpdf re-parses the file, finds the objects by scanning when the table cannot be trusted, and writes a fresh document with the table rebuilt. What is repaired is the index, not the contents.",
    },
    {
      question: "Can it recover a file that will not open at all?",
      answer:
        "Sometimes, and it will tell you which case you are in. If the objects are present but the map to them is wrong, that is exactly what this fixes. If the file has no trailer dictionary, or never carried a PDF header, qpdf has nothing to start from and says so rather than producing a file. A download that stopped halfway is missing bytes, and no tool can invent the part that never arrived.",
    },
    {
      question: "Why did it say the file completed with warnings and still give me a document?",
      answer:
        "Because that is the successful outcome, not a failure. qpdf reports warnings when it had to reconstruct something rather than reading it cleanly — a bad offset, an object it had to hunt for, a recovered stream — and the file it writes in that case is complete and valid. The warnings are shown rather than swallowed, because a document that had to be rebuilt is not the same as one that was fine all along.",
    },
    {
      question: "It said nothing was wrong. Did the tool do anything?",
      answer:
        "It re-wrote the file, and it found nothing to work around while doing it — so it says that instead of claiming a rescue. A rewrite on its own can still be useful: the result is a cleanly serialised document with a fresh cross-reference table. But if you came here because a reader called your file damaged and this page found no damage, the problem is somewhere else, and being told that is more useful than a reassuring green tick.",
    },
    {
      question: "Can it get back pages or text that were deleted?",
      answer:
        "No. This reconstructs the map of where objects are in the file; it cannot restore objects the file does not contain. Deleted pages, removed text and reversed edits are gone from the bytes, and nothing here goes looking for them. It is also not a converter or a scanner — a file that is not a PDF is reported as a file that is not a PDF.",
    },
  ],
  "markdown-to-pdf": [
    {
      question:
        "Why does the print dialog open instead of an instant download?",
      answer:
        "The browser's native print engine is the only way to produce a PDF with selectable text, embedded fonts, and crisp vector code blocks. Pick 'Save as PDF' (Chrome/Edge), 'Save to PDF' (Safari), or 'Save to File' (Firefox) as the destination — the rest of the layout is already taken care of.",
    },
    {
      question: "Does it support GitHub-Flavored Markdown?",
      answer:
        "Yes. Tables, fenced code blocks, task lists (rendered as Unicode glyphs so they print consistently), strikethrough, autolinks, and footnotes are all handled. Standard headings, lists, blockquotes, images, and inline emphasis work as expected.",
    },
    {
      question: "What languages are syntax-highlighted in code blocks?",
      answer:
        "About twenty popular languages out of the box: js, ts, tsx, jsx, py, go, rust, java, c, cpp, json, yaml, toml, bash, sh, sql, html, css, md, and diff. Code fences with an unrecognised language fall back to plain monospace without throwing.",
    },
    {
      question: "Can I customize the styling?",
      answer:
        "Yes — toggle between Light and Dark themes and between a Serif body (default, MD Peek-inspired) and a Sans body. Margins, page size (A4 by default), and code-block colors are tuned for legible long-form prose; per-document custom CSS is on the roadmap.",
    },
    {
      question: "Why are colors missing from my exported PDF in Firefox?",
      answer:
        "Firefox disables 'Print backgrounds' by default, which strips the code-block backgrounds and table headers from the print preview. Toggle 'Print backgrounds' (or 'Print background graphics') in the print dialog before saving to fix it.",
    },
  ],

  // ── Audio Tools ──────────────────────────────────────────────────
  "mp3-to-wav": [
    {
      question: "Why convert MP3 to WAV?",
      answer:
        "WAV is an uncompressed format required by many audio editors, DAWs, and professional workflows. While converting MP3 to WAV won't restore quality lost during MP3 compression, it gives you a lossless container for further editing without additional quality degradation.",
    },
    {
      question: "Will the WAV file be larger than the MP3?",
      answer:
        "Yes, significantly. A typical 3-minute MP3 at 192 kbps is about 4 MB, while the equivalent WAV is roughly 30 MB. WAV stores uncompressed PCM audio data.",
    },
    {
      question: "What sample rate and bit depth is the output WAV?",
      answer:
        "The output WAV matches the sample rate of your input MP3 (usually 44.1 kHz) and uses 16-bit PCM encoding — CD quality.",
    },
    {
      question: "Is there a size limit on the MP3?",
      answer:
        "No enforced limit, but the whole job runs in tab memory: the decoded audio is about 20 MB per minute of 44.1 kHz stereo, plus the WAV being written alongside at roughly 10 MB per minute. Podcast-length files are fine on a desktop; multi-hour files can exhaust memory, especially on phones.",
    },
    {
      question: "Will a stereo MP3 stay stereo?",
      answer:
        "Yes. The converter writes exactly the channels the MP3 decodes to — mono stays mono, stereo stays stereo — and applies no volume changes or normalization along the way.",
    },
  ],
  "wav-to-mp3": [
    {
      question: "What bitrate should I choose?",
      answer:
        "128 kbps is fine for speech and podcasts. 192 kbps is a good balance for music. 256-320 kbps is nearly indistinguishable from the original for most listeners.",
    },
    {
      question: "How much smaller will the MP3 be?",
      answer:
        "Typically 80-90% smaller. A 30 MB WAV file at 192 kbps becomes about 4 MB as MP3.",
    },
    {
      question: "Is there any quality loss?",
      answer:
        "Yes, MP3 is a lossy format — it discards audio data that's less perceptible to human hearing. At 192 kbps or higher, the difference is very hard to notice for most listeners.",
    },
    {
      question: "What happens to a 96 kHz or 192 kHz WAV?",
      answer:
        "MP3 can't carry sample rates above 48 kHz, so anything higher is resampled down to 48 kHz before encoding. Files at 44.1 or 48 kHz keep their original rate untouched.",
    },
    {
      question: "Can I convert a surround (5.1) WAV?",
      answer:
        "Yes, but MP3 holds at most two channels, so anything wider is folded down to stereo with the extra channels mixed in at -3 dB — which keeps the center-channel dialogue instead of dropping it. Mono and stereo files pass through with no channel changes.",
    },
  ],
  "m4a-to-mp3": [
    {
      question: "What is M4A?",
      answer:
        "M4A is an audio container format used by Apple. It typically contains AAC (Advanced Audio Coding) data. iPhones use M4A for voice memos, and iTunes/Apple Music downloads are M4A files.",
    },
    {
      question: "Why convert M4A to MP3?",
      answer:
        "While M4A offers better compression than MP3, some older devices, car stereos, and media players don't support it. MP3 is universally compatible with virtually every device and application.",
    },
    {
      question: "Can I convert iPhone voice memos?",
      answer:
        "Yes! iPhone voice memos are saved as M4A files. Simply transfer the file to your computer (via AirDrop, email, or Files app) and upload it here.",
    },
    {
      question: "Does going from M4A to MP3 lose quality?",
      answer:
        "A little — AAC and MP3 are both lossy, so the audio is fully decoded and re-encoded, which adds a second generation of compression. Choose 256 or 320 kbps to keep the difference inaudible for music; 128 kbps is plenty for voice memos.",
    },
    {
      question: "Does this work in every browser?",
      answer:
        "In practice, yes. Most browsers decode M4A with their built-in AAC decoder; when one can't (Firefox on some systems), the tool falls back to an FFmpeg engine — a one-time ~31 MB download served from this site's own origin — and you get the same MP3 out. It costs more memory to get there: the fallback expands the file to a 16-bit WAV, around ten times the size of a 128 kbps source, before decoding it, so a long recording that converts fine in Chrome can run a Firefox tab out of memory.",
    },
  ],
  "audio-trimmer": [
    {
      question: "What audio formats are supported?",
      answer:
        "You can trim MP3, WAV, OGG, M4A, FLAC, and AAC files — any format your browser can decode. The trimmed output is available as either MP3 or WAV.",
    },
    {
      question: "Can I preview before trimming?",
      answer:
        "Yes. After uploading your file, you can play the audio and adjust start/end times. The playback lets you verify your selection before exporting.",
    },
    {
      question: "Is there a maximum file duration?",
      answer:
        "There is no enforced limit, but the cost is memory rather than time: the file is decoded to 32-bit float once on drop to draw the waveform and again to make the cut, at roughly 20 MB per minute of 44.1 kHz stereo each time. Podcast-length files are fine on a desktop; multi-hour files can exhaust the tab, especially on phones.",
    },
    {
      question: "Does trimming re-encode the audio?",
      answer:
        "Yes — the file is decoded, cut at the exact sample you selected, and re-encoded to the format you choose. Export WAV to avoid any new lossy step; MP3 export is a fresh lossy encode at your chosen bitrate (128-320 kbps).",
    },
    {
      question: "What do the presets actually change?",
      answer:
        "Only the export settings: Podcast sets MP3 at 128 kbps, Music sets MP3 at 320 kbps, and Lossless switches the output to WAV. No normalization, fades, or channel changes are applied — and adjusting any control by hand switches you back to Custom.",
    },
  ],
  "merge-audio": [
    {
      question: "Can I merge different audio formats?",
      answer:
        "Yes! You can mix MP3, WAV, OGG, M4A, FLAC, and other formats. Each file is decoded to raw audio before merging, so the input format doesn't matter.",
    },
    {
      question: "What if my files have different sample rates?",
      answer:
        "The tool automatically resamples all files to match the highest sample rate among your inputs, ensuring consistent quality throughout the merged output.",
    },
    {
      question: "Can I reorder the files before merging?",
      answer:
        "Yes. After uploading, you can drag and drop the files to arrange them in the order you want before merging.",
    },
    {
      question: "Is there a limit on how many files I can merge?",
      answer:
        "No count is enforced, but every file you add is decoded to 32-bit float at the same time — not one after another — then resampled, then copied again into a single merged buffer, so the peak is several times the decoded size of the whole queue, and decoded audio runs about 20 MB per minute of 44.1 kHz stereo. This is the heaviest job on the site: a few podcast-length files are comfortable, a dozen hour-long ones are not.",
    },
  ],

  // ── Audio format converters ──────────────────────────────────────
  //
  // Eight pages, one component. The line these answers hold is the difference
  // between LOSSLESS → LOSSY (flac-to-mp3, a real trade worth making),
  // LOSSY → LOSSY (ogg/aac/opus/wma → mp3, a SECOND generation of loss), and
  // LOSSLESS → LOSSLESS (wav-to-flac, the only one allowed the word).
  "flac-to-mp3": [
    {
      question: "Does converting FLAC to MP3 lose quality?",
      answer:
        "Yes, and permanently. FLAC keeps every sample; MP3 discards the parts of the sound its model considers inaudible. What makes this the good version of that trade is the starting point — a 320 kbps MP3 made from a lossless master is one generation of loss applied to audio that had none, which is about as good as MP3 gets. Keep the FLAC files as your archive.",
    },
    {
      question: "What bitrate should I use for music?",
      answer:
        "320 kbps if you are converting a lossless archive and want the copy to be as close to transparent as MP3 allows. 256 kbps is very hard to tell apart on most equipment and saves about 20% more space. Anything below 192 kbps starts to be audible on dense music, and there is little reason to go there when the source is FLAC.",
    },
    {
      question: "How much smaller will the MP3 be?",
      answer:
        "A FLAC album typically runs 250 to 400 MB. The same music at 320 kbps is about 2.4 MB per minute, so roughly 70 to 90 MB — usually a quarter to a third of the FLAC. At 192 kbps it is about half that again.",
    },
    {
      question: "Can I convert the MP3 back to FLAC afterwards?",
      answer:
        "You can produce a FLAC file from it, but it will not restore anything. FLAC is lossless about whatever it is given, so encoding an MP3 to FLAC preserves the already-degraded audio at a much larger size. The information MP3 discarded is gone. Convert from the FLAC every time you need a new copy rather than from a previous MP3.",
    },
    {
      question: "Are my tags and cover art kept?",
      answer:
        "No. The conversion works on decoded audio, so artist, album, track number and embedded artwork are all dropped — the MP3 you get back carries the sound and nothing else. Re-tag it in your music player or a tag editor afterwards. This is true of every audio converter here, not just this one.",
    },
    {
      question: "Does this download an engine to read FLAC?",
      answer:
        "Usually not. Most browsers decode FLAC natively through the Web Audio API. Where one cannot, the tool falls back to an FFmpeg build served from this site — a one-time download of roughly 31 MB, cached afterwards, never fetched from a CDN — and you get the same MP3 out.",
    },
  ],
  "ogg-to-mp3": [
    {
      question: "Is converting OGG to MP3 lossless?",
      answer:
        "No, and it cannot be. Ogg Vorbis is already lossy, and MP3 cannot hold a Vorbis stream, so the audio has to be decoded and encoded again. That is a second generation of compression: Vorbis discarded what its model judged inaudible, and MP3 now discards what its own, different model judges inaudible from what is left.",
    },
    {
      question: "What bitrate keeps the second encode clean?",
      answer:
        "256 or 320 kbps. Giving the MP3 encoder more room than the source used is the way to keep the second generation from becoming audible — you are not adding quality, you are avoiding subtracting more. For speech, 128 kbps is fine, because there is far less detail to lose.",
    },
    {
      question: "What is the difference between .ogg and .oga?",
      answer:
        "Nothing that matters here. Both are Ogg containers; .oga is the convention for audio-only files while .ogg gets used for both. This page accepts either. What is inside is almost always Vorbis, and occasionally Opus — which the tool also decodes, though the dedicated Opus page explains that case better.",
    },
    {
      question: "Why is my MP3 larger than the OGG file was?",
      answer:
        "Because the bitrate you picked is higher than the one the OGG was encoded at. Vorbis is efficient, so a 128 kbps OGG converted at 320 kbps roughly triples in size without sounding better than the source. If size matters more than headroom, match the original bitrate rather than exceeding it.",
    },
    {
      question: "Why does Safari download an engine for this?",
      answer:
        "Safari has no Ogg Vorbis decoder, so there is nothing in the browser to open the file with. The tool falls back to an FFmpeg build served from this site — about 31 MB once, then cached. Chrome, Edge and Firefox decode Ogg themselves and fetch nothing.",
    },
  ],
  "aac-to-mp3": [
    {
      question: "What is the difference between .aac and .m4a?",
      answer:
        "The codec is the same; the wrapper is not. A .m4a file is AAC inside an MP4 container, with chapter, artwork and metadata support — what iTunes and iPhone voice memos produce. A bare .aac file is usually a raw ADTS stream, the shape stream rippers and broadcast captures produce. Both are accepted here.",
    },
    {
      question: "Does converting AAC to MP3 lose quality?",
      answer:
        "Yes. Both are lossy, so the file is fully decoded and encoded again, adding a second generation of compression. AAC is the better codec at any given bitrate, which means MP3 is a downgrade on paper — you are trading a little quality for a format that plays on everything.",
    },
    {
      question: "Which bitrate should I pick?",
      answer:
        "Match or exceed the source: 256 or 320 kbps for music, so the second encode has room to work. 128 kbps is plenty for speech and podcasts, where the extra bits buy almost nothing. Picking a bitrate above the source's does not improve anything — it only limits further damage.",
    },
    {
      question: "Why does Firefox download an engine for this?",
      answer:
        "Some Firefox builds ship no AAC decoder at all, so the browser cannot open the file. The tool falls back to an FFmpeg build served from this site — roughly 31 MB once, then cached — which decodes the AAC before the MP3 is written. It costs memory as well as bandwidth: that path first expands the file to a 16-bit WAV around ten times the size of a 128 kbps source.",
    },
    {
      question: "Should I convert at all, if AAC is better?",
      answer:
        "Only for compatibility. If everything you use plays AAC, keep it. Convert when something in the chain will not: older car head units, cheap MP3 players, some editing software, DJ decks, and upload forms that only take .mp3. The conversion is for the destination, never for the audio.",
    },
  ],
  "opus-to-mp3": [
    {
      question: "Can I convert WhatsApp voice notes with this?",
      answer:
        "Yes — that is the main reason this page exists. WhatsApp, Signal and Telegram all record voice messages as Opus in an Ogg container, which is what the .opus extension means. Export the message or save the attachment, drop it here, and you get an MP3 that plays in anything.",
    },
    {
      question: "Why is the MP3 bigger than the Opus file?",
      answer:
        "Because MP3 is far less efficient at speech bitrates. Opus was designed for exactly this job and a voice note is often recorded around 24 kbps; MP3 needs several times that to sound comparable. A one-minute note that took 200 KB as Opus can land near 1 MB as a 128 kbps MP3. That is the cost of a format everything opens.",
    },
    {
      question: "What bitrate should I use for a voice message?",
      answer:
        "128 kbps is more than enough, and often generous. The source was compressed heavily for a phone network, so encoding at 320 kbps produces a much larger file that carries no more detail — a higher bitrate cannot recover what Opus already discarded.",
    },
    {
      question: "Does the conversion lose quality?",
      answer:
        "Yes, but not much that you will hear on speech. Opus is lossy and MP3 is lossy, so this is a second generation of compression. For music that matters and a high bitrate is worth it; for a voice note the source is already the limiting factor and the re-encode is barely the weak link.",
    },
    {
      question: "Why does the waveform sometimes fail to draw?",
      answer:
        "The waveform preview only uses the browser's own decoder, deliberately — drawing decoration is not worth a 31 MB download. In a browser that cannot decode Opus, mainly Safari, the preview gives up and the canvas says so, while the conversion carries on through the FFmpeg engine and produces the same MP3.",
    },
  ],
  "m4a-to-wav": [
    {
      question: "How much bigger will the WAV be?",
      answer:
        "Roughly ten times, and sometimes more. Uncompressed stereo audio runs about 10 MB per minute at 44.1 kHz, so a 5 MB voice memo becomes something near 50 MB and an hour-long recording lands around 600 MB. That is the format working as intended — WAV stores every sample rather than a compressed approximation.",
    },
    {
      question: "Does converting to WAV improve the audio?",
      answer:
        "No. Nothing the AAC encoder discarded comes back, and no conversion can recover it. What the WAV gives you is a lossless container to work in, so that every edit, filter and export after this point costs nothing further. It is a working format, not a repair.",
    },
    {
      question: "What sample rate and bit depth does the WAV use?",
      answer:
        "The file's own sample rate — usually 44.1 or 48 kHz — written as 16-bit PCM, which is what audio software expects and what CD-quality means. Channel count is preserved: mono stays mono, stereo stays stereo.",
    },
    {
      question: "Can I convert iPhone voice memos this way?",
      answer:
        "Yes. Voice Memos saves M4A, and so do GarageBand bounces and most iOS recording apps. Move the file to your computer via AirDrop, email or the Files app and drop it here. A WAV is what a transcription tool or a DAW will want from it.",
    },
    {
      question: "Why does Firefox download an engine for this?",
      answer:
        "Some Firefox builds have no AAC decoder, so the browser cannot open an M4A at all. The tool falls back to an FFmpeg build served from this site — about 31 MB once, then cached — which decodes the file before the WAV is written. That path is heavier on memory too, because it produces a 16-bit WAV of its own on the way.",
    },
  ],
  "wav-to-flac": [
    {
      question: "Is FLAC really lossless?",
      answer:
        "Yes, in the strict sense: FLAC models the waveform and stores the difference, so decoding a FLAC returns the same samples that were encoded. It is the audio equivalent of zipping a file rather than the audio equivalent of shrinking a JPEG. Nothing about the sound is approximated or thrown away.",
    },
    {
      question: "How much smaller is FLAC than WAV?",
      answer:
        "Typically 40 to 60 percent of the original size for music. Quiet or sparse material compresses further; dense, loud, heavily limited masters compress less. The exact figure depends entirely on the audio, because the encoder is finding real redundancy rather than applying a fixed ratio.",
    },
    {
      question: "What software plays FLAC files?",
      answer:
        "VLC, foobar2000, Audacity, Android, most media servers and network players, and current desktop browsers. Support is patchier in older Apple software and in car head units, which is why FLAC is best treated as an archive format — keep the FLAC, and make MP3s from it for the devices that need them.",
    },
    {
      question: "Should I use FLAC or MP3?",
      answer:
        "Both, for different jobs. FLAC is what you store: it is lossless, so you can re-encode from it forever without stacking generations of damage. MP3 is what you send and what you put on a device with limited space. Converting FLAC to MP3 is a one-way step, so the FLAC is the one worth keeping.",
    },
    {
      question: "Why does this page fetch an engine when the MP3 tools do not?",
      answer:
        "Because the encoders differ. MP3 is written by the lamejs library — about 254 KB, loaded from this site — and WAV by a small hand-rolled writer that is part of the page already. There is no FLAC encoder in JavaScript here, so FLAC output goes through an FFmpeg build compiled to WebAssembly: a one-time download of roughly 31 MB, served from this site rather than a CDN, and cached afterwards.",
    },
  ],
  "mp3-converter": [
    {
      question: "Which formats can I convert to MP3 here?",
      answer:
        "WAV, M4A, AAC, FLAC, OGG, Opus and WMA, plus MP3 itself if you want to re-encode at a different bitrate. If you have audio inside a video file, the audio extractor handles that instead — this page takes audio files.",
    },
    {
      question: "What bitrate should I choose?",
      answer:
        "128 kbps for speech, voice memos and podcasts. 192 kbps as a general-purpose default. 256 or 320 kbps for music you care about, and especially when the source is lossless, because that is the one case where a high bitrate genuinely buys you something.",
    },
    {
      question: "Can I make an existing MP3 smaller?",
      answer:
        "Yes — drop it in and pick a lower bitrate. Be aware that this is a second lossy pass over already-lossy audio, so it degrades more than the size drop suggests. It is worth doing to fit a size limit and not worth doing for tidiness.",
    },
    {
      question: "Why is the MP3 sometimes bigger than the file I dropped?",
      answer:
        "Because the source was compressed harder than the bitrate you picked. A 24 kbps Opus voice note or a 96 kbps AAC stream will grow at 192 kbps. Match the source's bitrate rather than exceeding it if size is what matters — going higher cannot add back detail that is not there.",
    },
    {
      question: "Does the MP3 keep the original file's tags?",
      answer:
        "No. Every arm here works on decoded audio, and the FFmpeg arm additionally drops attached pictures, so artist, album, track number and cover art do not survive the conversion. The audio does. Add the tags back in your music player or a dedicated tag editor once you have the MP3.",
    },
    {
      question: "Do I need to install or sign up for anything?",
      answer:
        "No. The MP3 is written by the lamejs encoder that ships with the page, and for the formats your browser cannot decode on its own an FFmpeg build served from this site takes over — a one-time 31 MB download, cached afterwards. Both run inside the tab, and no file is ever sent anywhere.",
    },
  ],
  "wma-to-mp3": [
    {
      question: "Why does this page always download something?",
      answer:
        "Because no browser can decode WMA. Every other audio format here has a native path on at least some platform; Windows Media Audio has none, so this page always loads an FFmpeg build compiled to WebAssembly — roughly 31 MB, served from this site rather than a CDN, and cached by your browser afterwards. Everything after that download happens in the tab.",
    },
    {
      question: "Which kinds of WMA file work?",
      answer:
        "Standard WMA — the wmav1 and wmav2 codecs that Windows Media Player wrote by default — is what this was tested against end to end. The engine also carries decoders for WMA Pro and WMA Lossless, so those are likely to work, but they were not part of the measurement and we would rather say so than imply otherwise.",
    },
    {
      question: "Will DRM-protected WMA files convert?",
      answer:
        "No. Files bought from the old Windows Media stores carry DRM, and the audio inside cannot be decoded without a licence that lives on the machine it was bought for. No browser tool can convert those, and this one will fail on them rather than produce a broken file.",
    },
    {
      question: "Does the conversion lose quality?",
      answer:
        "Yes. WMA is lossy and MP3 is lossy, so the file is decoded and encoded again — a second generation of compression. Choose 256 or 320 kbps for music you intend to keep, and 128 kbps for anything that is mostly speech, where the difference is hard to hear.",
    },
    {
      question: "Why is the waveform preview blank?",
      answer:
        "The waveform is drawn with the browser's own decoder, and no browser has one for WMA. The canvas says the preview is unavailable rather than pretending, and the conversion runs perfectly well underneath it through the FFmpeg engine.",
    },
  ],

  // ── Video Tools ──────────────────────────────────────────────────
  "video-to-gif": [
    {
      question: "What video formats are supported?",
      answer:
        "MP4, WebM, and MOV — whatever your browser can play back natively, since the tool decodes frames straight from a video element rather than shipping its own decoder.",
    },
    {
      question: "Why is my GIF so large?",
      answer:
        "GIF stores every frame in full — there is no compression between frames the way there is in a video codec. Reduce the width, lower the frame rate (10-15 fps is usually smooth enough), and keep clips short to minimize file size.",
    },
    {
      question: "How do I get the best GIF quality?",
      answer:
        "Each frame gets its own 256-color palette, computed from that frame's actual colors, which holds up far better than a single fixed palette across the whole clip. Lowering the width helps quality too, since fewer pixels means less to quantize.",
    },
    {
      question: "Is there a duration limit?",
      answer:
        "No hard limit, but GIFs longer than 10-15 seconds become very large. For longer clips, consider keeping the video format and using lower resolution.",
    },
  ],
  "video-trimmer": [
    {
      question: "What video formats can I trim?",
      answer:
        "MP4, WebM, MOV, AVI, and MKV. The trimmed output uses the same format as your input.",
    },
    {
      question: "Is the video re-encoded when trimming?",
      answer:
        "No. The tool uses stream copy mode (-c copy) which copies the video and audio data without re-encoding. This is nearly instant and preserves original quality.",
    },
    {
      question: "Why doesn't the trim start exactly where I set it?",
      answer:
        "Stream copy mode can only cut at keyframes. The actual start time may be slightly before your requested time. For frame-accurate trimming, re-encoding would be needed.",
    },
    {
      question: "Why is there a 1.5 GB limit?",
      answer:
        "Because trimming keeps the original quality, the trimmed copy can be as large as the source — and it has to be held in the tab, where a browser tops out around 1.8 GB for a single file. If you only need the sound, MP4 to MP3 reads the video in place and has no size cap.",
    },
    {
      question: "Why does the first trim take longer than the next one?",
      answer:
        "The first run loads the FFmpeg engine — a ~31 MB WebAssembly download served from this site's own origin — and keeps it in memory afterwards. The trim itself is a stream copy, so even a 1.5 GB file finishes in about 15 seconds once the engine is up.",
    },
  ],
  "mp4-to-mp3": [
    {
      question: "What bitrate should I choose?",
      answer:
        "128 kbps is fine for speech and podcasts. 192 kbps is a good balance for music. 256-320 kbps provides near-transparent quality for audiophiles.",
    },
    {
      question: "Can I extract audio from non-MP4 videos?",
      answer:
        "Yes! Despite the name, this tool accepts MP4, WebM, MOV, AVI, and MKV files. Any video with an audio track can be converted to MP3.",
    },
    {
      question: "What if the video has no audio?",
      answer:
        "FFmpeg will report an error if there is no audio stream to extract. Make sure your video file contains an audio track.",
    },
    {
      question: "Is there a maximum video size?",
      answer:
        "No. The video is read in place rather than copied into memory, so only the much smaller MP3 output has to fit in the tab — extraction from a 2.5 GB file has been verified end to end. That's why this tool has no cap, while the tools that build a full-size copy of the video in the tab — the trimmer, the container converters, the muter and the rotator — all stop at 1.5 GB.",
    },
    {
      question: "How long does extraction take?",
      answer:
        "About a minute per 600 MB of video: the video track is skipped entirely, but the audio still has to be decoded and re-encoded to MP3 in single-threaded WebAssembly. In testing, a 400 MB file took around 40 seconds and a 2.5 GB file just over four minutes.",
    },
  ],
  "webm-to-mp4": [
    {
      question: "Why convert WebM to MP4?",
      answer:
        "WebM is great for web playback but has limited support on iOS, some Android apps, and many video editors. MP4 (H.264/AAC) is the most universally compatible video format.",
    },
    {
      question: "Will the quality change?",
      answer:
        "Yes — the video is fully re-encoded from VP8/VP9 to H.264, so this is not a lossless remux. The target is 5 Mbps, high enough that the difference is hard to see on typical screen recordings. The output may be larger or smaller than the original depending on the content.",
    },
    {
      question: "How long does conversion take?",
      answer:
        "It depends on the video length and your device. Encoding runs through the browser's built-in WebCodecs API, which uses your hardware encoder where one is available, so a 1-minute clip is usually well under a minute. This needs Chrome or Edge — Firefox and older Safari don't expose the encoder.",
    },
    {
      question: "Can I convert a 4K WebM?",
      answer:
        "Yes, but the output is capped at 1920 pixels on the longest side, so a 3840×2160 recording comes out at 1920×1080. Anything at 1080p or below keeps its original dimensions, rounded to even numbers as H.264 requires.",
    },
    {
      question: "What happens to the audio track?",
      answer:
        "The WebM's Opus or Vorbis audio is decoded and re-encoded to AAC at 128 kbps — the codec MP4 players expect. A recording with no audio track converts fine and produces a video-only MP4.",
    },
  ],
  "compress-video": [
    {
      question: "Which preset should I choose?",
      answer:
        "WhatsApp: optimized for mobile sharing (720p, ~1 Mbps). Email: small enough for email attachments (480p, ~500 kbps). Web: balanced quality for websites and social media (original resolution, higher bitrate).",
    },
    {
      question: "How much smaller will my video get?",
      answer:
        "Results vary by content. Typical reductions: WhatsApp preset 60-80% smaller, Email preset 70-90% smaller, Web preset 30-60% smaller than the original.",
    },
    {
      question: "Is there a file size limit?",
      answer:
        "No limit is enforced, but everything runs in your browser tab, so files much beyond ~100 MB risk exhausting its memory. Trimming the clip first is usually the better route for very long recordings.",
    },
    {
      question: "Can the output end up bigger than my original?",
      answer:
        "It shouldn't — the preset bitrate is a ceiling, not a fixed target, and the encoder aims for at most 90% of what your source actually spends per second (with a 200 kbps floor so tiny clips aren't re-encoded into mush). If an encode still lands at or above the original size, the tool reports 0% saved and suggests keeping the original file.",
    },
    {
      question: "Is the audio compressed too?",
      answer:
        "Yes — the audio is re-encoded to AAC at a bitrate matched to the preset: 96 kbps for WhatsApp, 64 kbps for Email, and 128 kbps for Web. A silent clip compresses fine; the output just carries no audio track.",
    },
  ],
  "screen-recorder": [
    {
      question: "Do I need to install anything?",
      answer:
        "No. This tool uses the browser's built-in Screen Capture API (getDisplayMedia). It works in Chrome, Edge, Firefox, and other modern browsers without any extensions.",
    },
    {
      question: "Can I record with audio?",
      answer:
        "Yes. You can include microphone audio for narration. System audio capture depends on your browser and OS — Chrome on Windows and macOS supports it when sharing a tab.",
    },
    {
      question: "What format is the recording?",
      answer:
        "Recordings are saved as WebM (VP8/VP9 video with Opus audio), which is the native format for browser MediaRecorder. Use our WebM to MP4 tool if you need MP4.",
    },
    {
      question: "Is there a recording time limit?",
      answer:
        "No built-in limit. Recording length is only constrained by your device's available memory and disk space. Very long recordings (30+ minutes) may use significant memory.",
    },
  ],

  /*
    Container tools. Every timing quoted below was measured against the
    shipped public/ffmpeg-core.wasm (FFmpeg n5.1.4): `-c copy` into .mov took
    12 ms at speed=774x and into .mkv 4 ms at 1.72e+03x on the repo's sample
    clip; `-an -c copy` took 7 ms; `-metadata:s:v:0 rotate=90` took 6 ms
    against 7,579 ms for the same rotation as a `-vf transpose=1` re-encode.
    The 1.5 GB cap is STREAM_COPY_MAX_INPUT_BYTES, enforced by
    validateFFmpegInput — see src/lib/tools/ffmpeg-loader.ts.
  */
  "video-to-mp4": [
    {
      question: "Is my video re-encoded?",
      answer:
        "Not on the normal path. The tool reads the file's streams first, and when the video codec is one MP4 can hold, the compressed data is copied into the new container byte for byte — nothing is decoded, so nothing is lost. Only if the codec does not fit MP4 are you offered a real conversion, and that choice is yours to make.",
    },
    {
      question: "Which formats can I convert from?",
      answer:
        "MOV, MKV, AVI and M4V. WebM is handled separately by the WebM to MP4 tool, because WebM's VP8 and VP9 video has no MP4 equivalent to copy across — that one genuinely has to re-encode.",
    },
    {
      question: "Why is a container swap so much faster than a converter?",
      answer:
        "Because it does almost no work. A conversion decodes every frame and encodes it again; a container swap unwraps the already-compressed stream and rewraps it. On our test clip the rewrap finished in about 12 milliseconds, running at several hundred times realtime.",
    },
    {
      question: "What happens if my video is H.265?",
      answer:
        "You are told before anything runs. H.265 (HEVC) is legal inside an MP4, but an H.265 MP4 still fails to play in plenty of the places people are converting for, so quietly rewrapping it would hand you a file with the same problem and a different extension. Instead you get the choice of converting to H.264, which re-encodes every frame — slower, and lossy.",
    },
    {
      question: "Is there a file size limit?",
      answer:
        "1.5 GB. That is the cap the code actually enforces: a stream copy has to hold its output in the browser tab, and a tab tops out under 2 GB in a single buffer. For anything longer, trim the clip first.",
    },
  ],
  "mov-to-mp4": [
    {
      question: "Will my iPhone video convert instantly?",
      answer:
        "It depends on what the phone recorded. iPhones have shot H.265 (HEVC) by default for years — that codec is rewrapped just as fast, but an H.265 file called .mp4 still will not play in a lot of places, so the tool offers an H.264 conversion instead and says how it differs. Older or 'Most Compatible' recordings are already H.264 and are rewrapped losslessly in milliseconds.",
    },
    {
      question: "How do I know which codec my MOV holds?",
      answer:
        "The tool reads it off the file and shows you before you commit to anything. That probe is the whole point: without it, a converter has to guess, and the wrong guess produces a file that looks converted and does not play.",
    },
    {
      question: "Does the quality change?",
      answer:
        "Not when the file is rewrapped — the compressed video is copied across untouched, so the output is the same picture at the same bitrate. If you choose the H.264 conversion for an H.265 source, that is a genuine re-encode and does cost some quality.",
    },
    {
      question: "Why does the first conversion take longer than the next one?",
      answer:
        "The first run downloads the FFmpeg engine — about 31 MB of WebAssembly, served from this site's own origin rather than a CDN — and keeps it in memory for the rest of the session. The conversion itself is the fast part.",
    },
    {
      question: "How large a MOV can I convert?",
      answer:
        "Up to 1.5 GB. The limit is enforced before the run starts rather than discovered halfway through it, because the rewrapped copy has to fit in the browser tab alongside the original.",
    },
  ],
  "mp4-to-mov": [
    {
      question: "Is anything re-encoded?",
      answer:
        "No. MP4 and MOV are both ISO base media containers built from the same box structure, so the video and audio streams move from one to the other unchanged. The picture that comes out is bit for bit the picture that went in.",
    },
    {
      question: "Why would I want a MOV instead of an MP4?",
      answer:
        "Mostly Apple software that keys off the container rather than the codec — some Final Cut and iMovie import paths, a few QuickTime and broadcast workflows. If your software opens MP4 happily, there is no reason to convert.",
    },
    {
      question: "Why is the output a slightly different size?",
      answer:
        "The two containers keep their bookkeeping — indexes, track headers, chapter data — a little differently, so the wrapper around the video changes size even though the video does not. On our test clip the file grew by under a kilobyte.",
    },
    {
      question: "Can I convert an H.265 MP4?",
      answer:
        "Yes. MOV holds H.265 as readily as MP4 does, so the stream is copied across as-is. Note that this does not make an H.265 file more compatible — it is the same video in a different box, and anything that could not decode it before still cannot.",
    },
    {
      question: "What is the maximum file size?",
      answer:
        "1.5 GB, enforced before the conversion starts. The rewrapped output has to be held in the tab, and a browser cannot hold much more than that in one file.",
    },
  ],
  "mkv-to-mp4": [
    {
      question: "Is the video re-encoded?",
      answer:
        "Not when the codec fits. Matroska very often holds plain H.264, which MP4 accepts directly, so the compressed stream is copied into the new container without being decoded — milliseconds of work and no quality cost. Where the codec does not fit MP4, you are offered an H.264 conversion as an explicit, clearly slower choice.",
    },
    {
      question: "Do extra audio tracks and subtitles survive?",
      answer:
        "This is the part of Matroska that MP4 handles worst. Expect the main video and audio track to come across; do not count on additional language tracks, chapter data, or subtitle streams, which MP4 supports far more narrowly than MKV does. If those matter, keep the MKV as your master copy.",
    },
    {
      question: "Why won't my TV or phone open MKV in the first place?",
      answer:
        "Matroska will hold almost any codec, which is exactly why hardware players avoid it — they cannot promise to decode what they might find inside. MP4 is a much narrower container, and that narrowness is what makes it safe to support everywhere.",
    },
    {
      question: "How long does the conversion take?",
      answer:
        "Milliseconds to a few seconds for the rewrap itself, because no frame is decoded. In our measurements a stream copy into a new container ran at between several hundred and roughly 1,700 times realtime. The first run on a page also downloads the ~31 MB FFmpeg engine, which is the part you actually wait for.",
    },
    {
      question: "Is there a size limit on the MKV?",
      answer:
        "1.5 GB. MKV rips are often larger than that; trimming the section you need first, or keeping the original, is the honest answer for a full-length film.",
    },
  ],
  "mp4-to-mkv": [
    {
      question: "Why convert to MKV at all?",
      answer:
        "Matroska takes almost any codec, any number of audio tracks, and subtitle and chapter structures MP4 handles badly or not at all. Media servers and home-theatre software generally prefer it. Going MP4 to MKV is the easy direction — the destination can hold whatever the source was holding.",
    },
    {
      question: "Is anything lost?",
      answer:
        "No. This is a container swap: the compressed video and audio are copied into the Matroska wrapper untouched, nothing is decoded, and the output is exactly as good as the input.",
    },
    {
      question: "Why did the file size change?",
      answer:
        "Only the wrapper changed. MP4 and Matroska store their indexes and headers differently, so the overhead around the video shifts by a few hundred bytes to a few kilobytes in either direction. The video data itself is identical.",
    },
    {
      question: "Can MKV hold H.265?",
      answer:
        "Yes — that is rather the point of Matroska. Whatever codec your MP4 carries, including H.265, moves across as-is. Bear in mind that the file is no more or less playable than it was; only the container changed.",
    },
    {
      question: "How big a file can I convert?",
      answer:
        "1.5 GB. The rewrapped copy is built in the browser tab, and that is the ceiling a tab can hold in a single file — so the limit is checked before the run rather than hit during it.",
    },
  ],
  "avi-to-mp4": [
    {
      question: "Will my AVI convert without re-encoding?",
      answer:
        "It depends what is inside. An AVI holding H.264 can be rewrapped as MP4 in milliseconds with no quality cost at all. An AVI holding something older — MPEG-4 Part 2, MJPEG, an ancient DivX variant — has no clean MP4 equivalent, and the tool tells you that before it runs.",
    },
    {
      question: "What happens if the codec is too old for MP4?",
      answer:
        "You are offered a conversion to H.264 as an explicit second choice, with the cost stated: every frame is decoded and encoded again, so it is slow and it is lossy. What you are not given is a silent failure or a zero-byte file, which is what a naive rewrap produces on those inputs.",
    },
    {
      question: "Does converting to MP4 improve the picture?",
      answer:
        "No, and nothing can. A conversion can only preserve or degrade what the AVI already holds. Old camcorder footage stays old camcorder footage — it just becomes something a phone will open.",
    },
    {
      question: "How long does it take?",
      answer:
        "A rewrap is milliseconds regardless of clip length, since no frame is decoded. An H.264 conversion is a real encode and scales with duration and resolution, so it can take minutes on a long clip; the tool estimates before you commit.",
    },
    {
      question: "Is there a maximum AVI size?",
      answer:
        "1.5 GB, checked before the conversion starts. Old DV-format AVIs are unusually large for their running time — roughly 13 GB an hour — so long tapes may need trimming first.",
    },
  ],
  "mute-video": [
    {
      question: "Is the video re-encoded when the audio is removed?",
      answer:
        "No. The audio track is simply left out of the new file while the compressed video stream is copied across byte for byte. Same resolution, same bitrate, same picture — measured at about 7 milliseconds on our test clip.",
    },
    {
      question: "Can I get the audio back afterwards?",
      answer:
        "Not from the muted file — the track is gone, not hidden. Keep your original if you might want the sound later. If you want to save the audio separately before muting, the MP4 to MP3 tool extracts it.",
    },
    {
      question: "What format is the output?",
      answer:
        "The same container you put in. A muted MP4 is still an MP4, a muted MOV is still a MOV — only the audio track is missing, so the file drops into exactly the same places the original did.",
    },
    {
      question: "Can I remove only one of several audio tracks?",
      answer:
        "No. This tool strips the audio entirely; there is no per-track selection. That keeps the operation a single stream copy, which is what makes it instant and lossless.",
    },
    {
      question: "How large a video can I mute?",
      answer:
        "Up to 1.5 GB. The muted copy has to be held in the browser tab, so the same stream-copy ceiling applies here as on the trimmer.",
    },
  ],
  "rotate-video": [
    {
      question: "Does this re-encode the video?",
      answer:
        "No — and that is the whole point. MP4 and MOV store a display matrix telling players how to turn the frames, and this rewrites that one field. Measured on a ten-second 720p clip: 6 milliseconds for the flag rewrite against 7,579 milliseconds to re-encode the same rotation, and the flag rewrite loses nothing.",
    },
    {
      question: "Will every player show it rotated?",
      answer:
        "No, and it would be dishonest to promise otherwise. A rotation flag is a request. Most modern players — QuickTime, VLC, iOS, Android, current browsers — read it and rotate accordingly; some editors, some older players and some upload pipelines ignore it and show the clip exactly as it was shot. Preview the result before you rely on it.",
    },
    {
      question: "Why do the dimensions still show the original size?",
      answer:
        "Because the frames themselves were never touched. A 1920×1080 clip rotated 90 degrees still reports 1920×1080, with a rotation flag attached that a player is expected to apply. Anything that ignores the flag sees the original, unrotated frame.",
    },
    {
      question: "When should I re-encode instead?",
      answer:
        "When the destination is known to ignore rotation metadata — some editing suites and some upload pipelines do. A re-encode bakes the rotation into the pixels so nothing downstream can disagree, at the cost of time and a generation of quality. For everyday playback the flag rewrite is the better trade by a wide margin.",
    },
    {
      question: "Which formats can I rotate?",
      answer:
        "MP4, MOV and M4V. The rotation flag lives in the display matrix that ISO base media containers define, so those three are where it can be written reliably — AVI has no equivalent field at all.",
    },
  ],

  // ── Audio extraction (video in, audio out) ───────────────────────
  //
  // The one arm that is genuinely lossless on this whole cluster is the copy
  // arm here, and these answers are the surface that has to keep it apart from
  // the two that are not. The size answers matter as much: the INPUT is
  // uncapped because it is mounted rather than copied, and the OUTPUT is the
  // thing that can run a tab out of memory — the pages say "NO SIZE CAP" about
  // the file you hand over, and it is these answers that carry the rest.
  "extract-audio": [
    {
      question: "What does the Keep original setting actually do?",
      answer:
        "It runs a stream copy: FFmpeg lifts the encoded audio track out of the video container and writes it into a new one without decoding a single sample. Nothing is re-encoded, nothing is lost, and it takes milliseconds — 29 milliseconds on the clip this was measured against. The page reports what the run actually did afterwards, rather than promising it in advance.",
    },
    {
      question: "What format do I get from Keep original?",
      answer:
        "Whatever the video was already carrying. That is usually AAC from an MP4 or a phone recording, and Opus or Vorbis from a WebM. You are getting the same bytes the video held, in a container that can hold them — which is exactly why the run costs nothing in quality.",
    },
    {
      question: "Should I pick MP3 or WAV instead?",
      answer:
        "MP3 when the file has to play on absolutely anything, and no higher than the video's own audio bitrate — going above it buys nothing. WAV when the audio is heading into an editor, a DAW or a transcription tool that wants uncompressed samples. Both decode the track and encode it again, so both cost a generation of quality; that is why they sit behind a named choice.",
    },
    {
      question: "Is there a size limit on the video?",
      answer:
        "No, and it is not a courtesy: the video is mounted into the FFmpeg engine rather than read into the tab, so a large source costs no memory at all — that path has been verified end to end at 2500 MB. What does have to fit in the tab is the audio that comes out, which matters mainly on the WAV setting at roughly 10 MB per minute.",
    },
    {
      question: "Which video formats can I use?",
      answer:
        "MP4, WebM, MOV, AVI and MKV. The demuxer is chosen from the file's own extension, so keep it intact — a renamed or extension-less file leaves the engine guessing.",
    },
  ],
  "video-to-wav": [
    {
      question: "Why would I want a WAV rather than an MP3?",
      answer:
        "Because audio software expects uncompressed PCM. Digital audio workstations, transcription engines, forensic tools and subtitle timing software all want samples rather than a compressed approximation, and several of them refuse a compressed file outright. If you only want something to listen to, MP3 is a much smaller file and the audio extractor offers it.",
    },
    {
      question: "How big will the WAV be?",
      answer:
        "About 10 MB per minute of stereo audio, regardless of how small the video was. A 30-minute talk lands near 300 MB and a two-hour film goes over a gigabyte. The whole file is built in the browser tab before you can download it, so very long recordings can run a tab out of memory even though the video itself costs nothing to read.",
    },
    {
      question: "Does converting to WAV improve the audio?",
      answer:
        "No. The audio in a video is already compressed — AAC, Opus, Vorbis, AC-3 or MP3 — and decoding it to WAV recovers nothing that encoder discarded. What you get is a lossless working copy, so every edit and export after this point adds no further damage.",
    },
    {
      question: "What sample rate does the WAV use?",
      answer:
        "The audio track's own, usually 44.1 or 48 kHz, written as 16-bit PCM. Nothing is resampled on the way through, so the timing matches the video exactly — which matters when the WAV is going into subtitle or transcription work.",
    },
    {
      question: "Which video formats does this accept?",
      answer:
        "MP4, WebM, MOV, AVI and MKV. FFmpeg picks its demuxer from the file extension, so leave the name intact. The video track is discarded entirely — only the audio stream is read — which is why the run is fast even on a large file.",
    },
  ],
  "mp4-to-wav": [
    {
      question: "What is inside an MP4's audio track?",
      answer:
        "Almost always AAC — compressed and lossy, fine for listening and awkward for working with. This tool demuxes that stream out of the container, decodes it, and writes the samples into a standard 16-bit WAV at the track's own sample rate, which is the shape editing and transcription software expects.",
    },
    {
      question: "How large is the resulting WAV?",
      answer:
        "Around 10 MB for every minute of stereo audio, so an hour-long recording becomes a file over half a gigabyte. It is assembled in the browser tab in one piece before the download appears, which is the practical ceiling here — the MP4 itself is mounted rather than loaded, so its size costs nothing.",
    },
    {
      question: "Does this restore quality the MP4 lost?",
      answer:
        "No. Whatever AAC discarded when the video was made is gone, and no conversion brings it back. The WAV is lossless from this point forward, not lossless all the way back — which is still exactly what you want before editing, because nothing further is lost downstream.",
    },
    {
      question: "Can I use a MOV or M4V file too?",
      answer:
        "Yes — this page accepts .mp4, .m4v and .mov, which are all ISO base media containers holding the same kinds of audio track. For WebM, AVI or MKV sources, use the more general video to WAV page, which takes the wider list.",
    },
    {
      question: "Why is the first conversion slower than the next one?",
      answer:
        "Because the engine has to arrive first. FFmpeg is compiled to WebAssembly and is roughly a 31 MB download, served from this site rather than a CDN, fetched once and then cached by your browser. Every conversion after that starts immediately, and all of them run on your own machine.",
    },
  ],

  // ── Developer Tools FAQs (continued) ─────────────────────────────
  "json-to-csv": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What JSON structure does this tool expect?",
      answer:
        'It expects a JSON array of objects, where each object represents a row. For example: [{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]. Nested objects are flattened automatically.',
    },
    {
      question: "How are nested objects handled?",
      answer:
        'Nested properties are flattened using dot notation. For example, {"address": {"city": "NYC"}} becomes a column named "address.city".',
    },
    {
      question: "What if my objects have different keys?",
      answer:
        "The tool collects all unique keys across every object. Rows missing a key will have an empty value in that column.",
    },
    {
      question: "Can I use the CSV in Excel?",
      answer:
        "Yes. The output is standard comma-separated CSV that opens directly in Excel, Google Sheets, LibreOffice Calc, and any other spreadsheet application.",
    },
  ],
  "csv-to-json": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "Does it use the first row as keys?",
      answer:
        "Yes. The first row of the CSV is treated as column headers and used as the property names in each JSON object.",
    },
    {
      question: "Can I paste CSV text directly?",
      answer:
        "Yes. You can paste CSV content into the text area or upload a .csv file. Both methods produce the same JSON output.",
    },
    {
      question: "How are numeric values handled?",
      answer:
        "Values that look like numbers are automatically converted to JSON numbers. Everything else is kept as a string.",
    },
    {
      question: "Does it handle quoted fields with commas?",
      answer:
        "Yes. The parser correctly handles fields enclosed in double quotes, including fields that contain commas, newlines, or escaped quotes.",
    },
  ],
  // The spreadsheet route into the CSV pair above: an .xlsx is unzipped
  // here and its answers are mostly about what a cell really stores.
  "xlsx-to-csv": [
    {
      question: "My dates came out as numbers like 45678.",
      answer:
        "That is genuinely what the file stores. XLSX has no date type: a date is an ordinary number — days since 1899-12-30, or since 1904-01-01 in a workbook that declares the 1904 date system — and the only thing that makes it look like a date is a number format hanging off the cell's style. Writing it back out correctly means implementing Excel's whole format-code language, plus the 1904 epoch and the fictional 1900 leap day, and a date rendered on the wrong calendar is a silent error where 45678 is an obvious one. So the serial is written out unchanged, and the page reads the style table to count how many cells that affects and prints the number beside the preview.",
    },
    {
      question: "Excel opens the CSV with every row squashed into one column.",
      answer:
        "Switch SEPARATOR to semicolon. Excel does not read the separator out of the file; it assumes the list separator for your Windows locale, and everywhere the decimal mark is a comma — most of Europe and Latin America — that separator is a semicolon, so a comma-separated file arrives as one column per row. The sibling failure is accented characters coming through as garbage, and that one is the byte-order mark: tick it and Excel reads the file as UTF-8. It is off by default because many command-line and scripting readers then hand the mark back as part of your first column's name.",
    },
    {
      question: "It says my file is not an .xlsx, and I am certain that it is.",
      answer:
        "Two different files fail the same way, and the message names which one you have. An old binary .xls — anything saved before 2007, or exported by a legacy system — is not a ZIP at all but an OLE2 compound file, and nothing here can open it; re-save it from Excel, LibreOffice or Numbers as .xlsx. A password-protected .xlsx looks identical from the outside, because Excel encrypts the whole package and wraps it in that same container. Open it with its password and save an unprotected copy. Renaming a .xls to .xlsx changes the name and nothing else.",
    },
    {
      question: "What does the CSV lose compared with the workbook?",
      answer:
        "Everything that is not a value sitting in a cell. Charts, images, pivot tables, colours, fonts, column widths, conditional formatting, data validation and comments have nowhere to live in a CSV and are dropped. Formulas come through as the result Excel last calculated and saved beside them — nothing is recalculated here — so a workbook written by a library that never computed its formulas will show blanks. A merged block keeps its value in the top-left cell and leaves the rest empty, which is exactly how the file stores it. Formula cells and error values such as #REF! are counted on screen.",
    },
    {
      question: "The workbook has five sheets. Do I get five files?",
      answer:
        "You get one CSV per sheet you tick, and every sheet is ticked to begin with. One sheet downloads as a plain .csv named after the workbook and the tab; two or more come down as a single ZIP, because a browser cancels most of a burst of downloads fired off at once. Hidden sheets are listed too, marked HIDDEN — hiding is a display setting rather than a lock, so untick any you do not want out. Click a sheet's row × column count to preview its CSV, quoting and all, before you save anything.",
    },
  ],
  "sql-formatter": [
    {
      question: "Is my SQL sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What SQL dialects are supported?",
      answer:
        "The formatter supports standard SQL, PostgreSQL, MySQL, MariaDB, SQLite, BigQuery, Transact-SQL (SQL Server), and PL/SQL (Oracle).",
    },
    {
      question: "Does formatting change query behavior?",
      answer:
        "No. Formatting only changes whitespace, indentation, and capitalization of keywords. The query logic and results remain exactly the same.",
    },
    {
      question: "Can I customize the indentation style?",
      answer:
        "Yes. You can choose between spaces and tabs, adjust the indent width, and control keyword capitalization (uppercase, lowercase, or preserve).",
    },
  ],
  "markdown-to-html": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "Which Markdown features are supported?",
      answer:
        "The tool supports standard Markdown including headings, bold, italic, links, images, code blocks, lists, blockquotes, tables, and horizontal rules.",
    },
    {
      question: "Can I preview the rendered HTML?",
      answer:
        "Yes. The tool shows both the raw HTML output and a live preview of how it looks rendered in a browser.",
    },
    {
      question: "Does it support GitHub-Flavored Markdown?",
      answer:
        "Yes. Features like tables, task lists, strikethrough, and fenced code blocks with syntax highlighting are all supported.",
    },
  ],
  "html-to-markdown": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "Why convert HTML to Markdown?",
      answer:
        "Markdown is easier to read and edit than raw HTML. It's widely used in README files, documentation, blogs, and note-taking apps like Obsidian and Notion.",
    },
    {
      question: "Does it preserve links and images?",
      answer:
        "Yes. HTML links become [text](url) and images become ![alt](src) in the Markdown output.",
    },
    {
      question: "How are complex HTML elements handled?",
      answer:
        "Tables, lists, and headings are converted to their Markdown equivalents. Elements with no Markdown equivalent (like custom divs) are simplified or kept as inline HTML.",
    },
  ],
  "xml-formatter": [
    {
      question: "Is my XML sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "Does formatting change the XML data?",
      answer:
        "No. Formatting only affects whitespace and indentation. Element names, attributes, and text content remain unchanged.",
    },
    {
      question: "Can it handle large XML files?",
      answer:
        "It works well for XML documents up to a few megabytes. Very large files may cause the browser tab to slow down due to parsing and rendering.",
    },
    {
      question: "Does it validate my XML?",
      answer:
        "The tool checks for well-formedness (proper nesting, matching tags, valid syntax) and will report parsing errors if your XML is malformed.",
    },
  ],
  "url-encode-decode": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What is URL encoding?",
      answer:
        "URL encoding (percent-encoding) replaces special characters with a % followed by their hex code. For example, a space becomes %20 and an ampersand becomes %26. This ensures URLs are valid and unambiguous.",
    },
    {
      question: "When should I URL-encode text?",
      answer:
        "Encode text when including it in query parameters, form data, or any part of a URL that might contain special characters like spaces, ampersands, or non-ASCII characters.",
    },
    {
      question: "Does it handle Unicode characters?",
      answer:
        "Yes. Non-ASCII characters like emoji and international text are encoded as UTF-8 byte sequences, each byte represented as a percent-encoded value.",
    },
  ],
  // Reading a URL, and reading a log full of them. `har-viewer` sits with
  // `url-parser` because both answer questions about what a browser
  // normalised before anyone saw it.
  "url-parser": [
    {
      question: "The URL it shows me is not the URL I pasted.",
      answer:
        "That is the parser, and the page flags it rather than hiding it. The WHATWG URL parser every browser ships normalises as it reads: schemes and hostnames are lower-cased, a default port is dropped, dot segments in the path are resolved, and non-ASCII is escaped. So HTTP://Example.COM:80/a/../b comes back as http://example.com/b. All of that is exactly what a browser would do with the same string, which is why the components below describe the rewritten URL — that is the one a request would actually be made against. The banner shows both so you can see what moved.",
    },
    {
      question: "My query string has the same key twice and other tools only show one.",
      answer:
        "This one shows both, in source order, as separate rows. Repeated keys are legal and common — tag=a&tag=b — and servers resolve them differently: Go's Query().Get returns the first, PHP's $_GET keeps the last, and Express with its default parser builds an array. Collapsing the rows would hide precisely the ambiguity you are debugging. The footnote counts how many repeats were kept. Editing the table and rebuilding writes them all back out in order, so a round trip through this page does not silently deduplicate your query string.",
    },
    {
      question: "What does DOUBLE-ENCODED mean on one of my parameters?",
      answer:
        "It means the value still contains a percent sequence after being decoded once, which almost always means an already-encoded string was encoded again. A redirect parameter is the usual culprit: https%3A%2F%2Fexample.com is correct, and https%253A%252F%252Fexample.com is that same value run through the encoder twice, so the server decodes it once and gets a literal %3A back. The table shows the once-decoded value with the raw string underneath, so you can see both. The page does not decode a second time on your behalf, because whether that is correct depends on the receiving code.",
    },
    {
      question: "Why is my hostname full of xn-- gibberish?",
      answer:
        "Because that is the hostname. An internationalised domain is stored and resolved in Punycode: münchen.de goes on the wire as xn--mnchen-3ya.de, and that ASCII form is what DNS looks up and what a TLS certificate is issued for. The Unicode spelling exists for humans. This page decodes the xn-- labels back and shows both forms, which is the point — two hostnames that look identical in a browser's address bar can have completely different Punycode, and comparing the ASCII form is the only reliable way to catch a lookalike domain.",
    },
    {
      question: "Does it check whether the URL actually works?",
      answer:
        "No, and it never contacts the address. This page reads the string and nothing else: no request is made, no DNS lookup happens, no redirect is followed, and no certificate is checked. A URL that parses cleanly here can still be a dead link, a typo, or a host that does not exist. That restriction is deliberate — a HAR file, a support ticket or a log line often carries a URL with a session token in it, and a parser that fetched what you pasted would be handing that token to whoever owns the domain.",
    },
  ],
  "har-viewer": [
    {
      question: "Is it safe to send someone my HAR file?",
      answer:
        "Not as it comes off the Network panel. A HAR records every request verbatim, so it normally contains your Cookie header, any Authorization or Bearer token, CSRF and session headers, vendor API keys, and the body of every POST — the login form included. Anyone who opens it can sign in as you until those credentials expire. The redact control here removes the parts it can name and tells you how many values it took out, which is a large improvement and is not the same as safe: it leaves URLs, query strings and response bodies exactly as recorded. Read the redacted file before you attach it.",
    },
    {
      question: "Exactly what does the redact control remove?",
      answer:
        "By name: Authorization, Proxy-Authorization, Cookie, Set-Cookie, X-CSRF-Token and X-XSRF-Token. By pattern: any header whose name contains token, secret, api-key or session, which is what catches X-Api-Key and the hundred vendor spellings around it. It also empties every value in the request and response cookies arrays and replaces the whole request body, form parameters included. The counts on screen are taken from your file, not from a list. What it does not touch: the URL and its query string, so a token in ?access_token= survives, and response bodies, so a JSON login response still holds whatever it returned.",
    },
    {
      question: "Why do some requests show a dash instead of a size or a time?",
      answer:
        "Because the recording says the figure is unknown. The HAR format writes -1 for a size or duration it could not measure, which is routine for requests served from cache, requests the browser blocked, and anything an extension interfered with. Printing that as 0 B would understate the page and quietly flatter it, so those cells show a dash instead. The totals follow the same rule: the transferred figure is the sum of the requests that reported a size, and the rail says how many did not, so you can see how much of the recording the number actually covers.",
    },
    {
      question: "The TYPE column says json but DevTools called it xhr.",
      answer:
        "Because the two are reading different things. Chrome and Edge write a private _resourceType field into each entry, and where that exists this page uses it verbatim — which is why most rows in a Chrome HAR match the Network panel exactly. Firefox HARs and anything converted from curl have no such field, so the type is read off the response MIME type instead, and a MIME type genuinely cannot tell an XHR from a fetch from a script tag. The fallback is deliberately coarse for that reason: document, stylesheet, script, image, font, media, json, xml, text or other.",
    },
    {
      question: "Where is the response body?",
      answer:
        "Not rendered, in this version. The detail panel shows the request headers, the query string, the request body, the response headers and the timing breakdown. Response bodies are left out for two reasons: they are frequently megabytes of base64 or minified bundles, which no amount of scrolling makes readable, and they are the one part of a HAR that redaction here does not reach, so drawing them on screen would put the least protected content in the most prominent place. The bodies are still in your file and still in the export — which is exactly why the page tells you to read the export before sharing it.",
    },
  ],
  "html-entity-encode-decode": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What are HTML entities?",
      answer:
        "HTML entities are special codes that represent characters in HTML. For example, &lt; represents <, &amp; represents &, and &nbsp; represents a non-breaking space. They prevent browsers from interpreting characters as HTML markup.",
    },
    {
      question: "When should I use HTML entities?",
      answer:
        "Use HTML entities when displaying special characters in HTML content — especially <, >, &, and quotes — to prevent them from being interpreted as HTML tags or attributes.",
    },
    {
      question: "Does it support named and numeric entities?",
      answer:
        "Yes. The tool handles both named entities (like &amp;) and numeric entities (like &#38; or &#x26;).",
    },
  ],
  "lorem-ipsum-generator": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What is Lorem Ipsum?",
      answer:
        "Lorem Ipsum is placeholder text used in design and typesetting since the 1500s. It has a natural letter distribution similar to English, making layouts look realistic before final copy is written.",
    },
    {
      question: "Can I generate paragraphs, sentences, or words?",
      answer:
        "Yes. You can choose to generate a specific number of paragraphs, sentences, or words depending on your layout needs.",
    },
    {
      question: "Is the text random each time?",
      answer:
        "The text is shuffled from a pool of classical Lorem Ipsum phrases, so each generation produces a slightly different arrangement while maintaining natural-looking Latin text.",
    },
  ],
  "css-gradient-generator": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What types of gradients can I create?",
      answer:
        "You can create linear gradients (with adjustable angle), radial gradients (circular or elliptical), and conic gradients. Each type supports multiple color stops.",
    },
    {
      question: "Do CSS gradients work in all browsers?",
      answer:
        "Yes. The linear-gradient, radial-gradient, and conic-gradient CSS functions are supported in all modern browsers including Chrome, Firefox, Safari, and Edge.",
    },
    {
      question: "Can I add more than two colors?",
      answer:
        "Yes. You can add multiple color stops to create complex multi-color gradients. Each stop can have its position adjusted along the gradient axis.",
    },
  ],
  "box-shadow-generator": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What do the shadow values mean?",
      answer:
        "The box-shadow property takes: horizontal offset, vertical offset, blur radius, spread radius, and color. Blur controls softness, spread controls size, and the offsets control direction.",
    },
    {
      question: "Can I add multiple shadows?",
      answer:
        "Yes. You can layer multiple shadows on a single element to create depth effects, glows, or complex shadow compositions. Each shadow is listed comma-separated in the CSS output.",
    },
    {
      question: "What is an inset shadow?",
      answer:
        "An inset shadow appears inside the element instead of outside, creating a pressed or recessed effect. Toggle the inset option to switch between inner and outer shadows.",
    },
  ],
  "cron-expression-generator": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What is a cron expression?",
      answer:
        "A cron expression is a string of five (or six) fields that defines a schedule: minute, hour, day of month, month, and day of week. It's used by Unix cron, CI/CD systems, and task schedulers to run jobs automatically.",
    },
    {
      question: "What does * mean in a cron field?",
      answer:
        'An asterisk (*) means "every" — so * in the minute field means every minute, and * in the day-of-week field means every day. Other special characters include , (list), - (range), and / (step).',
    },
    {
      question: "Does this show when the next runs will be?",
      answer:
        "Yes. The tool displays the next several scheduled run times so you can verify your cron expression triggers at the correct times.",
    },
    {
      question: "What's the difference between 5-field and 6-field cron?",
      answer:
        "Standard Unix cron uses 5 fields (minute through day-of-week). Some systems like Quartz and AWS add a 6th field for seconds. This tool generates standard 5-field expressions.",
    },
  ],
  "text-diff": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What diff algorithm is used?",
      answer:
        "The tool uses a standard line-by-line diff algorithm that highlights additions, deletions, and modifications — similar to what git diff produces.",
    },
    {
      question: "Can I compare code files?",
      answer:
        "Yes. The diff tool works with any plain text including source code, configuration files, JSON, XML, or prose. Line-by-line comparison makes it easy to spot changes.",
    },
    {
      question: "What do the colors mean?",
      answer:
        "Green highlights indicate added lines (present only in the second text), red highlights indicate removed lines (present only in the first text), and unchanged lines are shown without highlighting.",
    },
  ],
  "text-case-converter": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "What case formats are supported?",
      answer:
        "The tool supports camelCase, PascalCase, snake_case, SCREAMING_SNAKE_CASE, kebab-case, Title Case, UPPERCASE, lowercase, and Sentence case.",
    },
    {
      question: "When would I use snake_case vs camelCase?",
      answer:
        "snake_case is the convention in Python, Ruby, and SQL. camelCase is standard in JavaScript, Java, and TypeScript. PascalCase is used for class names in most languages.",
    },
    {
      question: "Does it handle multi-line text?",
      answer:
        "Yes. Each line is converted independently, so you can paste a list of variable names or phrases and convert them all at once.",
    },
  ],
  "word-counter": [
    {
      question: "Is my data sent to a server?",
      answer:
        "No. All processing happens locally in your browser. No data leaves your device.",
    },
    {
      question: "How are words counted?",
      answer:
        "Words are counted by splitting text on whitespace boundaries. Hyphenated words like 'well-known' count as one word, and numbers count as words.",
    },
    {
      question: "Does it show reading time?",
      answer:
        "Yes. The tool estimates reading time based on an average reading speed of about 200-250 words per minute.",
    },
    {
      question: "What statistics are displayed?",
      answer:
        "The tool shows word count, character count (with and without spaces), sentence count, paragraph count, and estimated reading time.",
    },
  ],
  // The line-level text tools, beside the other counters. Both answer in
  // counts — lines dropped, endings found — rather than in adjectives.
  "sort-dedupe-lines": [
    {
      question: "It sorted file1, file10, file2 — that is not the order I want.",
      answer:
        "That is alphabetical order doing exactly what it says: comparing character by character, 1 comes before 2, so file10 lands between file1 and file2. Switch the sort to Natural. That mode turns on numeric collation, which reads a run of digits as a number rather than as characters, and gives you file1, file2, file10. It handles digits anywhere in the line, so IMG_2 before IMG_10 and v1.9 before v1.10 both work. Everything else about the sort is unchanged; only the treatment of digit runs differs.",
    },
    {
      question: "Why does apple sort before Banana instead of after Zebra?",
      answer:
        "Because the ordering is the browser's Unicode collation, not a comparison of raw code points. In code-point order every capital letter comes before every lower-case one, so a naive sort produces Banana, Zebra, apple — which is almost never what anyone means by alphabetical. Collation orders letters the way a dictionary does and treats accented characters as variants of their base letter. If you want case to matter, leave Case-sensitive ticked and letters that differ only in case will still sort in a stable, defined order; untick it and API and api become the same line for both sorting and de-duplication.",
    },
    {
      question: "Which copy of a duplicate line survives?",
      answer:
        "Whichever you choose, and the choice means what it says because the operations run in a fixed order: trim, drop blanks, de-duplicate, sort, reverse. De-duplication happens before the sort, so Keep first means the first occurrence in your original file rather than the first one after a re-order, and Keep last leaves that copy in the position it already occupied instead of moving it to the front. The counts on screen show how many lines were removed and across how many distinct repeated values, so a list with one line repeated fifty times reads differently from fifty lines each repeated once.",
    },
    {
      question: "Can I sort a CSV by one of its columns?",
      answer:
        "No. Everything here compares whole lines, so a CSV sorts by its first column and then by whatever follows, and the header row sorts along with the data. There is a worse trap: a CSV field may legally contain a line break inside quotes, and this tool splits on every break, so such a record would be torn into two lines and could then be sorted apart. If your data has quoted multi-line fields, do not run it through here. Use a spreadsheet, or convert to JSON first with the CSV to JSON tool.",
    },
    {
      question: "My output has fewer lines than I expected.",
      answer:
        "Read the four counters — they exist for exactly this. Lines in and lines out bracket the run, and the two causes are itemised separately: duplicates removed, and blank lines removed. Blank means empty or whitespace-only, so a line of spaces counts. Trim runs first and can turn two lines that looked different into the same line, which then de-duplicates. And with Case-sensitive off, API and api collapse to one. A warning above the panes spells out each of these in words whenever it applies, so nothing leaves silently.",
    },
  ],
  "crlf-lf": [
    {
      question: "Git says every line changed and I only edited one.",
      answer:
        "Your editor rewrote the whole file's line endings on save. Git compares bytes, and a line that ended in CRLF and now ends in LF is a changed line even though nothing you can see is different. Drop the file here and the counts tell you which way it went: a file showing all LF that your colleague's diff shows as CRLF is the giveaway. Convert to whatever the repository already uses, commit that as its own change, and then set core.autocrlf or a .gitattributes rule so it stops happening. This page fixes the file; only Git config stops the recurrence.",
    },
    {
      question: "My shell script fails with '\\r: command not found'.",
      answer:
        "The script has Windows line endings. The shell reads a line up to the LF, which leaves the carriage return attached to the end of the last word, so it looks for a command whose name ends in an invisible control character. The same thing shows up as a bad interpreter error when the shebang line is affected. Drop the .sh file here, convert to LF, and re-download. The counts will confirm what it had. Nothing else in the file changes, so a script that was working apart from this keeps working.",
    },
    {
      question: "I pasted my file in and it says LF, but my editor says CRLF.",
      answer:
        "The paste arm cannot detect line endings, and that is the browser's doing rather than a bug here. The HTML specification requires a textarea to normalise every line ending in its value to LF, so by the time this page can read what you pasted, the carriage returns are already gone. There is a warning on screen saying so whenever you switch to Paste. Use the File arm for detection — it reads the raw bytes. Paste is still the right arm for the opposite job: producing CRLF or CR output from text you are composing in the box.",
    },
    {
      question: "What is the byte-order mark, and should I take it off?",
      answer:
        "It is three bytes, EF BB BF, that some Windows tools write at the start of a UTF-8 file to say the file is UTF-8. It is invisible in most editors and legal but discouraged in UTF-8. Take it off when it is causing trouble: a shell script whose first line is a shebang will not run with a mark in front of it, a CSV's first column header reads with a stray character glued to it, and JSON.parse rejects the file outright. Leave it when a Windows tool downstream expects it. The page reports whether one was there and removes it only if you tick the box.",
    },
    {
      question: "It will not accept my .js or .py file.",
      answer:
        "The picker takes .txt, .csv, .log, .md and .sh, which covers the files people most often hit this problem with but is not the whole world of text. Rename a copy to .txt, convert it, and rename it back — the contents are untouched by the round trip. Two things it genuinely cannot do: a UTF-16 file is refused rather than converted, because rewriting it as UTF-8 would change every byte instead of only the line endings; and a file that is not valid UTF-8 is refused for the same reason, with a pointer to the charset converter.",
    },
  ],
  "compress-video-to-size": [
    {
      question: "Will the file actually come out at the size I picked?",
      answer:
        "It is a target, not a guarantee, and the page never pretends otherwise. An H.264 encoder is given a bitrate, not a file size: the solver turns your number into a bitrate using the clip's duration, and how close the finished file lands depends on the footage — a static shot undershoots, constant motion overshoots. What you get back is the size actually produced next to the size you asked for, and a plain statement when the target was missed rather than a download that quietly breaks your limit.",
    },
    {
      question: "What happens when the target cannot be met?",
      answer:
        "You get the closest result it could manage, plus a clear line saying the target was not reached. There is a bitrate floor because below it H.264 stops resembling the source and starts resembling blocks, so a long recording asked to fit in a small number comes back at that floor, above your target. The fix is fewer seconds rather than fewer bits: trim the clip first and run it again.",
    },
    {
      question: "Which number should I pick?",
      answer:
        "25 MB is the usual email attachment ceiling, 16 MB is what WhatsApp accepts, and 10 MB is the Discord limit without Nitro. Those three are offered as presets and every one of them is only a starting value — the field stays editable, so if your own limit is 8 MB or 40 MB, type it.",
    },
    {
      question: "How is this different from Compress Video?",
      answer:
        "Same encoder, opposite input. Compress Video asks you to pick a preset — a resolution and a bitrate chosen for WhatsApp, email or the web — and the file size falls out of that. This page asks you for the file size and works backwards to the bitrate. Pick whichever end of the arithmetic you actually know.",
    },
    {
      question: "Why does it say my browser is not supported?",
      answer:
        "The encoding runs on WebCodecs, the browser's own H.264 encoder, which today means Chrome or Edge. Firefox and Safari are checked before anything starts and told so up front, rather than being allowed to spend minutes on an encode that cannot finish. This page does not fall back to FFmpeg; the video tools that do are the trimmer and the container converters.",
    },
    {
      question: "Is there a file size limit on the input?",
      answer:
        "Nothing is enforced, but everything happens in one browser tab: the clip is read into a buffer, its audio is decoded to 32-bit float, and the new MP4 is assembled beside both. Clips much past ~100 MB risk exhausting the tab's memory. For a long recording, trimming first is both faster and safer.",
    },
  ],
  "subtitle-converter": [
    {
      question: "My subtitles drift further out the longer the video runs.",
      answer:
        "That is a frame-rate problem, not an offset problem, and shifting the file will not fix it — the error grows with elapsed time instead of staying constant. It happens when a file timed against 23.976 fps is played at 25, or the reverse. Use the frame-rate re-time instead: give it the rate the file was timed at and the rate you are playing at, and every timestamp is scaled rather than nudged.",
    },
    {
      question: "What is lost converting ASS to SRT?",
      answer:
        "Everything except the words and the times. ASS carries named styles, fonts, colours, on-screen positioning and karaoke timing inside the text itself, and SRT has nowhere to put any of it. The conversion keeps the dialogue and the cue timings and drops the rest, and it tells you what it dropped — the cues that were vector drawings rather than words, the markup with nowhere to go. Going the other way cannot invent styling that was never there: writing ASS gives you a valid file with one Default style, not a styled one.",
    },
    {
      question: "What if my file is not UTF-8?",
      answer:
        "It is read anyway, and the guess is shown rather than hidden. Detection believes a byte-order mark, spots BOM-less UTF-16 by its zero bytes, and otherwise tests the bytes strictly against UTF-8 — strictly, because the forgiving decoder every browser uses by default would replace each accented character with a diamond and report success. Bytes that fail the strict test are read as Windows-1252 and flagged as a guess, since a Cyrillic or Greek file is equally valid non-UTF-8; when the guess is wrong, the READ THE FILE AS picker lets you name the codepage. Everything written out is UTF-8, with an optional byte-order mark for the few players that insist on one.",
    },
    {
      question: "Does this burn the subtitles into the video?",
      answer:
        "No. This is a text tool: subtitles in, subtitles out. Burning captions into the picture means re-encoding every frame of the video, which is a different job entirely and is not what this page does. What you get is a sidecar file to sit next to the video, which is also the version a viewer can turn off.",
    },
    {
      question: "What happens if a shift pushes a cue before zero?",
      answer:
        "Its start is pulled to 00:00:00 rather than written out as a negative time, because no subtitle format can express one and a player handed a negative timestamp will either ignore the cue or refuse the file. A cue whose END also falls before zero has nothing left to show and is dropped instead. Both are counted on screen, so a shift that quietly cost you the first three lines cannot pass for a clean run.",
    },
  ],
  // `charset-converter` shares this page's detector, so it inherits the
  // same question about a file that is not UTF-8 and answers it the same
  // way.
  "charset-converter": [
    {
      question: "My CSV opens in Excel with Ã© where the accents should be.",
      answer:
        "That is a file written in one encoding and read in another. Ã© is what the two UTF-8 bytes for é look like when something reads them one byte at a time as Windows-1252, and the reverse mistake gives you a diamond or a question mark instead. Drop the file here and the preview shows you what each candidate encoding actually produces, so you can settle it by looking rather than guessing. Save the result as UTF-8, and if the file is a CSV you are about to open in Excel on Windows, tick the byte-order mark box as well — Excel needs that mark before it will treat a CSV as UTF-8.",
    },
    {
      question: "Can I convert a file TO Shift_JIS or Windows-1251?",
      answer:
        "No, and no browser tool can. The browser gives pages two halves of the encoding standard and they are not symmetrical: TextDecoder reads about forty encodings, and TextEncoder writes UTF-8 only — its constructor takes no argument at all. So a page can read Shift_JIS bytes and cannot produce them. This tool therefore converts legacy encodings to UTF-8 and states that plainly rather than offering a target list it cannot deliver. If you genuinely need legacy bytes out, that is a job for iconv or Python on your own machine, where the full encoding tables are available in both directions.",
    },
    {
      question: "How does it know which encoding my file is in?",
      answer:
        "Mostly it does not, and it says so. Nothing inside a plain text file records its own encoding. Detection runs in order: a byte-order mark is a statement by whoever wrote the file, so it is believed; BOM-less UTF-16 is recognised from its pattern of zero bytes, which has to be checked before UTF-8 because a strict UTF-8 decode accepts those bytes and returns text with a gap between every letter; then the bytes are tested strictly against UTF-8. Anything that fails that test is read as Windows-1252 and labelled a guess, because a Cyrillic, Greek or Turkish file is equally valid non-UTF-8. Reading the preview is the only way to resolve it, which is what the picker is for.",
    },
    {
      question: "What does the UNDECODABLE count actually mean?",
      answer:
        "It counts the U+FFFD replacement characters in the decoded text — one for each byte sequence the decoder could not use. A number above zero on a multi-byte encoding such as UTF-8, Shift_JIS or Big5 means the label is wrong for these bytes, and picking the right encoding takes it to zero. Zero does not prove the opposite, though. A single-byte codepage like Windows-1252 maps all 256 byte values, so no byte in it can ever be invalid: a Russian file read as Windows-1252 scores zero undecodable characters and is still completely wrong on screen. That case is what the preview and the guess warning are for.",
    },
    {
      question: "Should I tick the byte-order mark box?",
      answer:
        "Only for software that asks for it. The download is UTF-8 either way; the mark is three extra bytes at the front that announce the fact. Excel on Windows is the main reason to add one — without it, Excel opens a CSV in the system codepage and mangles every accent, no matter how correct the file is. Most other software ignores the mark, and a few things break on it: it is invalid at the start of a JSON document, it shows up as stray characters in some shell pipelines, and web pages and browsers never need it. When in doubt, leave it off.",
    },
  ],
  "extract-images-from-pdf": [
    {
      question: "Why are the extracted images smaller than they look in the PDF?",
      answer:
        "Because that is the size the document stores them at. A page can render a 900-pixel-wide photo across six inches of paper and it still looks sharp, but the picture inside the file is still 900 pixels wide. Extraction gives you what is actually there rather than what the page appears to show, and there is nothing to turn up: the missing pixels were never in the file.",
    },
    {
      question: "How is this different from PDF to JPG?",
      answer:
        "PDF to JPG renders the page — text, vector artwork and images composited together, at whatever scale you choose — and gives you one image per page. This tool ignores the page entirely and lifts out the image objects the document embeds. If you want a picture of the page, use that tool; if you want the photographs that were put into the document, use this one.",
    },
    {
      question: "Are the images re-compressed on the way out?",
      answer:
        "The JPEGs are not. An image stored in a PDF as JPEG already is a JPEG bitstream, so those bytes are written straight out under a .jpg name — no decode, no re-encode, no colour shift, no second generation of loss. Images held as raw deflated samples have no JPEG bytes to copy, so a PNG is built from the samples instead, which is lossless as well.",
    },
    {
      question: "Which images does it skip, and why?",
      answer:
        "Anything whose samples cannot be written out truthfully. JPEG 2000, CCITT fax, JBIG2, LZW and run-length streams need codecs this page does not carry; an image that is a transparency mask, or that carries one, would come out showing what the mask was hiding; a decode array or a filter predictor changes what the samples mean; and indexed, separation and CMYK colour, or anything that is not eight bits per component, needs handling a guess gets visibly wrong. A JPEG is judged a little more leniently than a rebuilt PNG, because the JPEG file carries its own colour description — an sRGB photo tagged with a one- or three-component ICC profile is fine. Every skip is counted and its reason named on screen, so you always know how many images the document held and how many you got. One thing is not skipped so much as invisible: a small image written straight into a page's content stream rather than stored as its own object is not read at all — in practice those are rules and bullets, not photographs.",
    },
    {
      question: "The same logo appears on every page — do I get forty copies?",
      answer:
        "No, you get one. Images are collected by walking the document's objects rather than its pages, so an image drawn forty times is still a single object and is written out once. That is also why the count on screen is the number of distinct images the file holds, not the number of times something is drawn — and why an image no page draws any more, left behind by an edit or a deleted page, still comes out: it is genuinely still in the document.",
    },
  ],
  "normalize-audio": [
    {
      question: "What is LUFS, and why not just make it louder?",
      answer:
        "LUFS measures average loudness over time, weighted the way hearing is, rather than the tallest sample in the file. Two files can both peak at 0 dBFS and still sound a long way apart. Peak normalisation only guarantees that nothing clips; a LUFS target is what actually makes two tracks sound like they belong together.",
    },
    {
      question: "Does it really run two passes?",
      answer:
        "It does when it can, and it tells you when it did not. The first pass measures the whole file with loudnorm and prints the numbers; the second feeds them back and asks for one linear gain. If that measurement comes back unusable — a digitally silent file reports an infinite loudness, which cannot be fed back — the run falls back to loudnorm's single-pass mode and says so on screen. The pass count is read off the filtergraph that actually executed, and the gain is read off what the second pass reported doing: loudnorm rides the gain instead of applying one whenever a single gain would break the true-peak ceiling, and the page names whichever it did.",
    },
    {
      question: "Which target should I pick?",
      answer:
        "Podcast (−16 LUFS, −1.5 dBTP) is the safe default for anything with a voice in it. Streaming (−14 LUFS, −1 dBTP) is the common music-streaming playback level — a master louder than that gets turned down on the way to the listener rather than played louder. Broadcast (−23 LUFS, −2 dBTP) is the EBU R128 television target; the 7 LU loudness range on that preset is this tool's choice, not part of the standard.",
    },
    {
      question: "Why did my 96 kHz file come out at 48 kHz?",
      answer:
        "Only on MP3 export. Loudnorm negotiates a 192 kHz internal rate, so the output rate is pinned back explicitly — to the source's rate for WAV and FLAC, and for MP3 to one of the nine rates it can actually carry, which tops out at 48 kHz. A rate off that list is rounded up rather than to the nearest, so no part of the band is thrown away. The page says so when it happens. Choose WAV or FLAC to keep the original rate.",
    },
    {
      question: "How long does it take, and what happens to my tags?",
      answer:
        "The measuring pass costs about 22 milliseconds per second of audio, so a five-minute file spends roughly seven seconds being measured before anything is written; the second pass is the usual encode on top of that. Tags and cover art are not carried over — the audio stream is taken out and written on its own.",
    },
  ],
  "change-audio-volume": [
    {
      question: "How many decibels should I use?",
      answer:
        "+6 dB is roughly twice the amplitude and −6 dB roughly half, and the slider runs from −30 to +30 in half-decibel steps. If you want a specific loudness rather than a specific change, use the audio normalizer instead — it measures the file and works out the gain for you.",
    },
    {
      question: "What happens if the gain makes it clip?",
      answer:
        "You are told. Nothing here limits or compresses, so a peak pushed above full scale cannot be stored — the tool measures the peak on the decoded samples before and after the multiply, prints both, and a run that goes over says by how much and how far to come back. It never quietly flattens the peaks and calls that success.",
    },
    {
      question: "Why can't the waveform tell me whether it will clip?",
      answer:
        "Because the waveform is normalised: the loudest bar is scaled to fill the space, so it draws the shape of the file and not its absolute level. Two files with identical pictures can sit 20 dB apart. The clipping answer only appears after a run, because that is the first point at which anything has really measured the file.",
    },
    {
      question: "Does it change anything besides the level?",
      answer:
        "The gain is one multiply per sample and nothing else, and the length never changes. The output format can, though: WAV and FLAC keep the channel count and sample rate exactly, while MP3 carries at most two channels and 48 kHz, so a surround source is summed to stereo and a 96 kHz source is written at 48 kHz. Both are reported on the page when they happen. What does not survive on any arm is tags and cover art: decoding reduces the file to raw samples, where metadata stops existing.",
    },
    {
      question: "Does this download the FFmpeg engine?",
      answer:
        "Only if it has to. MP3 and WAV output run entirely on the Web Audio API and a worker encoder. FLAC output has no encoder in that worker, so that arm renders a lossless WAV and hands it to FFmpeg; so does a container your browser refuses to decode, which means WMA everywhere and AAC or Ogg in some browsers. If neither happens, the engine is never fetched.",
    },
  ],
  "reverse-audio": [
    {
      question: "Does reversing lose any quality?",
      answer:
        "The reverse itself loses nothing: each channel is walked from the last sample to the first into a new buffer of exactly the same shape, so every sample that was in the file is still in the file, and the length comes out identical. Any loss comes from the format you export to, not from the reversal — and that includes shape: WAV and FLAC keep the channel count and sample rate, while MP3 carries at most two channels and 48 kHz, so a surround or hi-res source is folded or resampled and the page says so.",
    },
    {
      question: "Which output format should I pick?",
      answer:
        "FLAC if you want to keep everything — it compresses the reversed samples without discarding any, at roughly half the size of WAV. WAV is uncompressed but written at 16 bits, so a 24-bit source is reduced. MP3 is a fresh lossy encode, which means a lossy source reversed into MP3 has been through two lossy encoders.",
    },
    {
      question: "Can I reverse just part of a file?",
      answer:
        "Not here — this reverses the whole file. Trim the section you want with the audio trimmer first, then reverse the result.",
    },
    {
      question: "Is the video reversed too?",
      answer:
        "There is no video involved. This tool takes audio files and hands back audio files; if you drop a file with a video track it is the audio that is decoded, and nothing writes a picture back out.",
    },
    {
      question: "Why does the waveform not look reversed?",
      answer:
        "Because it is the source's shape, drawn when the file lands. Painting the reversed bars would be a picture of a file that does not exist until the run finishes, and there is nothing to compare it against afterwards, so the canvas shows what you gave it.",
    },
  ],
  "remove-silence": [
    {
      question: "What is the difference between the two modes?",
      answer:
        "Ends only trims the quiet run at the start and the quiet run at the end and leaves everything between them exactly as it was, pauses included — it tidies a recording without changing its pacing. Every gap removes each quiet stretch longer than the minimum gap wherever it falls, which shortens the file and closes the pauses between sentences.",
    },
    {
      question: "What should the threshold be?",
      answer:
        "−50 dB is the default and catches room tone. Moving it nearer zero starts catching quiet speech and breath as well, which also risks cutting into words; moving it further down catches only near-digital silence. If the tool removed something you wanted, lower the threshold before changing anything else.",
    },
    {
      question: "Will it cut in the middle of a word?",
      answer:
        "It can, if the threshold is set high enough that quiet speech reads as silence. That is what the minimum gap is for in Every gap mode: a quiet stretch shorter than it is left alone, and below about a third of a second you are closing the spaces between words rather than between sentences.",
    },
    {
      question: "How exact are the durations it reports?",
      answer:
        "They are FFmpeg's own report of what it read and what it wrote, which carries hundredth-of-a-second resolution — treat them as accurate to about a twentieth of a second rather than to the millisecond. Removed is the difference between the two, and it never goes negative: a file whose header duration is missing reads as zero rather than as a nonsense number.",
    },
    {
      question: "Does it change the sample rate or keep my tags?",
      answer:
        "On WAV and FLAC the sample rate is the source's — silenceremove was measured leaving 44.1 kHz alone, and no resampling is asked for. MP3 cannot go above 48 kHz, so a 96 kHz source is written at 48 kHz by the encoder itself; the page reports the two rates when they differ. Tags and cover art are not carried over, because the metadata is explicitly dropped rather than copied to the new file.",
    },
  ],
  "audio-recorder": [
    {
      question: "Is the recording an MP3?",
      answer:
        "No, and this page will not pretend otherwise. There is no encoder on it at all — what you download is exactly what your browser's MediaRecorder wrote, which in Chrome, Edge and Firefox is normally Opus in a WebM container. The page names the format after the fact rather than promising one in advance. If you need MP3, record here and convert afterwards.",
    },
    {
      question: "Do I need to install anything?",
      answer:
        "No. It uses the browser's built-in getUserMedia and MediaRecorder APIs, so it works in Chrome, Edge, Firefox and other modern browsers with no extension and no account.",
    },
    {
      question: "Why is my microphone list empty or unnamed?",
      answer:
        "Browsers hide the device list until a page has been allowed to use a microphone once. Start a recording, allow access, and the real names appear in the picker. Until then the tool records with the browser's default input, which still works.",
    },
    {
      question: "Is there a time limit?",
      answer:
        "No built-in limit. Length is bounded by your device's memory, since the clip is held in this tab until you download it. Very long takes use a lot of it.",
    },
    {
      question: "Why does my player show no length for the file?",
      answer:
        "The file is written in one-second chunks and carries no duration header, so some players show nothing until they have read the whole thing. The elapsed time on this page is its own clock, not something read out of the file.",
    },
  ],
  "video-to-images": [
    {
      question: "How many frames can one run save?",
      answer:
        "Three hundred. The ceiling is stated before you click as well as after: the page shows how many frames your settings ask for, how many will actually be saved, and where in the clip the run stops. It never quietly hands back a shorter set than you asked for.",
    },
    {
      question: "What is the difference between the two sampling modes?",
      answer:
        "Every N seconds takes the first frame at the very start of the clip and then one at each interval until the end. Fixed count spaces the frames evenly and takes each one from the middle of its slice, so the first picture is a picture rather than the black leader most clips open on.",
    },
    {
      question: "Why did I get fewer distinct pictures than I asked for?",
      answer:
        "Because a video only carries pictures where it carries pictures. Asking for one every half-second from a clip shot at one frame per second cannot invent the ones in between, so several requested moments land inside a picture already saved. Each saved frame is stamped with the time it really came from, and the run reports how many moments collapsed that way.",
    },
    {
      question: "Which image format should I choose?",
      answer:
        "JPEG for a long run — it is small and every browser can write it. PNG is lossless and the largest of the three, and a long PNG run at full resolution is the case most likely to exhaust the tab. WebP is smaller than JPEG at the same setting, and a browser that cannot write it from a canvas falls back to PNG, names the files .png, and says so.",
    },
    {
      question: "Why is the download always a ZIP?",
      answer:
        "Because browsers cancel most of a burst of separate downloads, so a single archive is the only way all the frames arrive. Each file inside is named with its position in the run and the exact moment it came from, so three hundred of them still unzip in order.",
    },
  ],
  "video-thumbnail": [
    {
      question: "Why is the captured time different from the one I asked for?",
      answer:
        "A video carries pictures only at its own frame times. The seek lands the playhead where you asked and the decoder presents the first frame at or after it, so the still can come from slightly later. The result is stamped with the time it really came from and that is the time in the filename — the page prints both numbers rather than only the one you typed.",
    },
    {
      question: "Why can't I capture right at the end of the clip?",
      answer:
        "The frame walk needs a moment after the seek for the decoder to present something, so a request inside the last quarter-second is pulled back. The page warns about that before you click and names the time it will use instead.",
    },
    {
      question: "Can I get a bigger image than the video?",
      answer:
        "No. The width choice never upscales — asking a 640-wide clip for a 1280-wide still gives you 640 — so the picture is always real pixels rather than an interpolated guess. The readouts print the size that was actually written.",
    },
    {
      question: "Which format should I use for a poster frame?",
      answer:
        "JPEG, usually: small and universally supported. PNG is lossless and much larger, worth it when the still is going to be edited rather than posted. WebP is smaller than JPEG at the same setting, with a PNG fallback and a note on screen in browsers that cannot write it from a canvas.",
    },
    {
      question: "Does capturing a frame re-encode my video?",
      answer:
        "No — the video is not written at all. One frame is drawn onto a canvas and encoded as an image, so the picture quality is whatever the source carries at that moment. No conversion engine is downloaded and nothing is uploaded.",
    },
  ],
  "split-video": [
    {
      question: "Are the parts exactly the lengths I asked for?",
      answer:
        "Not quite, and the tool shows you both numbers. A stream copy can only cut at a keyframe, so each boundary moves back to the nearest one and a part starts a little earlier and runs a little longer than requested. Measured on this engine with a 2.09-second clip, a part asked to be 1.000 second came out at 1.022, and one asked to start at 0.5 seconds came out at 1.510 because the seek snapped back to the keyframe at the start.",
    },
    {
      question: "Does splitting lose quality?",
      answer:
        "No. Nothing is decoded and nothing is re-encoded — the compressed picture and sound are copied straight across, so each part holds the same bytes the source did and keeps its original format. That is also why it is fast.",
    },
    {
      question: "How do I choose where the cuts go?",
      answer:
        "Three ways. Equal parts divides the clip into a number of parts of the same length; Every N sec cuts at a fixed length, and whatever is left at the end becomes a final shorter part of its own — a 100-second clip cut every 30 seconds gives 30, 30, 30 and 10 — with only a remainder under 0.05 seconds, too short to write as a playable file, folded into the part before it; At times takes a comma-separated list in seconds (90) or minutes and seconds (1:30), where each time is where one part ends and the next begins, so three times give four parts.",
    },
    {
      question: "Why is the download a ZIP instead of separate files?",
      answer:
        "Browsers cancel most of a burst of separate downloads, so a single archive is the only way every part actually arrives. One run produces at most a hundred parts, because each part is its own pass through the engine.",
    },
    {
      question: "Which column should I trust for a part's length?",
      answer:
        "The ACTUAL one. It is read back off each finished file rather than copied from the request, so it describes what you are about to download. The ASKED column is there to show you how far the keyframe moved the boundary.",
    },
  ],
  "merge-video": [
    {
      question: "Why won't it join my clips?",
      answer:
        "Because they differ in something a lossless join cannot bridge, and the table names the file and the property. Clips have to share a video codec, frame size, pixel format and audio codec, sample rate and channel count — or all be silent — as well as a container and the timing base that container counts in. Nothing here re-encodes to make them match.",
    },
    {
      question: "Two files are both H.264 MP4-style video. Why does the container matter?",
      answer:
        "Because it was measured to matter. An MP4 and an MKV holding identical H.264 video at the same size and pixel format with identical AAC audio were joined on this build and produced exit code zero and a file containing only the first clip. Nothing differed except the container and the timing base it counts in — 1/57600 against 1/1000 — so both are checked too.",
    },
    {
      question: "What happens if I join clips that do not match anyway?",
      answer:
        "You cannot, and that is deliberate. FFmpeg's concat demuxer, handed mismatched clips, reports success and writes a file with clips missing rather than failing. Two guards stop that reaching you: every clip is compared as it lands, and the join itself measures the finished file against the total length of its parts and fails if it comes up short or runs long.",
    },
    {
      question: "How do I make mismatched clips joinable?",
      answer:
        "A clip in the wrong container or codec can usually be rewrapped losslessly by the Video to MP4 tool, but the rewrap writes its own timing base — measured here, an MKV rewrapped to MP4 came out counting in 1/16000 against an untouched MP4's 1/57600 — so the pair can come back refused on that row instead. Clips exported by the same camera, app or settings are the ones that join for nothing. A clip at a different frame size has to be re-encoded to match the others, which nothing here does in one step — that one needs an editor.",
    },
    {
      question: "Does joining re-encode or lose quality?",
      answer:
        "Never. The clips are copied into one file exactly as they are, which is why it is near-instant on clips an editor would spend minutes re-rendering. Use the arrows on each row to set the order — they join end to end, top to bottom.",
    },
  ],
  "webcam-recorder": [
    {
      question: "Do I need an extension or an account?",
      answer:
        "Neither. It uses the browser's built-in getUserMedia and MediaRecorder APIs, so it works in Chrome, Edge, Firefox and other modern browsers with nothing installed.",
    },
    {
      question: "What format is the recording?",
      answer:
        "Whatever your browser's recorder wrote — normally VP9 or VP8 video with Opus audio in a WebM container, and MP4 in a browser that supports none of the WebM forms. The page names the format after the fact rather than promising one, and the file extension follows the container. Use the WebM to MP4 tool if you need MP4 specifically.",
    },
    {
      question: "Can I record without the microphone?",
      answer:
        "Yes — untick Include microphone audio before you start. The camera and microphone are asked for in the same call, so turning it off means the browser never requests the microphone at all.",
    },
    {
      question: "What does the Front and Rear choice do?",
      answer:
        "On a phone it picks between the front and rear camera. Most desktop webcams report no facing at all, so it changes nothing there, and it is ignored entirely once you name a specific camera in the picker above it.",
    },
    {
      question: "Why is my camera list empty or unnamed?",
      answer:
        "Browsers hide camera names until a page has been allowed to use one. Start a recording, allow access, and the real names appear in the picker. Until then the tool records with the browser's default camera, which still works.",
    },
  ],
  "extract-archive": [
    {
      question: "Can this page make a ZIP as well as open one?",
      answer:
        "No, and the reason is worth knowing because it is stronger than a promise. This page runs a WebAssembly build of libarchive that contains sixteen archive_read_support_format_* entry points — ZIP, TAR, 7-Zip, RAR, RAR5, CPIO, AR, CAB, LHA, ISO9660, XAR, WARC, mtree and the rest — and zero archive_write_set_format_* ones. There is no writer in the binary to call, so no future change to this page could quietly start creating archives. Packing files into a ZIP is what Create ZIP does, on a different library entirely.",
    },
    {
      question: "My .gz file opened as one file, not a folder of files.",
      answer:
        "Then it was a single compressed file rather than a compressed archive, and the page said which it found. A .tar.gz is a tar — a real archive with many members — wrapped in gzip, and libarchive reads it. A bare .gz, like access.log.gz, holds one file and nothing else; libarchive is not built with its raw reader, so it cannot open that at all. The browser's own gzip decoder does it instead, which is why the list has exactly one row and the size shown is the one the file records in its last four bytes. There is no browser-native xz or bzip2 decoder, so a bare .xz or .bz2 — as opposed to a .tar.xz or .tar.bz2 — is refused with that explanation rather than opened wrongly.",
    },
    {
      question: "One of the entries says REFUSED. What did my archive do?",
      answer:
        "It stored a path that points outside the folder you would unpack into — something beginning with ../, an absolute path like /etc/passwd, or a Windows drive or network path. That is the zip-slip pattern, and an archive built by an ordinary tool does not contain one. Nothing here could write to those locations even if it tried: a browser download goes to your downloads folder and nowhere else. The reason it is shown rather than quietly cleaned up is that the same archive unpacked by tar or unzip on a shell CAN write there, and you should know the file tried before you take it anywhere else. Refused entries are listed with their real stored path and cannot be ticked.",
    },
    {
      question: "Should I use this or Unzip Files?",
      answer:
        "Use Unzip Files for an ordinary .zip. It runs on JSZip, which is already part of this site's JavaScript, so it fetches no engine and starts instantly. Come here when the file is not a plain ZIP — a .tar, .7z, .rar, or a tar.gz, tar.xz or tar.bz2 — or when the ZIP's entries are password-protected, which JSZip cannot decrypt at all. The cost of that reach is one 599 KB WebAssembly download the first time something on this page needs the engine, cached by your browser afterwards — a bare .gz never does, because the browser's own gzip decoder reads that one and the engine is not fetched at all. Both read the archive in your tab and neither uploads anything.",
    },
    {
      question: "The archive is password-protected. Will this open it?",
      answer:
        "Often, yes. Type the password into ARCHIVE PASSWORD in the rail before extracting; it is handed to the engine running beside this page and is not stored, remembered or sent anywhere. libarchive opens ZipCrypto and AES-encrypted ZIP entries given the right password, and it reports a wrong one as a wrong password rather than handing back garbage. What it will not do is decrypt RAR: this build says so itself, and rather than guess, the page shows you the engine's own refusal for any member it cannot read, naming the entry. Some archives also encrypt their file list, in which case nothing appears until you supply the password and press \"Read this archive again\".",
    },
  ],
  "create-zip": [
    {
      question: "My ZIP came out the same size as the files I put in.",
      answer:
        "Then those files were already compressed, and that is the expected result rather than a fault. DEFLATE, the compression a ZIP uses, works by finding repetition and replacing it with references — and a JPEG, an MP4, an MP3, a PDF full of images or another ZIP has already had its repetition taken out by its own format. There is nothing left to find, so the packed size matches the original and the container's headers add a little on top. The page reports the real figure either way, including a negative saving. If the batch is all media, choose Store: it copies the files in without spending the time.",
    },
    {
      question: "Can I zip a whole folder?",
      answer:
        "Not from a browser, and this page says so rather than half-doing it. A web page is handed a flat list of files with no paths attached — the folder each one came from is simply not part of what the browser passes on. Worse, a folder dragged onto the drop zone arrives as an object that looks like a file and then refuses to be read. Anything this page cannot read back from disk is dropped from the list and named on screen, rather than becoming an empty entry in your archive. Open the folder and select the files inside it, and they will all go in at the top level.",
    },
    {
      question: "Does the ZIP keep modified dates and permissions?",
      answer:
        "Dates yes, permissions no. A ZIP stores an MS-DOS timestamp whose seconds field counts in twos, so a file saved at 14:35:23 reads back 14:35:22 — that is the format's resolution and no setting improves it. The timestamp carries no timezone either, so it is written as the clock reading on your machine, which is what Finder, Explorer and unzip all expect to find. The format can only express 1980 to 2107, so anything outside that window is clamped to whichever end it fell past — 1 January 1980 or 31 December 2107 — and counted on screen by direction, because the alternative is a silent wrap that turns a 1970 date into 2098. Permissions are a different matter: a browser hands a page a name, a size, a type and a date, and no mode bits at all, so an executable script comes out of this archive without its executable bit.",
    },
    {
      question: "Can I put a password on the ZIP?",
      answer:
        "No, and that is deliberate rather than unfinished. The encryption built into the original ZIP format, usually called ZipCrypto, was broken in 1994 and is recoverable given a small piece of known plaintext from any one file inside the archive, so offering it would be offering something that looks like protection and is not. The stronger AES scheme that modern archivers use is a WinZip extension the library here neither writes nor reads. If you need a protected archive, make it with 7-Zip, Keka or the archiver built into your system and choose AES-256. For sending a file rather than storing one, an encrypted transfer usually beats an encrypted container.",
    },
    {
      question: "Which compression level should I choose?",
      answer:
        "Normal, almost always — it is level 6, which is what the zip command and every desktop archiver default to. Measured here over 5.8 MB of source code, Normal brought the data down to 26% of its original size and Maximum reached 25.8%: six tenths of one percent, for about two and a half times the work. Fast ran in roughly half Normal's time for a result about a quarter larger, which earns its place on a very large batch. Store skips compression altogether and copies the files in, which is the honest choice for photos or video, where none of the levels finds anything. Whichever you pick, the page reports what it actually achieved.",
    },
  ],
  "unzip-files": [
    {
      question: "It says my archive is password-protected and will not open anything at all.",
      answer:
        "That is accurate, and the second half is the part worth explaining. This page has no decryption in it, and the reader it uses refuses an archive outright the moment it meets an encrypted entry while walking the index — before a single byte is extracted. So one protected file blocks every unprotected file beside it, and there is no partial extraction to offer. The listing still works, because the archive's index is read separately and is never encrypted, which is why the page can name exactly which entries are protected. To open it, use 7-Zip, Keka or the unzip command, where you can supply the password.",
    },
    {
      question: "Why is one of the files marked REFUSED?",
      answer:
        "Because its stored path tries to leave the folder you would extract into — it begins with ../, or with a slash, or with a drive letter. That is the shape of a zip-slip attack: an archive that writes a file over something elsewhere on your disk when a careless extractor follows the path it was given. What makes it worth flagging is that the usual behaviour is not a refusal but a quiet repair — the library underneath this page rewrites ../../etc/passwd to etc/passwd and extracts it under that name without a word. Here the entry is refused, named on screen, and left out. Everything else in the archive is unaffected.",
    },
    {
      question: "Why did my two files come down as another ZIP?",
      answer:
        "Because a browser cancels most of a burst of downloads fired at once, so handing you six separate files would reliably give you one or two. Selecting a single entry saves that file directly under its own name. Selecting more repacks them into one archive that keeps their folder paths, which you then unpack with whatever you normally use. It is worth being clear that this is a repack rather than a folder appearing on your disk: a web page cannot write a directory tree, and any tool that claims to unzip straight into your file system is either an extension or an application, not a page.",
    },
    {
      question: "The file names have strange characters in them.",
      answer:
        "Old archives store names in CP437, the original IBM PC character set, and only set a flag saying \"this name is UTF-8\" if the writer bothered. This reader decodes names as UTF-8 either way, matching the library it extracts with, so a name written on a Windows machine in the 1990s can come out wrong. The page counts those entries and warns you rather than letting you assume the file is damaged. Only the names are affected — the contents are read byte for byte and are exactly what the archive holds. Rename the file after saving it, or unpack the archive with a tool that lets you name the codepage.",
    },
    {
      question: "It says the archive uses a compression it cannot read.",
      answer:
        "A ZIP can hold entries compressed in several ways, and the reader here inflates the two that account for practically every archive in the wild: Store, which is no compression, and DEFLATE. Entries written with bzip2, LZMA, zstd or the old implode method cannot be inflated, and — as with encryption — the reader refuses the whole archive rather than skipping them, so one such entry blocks the rest. The listing still names them and shows which method each uses, because that comes out of the index. 7-Zip and the unzip command read all of these, and re-saving the archive from either one produces a file this page can open.",
    },
  ],
  "docx-to-markdown": [
    {
      question: "My headings all came through as ordinary paragraphs.",
      answer:
        "In Word a heading is a style, not a size. The reader maps Word's built-in Heading 1 to Heading 6 styles onto # through ######, and a paragraph that is merely bold 18pt Calibri is, structurally, body text — there is nothing in the file to say otherwise, and guessing from font size would invent headings in documents that have none. The fix is in Word: put the cursor in the line, pick Heading 1 from the Styles gallery, and convert again. The HEADINGS count above the preview tells you how many the file really had before you download anything. If it reads 0 on a document full of titles, that is the reason.",
    },
    {
      question: "Where did my pictures go?",
      answer:
        "Nowhere you did not send them. IMAGES has three settings. Link, the default, writes each picture into a media/ folder and points the Markdown at it, so the download becomes a ZIP — keep that folder beside the .md or the links break. Embed writes each picture into the .md itself as a base64 data URI: one self-contained file, at four characters of text for every three bytes of picture. Drop removes them and reports the count. A picture used only in a page header, a footer or a list bullet appears under none of the three, because only the document body is read; the panel says how many of those there are. One more kind goes missing under all three: a picture inserted with Link to File rather than Insert > Picture is not inside the .docx at all — it is a path to your disk, which a browser cannot follow — so it reaches neither the Markdown nor the download. The page counts those separately and says so rather than promising a media/ folder it could not write.",
    },
    {
      question: "It says my file is an OLE compound document, and it is definitely a Word file.",
      answer:
        "It is a Word file — just not a .docx. Two different things arrive under that extension and both begin with the same eight bytes, D0 CF 11 E0 A1 B1 1A E1: a Word 97–2003 .doc, which is an entirely different binary format, and a .docx with a password on it, because encrypting an Office file wraps the whole ZIP inside an OLE container. Neither can be unzipped, so neither can be read here, and the page says which one it saw rather than reporting a broken ZIP. Open it in Word or LibreOffice, remove the password if there is one, and save it again as .docx.",
    },
    {
      question: "A merged cell knocked my table out of line.",
      answer:
        "A Markdown pipe table has no merged cells at all, so the two kinds of merge are handled differently and both are counted. A cell spanning columns keeps its text in the first of them and leaves the rest empty, which keeps every later column under the right heading. A cell spanning rows cannot be faked that way — the rows beneath it are short, and every value in them would slide one column to the left — so a table containing one is written out as its original HTML instead, which most Markdown renderers display and a plain-text reader shows as tags. Set TABLES to Keep HTML to get that for every table.",
    },
    {
      question: "Are the comments and tracked changes in the Markdown?",
      answer:
        "No comments, and tracked changes only in their accepted form. Comments live in word/comments.xml; this page opens that part purely to count them, and none of their text reaches the output — the commented sentence comes through, the comment on it does not. Tracked changes are the more dangerous half: inserted text is kept, deleted text is gone, and nothing marks which was which, so the Markdown reads as though every change had been accepted. The panel counts insertions and deletions separately, so a contract or a redline tells you before you rely on it. If that distinction matters, accept or reject the changes in Word first.",
    },
  ],
  "svg-optimizer": [
    {
      question: "The icon still looks right, but the hover colour and the animation stopped working.",
      answer:
        "Three of SVGO's default passes will do that, and the page names whichever one fired on your file. Inlining the stylesheet writes each rule onto the element it matched and removes the class it matched on, after which a :hover, :focus or @media rule has nothing left to attach to and is dropped as unused. Collapsing groups dissolves a <g>, so a transform or SMIL animation written against that group loses its element. And the id pass renames or deletes ids, which breaks a CSS or JavaScript hook that pointed at one. Untick those three, or start from the Safe preset, which has all seven risky passes off.",
    },
    {
      question: "Does this strip the viewBox out of my file?",
      answer:
        "No, and it has not been true of SVGO for several major versions. removeViewBox is not in SVGO 4's default preset — the unit tests behind this page assert that against the shipped plugin list, so if it ever came back the assertion goes red before the page does. removeDimensions is not a default either. This page offers dropping the root width and height as an explicit checkbox, off unless you tick it, and when you do it writes a viewBox from the old width and height first if the file did not already have one, so the aspect ratio survives — but only where both are plain numbers. A root sized in mm, in, pt, em or % is left exactly as it is, because building a viewBox from it would mean guessing at a scale; the page says so above the panes rather than letting you ship a file you believe was made responsive. The viewBox is never removed here at all.",
    },
    {
      question: "SVGO says it saved 60%, but my gzipped bundle barely moved.",
      answer:
        "Both numbers are real, and neither predicts the other. The figures here are UTF-8 bytes on disk; your server almost certainly compresses the file again on the way out. Which of the two savings is larger depends on what came out. Cutting repetitive boilerplate — namespaces, repeated attribute names, whitespace — barely moves the gzip number, because gzip was already collapsing it: this site's own 438-byte icon saves 26% raw and 19% gzipped. Cutting high-entropy content such as long unique decimal coordinates moves it more, and a 471 KB path drawing saved 50% raw against 73% gzipped. Measure the figure that matches how you ship the file.",
    },
    {
      question: "A client sent me an SVG and I want to know whether it can run code.",
      answer:
        "It can, and this page tells you so rather than quietly deciding for you. Removing scripts is not part of SVGO's default set, so a <script> element and any onclick or onload attributes come through the optimiser untouched — the warning above the panes counts them and says they are still in the output. Whether that matters depends on how the file is used: browsers do not run script in an SVG loaded through an <img> tag or as a CSS background, and they do when the same file is pasted inline or opened as a document. Tick SCRIPTS AND HANDLERS, under ALSO REMOVE, and the page strips both, reporting how many of each it took out.",
    },
    {
      question: "My file came out bigger than it went in.",
      answer:
        "Then the page says so, in bytes, and tells you to keep the original. There are two usual causes. If the file declared XML entities in its DOCTYPE, every use is expanded in place while the declaration is dropped, so text written once and referenced ten times is written out ten times — a test fixture of that shape comes back at more than twice its original size. The other cause is a file that has already been through an optimiser, where there is nothing left to take out and the byte counts come back equal. Neither is a failure of the run; both are answers, and the page prints them rather than rounding a loss up into a saving.",
    },
  ],
  "barcode-generator": [
    {
      question: "The barcode I made scans as a different number from the one I typed.",
      answer:
        "That is usually the symbology doing its job rather than a fault. Three of them change the number on purpose. Give EAN-13 twelve digits and it computes the thirteenth, the check digit, and that is what a scanner reports. A UPC-A is the subset of EAN-13 whose first digit is zero, so readers disagree about it: a till scanner usually sends the twelve digits printed under the bars, while a software reader hands back thirteen with a leading zero attached — this site's own included, which is why the page prints both. And UPC-E is not a short barcode at all but a shorthand: the last digit before the check digit selects one of five rules for putting a run of zeroes back, so the seven digits 0123456 scan as the twelve-digit UPC-A 012345000065. The page works all of this out as you type and prints the decoded value on screen — both of them, for a UPC — so you find out here rather than on a pallet.",
    },
    {
      question: "Why does it refuse my EAN-13 when I copied the number off the packet?",
      answer:
        "Because one digit is wrong somewhere and the check digit proves it. The last digit of an EAN, UPC or ITF-14 number is not data — it is a weighted sum of the digits before it, designed so that a single mistyped or transposed digit fails the sum. When the number you paste does not check out, the tool says which digit it should have been instead of drawing a barcode for a product that does not exist. If you only have the first twelve digits, paste those: give it twelve and the thirteenth is computed for you and shown before you generate. The commonest cause is a digit dropped from a long number.",
    },
    {
      question: "Can I put an accent or an emoji into a Code 128?",
      answer:
        "No, and this page refuses rather than drawing one that scans wrong. Code 128 and Code 39 carry bytes, not characters, and the alphabet they are defined over stops at ASCII. A generator handed “héllo” writes the UTF-8 bytes for it; a scanner following the specification reads those bytes back as Latin-1 and reports “hÃ©llo”. That was measured by decoding this tool's own output with an independent reader; an emoji came back as a single stray byte. The result is not a corrupt barcode, which would at least be obvious — it is a good barcode for the wrong string. QR Code, Data Matrix, PDF417 and Aztec declare their encoding inside the symbol and carry Japanese, Greek and emoji back intact.",
    },
    {
      question: "Which symbology should I pick?",
      answer:
        "If you are labelling something for retail sale, the number decides for you: a thirteen-digit article number is EAN-13, a twelve-digit one is UPC-A, and the fourteen-digit number on an outer case is ITF-14. If you are labelling something for yourself — assets, shelves, work orders — Code 128 is the default: it takes any printable ASCII, up to the encoder's own ceiling of 500 characters, and packs it more tightly than Code 39, which is older, limited to capitals and six symbols, and measurably wider for the same data — 1.3 times for PART-1024 and 2.1 times for a ten-digit number, because Code 128 folds pairs of digits into one symbol and Code 39 cannot. For anything longer, use a matrix symbology: QR Code where a phone camera will read it, Data Matrix where the label is tiny, PDF417 for the wide stacked codes on licences and boarding passes, and Aztec for tickets.",
    },
    {
      question: "The code looks fine on screen but the printed one will not scan.",
      answer:
        "Four things account for nearly all of it. The quiet zone: the blank margin either side is part of the symbol, and cropping a barcode flush to its bars is the commonest cause of a dead label. This page draws the margin the spec asks for — ten narrow bars either side of a linear code, four modules around a matrix one — so keep it. Contrast: most scanners read reflected red light, so red bars on white are invisible to them — the page warns about that pair, and refuses one that grades F for symbol contrast outright, though it can only judge the two colours, not your printer. Resolution: raise the scale, or use the SVG, which is vector and stays sharp at any size while the PNG is fixed at the pixel size shown. And height: a short linear code has to be swept straight, so raise the bar height if the scan is taken by hand.",
    },
  ],
  "qr-code-reader": [
    {
      question: "The code in my photo will not read.",
      answer:
        "Work down the causes, taking the ones the page named for your own image first. If you dropped an animated GIF or WebP, only its first frame was scanned — the browser hands back an animation's default image, so a code that appears later in the loop is simply not in the pixels that were searched, and no amount of denoising will find it; save the frame the code is on and scan that. If the code is a striped retail barcode rather than a square, switch SCAN FOR to Every format — the default searches only for QR, Micro QR and rMQR. If the photo is blurred or badly lit, turn on the extra denoising pass under IF IT WILL NOT READ. If the code runs to the edge of the frame with no white margin, no reader will get it: the quiet zone is part of the specification, not a courtesy. And if the picture is enormous, crop it down to the code — an image bigger than a browser canvas is guaranteed to hold is scaled before scanning, which the page reports, with the numbers.",
    },
    {
      question: "Is it safe to scan a QR code from a poster or a letter I did not expect?",
      answer:
        "Scanning it here is safe; acting on it may not be. A square looks identical whatever is inside it, which is the mechanism behind stickers pasted over parking-meter codes and fake payment slips. So this page decodes and stops: the payload is printed as text, nothing is clickable, and the host name is pulled into its own row so you can read it without picking a URL apart. Three tricks are named where they occur — a username in front of the host, so paypal.com@evil.example reads as PayPal and goes elsewhere; a punycode host, where Cyrillic and Latin letters draw the same; and zero-width or right-to-left characters, which change what a string looks like without changing what it is.",
    },
    {
      question: "Can it read ordinary barcodes, not just QR codes?",
      answer:
        "Yes — set SCAN FOR to Every format. That adds Data Matrix, Aztec, PDF417, MaxiCode, Codabar, Code 39, Code 93, Code 128, ITF, DataBar and the EAN/UPC retail family. It is not the default because it costs real time: several of those symbologies are searched line by line across the whole image, and on a 12-megapixel photo the full set took 2.9 seconds against 0.19 seconds for QR alone in our own measurements. Every run prints the time it actually took, so you never have to take that on trust. If you only ever wanted a QR code, the default is fifteen times faster and finds exactly the same square.",
    },
    {
      question: "There are several codes in one picture — do I have to crop them apart?",
      answer:
        "No. The symbol limit is turned off, so every code in the image is decoded and each one gets its own block with its own format, its own payload and its own copy button. The header says how many were found, which matters because a photo of a page of tickets should produce a number you can check. If the codes turn out to be parts of one payload split across several symbols — structured append, which is what an encoder does when the data will not fit in one square — the page says so and names the parts that are missing, rather than showing you a fragment as though it were the whole thing.",
    },
    {
      question: "Why does the first scan fetch about a megabyte?",
      answer:
        "That is zxing-cpp, the barcode engine, compiled to WebAssembly: 1,093,289 bytes, fetched once and then cached by the browser. It is served from this site. The npm package it comes from defaults to pulling that file from a public CDN, which would have handed a third party your IP address every time you opened the page — so the loader passes the bytes in directly and overrides the path, and a unit test fails the build if a foreign origin ever appears in that file again. The alternative was the browser's own BarcodeDetector, which costs no download and exists only in Chrome; a page built on it would work for some visitors and silently find nothing for the rest.",
    },
  ],
  "watermark-pdf": [
    {
      question: "Can the watermark be removed from the file I download?",
      answer:
        "Not by anything on this site, and not by re-saving the PDF. The mark is written into the page's own drawing instructions — the same place its text and pictures live — so it prints, copies and converts along with them. That is not the same as protection. The page underneath is untouched, its text stays selectable, and anyone with a real PDF editor can open the page content and take the mark out. Treat a watermark as a label on a document, not a lock on one.",
    },
    {
      question: "Why can't I use Chinese, Cyrillic or emoji in the watermark text?",
      answer:
        "Because a text mark is drawn with one of the PDF standard fonts, and those only carry the WinAnsi character set. That is more than it sounds — every Latin letter, digit and piece of punctuation, plus accented letters, curly quotes, em dashes and the euro sign — but Chinese, Japanese, Korean, Cyrillic, Greek, Arabic and emoji have no glyph to draw at all. Rather than let the run fail at the end, the tool checks what you type and names the exact characters it cannot draw. The way round it is an image mark: set the words in a program that has the font, export a PNG with a transparent background, and place that instead.",
    },
    {
      question: "What does “place under the page content” actually do?",
      answer:
        "It draws the mark before everything your page already draws, so your body text and pictures land on top of it rather than the other way round — the look most people mean by a watermark. On a page with a solid white background that will hide the mark wherever the two overlap, and on a mostly empty page it looks much the same as drawing on top. The preview cannot show the difference, because the page behind it is one flat picture with nothing to slide underneath, so open the download to check.",
    },
    {
      question: "My logo is a photo from a phone and it lands sideways. What is going on?",
      answer:
        "A phone JPEG usually stores its pixels one way up and records a rotation tag telling viewers to turn them. PDFs ignore that tag completely: inside a PDF an image is simply its stored grid of samples, and where it sits is decided by the page, not by anything in the picture. So this tool clears the tag before anything decodes the file, which makes the preview and the download agree — what you see placed on the page is exactly what gets embedded. If that is the wrong way up, open the picture in any editor, save it with the rotation actually applied, and drop it in again.",
    },
    {
      question: "Is the watermark text still searchable in the result?",
      answer:
        "Yes. A text mark is real text rather than a picture of text, so a reader can select it, search for it and copy it, and PDF to Text on this site lists it alongside the page's own words. That is usually what you want — a document you can find by searching for “CONFIDENTIAL”. If you would rather it were not selectable, use an image mark instead: an embedded PNG or JPEG carries no text at all.",
    },
  ],
  "sign-pdf": [
    {
      question: "Is this the same as a digital signature?",
      answer:
        "No, and the difference matters. This page draws a picture of your signature into the page, the way a rubber stamp does. No certificate is involved, nothing is cryptographically signed, and the file comes back with no signature field in it — open the result in Acrobat or Preview and it will report no signatures at all. That means it cannot prove who signed, and it cannot show whether the document was altered afterwards. If you have been asked for a certificate-based signature, this is not the tool for it, and this page makes no claim about whether a drawn mark is enough for your document.",
    },
    {
      question: "Can I sign without a mouse or a touchscreen?",
      answer:
        "Yes, by placing an image instead of drawing one. The pad needs a pointer — there is no way to draw a signature from a keyboard, and the pad says so in its own label. Switch the signature source to the upload option, choose a PNG or JPEG of your signature, and set the position with the three percentage fields, which are ordinary number inputs you can tab into and type in. Dragging on the page and typing in those fields write the same three numbers through the same clamp, so the picture and the fields can never disagree.",
    },
    {
      question: "Why does my uploaded signature have a white box around it?",
      answer:
        "Because it is a JPEG. JPEG has no transparency, so the whole rectangle is drawn — background included — and it covers whatever was under it on the page. Save or export your signature as a PNG with a transparent background instead: a PDF carries a PNG’s transparency through as a soft mask, so only the ink shows. A signature drawn on the pad here is already exported as a transparent PNG, trimmed to the ink.",
    },
    {
      question: "Can someone delete the signature from the PDF afterwards?",
      answer:
        "Not by clicking on it. The image is drawn into the page’s own content rather than attached as an annotation object, so there is nothing for a reader to select and remove. That is not tamper-proofing and should not be read as any: anyone with a PDF editor can still alter the page, and nothing in the file would record that it happened. A drawn signature is a mark on a page, not a seal on an envelope.",
    },
    {
      question: "Can I type my name in a handwriting font instead of drawing it?",
      answer:
        "No. The only fonts a PDF viewer is guaranteed to have are Helvetica, Times, Courier and two symbol faces — none of them a handwriting face — and this page embeds no font of its own, so a typed name would come out looking like ordinary body text rather than a signature. Draw it on the pad, or photograph or scan a signature on paper and place that PNG instead.",
    },
  ],
  "add-image-to-pdf": [
    {
      question: "Which image formats can I place?",
      answer:
        "PNG and JPEG. Those are the two formats a PDF can carry directly, so their bytes go into the document as they are, with no conversion step in between. The file's own bytes decide, not its name — a WebP or a HEIC saved as photo.png is refused with a plain sentence rather than a parser error. Convert it to PNG or JPEG first and it places fine.",
    },
    {
      question: "Can the image still be moved or deleted in a PDF reader afterwards?",
      answer:
        "No. It is drawn into the page's content stream, in the same layer as the text and pictures already there, so it is part of the page rather than an object sitting on top of it. Nobody can click it in a reader and drag or delete it — and neither can you. Keep the original PDF if you might want the page back without the image; this tool never changes the file you dropped.",
    },
    {
      question: "Will a photo from my phone come out sideways?",
      answer:
        "No, but the fix has a cost worth knowing about. Phone cameras record which way up a photo is in an EXIF Orientation tag, and PDF readers ignore that tag entirely — so an image carrying one would be embedded on its side and at the wrong aspect ratio. When the tag is anything other than 1, the picture is redrawn upright before it is embedded. For a JPEG that is one re-encode at quality 92%, and it drops the EXIF block, GPS position included. The canvas tells you when this happened. An image with no tag, or a tag of 1, goes in untouched.",
    },
    {
      question: "Does a transparent PNG stay transparent?",
      answer:
        "Yes. A PNG with an alpha channel is embedded with a soft mask, so a logo with a transparent background sits over the page instead of on a white box. That is separate from the Opacity slider, which thins the whole image so the page shows through the picture itself as well.",
    },
    {
      question: "Can I put the image behind the text instead of over it?",
      answer:
        "Yes — set LAYER to Under content and the image is drawn before the page's own content, so text and pictures on the page cover it. One caveat: if the page already paints a filled background, that background is part of its content and will hide the image completely. Over content is the default, and is always visible.",
    },
  ],
  "annotate-pdf": [
    {
      question: "Does this highlight text, or just draw a rectangle over it?",
      answer:
        "It draws a rectangle. There is no text layer under the preview and the engine has no model of where the words sit on the page, so a highlight is a translucent block you position over a line by eye. It cannot find a sentence, follow it across a line break, or stop neatly at the end of a word — you say where it goes, and it goes exactly there.",
    },
    {
      question: "Can a reader delete these marks, or reply to them?",
      answer:
        "No. The marks are drawn into the page's own content rather than added as PDF annotation objects, so a reader shows no comment to click, no author, no reply and no Delete. In normal use they are permanent: taking one out again means editing the page content itself. If you need marks a colleague can answer or tick off, use a reader that writes real annotations.",
    },
    {
      question: "Do marks land correctly on a page the file stores rotated?",
      answer:
        "Yes, and it is worth saying because it was briefly not true. A PDF page can carry its own rotation of 90, 180 or 270 degrees, and the engine used to shift a rectangle down along the unrotated axis — which only means \"down the page\" when the rotation is zero. A mark could land a full mark-height away, twice that at 180 degrees, and sideways as well on a quarter turn. The correction now follows the page as a reader sees it, and a test places a mark at the same spot on all four rotations and fails if any of them drifts. Notes were never affected: text is drawn about its own origin with no correction to get wrong.",
    },
    {
      question: "Can a note be written in Chinese, Russian or emoji?",
      answer:
        "No. Notes are drawn with the standard PDF fonts, which only encode the Windows-1252 set: Latin letters, digits and punctuation, plus accented letters, curly quotes, the euro sign and similar. Chinese, Japanese, Cyrillic, Greek, Arabic and emoji cannot be drawn, and neither can a few Central and Eastern European letters such as ł, ș and ő. The page checks as you type and names the characters, so you find out before you press the button rather than after.",
    },
    {
      question: "Can I mark more than one page in a single pass?",
      answer:
        "Not in this version. Every mark lands on the page shown in the preview, and switching pages carries the marks with you rather than leaving them behind. To mark a second page, download the result and drop that file back in — by then the first page's marks are part of the page, so nothing is lost.",
    },
  ],
  "fill-pdf-form": [
    {
      question: "Why does this say my PDF has no form fields?",
      answer:
        "Because it hasn't got any. A PDF form is a list of named fields stored inside the file, and plenty of documents that look exactly like forms are only lines and boxes drawn on the page — a scan of a paper form is the usual case. There is nothing there for any filler to write into. This tool will not add a form dictionary to a document that arrived without one, so your file comes back untouched rather than quietly restructured. If you need writing on that kind of page, what you want is a tool that draws text onto the page, not a form filler.",
    },
    {
      question: "What does flattening actually do to the form?",
      answer:
        "It bakes each field's appearance into the page and then deletes the field. The answers stop being editable and stop being form data — the download has no fields left, so nobody can change an answer in a reader and nobody can fill it in again. The text stays real text rather than becoming a picture: on a flattened output the value is drawn with an ordinary text operator and there is no image anywhere in the file, so it still selects, copies and searches. Flattening is not compression — the appearances move into the page rather than going away — and it cannot be undone from the download, so keep the filled, unflattened copy if an answer might change.",
    },
    {
      question: "Can I type Japanese, Chinese, Cyrillic or emoji into a field?",
      answer:
        "No, and the page stops you rather than letting the run fail. Form text here is drawn with one of the standard PDF fonts, which can only encode the WinAnsi character set: the Latin alphabet, accented letters, curly quotes, dashes, the euro sign and a handful of typographic marks. Anything outside that makes the library throw while it is saving, with the values already written into the document — so the check happens before the button rather than after it. Answering in those scripts properly needs an embedded Unicode font, which is a font file this site does not ship.",
    },
    {
      question: "Why can't I edit some of the fields?",
      answer:
        "Several reasons, and each row says which one applies. A field the document marks read-only is shown with its stored value and locked — worth knowing that the library underneath would overwrite one without complaining, so that lock is this page's doing rather than the format's. A push button holds no value at all. A signature field is not something this tool writes into. A field whose type could not be read from the document's own /FT entry gets no control, because guessing would be worse than saying so. And where two fields share a name, only the first can be written, so the second is locked.",
    },
    {
      question: "Does this sign a PDF?",
      answer:
        "No. It fills form fields; it places no signature of any kind, digital or drawn. A signature field in your document is listed so you can see it is there, and nothing is written into it. A signature field is also one of the things that can block flattening: the library never regenerates an appearance for one, so if it arrived without a stored appearance there is nothing for the flatten to bake, and the page turns that option off and names the field instead of failing halfway through.",
    },
  ],
  "flatten-pdf": [
    {
      question: "What does flattening a PDF form actually change?",
      answer:
        "Two things at once. The picture of the value — the typed text, the tick, the chosen option — is copied out of the field and drawn onto the page as page content, and then the field object itself is removed from the document. Open the result and there is no box to click into: the answers read as part of the paperwork. Because the drawing that already existed is re-used rather than re-rendered, typed text is still selectable, searchable text afterwards and not a flattened image.",
    },
    {
      question: "Why does it refuse to flatten some forms?",
      answer:
        "Because a field with no stored appearance would come out blank, and there is no honest way to invent one. Baking happens one field at a time with each one removed as it goes, so a failure half-way through leaves a file that will not even save — the check therefore runs before anything is written, and any field it cannot draw stops the run and gets named on screen. Signature fields are the classic case; so is a radio group whose buttons never had appearances written for them. The check errs on the strict side, so it will occasionally refuse a form that would in fact have worked.",
    },
    {
      question: "Can I unflatten a PDF afterwards?",
      answer:
        "No. The fields are gone from the file and their values are page content now; nothing on this site puts them back, and no PDF reader will either. Keep your original if the answers might ever need to change.",
    },
    {
      question: "Does flattening make the file smaller?",
      answer:
        "Not really, and it can go the other way. The drawing that was inside the field ends up on the page instead of being discarded, so a flattened form usually lands close to the size it started at and can end up slightly bigger. If size is the goal, run Compress PDF on the result.",
    },
    {
      question: "I already flattened this file — why does it still say it has a form?",
      answer:
        "Because the form dictionary stays behind even when every field has been taken out of it. A document that has been flattened once comes back here with a form and zero fields, and this page says so plainly instead of offering a second run that would change nothing but the object numbering.",
    },
  ],
  "remove-metadata": [
    {
      question: "What exactly does this remove from a PDF?",
      answer:
        "Two things, and it says how many of each it found before you press anything. The first is the /Info dictionary — the document properties a reader shows under File then Properties: title, author, subject, keywords, the creating application, the producing library, and the creation and modification dates. Every key is deleted outright rather than set to an empty string, because an emptied title is still a title. The second is XMP: the same kind of information as an XML packet, which can sit on the document, on an individual page, and on photographs embedded in the file. Clearing the properties alone is the common half-measure — an XMP packet routinely repeats the title and the author, so a document cleaned that way still names you. Both go, and the objects they lived in are dropped from the file rather than left in it unreferenced.",
    },
    {
      question: "Why did my HEIC or TIFF come back as a JPEG?",
      answer:
        "Because a browser canvas cannot write those containers. Cleaning an image works by decoding the picture and encoding it again — that is what leaves the metadata behind — so the output can only be a format the browser's encoder supports. PNG stays PNG and WebP stays WebP; JPEG, HEIC, HEIF and TIFF are all written out as JPEG. The page states the container it plans to write before you run it, then reads back what the encoder actually produced, so if a browser quietly substitutes a format — WebKit writes PNG when it is asked for WebP — you are told, instead of ending up with a .webp file full of PNG bytes.",
    },
    {
      question: "Does cleaning a photo change the picture itself?",
      answer:
        "Yes, and that is the part worth knowing. The download is a new picture built from your pixels, not your original bytes with the tags cut out. JPEG and WebP are written at the quality you choose, 92% by default, which gives up a little detail; the embedded colour profile is not carried over, because the canvas works in sRGB; anything deeper than 8 bits per channel comes back at 8; transparency survives only in PNG and WebP, since a JPEG has no alpha channel and transparent areas are filled white; an animated PNG or WebP keeps only its first frame; and a multi-page TIFF keeps only its first page. Keep the original if the pixels matter. A PDF is the opposite case — nothing on its pages is re-encoded, so the document looks and prints exactly as it did.",
    },
    {
      question: "Is anything left behind after a clean?",
      answer:
        "Some things, and they are named here rather than glossed over. In a PDF the pages themselves are untouched, so a name typed into a page, an annotation's author or a form field's value is still there — that is content, not metadata. Any /ID strings in the trailer, which identify the file rather than describe it, are left in place as well. And if your document is a PDF/A archival file, PDF/A identifies itself through an XMP packet, so removing the metadata removes that identification too. For an image, the listing covers what this page's reader can parse — EXIF, GPS, IPTC, XMP and the colour profile — and not every block a file can carry; a PNG text chunk, for instance, is never listed here even though the re-encode drops it. That is why the cleaned file is read back after every run and the result printed on the page: it is a measurement of the file you now have, not a promise about it.",
    },
    {
      question: "Why will it not open my password-protected PDF?",
      answer:
        "Because the PDF engine on this site is pdf-lib, which does not decrypt. A protected document fails to load, and the message says so and points you at Unlock PDF, which runs qpdf's decrypt: it removes a password you know, and it clears an owner-password restriction without one. It cannot crack a password you do not have. Run the file through there first and bring the result back here. Images are not encrypted this way, so the image path never runs into it.",
    },
  ],
  "pdf-editor": [
    {
      question: "Can I edit the text that's already in my PDF?",
      answer:
        "No, and nothing built on these libraries can. A PDF page is not a document in the word-processor sense \u2014 it is a list of drawing instructions that place individual glyphs at fixed coordinates, with no paragraphs, no line boxes and no reflow model. There is nothing to click into and retype, and no way to re-lay-out whatever follows a change. Adobe's own free tier cannot do it either. What works instead is the workflow this page is built for: cover the old wording with a whiteout box, then draw the new wording on top with Add text.",
    },
    {
      question: "Does whiteout actually remove what is underneath?",
      answer:
        "No. Whiteout paints an opaque white rectangle over the page, and that is all it does. The text underneath is still in the file, still selectable and still copyable by anything that reads the content stream \u2014 select-all-and-copy in almost any reader brings it straight back. This is not redaction, and this site deliberately ships no redaction tool, because no honest permissive client-side one exists. If the point is that nobody can ever recover what was there, do not use this.",
    },
    {
      question: "Can a reader delete the marks I add, or reply to them?",
      answer:
        "No. Every mark is drawn into the page's own content stream rather than attached as a PDF annotation object, so a reader shows no comment to click, no author, no reply and no Delete. Undo works here, while you are still setting the edit up; once you download, taking a mark out again means editing the page itself. The flip side is that the marks survive printing, flattening and re-saving. If you need marks a colleague can answer or tick off, use a reader that writes real annotations.",
    },
    {
      question: "Why can't I type Chinese, Russian or emoji?",
      answer:
        "Text is drawn with the standard PDF fonts, which only encode the Windows-1252 set: Latin letters, digits and punctuation, plus accented letters, curly quotes, the em dash and the euro sign. Chinese, Japanese, Korean, Cyrillic, Greek, Arabic, Hebrew and emoji cannot be drawn, and neither can a few Central and Eastern European letters such as \u0142, \u0219, \u0151 and \u017a. The page checks as you type and names the exact characters, so you find out before you press the button rather than after. The workaround: set the wording in another program, export it as a PNG with a transparent background, and place that with Add image.",
    },
    {
      question: "Can I edit several pages before downloading?",
      answer:
        "Yes. Every mark remembers the page you put it on, so you can move through the document with the PAGE field, add marks wherever you need them, mark pages for deletion as you go, and press Apply edits once. The marks are drawn first and the pages are removed second, which is why deleting a page never shifts anyone else's marks onto the wrong sheet. Marks sitting on a page you have marked for deletion are not drawn at all, and the canvas says so before you run.",
    },
    {
      question: "Does deleting a page change anything else in the file?",
      answer:
        "It changes how the file is put back together. When you only add marks, the document is loaded and re-saved and everything else is left alone. When you delete a page, the pages you keep are copied whole into a fresh document \u2014 fonts, images, text and formatting survive exactly \u2014 but bookmarks and the document outline are not carried across, because that copy does not bring them. Measured rather than assumed: a document with an outline goes in and comes back without one. If your bookmarks matter, keep every page, or accept the loss knowingly.",
    },
    {
      question: "Does this work without a mouse?",
      answer:
        "Almost entirely. Adding a mark, turning pages, deleting a page, selecting a mark, removing one, undoing and every setting are ordinary buttons and fields. Text, image and whiteout marks are positioned by X, Y, Width and Height fields that hold the same percentages a drag writes, so a keyboard reaches any placement a pointer can \u2014 and typing into X and Y slides an existing freehand stroke around too. The one thing a keyboard genuinely cannot do is draw a new freehand line, because that means tracing a path. This page says so rather than pretending otherwise.",
    },
  ],
};
