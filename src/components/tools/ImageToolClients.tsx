"use client";

import dynamic from "next/dynamic";
import type { Tool } from "@/data/tools";

/**
 * Image tool clients, code-split.
 *
 * These UIs pull the heaviest non-WASM dependencies in the app — `pica`,
 * `cropperjs`, `exifreader`, `jszip`. Statically importing them into
 * `app/[slug]/page.tsx` put all of that in the shared chunk for *every* tool
 * route, so opening the password generator downloaded an image resampler.
 *
 * `ssr: false` is required (and safe): every one of these touches canvas or
 * `URL.createObjectURL` on mount, and the route is prerendered at build time
 * under `output: "export"`. Mirrors `DevToolClients.tsx`.
 */

const ImageConverterUI = dynamic(() => import("./ImageConverterUI").then((m) => ({ default: m.ImageConverterUI })), { ssr: false });
const ImageCompressorUI = dynamic(() => import("./ImageCompressorUI").then((m) => ({ default: m.ImageCompressorUI })), { ssr: false });
const ImageResizerUI = dynamic(() => import("./ImageResizerUI").then((m) => ({ default: m.ImageResizerUI })), { ssr: false });
const ImageCropperUI = dynamic(() => import("./ImageCropperUI").then((m) => ({ default: m.ImageCropperUI })), { ssr: false });
const ExifViewerUI = dynamic(() => import("./ExifViewerUI").then((m) => ({ default: m.ExifViewerUI })), { ssr: false });
const ImageToBase64UI = dynamic(() => import("./ImageToBase64UI").then((m) => ({ default: m.ImageToBase64UI })), { ssr: false });
const PngToIcoUI = dynamic(() => import("./PngToIcoUI").then((m) => ({ default: m.PngToIcoUI })), { ssr: false });
const FaviconGeneratorUI = dynamic(() => import("./FaviconGeneratorUI").then((m) => ({ default: m.FaviconGeneratorUI })), { ssr: false });
const ColorPaletteUI = dynamic(() => import("./ColorPaletteUI").then((m) => ({ default: m.ColorPaletteUI })), { ssr: false });

export function ImageToolClient({ tool }: { tool: Tool }) {
  return (
    <ImageConverterUI
      acceptFormats={tool.acceptFormats}
      targetFormat={tool.targetFormat ?? "jpeg"}
      sourceFormat={tool.sourceFormat ?? ""}
    />
  );
}

export function ImageCompressorClient({ tool }: { tool: Tool }) {
  return (
    <ImageCompressorUI
      acceptFormats={tool.acceptFormats}
      defaultTargetSizeKb={tool.defaultTargetSizeKb}
    />
  );
}

export function ImageResizerClient({ tool }: { tool: Tool }) {
  return <ImageResizerUI acceptFormats={tool.acceptFormats} />;
}

export function ImageCropperClient({ tool }: { tool: Tool }) {
  return <ImageCropperUI acceptFormats={tool.acceptFormats} />;
}

export function ExifViewerClient({ tool }: { tool: Tool }) {
  return <ExifViewerUI acceptFormats={tool.acceptFormats} />;
}

export function ImageToBase64Client({ tool }: { tool: Tool }) {
  return <ImageToBase64UI acceptFormats={tool.acceptFormats} />;
}

export function PngToIcoClient({ tool }: { tool: Tool }) {
  return <PngToIcoUI acceptFormats={tool.acceptFormats} />;
}

export function FaviconGeneratorClient({ tool }: { tool: Tool }) {
  return <FaviconGeneratorUI acceptFormats={tool.acceptFormats} />;
}

export function ColorPaletteClient({ tool }: { tool: Tool }) {
  return <ColorPaletteUI acceptFormats={tool.acceptFormats} />;
}
