"use client";

import { ImageResizerUI } from "@/components/tools/ImageResizerUI";
import type { Tool } from "@/data/tools";

interface ImageResizerClientProps {
  tool: Tool;
}

export function ImageResizerClient({ tool }: ImageResizerClientProps) {
  return <ImageResizerUI acceptFormats={tool.acceptFormats} />;
}
