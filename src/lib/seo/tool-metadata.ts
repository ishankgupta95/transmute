import type { Metadata } from "next";
import { getToolBySlug } from "@/data/tools";
import type { ToolType } from "@/data/tools";
import { OG_LOCALE } from "@/lib/seo/locale";

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
  /*
    Rewritten with the Wave 4 cluster. The page was PNG-only when these steps
    were written and the middle one could not name a format because there was
    no choice to name; `OutputFormatPicker` landed on it in the same batch as
    the edit verbs, so the FORMAT control the step points at now exists.
  */
  "image-crop": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Drag the crop region to select the area you want to keep, then pick PNG, JPG or WEBP under FORMAT.",
    "Click Crop, then Download to save the result.",
  ],
  /*
    The third step used to read "Optionally export the metadata as JSON."
    There has never been a JSON export in `ExifViewerUI.tsx` — no serialiser,
    no copy affordance, no download of anything but the cleaned image. These
    strings are rendered instruction (the numbered grid under the tool) as
    well as HowTo JSON-LD, so it was an instruction nobody could follow.

    Replaced with the flow the page really has, and deliberately NOT closed
    the other way by building an export: the strip is two clicks on purpose
    (`ExifViewerUI.tsx` explains why beside the button) and a third
    affordance is a change to the surface, not a copy fix. Both controls
    named below are literals in that component — "Remove EXIF" is the
    primary action's label, "Download" is `DownloadButton`'s own text.
  */
  "exif-viewer": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "View the extracted EXIF metadata, including camera, lens, and GPS info.",
    "Click Remove EXIF, then Download to save the cleaned copy.",
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

  /*
    Wave 4's image cluster.

    These strings are the one part of this file a visitor reads: they are the
    HowTo steps in the page's JSON-LD and the numbered list under the tool. So
    every control named below was checked against the component that renders
    it — the ToolControl heading in caps (ROTATION, AXIS, BORDER, GRID, FIT,
    EFFORT, SIZES, TARGET DPI), the field or slider label in sentence case, and
    the exact primary-button text. FORMAT is `OutputFormatPicker`'s own
    heading, shared by every verb that offers PNG / JPG / WEBP.

    That checking is the whole point. This repo has twice shipped a HowTo step
    naming a control no one had built, and it is the failure this file makes
    easy: the Record is total over ToolType, so tsc demands an entry and says
    nothing about whether the entry is true.
  */
  "rotate-image": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Pick a turn under ROTATION — 90° right, 180° or 90° left — and an output format under FORMAT.",
    "Click Rotate, then click Download to save the turned image.",
  ],
  "flip-image": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Choose Horizontal or Vertical under AXIS — the canvas mirrors as you pick — and set the output under FORMAT.",
    "Click Flip, then click Download to save the mirrored image.",
  ],
  "add-border": [
    "Upload your image by dragging it into the drop zone or clicking to browse.",
    "Set All edges under BORDER, or break the link so Top, Right, Bottom and Left take their own widths, then choose a COLOUR.",
    "Check the size line on the canvas, click Add border, then click Download to save it.",
  ],
  "watermark-image": [
    "Drop an image into the drop zone, then type the mark in the Watermark text field.",
    "Pick a position — Bottom right through to Tiled — and set Size, Opacity, Rotation and Colour while the preview redraws.",
    "Choose PNG, JPG or WEBP, click Apply watermark, then click Download to save the file.",
  ],
  "pixelate-image": [
    "Drop an image into the drop zone, then drag on the preview to select the region to cover — or leave it alone to pixelate the whole image.",
    "Set Block size, and type exact numbers into the X, Y, Width and Height fields if you need them.",
    "Choose PNG, JPG or WEBP, click Pixelate, then click Download to save the file.",
  ],
  "crop-circle": [
    "Drop an image onto the upload area — JPG, PNG, WebP, AVIF, BMP and GIF are accepted, and nothing leaves this tab.",
    "Set the Diameter slider, then use the Horizontal and Vertical sliders to move the circle over the part of the picture you want to keep.",
    // PNG and WEBP only, and that is the tool rather than the copy: a circular
    // crop is an alpha mask, so a JPG arm would hand back a black box.
    "Choose PNG or WEBP under FORMAT, press Crop circle, and use the Download button to save the result.",
  ],
  "image-splitter": [
    "Drop an image onto the upload area — JPG, PNG, WebP, AVIF, BMP and GIF are accepted.",
    "Type the number of Rows and Columns you want under GRID, up to ten of each, and check the tile sizes printed under the picture.",
    "Press Split, then use the Download … tiles (ZIP) button for the whole grid, or click a single tile to save it on its own.",
  ],
  "social-media-image-resizer": [
    "Drop an image onto the upload area — JPG, PNG, WebP, AVIF, BMP and GIF are accepted.",
    "Click the frames you want in the size grid, then choose Cover or Contain under FIT and, for Contain, a Pad colour.",
    "Press Resize, then use the Download … sizes (ZIP) button, or click one output to save it on its own.",
  ],
  "bcrypt-generator": [
    "Type or paste the password into the field at the top of the page.",
    "Set the work factor — each step doubles the time, for you and for an attacker.",
    "Press Generate hash, then Copy the result.",
  ],
  "gif-maker": [
    "Drop several images onto the page, or click the drop zone to pick them.",
    "Set how long each frame is shown — the strip shows it as a frame rate too.",
    "Press Rebuild GIF after changing the timing, then Download the animation.",
  ],
  "csv-markdown-table": [
    "Paste or type CSV into the left pane — it starts with an example you can replace.",
    "The Markdown table appears on the right as you type; set the alignment if you want it.",
    "Press Copy to take the table, or Download to save it.",
  ],
  "resize-gif": [
    "Drop an animated GIF onto the page, or click the drop zone to pick one.",
    "Set the scale — halving the dimensions removes three quarters of the pixels in every frame.",
    "Press Resize GIF, then Download the result.",
  ],
  "gif-speed-changer": [
    "Drop an animated GIF onto the page, or click the drop zone to pick one.",
    "Set the speed as a percentage of the original — above 100% is slower, below is faster.",
    "Press Change speed, then Download the result.",
  ],
  "reverse-gif": [
    "Drop an animated GIF onto the page, or click the drop zone to pick one.",
    "It reverses as soon as it has read the frames — there is nothing to set.",
    "Press Download to save the reversed animation.",
  ],
  "split-gif": [
    "Drop an animated GIF onto the page, or click the drop zone to pick one.",
    "Every frame is pulled out as a numbered PNG, in playing order.",
    "Press Download to save them all as a ZIP.",
  ],
  "vcf-to-csv": [
    "Drop a .vcf contacts export onto the page, or click the drop zone to pick one.",
    "Check the columns — repeated emails and phone numbers each get their own, numbered.",
    "Press Download to save the CSV, or Copy to put it on the clipboard.",
  ],
  "ics-to-csv": [
    "Drop an .ics calendar export onto the page, or click the drop zone to pick one.",
    "Check the times — they are written as the calendar stores them, with the zone beside them.",
    "Press Download to save the CSV, or Copy to put it on the clipboard.",
  ],
  "ocr-pdf": [
    "Drop a scanned PDF onto the page, or click the drop zone to pick one.",
    // No control named in step two: the run starts on drop and there is
    // nothing to press. howto-controls.test.ts checks every control a step
    // names actually exists, so naming one that does not is caught here.
    "Wait while each page is read — a long scan takes a while, and the strip says which page it is on.",
    "Press Download to save the searchable PDF. It looks identical; the text is invisible.",
  ],
  "image-to-text": [
    "Drop a photo, screenshot or scan onto the page, or click the drop zone to pick one.",
    // No control is named in step two on purpose: the run starts on drop, and
    // the only thing to do is wait. Naming a button that does not exist is
    // exactly what howto-controls.test.ts was written to catch.
    "Wait while it reads — the first image on a fresh visit also fetches the 4.9 MB OCR engine.",
    "Press Download to save the text as a .txt file, or Copy to put it on the clipboard.",
  ],
  "compress-png": [
    "Drop a PNG onto the page, or click the drop zone to pick one.",
    "Choose an EFFORT level from 1 to 4 — 2 is the default and gives the most bytes per second of waiting.",
    // The third step has to survive the empty state: oxipng hands back the
    // byte-identical file when there is nothing left to win, and that is a
    // successful run, not an error.
    "Press Optimize PNG, then Download the result — or keep your original when the page reports that nothing was saved.",
  ],
  "ico-to-png": [
    "Drop an .ico or .cur onto the page — every image inside it is listed with its size and how it is stored.",
    "Click an icon to include or exclude it, or use Select all and Deselect all in the SIZES panel.",
    "Press Extract, then Download each PNG from the DOWNLOADS list.",
  ],
  "base64-to-image": [
    "Paste a Base64 string or a whole data: URI into the Base64 pane.",
    "Click Decode to image — the format comes from the decoded bytes, not from any data: prefix.",
    "Adjust File name if you want a different stem, then click Download to save it.",
  ],
  "change-image-dpi": [
    "Drop a PNG or JPEG into the drop zone — the density it declares today is read straight out of the header.",
    "Pick 72, 150, 300 or 600 under TARGET DPI, or type any value into the Custom field.",
    "Click Set DPI, then Download — the pixel dimensions never move, only the print size.",
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
    // There is no compression level to pick: CompressPdfUI has no controls at
    // all — it starts on drop, and the pass is lossless, so there is no
    // quality to trade away. The step used to promise a level chooser that has
    // never shipped, on a page that renders these steps as visible copy.
    "Compression starts as soon as the file lands — there is nothing to configure.",
    "Click Download to save your compressed PDF.",
  ],
  // Every control named here is one RecompressPdfImagesUI actually carries:
  // the Quality/Target size switch (which keeps the loaded file), the three
  // presets, the KB field, the run button, the download, and the skipped-image
  // readout. Note what is deliberately absent — there is no resolution setting
  // to name, because the target search scales images by a factor rather than
  // to any particular output resolution.
  "recompress-pdf-images": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Choose Quality and one of its three presets, or switch to Target size and type a size in KB — the file stays loaded either way.",
    "Click Recompress images, then Download the result — the canvas reports how many images were re-encoded, how many were skipped, and why.",
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
  // Every step below names a control that actually ships in the component the
  // toolType routes to (ToolClient.tsx). A step promising a control that does
  // not exist is the failure mode a past review caught here, so these were
  // written from the components rather than from the tool's description.
  "extract-pdf-pages": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Click the page thumbnails to pick pages, or type a range like 1-3, 5, 8-10 in the RANGE field.",
    "Set Output mode to One PDF or One per page, click Extract, and download the result.",
  ],
  "delete-pdf-pages": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Click the pages you want removed, or type them in the RANGE field — the count of pages that will remain updates as you go.",
    "Click Delete and download pages-removed.pdf.",
  ],
  "crop-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Drag the handles on the rendered first page to set the crop frame, optionally locking it to Free, 1:1, A4, 4:3, or 16:9.",
    "Click Crop to apply that frame to every page, then download the cropped PDF.",
  ],
  "change-pdf-page-size": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Pick a page size (A3, A4, A5, Letter, Legal, or Tabloid) and Portrait or Landscape.",
    "Choose Scale to fit or Box only, click Resize, and download the resized PDF.",
  ],
  "pdf-resizer": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Use the What to resize switch to pick Page size or File size — the same file stays loaded either way.",
    "Page size takes a size, an orientation and Scale to fit or Box only; File size runs one structural pass with no settings. Download the result.",
  ],
  "pdf-to-text": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "The text is extracted as soon as the file lands — there is no OCR, so a scanned page comes back empty and the tool says so.",
    "Toggle 'Mark where each page starts' if you want page separators, then Copy the text or Download it as a .txt file.",
  ],
  /*
    ExtractPdfImagesUI starts on the drop — `handleFiles` calls `run(f)`
    because there is nothing to configure first — so no step may name an
    "Extract" button, and none does. The controls named are the ones it
    renders: the MINIMUM SIZE choice and the download, whose label really does
    change with the count (one image saves bare, several save as a ZIP).
  */
  "extract-images-from-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Extraction starts as soon as the file lands — the canvas shows how many images the document holds, how many came out, and the reason for each one that did not.",
    "Set MINIMUM SIZE to hide icons and rules, then Download — a single image saves on its own and several save as one ZIP.",
  ],
  // The qpdf four. Same rule as the block above: every control named here is
  // one the component actually renders — the password + confirm pair, the
  // separate-owner-password checkbox, the AES choice and the restrictions
  // checkbox on protect-pdf; the print/edit/copy controls on pdf-permissions;
  // one password field on unlock-pdf; and nothing at all on repair-pdf, where
  // the rewrite IS the repair and there is genuinely nothing to configure.
  "protect-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Type the password and confirm it, then choose AES-256 or AES-128 — 128 only if a reader too old for AES-256 has to open the file.",
    "Optionally set a separate owner password or tick the restrictions box, then click Protect PDF and download the encrypted copy.",
  ],
  "unlock-pdf": [
    "Upload the protected PDF by dragging it into the drop zone or clicking to browse.",
    "Type the password you already use to open it — this removes a password you know, it does not find one you have forgotten.",
    "Click Remove password and download the copy with the encryption taken off.",
  ],
  "pdf-permissions": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Choose what readers may do with printing, editing and copying — these flags are advisory, so a reader is free to ignore them.",
    "Click Apply restrictions and download the restricted PDF.",
  ],
  "repair-pdf": [
    "Upload the damaged PDF by dragging it into the drop zone or clicking to browse.",
    "Click Repair PDF — there is nothing to configure, because qpdf re-parses the file and writes a fresh one with a rebuilt cross-reference table.",
    "Download the repaired file, and read the warnings it reports: a file that had to be reconstructed is not the same as one that was fine all along.",
  ],
  "watermark-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Type the watermark text, or set MARK to Image and choose a PNG or JPEG — then drag the ring on the page, or type exact X and Y percentages.",
    "Pick which pages to stamp. Click Add watermark, then download the watermarked PDF.",
  ],
  "sign-pdf": [
    "Upload the PDF you want to sign by dragging it into the drop zone or clicking to browse.",
    "Draw your signature on the pad below the page. Click Upload a signature image instead to place a PNG or JPEG you already have.",
    "Drag the signature onto the page, or type its X, Y and Width percentages. Click Sign PDF to download the signed copy.",
  ],
  "add-image-to-pdf": [
    "Drop your PDF on the page, then choose a PNG or JPEG under IMAGE in the settings rail.",
    "Drag on the page preview to move the image, or type exact percentages into the X and Y fields, and set its width, opacity and turn.",
    "Press Place image, then download the new PDF.",
  ],
  "annotate-pdf": [
    "Drop your PDF in and set the page number you want to mark.",
    "Click Add highlight, Add box or Add note, then drag on the page to place the mark — or type its position into the X and Y fields beside it.",
    "Click Annotate page, then Download to save the marked copy.",
  ],
  "fill-pdf-form": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse — the field list appears as soon as the form has been read.",
    "Edit the fields on the canvas: a box for text, a tick for a check box, buttons for a radio group, a menu for a dropdown. Read-only fields are shown but locked.",
    "Click Fill form to write your answers in, or tick Also flatten the form first to bake them into the pages, then download the filled PDF.",
  ],
  "flatten-pdf": [
    "Upload your PDF by dragging it into the drop zone or clicking to browse.",
    "Read the field list — every field is shown with its name, its type, the value it holds now, and the page it sits on.",
    "Click Flatten form, then Download the flattened PDF — the fields are gone and their values are part of the page.",
  ],
  "remove-metadata": [
    "Upload a PDF or a photo by dragging it into the drop zone or clicking to browse.",
    "Read the list of what the file is carrying: /Info entries and XMP packets for a PDF, or EXIF, IPTC and GPS tags for a photo. A photo that comes out as JPEG or WebP also gets a quality control for the re-encode.",
    "Click Remove metadata and download — the cleaned copy saves itself, and the page re-reads it to report what is left.",
  ],
  "pdf-editor": [
    "Drop your PDF in, then set the page you want to work on in the PAGE field.",
    "Click Add text, Add image, Whiteout or Draw to put a mark on the page, then drag it there or type exact X and Y percentages. Delete this page drops a whole page instead.",
    "Click Apply edits, then Download to save the edited PDF.",
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
  // These two render as visible HowTo copy, so each step names a control that
  // actually ships. `AudioConverterUI` has a FORMAT chip row (MP3 / WAV /
  // FLAC), a BITRATE row that appears only on MP3, and a primary button
  // labelled Convert; `ExtractAudioUI` has AUDIO OUT (Keep original / MP3 /
  // WAV), the same BITRATE row, and a primary button labelled Extract Audio.
  // Neither middle step promises a stream copy, because on these pages only
  // the extractor's "Keep original" arm is one.
  "audio-convert": [
    "Upload your audio file by dragging it into the drop zone or clicking to browse.",
    "Pick the output FORMAT — MP3, WAV or FLAC — then click Convert. The file is decoded and encoded again in your browser.",
    "Click Download to save your converted audio file.",
  ],
  "extract-audio": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Choose AUDIO OUT: Keep original lifts the track out without re-encoding it, while MP3 and WAV decode and encode it again. Then click Extract Audio.",
    "Click Download to save the extracted audio track.",
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

  /*
    The five audio-effects pages. These render as visible HowTo copy, so every
    control named below is one the component really mounts: NormalizeAudioUI's
    TARGET / FORMAT chips and its "Normalise" primary; ChangeAudioVolumeUI's
    "Volume" slider and "Apply" primary, which is disabled at 0 dB and is why
    the step says to move the slider; ReverseAudioUI's FORMAT chips and
    "Reverse"; RemoveSilenceUI's "Ends only" / "Every gap" chips, its "Silence
    below" slider and "Remove silence"; and the recorder's Start Recording /
    Pause / Stop and save, which come from MediaRecorderShell.
  */
  "normalize-audio": [
    "Upload your audio file by dragging it into the drop zone or clicking to browse.",
    "Pick a TARGET — Streaming, Podcast or Broadcast — choose the output FORMAT, then click Normalise. The file is measured first and the page reports what it found.",
    "Click Download to save the normalised audio.",
  ],
  "change-audio-volume": [
    "Upload your audio file by dragging it into the drop zone or clicking to browse.",
    "Move the Volume slider to the gain you want in decibels — Apply stays off at 0 dB, because that is no change — then click Apply.",
    "Check the measured Peak out and Clipping rows, then click Download to save the file.",
  ],
  "reverse-audio": [
    "Upload your audio file by dragging it into the drop zone or clicking to browse.",
    "Choose the output FORMAT — MP3, WAV or FLAC — then click Reverse.",
    "Click Download to save the reversed audio.",
  ],
  "remove-silence": [
    "Upload your audio file by dragging it into the drop zone or clicking to browse.",
    "Choose Ends only or Every gap under WHAT TO CUT, set how quiet counts with the Silence below slider, then click Remove silence.",
    "Check how many seconds went, then click Download to save the trimmed audio.",
  ],
  "audio-recorder": [
    "Pick a MICROPHONE, or leave it on Browser default, then click Start Recording and allow access.",
    "Watch the level meter while you record — Pause and Resume are available — then click Stop and save.",
    "Play the take back, then click Download to save it in whatever format your browser recorded.",
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
  /*
    Every control named here is one CompressVideoUI renders in `target-size`
    mode: the TARGET SIZE number field, the three preset cards (Email 25 MB,
    WhatsApp 16 MB, Discord 10 MB — seeds that write the field, which stays
    editable), the Compress primary, and the download. What is deliberately
    absent is any promise about the size: the canvas reports the size that
    exists, so the step says the tool reports it rather than that it hits it.
  */
  "compress-video-to-size": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Click Email, WhatsApp or Discord to fill in TARGET SIZE, or type your own number of MB — the field stays editable either way.",
    "Click Compress, then Download — the canvas shows the size actually produced beside the target, and says so when the target was not reached.",
  ],
  "screen-recorder": [
    "Choose whether to include microphone audio, then click Start Recording.",
    "Pick the screen, window, or tab to capture in the browser prompt.",
    // "Click Stop" for years; the button has always read "Stop and save"
    // (MediaRecorderShell.tsx, the component this page mounts). Caught by the
    // general control gate in howto-controls.test.ts, not by a reader.
    "Click Stop and save when you're done, then Download the recorded video.",
  ],
  // These three render as visible HowTo copy on the page, so every step names
  // a control that actually ships: the primary buttons are Convert / Remove
  // audio / Rotate, and the rotation chips read "90° right", "180°" and
  // "90° left" — RotateVideoUI deliberately labels the third one by the turn a
  // user pictures rather than by the 270 clockwise degrees it passes to the
  // engine, so a step offering "270°" would name a control that is not there.
  "video-remux": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Check the detected codec, then click Convert — a compatible stream is copied across without re-encoding.",
    "Click Download to save the converted file.",
  ],
  "mute-video": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Click Remove audio — the audio track is dropped and the video stream is copied untouched.",
    "Click Download to save the silent video.",
  ],
  "rotate-video": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Choose 90° right, 180° or 90° left, then click Rotate to rewrite the container's rotation flag.",
    "Click Download to save the rotated video.",
  ],

  /*
    Frames, cuts, joins and the camera. Again every control named ships:
    VideoToImagesUI's SAMPLING chips ("Every N sec" / "Fixed count") and its
    "Extract frames" primary; VideoThumbnailUI's Time slider, its "Use the
    player's position" button and "Capture frame"; SplitVideoUI's HOW TO CUT
    chips ("Equal parts" / "Every N sec" / "At times") and a primary that reads
    "Cut into N parts" once a plan exists; MergeVideoUI's Move up / Move down
    row buttons and its "Join N clips" primary; and WebcamRecorderUI's CAMERA
    picker, "Include microphone audio" checkbox and the shell's Start Recording
    / Stop and save.
  */
  "video-to-images": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Choose SAMPLING — Every N sec or Fixed count — pick the image FORMAT, then click Extract frames. The rail says how many frames the settings ask for before you click.",
    "Click Download to save every frame in one ZIP.",
  ],
  "video-thumbnail": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Scrub the player and click Use the player’s position, or drag the Time slider, then pick a WIDTH and FORMAT and click Capture frame.",
    "Click Download to save the still — the filename carries the moment the frame really came from.",
  ],
  "split-video": [
    "Upload your video by dragging it into the drop zone or clicking to browse.",
    "Choose HOW TO CUT — Equal parts, Every N sec or At times — set the number or the times, then click Cut into N parts.",
    "Compare the ASKED and ACTUAL lengths in the table, then click Download to save every part in one ZIP.",
  ],
  "merge-video": [
    "Drop two or more clips into the drop zone, or click to browse — each one is read as it lands.",
    "Use Move up and Move down to set the join order. If a clip differs from the first, the table names the file and the property and the join stays off.",
    "Click Join clips — the button counts what is in the queue — then Download to save the single joined file.",
  ],
  "webcam-recorder": [
    "Pick a CAMERA and decide whether to include microphone audio, then click Start Recording and allow access.",
    "Frame yourself in the live preview while you record — Pause and Resume are available — then click Stop and save.",
    "Play the clip back, then click Download to save it in whatever format your browser recorded.",
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
  /*
    SubtitleConverterUI converts as you type — there is no Convert button, so
    no step names one. Every control here is one it renders: the SOURCE
    File/Paste switch, CONVERT TO, TIME SHIFT (whose own hint spells the
    accepted formats) and the FRAME RATE checkbox that reveals the two rate
    pickers. The encoding picker is deliberately not in a step: it only appears
    in File mode and only matters when detection guessed.
  */
  "subtitle-converter": [
    "Choose SOURCE — drop a .srt, .vtt, .ass or .ssa file, or switch to Paste and paste the text in.",
    "Pick the format under CONVERT TO, and if the timing is off, type an offset such as +2.5s into TIME SHIFT.",
    "Tick 'Re-time between frame rates' when the drift grows through the file, then copy the output or Download it.",
  ],

  /*
    ── Wave 4's developer fills ──────────────────────────────────────────────
    Every control named below was read off the component before it was written
    here — these steps render as visible numbered copy AND as HowTo JSON-LD, so
    a step naming a button that does not exist is a lie in two places at once.
    That has shipped twice (`compress-pdf` step 2, the `pdf-to-jpg` how-to);
    the fix both times was to open the UI file, which is the only check there
    is. Nine of these pages take no file at all, so their first step names a
    field rather than a drop zone.
  */
  "yaml-json-converter": [
    "Drop a .yaml, .yml or .json file into the drop zone, or switch SOURCE to Paste and paste the text in.",
    "Set DIRECTION to YAML → JSON or JSON → YAML, and pick 2 or 4 spaces under INDENT.",
    "Read the warnings above the panes — they name every literal the conversion changed — then Copy or Download the output.",
  ],
  "yaml-formatter": [
    "Drop a .yaml or .yml file into the drop zone, or switch SOURCE to Paste and paste it in.",
    "Set INDENT and LINE WIDTH, and tick 'Sort keys alphabetically' under KEY ORDER if you want them ordered.",
    "Check the Valid row under OUTPUT — a parse error names the line and column — then Copy or Download the result.",
  ],
  "json-minify": [
    "Drop a .json file into the drop zone, or switch SOURCE to Paste and paste the JSON in.",
    "The SOURCE, MINIFIED and SAVED figures appear above the output pane as soon as the input parses.",
    "Copy the minified JSON from the pane header, or click Download to save the .min.json file.",
  ],
  "sort-dedupe-lines": [
    "Drop a .txt, .csv or .log file into the drop zone, or switch SOURCE to Paste.",
    "Choose an order under SORT, then pick Keep all, Keep first or Keep last under DUPLICATES.",
    "Check the lines in and lines out counts under OUTPUT, then copy the result or click Download.",
  ],
  "line-endings": [
    "Drop a text file into the drop zone — the CRLF, LF and CR counts appear straight away, mixed files included.",
    "Pick CRLF, LF or CR under CONVERT TO, and tick 'End the file with a newline' or 'Remove the UTF-8 byte-order mark' if you need them.",
    "Click Download to save the file with exactly the endings you chose.",
  ],
  "jwt-encoder": [
    "Edit the Header and Payload panes, or stamp iat, nbf and exp from the chips under TIME CLAIMS.",
    "Type your own SIGNING SECRET and set Secret encoding to Text, Hex or Base64.",
    "Copy the signed token — it is signed, not encrypted, so anyone holding it can read every claim in it.",
  ],
  "hmac-generator": [
    "Paste the exact message the MAC covers into the Message pane.",
    "Enter the SECRET KEY and set Key encoding to match how the key was given to you.",
    "Copy the Hex or Base64 MAC, or paste the value you were sent into VERIFY to compare it.",
  ],
  "charset-converter": [
    "Drop a text file into the drop zone — the encoding is guessed from its bytes.",
    "If the accented characters look wrong, pick the right one under READ THE FILE AS.",
    "Click Download to save the same text as UTF-8, the only encoding a browser can write.",
  ],
  "har-viewer": [
    "Drop a .har file into the drop zone — it is parsed in this tab and never uploaded.",
    "Narrow the table with STATUS, METHOD, TYPE and URL CONTAINS, and select a row for its headers, body and timings.",
    "Leave 'Strip credentials from the download' ticked, then click Download to save the redacted copy.",
  ],
  "file-checksum": [
    "Paste the publisher's checksum into EXPECTED CHECKSUM — a bare hash, a shasum line, or a whole SHA256SUMS file.",
    "Drop the downloaded file into the drop zone; MD5, SHA-1, SHA-256 and SHA-512 are computed in this tab.",
    "Read the verdict — it names the algorithm that matched, or says NO MATCH.",
  ],
  "wifi-qr-code": [
    "Enter the NETWORK NAME, choose WPA/WPA2, WEP or Open under SECURITY, and type the PASSWORD.",
    "Click Generate QR Code — the exact payload being encoded is printed above the square.",
    "Click Download PNG or Download SVG to save it.",
  ],
  "xlsx-to-csv": [
    "Drop an .xlsx workbook into the drop zone, or click it to browse.",
    "Tick the sheets you want under SHEETS and set SEPARATOR to Comma, Semicolon or Tab.",
    "Click Download — one sheet saves as a .csv, two or more as a single ZIP.",
  ],
  "chmod-calculator": [
    "Tick the read, write and execute boxes for owner, group and other.",
    "Or type an octal such as 755 into the Octal field, or an rwx string into the Symbolic field — all three stay in step.",
    "Copy the chmod command and run it yourself.",
  ],
  "http-status-codes": [
    "Type a code, a reason phrase or a symptom into the Search box.",
    "Narrow to one class with the CLASS chips, or untick 'Include vendor codes'.",
    "Read the RFC that defines the code, whether it is cacheable, and — for a 3xx — whether the method survives.",
  ],
  "timezone-converter": [
    "Set the date and time in the When row, and pick the zone you are planning from.",
    "Add every zone you care about with the ADD A ZONE picker in the rail.",
    "Read the time, date and UTC offset for each zone, or press Copy to take the whole board.",
  ],
  "byte-converter": [
    "Type a size into any row — bits, kB or KiB.",
    "Every other unit updates at once, decimal beside binary.",
    "Read the exact byte count under OUTPUT, or pick a speed under TRANSFER TIME for an estimate.",
  ],
  "aspect-ratio-calculator": [
    "Pick Width, Height or Ratio under SOLVE FOR — that field becomes the computed one.",
    "Fill in the other two, or choose a named ratio from the START FROM chips.",
    "Read the Reduced ratio under OUTPUT, and how far Off named it sits from the nearest one.",
  ],
  "url-parser": [
    "Paste a URL into the left pane.",
    "Read the components beside it, and edit the query parameters in the table below.",
    "Press Copy the rebuilt URL to take the result.",
  ],
  // ── Wave 4 · batch 2 ────────────────────────────────────────────────
  // These render as visible copy on the page, so every control named below
  // was read out of the component that mounts it, not out of the plan.
  "create-zip": [
    "Drop the files you want in one archive, or click to browse — + ADD MORE FILES under FILES adds to the pile without starting over.",
    "Pick a COMPRESSION level, choose whether MODIFIED DATES keep each file's own or stamp them all now, and set the ARCHIVE NAME.",
    "Click Create, read the packed size and the saving it actually measured, then click Download.",
  ],
  "unzip-files": [
    "Drop a .zip archive into the drop zone — its index is read in this tab and every entry is listed with its real size.",
    "Tick the entries you want, or press SELECT ALL; rows marked REFUSED, ENCRYPTED, TRUNCATED or BLOCKED say why they cannot come out.",
    "Click Download — one file saves under its own name, and two or more come down as a single ZIP.",
  ],
  "extract-archive": [
    "Drop a .zip, .tar, .7z, .rar, .tgz or tar.gz archive into the drop zone — its table of contents is read in this tab before anything is unpacked.",
    "Tick the files you want, or press All files or None under SELECTION; folders, symbolic links and refused paths cannot be ticked.",
    "If the archive is locked, type its password under ARCHIVE PASSWORD, then press Download — one file saves on its own, two or more as a single ZIP.",
  ],
  "barcode-generator": [
    "Choose a SYMBOLOGY — Code 128 for text, EAN-13 or UPC-A for retail, QR Code or Data Matrix for anything longer.",
    "Type the value; the block beneath the pane prints what a scanner reads back, check digit and all.",
    "Click Generate Barcode, then Download SVG or Download PNG.",
  ],
  "qr-code-reader": [
    "Drop a photo or screenshot of the code — PNG, JPG, WebP, GIF or BMP.",
    "Leave SCAN FOR on QR only, or switch it to Every format to also find Data Matrix, Aztec, PDF417 and the striped retail barcodes.",
    "Read the decoded payload and press Copy — it is never rendered as a clickable link, so a code from an untrusted image cannot be tapped through.",
  ],
  "svg-optimizer": [
    "Drop an .svg file into the drop zone, or click it to browse.",
    "Pick Safe, SVGO default or Smallest under START FROM, and drag Coordinate precision if you need fewer decimals.",
    "Read any warnings above the panes — each one names what the run actually changed — then click Download to save the .min.svg.",
  ],
  "docx-to-markdown": [
    "Drop a Word .docx onto the drop zone, or click it to browse.",
    "Set IMAGES to Link, Embed or Drop, and TABLES to Pipe table or Keep HTML.",
    "Click Download — the .md on its own, or a ZIP holding the .md and its images.",
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
      locale: OG_LOCALE,
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
