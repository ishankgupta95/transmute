"use client";

import { FaviconGeneratorUI } from "@/components/tools/FaviconGeneratorUI";
import type { Tool } from "@/data/tools";

export function FaviconGeneratorClient({ tool }: { tool: Tool }) {
  return <FaviconGeneratorUI acceptFormats={tool.acceptFormats} />;
}
