"use client";

import { ImageCropperUI } from "@/components/tools/ImageCropperUI";
import type { Tool } from "@/data/tools";

interface ImageCropperClientProps {
  tool: Tool;
}

export function ImageCropperClient({ tool }: ImageCropperClientProps) {
  return <ImageCropperUI acceptFormats={tool.acceptFormats} />;
}
