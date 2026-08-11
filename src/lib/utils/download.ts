import { trackEvent } from "./analytics";
import { currentToolSlug, recordRecentOutput } from "./recent-outputs";

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  // Defer cleanup — revoking the object URL in the same tick as click() can
  // cancel the download before the browser reads the blob (Safari/Chrome), and
  // is why batch "Download All" loops previously produced only the first file.
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  trackEvent({
    action: "file_downloaded",
    category: "conversion",
    label: ext,
    value: Math.round(blob.size / 1024),
  });

  // The rails' RECENT OUTPUT section — metadata only, stays on this device.
  recordRecentOutput({ name: fileName, bytes: blob.size, slug: currentToolSlug() });
}

/**
 * Download multiple files reliably. Browsers throttle or cancel many
 * programmatic downloads fired in one synchronous loop, so multi-file output is
 * bundled into a single ZIP. A single file downloads directly.
 */
export async function downloadFilesAsZip(
  files: { blob: Blob; name: string }[],
  zipName: string,
): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    triggerDownload(files[0].blob, files[0].name);
    return;
  }
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, zipName);
}
