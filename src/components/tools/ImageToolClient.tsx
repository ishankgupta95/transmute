"use client";

import { ImageConverterUI } from "@/components/tools/ImageConverterUI";
import type { Tool } from "@/data/tools";

interface ImageToolClientProps {
  tool: Tool;
}

export function ImageToolClient({ tool }: ImageToolClientProps) {
  return (
    <ImageConverterUI
      acceptFormats={tool.acceptFormats}
      targetFormat={tool.targetFormat ?? "jpeg"}
      sourceFormat={tool.sourceFormat ?? ""}
    />
  );
}
