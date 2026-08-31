/**
 * Generates the Transmute icon set from the "seam" mark.
 *
 * Source of truth: the Logo design doc — a 32×32 grid, 3-unit stroke, the mark
 * drawn at 68% of the tile on an accent-900 ground inside an accent-800 edge,
 * corner radius 22% of the tile (which reproduces the doc's r exactly at every
 * size it states: 16→4, 32→7, 48→11, 64→14).
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * The OG card is rendered separately (scripts/render-og.mjs) because it sets
 * type, and Inter is not installed system-wide.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ACCENT = "#9184d9";
const TILE_BG = "#2b2741"; // accent-900
const TILE_EDGE = "#423a6a"; // accent-800

/** The mark itself, on a transparent 32×32 grid. */
const MARK = `<path d="M13 6.5 H7.5 V25.5 H13" stroke="${ACCENT}" stroke-width="3" stroke-linejoin="miter" fill="none"/><path d="M16.5 5 A11 11 0 0 1 16.5 27 Z" fill="${ACCENT}"/>`;

/** A rounded app-icon tile with the mark centred at 68%. */
function tile(size) {
  const radius = Math.round(size * 0.22);
  // The doc draws `border:1px solid` on every tile — but at *display* scale: its
  // 512 tile is shown at 120px, so that hairline is 4.27px at true 512. Keep the
  // proportional reading, with a 1px floor so the 16/32/48 tab icons hold the
  // doc's literal hairline instead of a sub-pixel 0.5.
  const edge = Math.max(1, size * 0.008);
  const mark = size * 0.68;
  const offset = (size - mark) / 2;
  const scale = mark / 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${edge / 2}" y="${edge / 2}" width="${size - edge}" height="${size - edge}" rx="${radius}" fill="${TILE_BG}" stroke="${TILE_EDGE}" stroke-width="${edge}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${MARK}</g>
</svg>`;
}

/**
 * Maskable variant: full-bleed ground with no rounding, and the mark pulled in
 * to 56% so it survives whatever shape the platform crops to (the safe zone is
 * the inner 80%).
 */
function maskable(size) {
  const mark = size * 0.56;
  const offset = (size - mark) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${TILE_BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${mark / 32})">${MARK}</g>
</svg>`;
}

/** Minimal ICO container; every entry is a PNG payload (valid for ≤256px). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const png = (size) => sharp(Buffer.from(tile(size))).png({ compressionLevel: 9 }).toBuffer();

async function main() {
  await mkdir(join(ROOT, "public"), { recursive: true });

  // Scalable tab icon — Next's app/icon.svg convention emits sizes="any".
  await writeFile(join(ROOT, "src/app/icon.svg"), `${tile(32)}\n`);

  // iOS home screen.
  await writeFile(join(ROOT, "src/app/apple-icon.png"), await png(180));

  // PWA / manifest.
  await writeFile(join(ROOT, "public/icon-192.png"), await png(192));
  await writeFile(join(ROOT, "public/icon-512.png"), await png(512));
  await writeFile(
    join(ROOT, "public/icon-maskable-512.png"),
    await sharp(Buffer.from(maskable(512))).png({ compressionLevel: 9 }).toBuffer(),
  );

  // Legacy + Windows: one .ico carrying 16, 32 and 48.
  const ico = [];
  for (const size of [16, 32, 48]) ico.push({ size, data: await png(size) });
  await writeFile(join(ROOT, "src/app/favicon.ico"), buildIco(ico));

  console.log(
    "icons written: icon.svg, apple-icon.png, icon-192, icon-512, icon-maskable-512, favicon.ico (16/32/48)",
  );
}

main();
