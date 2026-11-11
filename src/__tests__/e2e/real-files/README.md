# Real-file run

Every other e2e suite uses tiny generated fixtures (largest image 800x600, video
160 KB). This opt-in run feeds the tools **your own files** — 12 MP phone photos
with ICC/Display-P3 and EXIF orientation, iPhone HEIC and HEVC `.mov`,
Word-exported and scanned PDFs, long audio — and checks the OUTPUT'S CONTENT,
not just that something downloaded.

## Run it

```bash
mkdir real-files            # gitignored default; put your files in it (subfolders are fine)
npm run dev                 # in another terminal, if one is not already on :3000
npm run test:e2e:real                                  # uses ./real-files
TRANSMUTE_REAL_FILES=~/Pictures/probe npm run test:e2e:real   # or any directory
npm run test:e2e:real -- --workers=1                          # serial
npm run test:e2e:real -- -g "IMG_0042.HEIC"                   # one file
```

One project, `real-files`, in Chromium (the product targets Chromium-based browsers).
When `TRANSMUTE_REAL_FILES` is unset none of this exists — the default,
`test:e2e:conversion` and `test:e2e:pwa` runs list exactly the same tests.
Files over `TRANSMUTE_REAL_MAX_MB` (default 400) are skipped: they go through the
page as base64 for the content checks.

## NEVER commit the directory

`/real-files/` is in `.gitignore`. If you point `TRANSMUTE_REAL_FILES` somewhere
inside the repo, add that path to `.gitignore` first. Nothing here copies, logs
or uploads a file's content; Playwright's HTML report and failure traces/screenshots
(`playwright-report/`, `test-results/`) can contain page screenshots and the
file names — they are gitignored, keep them that way and delete them when done.

## What is run

One test per (file x tool), named `<path> x <slug>`, so the report names the
failing pair. A tool whose drop zone does not accept the extension is skipped
with the reason.

| type | extensions | tools |
|---|---|---|
| image | jpg jpeg png webp avif tif tiff heic heif | jpg-to-png, jpg-to-webp, png-to-jpg, webp-to-jpg/png, avif-to-jpg/png, tiff-to-jpg/png, heic-to-jpg/webp, compress-image, resize-image |
| video | mp4 mov webm | compress-video, video-trimmer (Exact frame), mov-to-mp4 (HEVC: takes the explicit "Re-encode to H.264") |
| audio | mp3 wav m4a aac flac ogg opus wma | the format converters (mp3-to-wav, wav-to-mp3, wav-to-flac, m4a-to-mp3/wav, flac-to-mp3, ogg-to-mp3) and mp3-converter |
| pdf | pdf | compress-pdf, split-pdf (first + last page), rotate-pdf (90 degrees, all pages) |

## What each check means

**Images** — the source is decoded by the *browser* (which applies EXIF
orientation and converts the ICC profile to sRGB) and compared with the output
on a small grid (`compareImages`): `mae` (colour distance), `correlation`
(layout — catches a turned or flipped picture), per-channel `bias` (a colour
cast, e.g. a dropped Display-P3 profile), alpha. Output dimensions must equal the
browser's decode of the source (orientation applied); resize keeps the aspect
ratio; compress never grows the file.
If the browser cannot decode the source (HEIC in Chromium, TIFF), comparing with
the app's own decoder would be circular, so instead: the output is not black and
not a flat fill, and for HEIC the output size must equal the container's primary
`ispe` size with `irot` applied (a sideways portrait comes back swapped).

**Video** — source and output are decoded in a `<video>` and frames at 5/40/80 %
of the clip are compared (`compareVideoToSource`, tolerance loosened for real
re-encoded footage). Compress: same duration (2 %), same aspect ratio. Trimmer:
output lasts the requested length and frame *t* is source frame *t + start*
(i.e. it starts on the frame picked, not the keyframe before). mov-to-mp4: same
display size and duration. If the browser cannot decode the source (HEVC in
Chromium) only the output is judged: playable, right duration, frames not black
or flat.

**Audio** — real audio is not a pure tone, so this does not use the tone checks.
Both files are decoded and reduced to (a) the RMS loudness contour (50 ms windows
coarsened to 200 ms, since codecs smear transients), whose Pearson correlation
must exceed 0.97 (best of +-2 windows, absorbing encoder delay; a steady tone has
no contour, so its level is compared instead); (b) long-term levels in
+-1/3-octave bands around 100/200/400/800/1600/3200/6400 Hz, which must agree
within 4 dB wherever the band holds more than 0.01 % of the programme's power — a
wrong or doubled resample, filtering or distortion moves them. Also: duration
within max(0.35 s, 0.5 %), same channel count, and the output is not silent.
Sources with more than 2 channels are judged on duration and playability only
(the encoder legitimately downmixes them).

**PDF** — page count and the text of every page (via pdf.js, whitespace ignored)
must equal the source page it should be: all pages for compress, pages 1 and N
for split, all pages for rotate, whose `/Rotate` must additionally be the
source's + 90. A scanned PDF has no text layer, so only the page count (and
rotation) is checked — the test notes `text-layer: none`.

Measured values are attached to each test as annotations (HTML report).
