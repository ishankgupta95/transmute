"use client";

import dynamic from "next/dynamic";

const MergePdfUI = dynamic(() => import("./MergePdfUI").then((m) => ({ default: m.MergePdfUI })), { ssr: false });
const SplitPdfUI = dynamic(() => import("./SplitPdfUI").then((m) => ({ default: m.SplitPdfUI })), { ssr: false });
const CompressPdfUI = dynamic(() => import("./CompressPdfUI").then((m) => ({ default: m.CompressPdfUI })), { ssr: false });
const PdfToJpgUI = dynamic(() => import("./PdfToJpgUI").then((m) => ({ default: m.PdfToJpgUI })), { ssr: false });
const ImagesToPdfUI = dynamic(() => import("./ImagesToPdfUI").then((m) => ({ default: m.ImagesToPdfUI })), { ssr: false });
const RotatePdfUI = dynamic(() => import("./RotatePdfUI").then((m) => ({ default: m.RotatePdfUI })), { ssr: false });
const AddPageNumbersUI = dynamic(() => import("./AddPageNumbersUI").then((m) => ({ default: m.AddPageNumbersUI })), { ssr: false });
const PdfPageReorderUI = dynamic(() => import("./PdfPageReorderUI").then((m) => ({ default: m.PdfPageReorderUI })), { ssr: false });

export function MergePdfClient() { return <MergePdfUI />; }
export function SplitPdfClient() { return <SplitPdfUI />; }
export function CompressPdfClient() { return <CompressPdfUI />; }
export function PdfToJpgClient() { return <PdfToJpgUI />; }
export function ImagesToPdfClient() { return <ImagesToPdfUI />; }
export function RotatePdfClient() { return <RotatePdfUI />; }
export function AddPageNumbersClient() { return <AddPageNumbersUI />; }
export function PdfPageReorderClient() { return <PdfPageReorderUI />; }
