import { trackEvent } from "./analytics";

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  trackEvent({
    action: "file_downloaded",
    category: "conversion",
    label: ext,
    value: Math.round(blob.size / 1024),
  });
}
