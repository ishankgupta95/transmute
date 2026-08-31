export interface FAQ {
  question: string;
  answer: string;
}

export type ToolFAQs = Record<string, FAQ[]>;

export const PRIVACY_FAQ: FAQ = {
  question: "Is my file uploaded to a server?",
  answer:
    "No. Transmute processes everything locally in your browser using JavaScript and the Canvas API. Your files never leave your device — there is no server, no upload, no cloud processing.",
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
    {
      question: "What format is the cropped image saved in?",
      answer:
        "Cropped images are saved as PNG to preserve quality and support transparency. If you need a different format, use our image converter tools after cropping.",
    },
    {
      question: "Does cropping reduce image quality?",
      answer:
        "No — the pixels you keep are taken from the image at its full resolution and saved as lossless PNG, so no new compression artifacts are added. The trade-off: a PNG crop of a JPG photo can be larger in bytes than the original file even though it holds fewer pixels.",
    },
    {
      question: "Why does my cropped image have transparent corners?",
      answer:
        "That happens when you rotate before cropping — any part of the crop box the rotated image no longer covers is left transparent, which is one reason the output is PNG. Pull the crop box fully inside the rotated image if you want no transparent areas.",
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
        "The image is re-encoded through the HTML5 Canvas API, which only preserves pixel data. All metadata — EXIF, IPTC, XMP, ICC profiles — is naturally stripped during this re-encoding process.",
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
        "Yes — the file is handed to a background worker, so the page stays responsive and a progress bar tracks the work (MD5 is the slow part; the SHA family uses the browser's native crypto). The practical limit is your device's memory, since the whole file is loaded at once.",
    },
    {
      question: "Why doesn't my hash match the one from my terminal?",
      answer:
        "Almost always a trailing newline — echo appends one, so piping 'hello' through it hashes six bytes while this tool hashes exactly the five characters you typed, encoded as UTF-8. Use printf or echo -n in the terminal to compare like for like.",
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
      question: "Will the merged PDF keep bookmarks and links?",
      answer:
        "Page-level features — internal links, annotations, form fields — are copied with their pages, and the first file's document title and author are carried over. Document bookmarks (the outline tree) are not merged: the pages are grafted into a fresh document, so the combined file starts with no outline.",
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
        "Results vary. PDFs with lots of metadata or redundant internal objects see the biggest reduction. Heavily optimized PDFs may not shrink much. The tool shows the before and after file sizes.",
    },
    {
      question: "Does compression reduce image quality?",
      answer:
        "This tool focuses on structural optimization (removing metadata, using object streams). It does not re-compress embedded images, so visual quality is preserved.",
    },
    {
      question: "Will compression work on scanned PDFs?",
      answer:
        "Scanned PDFs are mostly raster image data, so structural optimization makes only a small dent. For scans, the highest-leverage move is reducing image resolution before producing the PDF; this tool can still strip redundant metadata on top of that.",
    },
    {
      question: "What happens if compression would make my file bigger?",
      answer:
        "You get your original bytes back. Small or already-optimized PDFs can re-encode larger, so the tool compares the two files and serves whichever is smaller — the readout then shows 0% saved and a note explains that the original won.",
    },
    {
      question: "Why are there no quality settings?",
      answer:
        "Compression is a single automatic pass — content streams are recompressed and unreferenced objects dropped — and it starts the moment you drop the file. Since it never touches your images or text, there is no dial that would trade visual quality for size.",
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
        "Slightly. HEIC cannot be embedded in a PDF directly, so each photo is decoded with heic2any and re-encoded as JPEG at quality 0.92 — usually indistinguishable from the original. An image with transparency is saved as lossless PNG instead.",
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
        "In practice, yes. Most browsers decode M4A with their built-in AAC decoder; when one can't (Firefox on some systems), the tool falls back to an FFmpeg engine — a one-time ~31 MB download served from this site's own origin — and the conversion carries on the same way.",
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
        "There is no hard limit, but very long files (over 30 minutes) may take longer to process since all decoding happens in your browser.",
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
        "There is no fixed limit. However, since all processing happens in your browser, merging many large files may be slower on devices with limited memory.",
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
        "No. The video is read in place rather than copied into memory, so only the much smaller MP3 output has to fit in the tab — extraction from a 2.5 GB file has been verified end to end. That's why this tool has no cap while the video trimmer stops at 1.5 GB.",
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
};
