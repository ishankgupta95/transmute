"use client";

import dynamic from "next/dynamic";
import type { Tool } from "@/data/tools";
import type { VideoContainer } from "@/lib/tools/video-remux";

const VideoToGifUI = dynamic(() => import("./VideoToGifUI").then((m) => ({ default: m.VideoToGifUI })), { ssr: false });
const VideoTrimmerUI = dynamic(() => import("./VideoTrimmerUI").then((m) => ({ default: m.VideoTrimmerUI })), { ssr: false });
const Mp4ToMp3UI = dynamic(() => import("./Mp4ToMp3UI").then((m) => ({ default: m.Mp4ToMp3UI })), { ssr: false });
const WebmToMp4UI = dynamic(() => import("./WebmToMp4UI").then((m) => ({ default: m.WebmToMp4UI })), { ssr: false });
const CompressVideoUI = dynamic(() => import("./CompressVideoUI").then((m) => ({ default: m.CompressVideoUI })), { ssr: false });
const ScreenRecorderUI = dynamic(() => import("./ScreenRecorderUI").then((m) => ({ default: m.ScreenRecorderUI })), { ssr: false });
const VideoRemuxUI = dynamic(() => import("./VideoRemuxUI").then((m) => ({ default: m.VideoRemuxUI })), { ssr: false });
const MuteVideoUI = dynamic(() => import("./MuteVideoUI").then((m) => ({ default: m.MuteVideoUI })), { ssr: false });
const RotateVideoUI = dynamic(() => import("./RotateVideoUI").then((m) => ({ default: m.RotateVideoUI })), { ssr: false });
/*
  The frame, cut, join and camera pages. All five are single-slug tools with no
  registry-driven variant, so these wrappers pass nothing — the accept list and
  the size cap are read from the registry inside each component, by slug.
*/
const VideoToImagesUI = dynamic(() => import("./VideoToImagesUI").then((m) => ({ default: m.VideoToImagesUI })), { ssr: false });
const VideoThumbnailUI = dynamic(() => import("./VideoThumbnailUI").then((m) => ({ default: m.VideoThumbnailUI })), { ssr: false });
const SplitVideoUI = dynamic(() => import("./SplitVideoUI").then((m) => ({ default: m.SplitVideoUI })), { ssr: false });
const MergeVideoUI = dynamic(() => import("./MergeVideoUI").then((m) => ({ default: m.MergeVideoUI })), { ssr: false });
const WebcamRecorderUI = dynamic(() => import("./WebcamRecorderUI").then((m) => ({ default: m.WebcamRecorderUI })), { ssr: false });

const VIDEO_CONTAINERS = ["mp4", "mov", "mkv"] as const;

function isVideoContainer(value: string | undefined): value is VideoContainer {
  return VIDEO_CONTAINERS.includes(value as VideoContainer);
}

/**
 * Which container a `video-remux` page converts INTO.
 *
 * Six slugs — the `video-to-mp4` hub plus mov/mkv/avi→mp4 and mp4→mov/mkv —
 * share one component, so the target has to come off the registry entry rather
 * than a `switch` on the slug. `targetFormat` is the field `PdfToJpgClient`
 * reads for exactly this job (`PdfToolClients.tsx:30`); it is read through a
 * widening assignment because that field's union is written for the image
 * tools, and this file must compile whether or not it has grown a video arm.
 *
 * The fallback is the slug's own `-to-<ext>` tail, which every page in this
 * cluster carries — ONE rule for all six, not a per-slug table.
 */
function remuxTarget(tool: Tool): VideoContainer {
  const declared: string | undefined = tool.targetFormat;
  if (isVideoContainer(declared)) return declared;
  const tail = /-to-([a-z0-9]+)$/.exec(tool.slug)?.[1];
  if (isVideoContainer(tail)) return tail;
  return "mp4";
}

export function VideoToGifClient() {
  return <VideoToGifUI />;
}

export function VideoTrimmerClient() {
  return <VideoTrimmerUI />;
}

export function Mp4ToMp3Client() {
  return <Mp4ToMp3UI />;
}

export function WebmToMp4Client() {
  return <WebmToMp4UI />;
}

export function CompressVideoClient() {
  return <CompressVideoUI />;
}

/**
 * `compress-video-to-size` — the same WebCodecs encoder, asked a different
 * question: a ceiling in MB instead of one of the three named presets.
 *
 * `mode` is passed EXPLICITLY rather than left to be inferred from the seed
 * being present. A registry entry that forgot `defaultTargetSizeKb` would
 * otherwise render the preset page under this page's URL — a wrong tool with
 * no error anywhere. The seed itself is optional and only pre-fills the field.
 */
export function CompressVideoToSizeClient({ tool }: { tool: Tool }) {
  return (
    <CompressVideoUI
      mode="target-size"
      defaultTargetSizeKb={tool.defaultTargetSizeKb}
      acceptFormats={tool.acceptFormats}
    />
  );
}

export function ScreenRecorderClient() {
  return <ScreenRecorderUI />;
}

export function VideoRemuxClient({ tool }: { tool: Tool }) {
  return (
    <VideoRemuxUI
      target={remuxTarget(tool)}
      acceptFormats={tool.acceptFormats}
      sizeCapMB={tool.maxSizeMB}
    />
  );
}

export function MuteVideoClient({ tool }: { tool: Tool }) {
  return <MuteVideoUI acceptFormats={tool.acceptFormats} sizeCapMB={tool.maxSizeMB} />;
}

export function RotateVideoClient({ tool }: { tool: Tool }) {
  return <RotateVideoUI acceptFormats={tool.acceptFormats} sizeCapMB={tool.maxSizeMB} />;
}

export function VideoToImagesClient() {
  return <VideoToImagesUI />;
}

export function VideoThumbnailClient() {
  return <VideoThumbnailUI />;
}

export function SplitVideoClient() {
  return <SplitVideoUI />;
}

export function MergeVideoClient() {
  return <MergeVideoUI />;
}

export function WebcamRecorderClient() {
  return <WebcamRecorderUI />;
}
