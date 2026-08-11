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
