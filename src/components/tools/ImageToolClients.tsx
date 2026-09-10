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
const JfifToJpgUI = dynamic(() => import("./JfifToJpgUI").then((m) => ({ default: m.JfifToJpgUI })), { ssr: false });

/*
  The Wave 4 image cluster. The first eight are edit verbs: one geometry
  module (`lib/tools/image-edit-core.ts`) drawn by either the worker or the
  main thread, so none of them adds a dependency of its own — what they add is
  a preview canvas per page, which is exactly the kind of thing `ssr: false`
  and a split chunk exist for.

  The last four are not edit verbs and are here for the category rather than
  the pipeline: `compress-png` fetches the oxipng WebAssembly (a real 160 KB
  download, rowed on the homepage), while `ico-to-png`, `base64-to-image` and
  `change-image-dpi` run over bytes and never decode at all — `change-image-dpi`
  cannot, because a canvas re-encode is what destroys the DPI it is setting.
*/
const RotateImageUI = dynamic(() => import("./RotateImageUI").then((m) => ({ default: m.RotateImageUI })), { ssr: false });
const FlipImageUI = dynamic(() => import("./FlipImageUI").then((m) => ({ default: m.FlipImageUI })), { ssr: false });
const AddBorderUI = dynamic(() => import("./AddBorderUI").then((m) => ({ default: m.AddBorderUI })), { ssr: false });
const WatermarkImageUI = dynamic(() => import("./WatermarkImageUI").then((m) => ({ default: m.WatermarkImageUI })), { ssr: false });
const PixelateImageUI = dynamic(() => import("./PixelateImageUI").then((m) => ({ default: m.PixelateImageUI })), { ssr: false });
const CropCircleUI = dynamic(() => import("./CropCircleUI").then((m) => ({ default: m.CropCircleUI })), { ssr: false });
const ImageSplitterUI = dynamic(() => import("./ImageSplitterUI").then((m) => ({ default: m.ImageSplitterUI })), { ssr: false });
const SocialMediaImageResizerUI = dynamic(() => import("./SocialMediaImageResizerUI").then((m) => ({ default: m.SocialMediaImageResizerUI })), { ssr: false });
const CompressPngUI = dynamic(() => import("./CompressPngUI").then((m) => ({ default: m.CompressPngUI })), { ssr: false });
const IcoToPngUI = dynamic(() => import("./IcoToPngUI").then((m) => ({ default: m.IcoToPngUI })), { ssr: false });
const Base64ToImageUI = dynamic(() => import("./Base64ToImageUI").then((m) => ({ default: m.Base64ToImageUI })), { ssr: false });
const ChangeImageDpiUI = dynamic(() => import("./ChangeImageDpiUI").then((m) => ({ default: m.ChangeImageDpiUI })), { ssr: false });

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

export function JfifToJpgClient({ tool }: { tool: Tool }) {
  return <JfifToJpgUI acceptFormats={tool.acceptFormats} />;
}

export function RotateImageClient({ tool }: { tool: Tool }) {
  return <RotateImageUI acceptFormats={tool.acceptFormats} />;
}

export function FlipImageClient({ tool }: { tool: Tool }) {
  return <FlipImageUI acceptFormats={tool.acceptFormats} />;
}

export function AddBorderClient({ tool }: { tool: Tool }) {
  return <AddBorderUI acceptFormats={tool.acceptFormats} />;
}

export function WatermarkImageClient({ tool }: { tool: Tool }) {
  return <WatermarkImageUI acceptFormats={tool.acceptFormats} />;
}

export function PixelateImageClient({ tool }: { tool: Tool }) {
  return <PixelateImageUI acceptFormats={tool.acceptFormats} />;
}

export function CropCircleClient({ tool }: { tool: Tool }) {
  return <CropCircleUI acceptFormats={tool.acceptFormats} />;
}

export function ImageSplitterClient({ tool }: { tool: Tool }) {
  return <ImageSplitterUI acceptFormats={tool.acceptFormats} />;
}

export function SocialMediaImageResizerClient({ tool }: { tool: Tool }) {
  return <SocialMediaImageResizerUI acceptFormats={tool.acceptFormats} />;
}

export function CompressPngClient({ tool }: { tool: Tool }) {
  return <CompressPngUI acceptFormats={tool.acceptFormats} />;
}

export function IcoToPngClient({ tool }: { tool: Tool }) {
  return <IcoToPngUI acceptFormats={tool.acceptFormats} />;
}

/*
  The one tool in this cluster that takes no file: `base64-to-image` reads a
  pasted string, so its registry entry carries `takesNoFile: true` and an empty
  `acceptFormats`, and there is nothing off `tool` to hand down. Written the way
  the dev arm writes its no-prop wrappers.
*/
export function Base64ToImageClient() {
  return <Base64ToImageUI />;
}

export function ChangeImageDpiClient({ tool }: { tool: Tool }) {
  return <ChangeImageDpiUI acceptFormats={tool.acceptFormats} />;
}
