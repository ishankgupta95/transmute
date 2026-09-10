/** Rasterise a bwip-js SVG (bars as strokes, matrix modules as even-odd fills). */
export function rasterSvg(svg) {
  const box = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const width = Math.round(Number(box[1]));
  const height = Math.round(Number(box[2]));
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const bg = svg.match(/<rect width="100%" height="100%" fill="(#[0-9a-fA-F]{6})"/);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  };
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (bg) { const c = rgb(bg[1]); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, c); }

  for (const m of svg.matchAll(/<path\b([^>]*)\/>/g)) {
    const attrs = m[1];
    const d = attrs.match(/ d="([^"]*)"/)?.[1] ?? "";
    const strokeHex = attrs.match(/stroke="(#[0-9a-fA-F]{6})"/)?.[1];
    const strokeWidth = Number(attrs.match(/stroke-width="([\d.]+)"/)?.[1] ?? 0);
    const fillHex = attrs.match(/ fill="(#[0-9a-fA-F]{6})"/)?.[1];
    if (strokeHex) {
      const c = rgb(strokeHex);
      for (const seg of d.matchAll(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/g)) {
        const x0 = Number(seg[1]), y0 = Number(seg[2]), x1 = Number(seg[3]), y1 = Number(seg[4]);
        const left = Math.round(Math.min(x0, x1) - strokeWidth / 2);
        const right = Math.round(Math.max(x0, x1) + strokeWidth / 2);
        const top = Math.round(Math.min(y0, y1));
        const bottom = Math.round(Math.max(y0, y1));
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) put(x, y, c);
      }
      continue;
    }
    if (/[QCASTqcast]/.test(d)) continue; // glyph outlines of the human-readable line
    const c = rgb(fillHex ?? "#000000");
    const polys = [];
    for (const sub of d.split("Z")) {
      if (!sub.trim()) continue;
      const pts = [];
      for (const p of sub.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)) pts.push([Number(p[2]), Number(p[3])]);
      if (pts.length >= 3) polys.push(pts);
    }
    if (polys.length === 0) continue;
    let top = Infinity, bottom = -Infinity;
    for (const p of polys) for (const [, y] of p) { if (y < top) top = y; if (y > bottom) bottom = y; }
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      const centre = y + 0.5; const cross = [];
      for (const p of polys) for (let i = 0; i < p.length; i++) {
        const [ax, ay] = p[i]; const [bx, by] = p[(i + 1) % p.length];
        if ((ay <= centre && by > centre) || (by <= centre && ay > centre)) cross.push(ax + ((centre - ay) / (by - ay)) * (bx - ax));
      }
      cross.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cross.length; i += 2) for (let x = Math.round(cross[i]); x < Math.round(cross[i + 1]); x++) put(x, y, c);
    }
  }
  return { data, width, height };
}

/** Upscale + a quiet-zone margin so the reader has room, keeping the colours. */
export function padded(image, scale = 4, margin = 40, fill = [255, 255, 255]) {
  const width = image.width * scale + margin * 2;
  const height = image.height * scale + margin * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255;
  }
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const s = (y * image.width + x) * 4;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o = ((margin + y * scale + dy) * width + (margin + x * scale + dx)) * 4;
      data[o] = image.data[s]; data[o + 1] = image.data[s + 1]; data[o + 2] = image.data[s + 2]; data[o + 3] = 255;
    }
  }
  return { data, width, height };
}
