"use client";

import { ColorPaletteUI } from "@/components/tools/ColorPaletteUI";
import type { Tool } from "@/data/tools";

export function ColorPaletteClient({ tool }: { tool: Tool }) {
  return <ColorPaletteUI acceptFormats={tool.acceptFormats} />;
}
