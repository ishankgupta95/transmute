"use client";

import { PngToIcoUI } from "@/components/tools/PngToIcoUI";
import type { Tool } from "@/data/tools";

export function PngToIcoClient({ tool }: { tool: Tool }) {
  return <PngToIcoUI acceptFormats={tool.acceptFormats} />;
}
