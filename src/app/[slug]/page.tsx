import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { tools, getToolBySlug } from "@/data/tools";
import { faqs } from "@/data/faqs";
import { getToolMetadata, DEFAULT_HOW_TO_STEPS } from "@/lib/seo/tool-metadata";
import { ToolPageLayout } from "@/components/tools/ToolPageLayout";
import { ImageToolClient } from "@/components/tools/ImageToolClient";
import { ImageCompressorClient } from "@/components/tools/ImageCompressorClient";
import { ImageResizerClient } from "@/components/tools/ImageResizerClient";
import { ImageCropperClient } from "@/components/tools/ImageCropperClient";
import { ExifViewerClient } from "@/components/tools/ExifViewerClient";
import { ImageToBase64Client } from "@/components/tools/ImageToBase64Client";
import { PngToIcoClient } from "@/components/tools/PngToIcoClient";
import { FaviconGeneratorClient } from "@/components/tools/FaviconGeneratorClient";
import { ColorPaletteClient } from "@/components/tools/ColorPaletteClient";
import {
  MergePdfClient,
  SplitPdfClient,
  CompressPdfClient,
  PdfToJpgClient,
  ImagesToPdfClient,
  RotatePdfClient,
  AddPageNumbersClient,
  PdfPageReorderClient,
} from "@/components/tools/PdfToolClients";
import {
  JsonFormatterClient,
  JsonToCsvClient,
  CsvToJsonClient,
  SqlFormatterClient,
  MarkdownToHtmlClient,
  HtmlToMarkdownClient,
  XmlFormatterClient,
  Base64EncodeDecodeClient,
  UrlEncodeDecodeClient,
  JwtDecoderClient,
  HtmlEntityEncodeDecodeClient,
  UuidGeneratorClient,
  PasswordGeneratorClient,
  HashGeneratorClient,
  LoremIpsumGeneratorClient,
  QrCodeGeneratorClient,
  ColorPickerClient,
  CssGradientGeneratorClient,
  BoxShadowGeneratorClient,
  RegexTesterClient,
  CronExpressionGeneratorClient,
  TimestampConverterClient,
  TextDiffClient,
  TextCaseConverterClient,
  WordCounterClient,
} from "@/components/tools/DevToolClients";

export async function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return getToolMetadata(slug);
}

function ToolClient({ tool }: { tool: (typeof tools)[number] }) {
  switch (tool.toolType) {
    case "image-convert":
      return <ImageToolClient tool={tool} />;
    case "image-compress":
      return <ImageCompressorClient tool={tool} />;
    case "image-resize":
      return <ImageResizerClient tool={tool} />;
    case "image-crop":
      return <ImageCropperClient tool={tool} />;
    case "exif-viewer":
      return <ExifViewerClient tool={tool} />;
    case "image-to-base64":
      return <ImageToBase64Client tool={tool} />;
    case "png-to-ico":
      return <PngToIcoClient tool={tool} />;
    case "favicon-generator":
      return <FaviconGeneratorClient tool={tool} />;
    case "color-palette":
      return <ColorPaletteClient tool={tool} />;
    case "merge-pdf":
      return <MergePdfClient />;
    case "split-pdf":
      return <SplitPdfClient />;
    case "compress-pdf":
      return <CompressPdfClient />;
    case "pdf-to-jpg":
      return <PdfToJpgClient />;
    case "images-to-pdf":
      return <ImagesToPdfClient />;
    case "rotate-pdf":
      return <RotatePdfClient />;
    case "add-page-numbers":
      return <AddPageNumbersClient />;
    case "pdf-page-reorder":
      return <PdfPageReorderClient />;
    case "json-formatter":
      return <JsonFormatterClient />;
    case "json-to-csv":
      return <JsonToCsvClient />;
    case "csv-to-json":
      return <CsvToJsonClient />;
    case "sql-formatter":
      return <SqlFormatterClient />;
    case "markdown-to-html":
      return <MarkdownToHtmlClient />;
    case "html-to-markdown":
      return <HtmlToMarkdownClient />;
    case "xml-formatter":
      return <XmlFormatterClient />;
    case "base64-encode-decode":
      return <Base64EncodeDecodeClient />;
    case "url-encode-decode":
      return <UrlEncodeDecodeClient />;
    case "jwt-decoder":
      return <JwtDecoderClient />;
    case "html-entity-encode-decode":
      return <HtmlEntityEncodeDecodeClient />;
    case "uuid-generator":
      return <UuidGeneratorClient />;
    case "password-generator":
      return <PasswordGeneratorClient />;
    case "hash-generator":
      return <HashGeneratorClient />;
    case "lorem-ipsum-generator":
      return <LoremIpsumGeneratorClient />;
    case "qr-code-generator":
      return <QrCodeGeneratorClient />;
    case "color-picker":
      return <ColorPickerClient />;
    case "css-gradient-generator":
      return <CssGradientGeneratorClient />;
    case "box-shadow-generator":
      return <BoxShadowGeneratorClient />;
    case "regex-tester":
      return <RegexTesterClient />;
    case "cron-expression-generator":
      return <CronExpressionGeneratorClient />;
    case "timestamp-converter":
      return <TimestampConverterClient />;
    case "text-diff":
      return <TextDiffClient />;
    case "text-case-converter":
      return <TextCaseConverterClient />;
    case "word-counter":
      return <WordCounterClient />;
    default:
      return null;
  }
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) notFound();

  const toolFaqs = faqs[slug] ?? [];

  return (
    <ToolPageLayout
      tool={tool}
      howToSteps={DEFAULT_HOW_TO_STEPS}
      faqs={toolFaqs}
      aboutText={tool.aboutText}
    >
      <ToolClient tool={tool} />
    </ToolPageLayout>
  );
}
