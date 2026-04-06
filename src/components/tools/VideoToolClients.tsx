"use client";

import dynamic from "next/dynamic";

const VideoToGifUI = dynamic(() => import("./VideoToGifUI").then((m) => ({ default: m.VideoToGifUI })), { ssr: false });
const VideoTrimmerUI = dynamic(() => import("./VideoTrimmerUI").then((m) => ({ default: m.VideoTrimmerUI })), { ssr: false });
const Mp4ToMp3UI = dynamic(() => import("./Mp4ToMp3UI").then((m) => ({ default: m.Mp4ToMp3UI })), { ssr: false });
const WebmToMp4UI = dynamic(() => import("./WebmToMp4UI").then((m) => ({ default: m.WebmToMp4UI })), { ssr: false });
const CompressVideoUI = dynamic(() => import("./CompressVideoUI").then((m) => ({ default: m.CompressVideoUI })), { ssr: false });
const ScreenRecorderUI = dynamic(() => import("./ScreenRecorderUI").then((m) => ({ default: m.ScreenRecorderUI })), { ssr: false });

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

export function ScreenRecorderClient() {
  return <ScreenRecorderUI />;
}
