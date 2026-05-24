"use client";

import dynamic from "next/dynamic";

const MarkdownToPdfUI = dynamic(
  () => import("./MarkdownToPdfUI").then((m) => ({ default: m.MarkdownToPdfUI })),
  { ssr: false },
);

export function MarkdownToPdfClient() {
  return <MarkdownToPdfUI />;
}
