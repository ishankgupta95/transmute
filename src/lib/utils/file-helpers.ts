/**
 * The size change between input and output as one mono token — `−86%`, `+12%`,
 * `±0%` — for the stat strips. Signed on purpose: a converted file that GREW
 * has to say so, which is why this is not a "saved" percentage.
 *
 * It lives here because the same six lines were copied into two tool UIs and
 * had already drifted apart (one said `0%` where the other said `±0%`).
 */
export function formatDelta(original: number, converted: number): string {
  if (!Number.isFinite(original) || !Number.isFinite(converted) || original <= 0) return "—";
  const pct = Math.round(((original - converted) / original) * 100);
  if (pct === 0) return "±0%";
  return pct > 0 ? `−${pct}%` : `+${Math.abs(pct)}%`;
}

export function formatFileSize(bytes: number): string {
  // Garbage in (NaN from a failed probe, negative deltas) must not render
  // as "NaN undefined" in a stat tile.
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  // Clamp: anything past the table's end wears the largest unit instead of
  // indexing off it into `undefined`.
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
