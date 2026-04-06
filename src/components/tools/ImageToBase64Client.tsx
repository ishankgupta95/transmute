"use client";

import { ImageToBase64UI } from "@/components/tools/ImageToBase64UI";
import type { Tool } from "@/data/tools";

export function ImageToBase64Client({ tool }: { tool: Tool }) {
  return <ImageToBase64UI acceptFormats={tool.acceptFormats} />;
}
