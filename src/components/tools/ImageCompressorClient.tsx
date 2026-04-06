"use client";

import { ImageCompressorUI } from "@/components/tools/ImageCompressorUI";
import type { Tool } from "@/data/tools";

interface ImageCompressorClientProps {
  tool: Tool;
}

export function ImageCompressorClient({ tool }: ImageCompressorClientProps) {
  return (
    <ImageCompressorUI
      acceptFormats={tool.acceptFormats}
      defaultTargetSizeKb={tool.defaultTargetSizeKb}
    />
  );
}
