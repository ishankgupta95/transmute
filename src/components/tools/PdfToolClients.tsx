"use client";

import dynamic from "next/dynamic";
import type { Tool } from "@/data/tools";

const MergePdfUI = dynamic(() => import("./MergePdfUI").then((m) => ({ default: m.MergePdfUI })), { ssr: false });
const SplitPdfUI = dynamic(() => import("./SplitPdfUI").then((m) => ({ default: m.SplitPdfUI })), { ssr: false });
const CompressPdfUI = dynamic(() => import("./CompressPdfUI").then((m) => ({ default: m.CompressPdfUI })), { ssr: false });
const PdfToJpgUI = dynamic(() => import("./PdfToJpgUI").then((m) => ({ default: m.PdfToJpgUI })), { ssr: false });
const ImagesToPdfUI = dynamic(() => import("./ImagesToPdfUI").then((m) => ({ default: m.ImagesToPdfUI })), { ssr: false });
const RotatePdfUI = dynamic(() => import("./RotatePdfUI").then((m) => ({ default: m.RotatePdfUI })), { ssr: false });
const AddPageNumbersUI = dynamic(() => import("./AddPageNumbersUI").then((m) => ({ default: m.AddPageNumbersUI })), { ssr: false });
const PdfPageReorderUI = dynamic(() => import("./PdfPageReorderUI").then((m) => ({ default: m.PdfPageReorderUI })), { ssr: false });
const ExtractPdfPagesUI = dynamic(() => import("./ExtractPdfPagesUI").then((m) => ({ default: m.ExtractPdfPagesUI })), { ssr: false });
const DeletePdfPagesUI = dynamic(() => import("./DeletePdfPagesUI").then((m) => ({ default: m.DeletePdfPagesUI })), { ssr: false });
const CropPdfUI = dynamic(() => import("./CropPdfUI").then((m) => ({ default: m.CropPdfUI })), { ssr: false });
const ChangePdfPageSizeUI = dynamic(() => import("./ChangePdfPageSizeUI").then((m) => ({ default: m.ChangePdfPageSizeUI })), { ssr: false });
const PdfResizerUI = dynamic(() => import("./PdfResizerUI").then((m) => ({ default: m.PdfResizerUI })), { ssr: false });
const PdfToTextUI = dynamic(() => import("./PdfToTextUI").then((m) => ({ default: m.PdfToTextUI })), { ssr: false });
const RecompressPdfImagesUI = dynamic(() => import("./RecompressPdfImagesUI").then((m) => ({ default: m.RecompressPdfImagesUI })), { ssr: false });
const ExtractPdfImagesUI = dynamic(() => import("./ExtractPdfImagesUI").then((m) => ({ default: m.ExtractPdfImagesUI })), { ssr: false });
const ProtectPdfUI = dynamic(() => import("./ProtectPdfUI").then((m) => ({ default: m.ProtectPdfUI })), { ssr: false });
const UnlockPdfUI = dynamic(() => import("./UnlockPdfUI").then((m) => ({ default: m.UnlockPdfUI })), { ssr: false });
const PdfPermissionsUI = dynamic(() => import("./PdfPermissionsUI").then((m) => ({ default: m.PdfPermissionsUI })), { ssr: false });
const RepairPdfUI = dynamic(() => import("./RepairPdfUI").then((m) => ({ default: m.RepairPdfUI })), { ssr: false });
const PdfEditorUI = dynamic(() => import("./PdfEditorUI").then((m) => ({ default: m.PdfEditorUI })), { ssr: false });
const WatermarkPdfUI = dynamic(() => import("./WatermarkPdfUI").then((m) => ({ default: m.WatermarkPdfUI })), { ssr: false });
const SignPdfUI = dynamic(() => import("./SignPdfUI").then((m) => ({ default: m.SignPdfUI })), { ssr: false });
const AddImageToPdfUI = dynamic(() => import("./AddImageToPdfUI").then((m) => ({ default: m.AddImageToPdfUI })), { ssr: false });
const AnnotatePdfUI = dynamic(() => import("./AnnotatePdfUI").then((m) => ({ default: m.AnnotatePdfUI })), { ssr: false });
const FillPdfFormUI = dynamic(() => import("./FillPdfFormUI").then((m) => ({ default: m.FillPdfFormUI })), { ssr: false });
const FlattenPdfUI = dynamic(() => import("./FlattenPdfUI").then((m) => ({ default: m.FlattenPdfUI })), { ssr: false });
const RemoveMetadataUI = dynamic(() => import("./RemoveMetadataUI").then((m) => ({ default: m.RemoveMetadataUI })), { ssr: false });

export function MergePdfClient() { return <MergePdfUI />; }
export function SplitPdfClient() { return <SplitPdfUI />; }
export function CompressPdfClient() { return <CompressPdfUI />; }
export function PdfToJpgClient({ tool }: { tool: Tool }) {
  return <PdfToJpgUI defaultFormat={tool.targetFormat ?? "jpeg"} />;
}
export function ImagesToPdfClient({ tool }: { tool: Tool }) {
  return <ImagesToPdfUI acceptFormats={tool.acceptFormats} />;
}
export function RotatePdfClient() { return <RotatePdfUI />; }
export function AddPageNumbersClient() { return <AddPageNumbersUI />; }
export function PdfPageReorderClient() { return <PdfPageReorderUI />; }
export function ExtractPdfPagesClient() { return <ExtractPdfPagesUI />; }
export function DeletePdfPagesClient() { return <DeletePdfPagesUI />; }
export function CropPdfClient() { return <CropPdfUI />; }
export function ChangePdfPageSizeClient() { return <ChangePdfPageSizeUI />; }
export function PdfResizerClient() { return <PdfResizerUI />; }
export function PdfToTextClient() { return <PdfToTextUI />; }
export function RecompressPdfImagesClient() { return <RecompressPdfImagesUI />; }
export function ExtractPdfImagesClient() { return <ExtractPdfImagesUI />; }
export function ProtectPdfClient() { return <ProtectPdfUI />; }
export function UnlockPdfClient() { return <UnlockPdfUI />; }
export function PdfPermissionsClient() { return <PdfPermissionsUI />; }
export function RepairPdfClient() { return <RepairPdfUI />; }
export function WatermarkPdfClient() { return <WatermarkPdfUI />; }
export function SignPdfClient() { return <SignPdfUI />; }
export function AddImageToPdfClient() { return <AddImageToPdfUI />; }
export function AnnotatePdfClient() { return <AnnotatePdfUI />; }
export function FillPdfFormClient() { return <FillPdfFormUI />; }
export function FlattenPdfClient() { return <FlattenPdfUI />; }
export function RemoveMetadataClient() { return <RemoveMetadataUI />; }
export function PdfEditorClient() { return <PdfEditorUI />; }
