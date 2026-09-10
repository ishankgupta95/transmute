import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as bwip from "bwip-js/generic";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

export function rasterModules(options) {
  let width = 0, height = 0, pixels = new Uint8Array(0);
  let pending = [];
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < width && y < height) pixels[y * width + x] = 1; };
  const flush = () => {
    if (pending.length === 0) return;
    let top = Infinity, bottom = -Infinity;
    for (const polygon of pending) for (const [, y] of polygon) { if (y < top) top = y; if (y > bottom) bottom = y; }
    for (let y = top; y < bottom; y++) {
      const centre = y + 0.5; const crossings = [];
      for (const polygon of pending) for (let i = 0; i < polygon.length; i++) {
        const [ax, ay] = polygon[i]; const [bx, by] = polygon[(i + 1) % polygon.length];
        if ((ay <= centre && by > centre) || (by <= centre && ay > centre)) crossings.push(ax + ((centre - ay) / (by - ay)) * (bx - ax));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) for (let x = Math.round(crossings[i]); x < Math.round(crossings[i + 1]); x++) set(x, y);
    }
    pending = [];
  };
  const drawing = {
    scale: () => null,
    measure: () => ({ width: 0, ascent: 0, descent: 0 }),
    init(w, h) { width = w; height = h; pixels = new Uint8Array(w * h); },
    line(x0, y0, x1, y1, lw) {
      let ax = x0 | 0, ay = y0 | 0, bx = x1 | 0, by = y1 | 0;
      const w = Math.round(lw) || 1;
      if (by < ay) [ay, by] = [by, ay];
      if (bx < ax) [ax, bx] = [bx, ax];
      const half = (w / 2) | 0;
      if (ax === bx) { ax = ax - w + half; bx = bx + half - 1; } else { ay = ay - half; by = by + w - half - 1; }
      for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) set(x, y);
    },
    polygon(p) { pending.push(p); },
    hexagon(p) { pending.push(p); },
    ellipse() {},
    fill() { flush(); },
    text() {},
    end() { flush(); return { width, height, pixels }; },
  };
  return bwip.render({ ...options, scale: 1 }, drawing);
}

export function toImageData(grid, scale = 6, quietModules = 12) {
  const quiet = quietModules * scale;
  const width = grid.width * scale + quiet * 2;
  const height = grid.height * scale + quiet * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    if (!grid.pixels[y * grid.width + x]) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const offset = ((quiet + y * scale + dy) * width + (quiet + x * scale + dx)) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 0;
    }
  }
  return { data, width, height };
}

export async function init() {
  const wasmPath = resolve(process.cwd(), "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
  const bytes = readFileSync(wasmPath);
  await prepareZXingModule({
    overrides: { wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    fireImmediately: true,
  });
}

export async function decode(options, readerOpts = { tryHarder: true }) {
  const image = toImageData(rasterModules(options));
  const results = await readBarcodes(image, readerOpts);
  return results.map((r) => [r.format, r.text]);
}
