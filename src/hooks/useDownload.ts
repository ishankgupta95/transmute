"use client";

import { useCallback } from "react";
import { triggerDownload } from "@/lib/utils/download";

export function useDownload() {
  const download = useCallback((blob: Blob, fileName: string) => {
    triggerDownload(blob, fileName);
  }, []);

  return { download };
}
