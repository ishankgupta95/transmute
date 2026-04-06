"use client";

import { ExifViewerUI } from "@/components/tools/ExifViewerUI";
import type { Tool } from "@/data/tools";

interface ExifViewerClientProps {
  tool: Tool;
}

export function ExifViewerClient({ tool }: ExifViewerClientProps) {
  return <ExifViewerUI acceptFormats={tool.acceptFormats} />;
}
