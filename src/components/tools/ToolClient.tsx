import type { Tool } from "@/data/tools";
import {
  ImageToolClient,
  ImageCompressorClient,
  ImageResizerClient,
  ImageCropperClient,
  ExifViewerClient,
  ImageToBase64Client,
  PngToIcoClient,
  FaviconGeneratorClient,
  ColorPaletteClient,
  JfifToJpgClient,
} from "@/components/tools/ImageToolClients";
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
import { MarkdownToPdfClient } from "@/components/tools/MarkdownToPdfClient";
import {
  Mp3ToWavClient,
  WavToMp3Client,
  M4aToMp3Client,
  AudioTrimmerClient,
  MergeAudioClient,
} from "@/components/tools/AudioToolClients";
import {
  VideoToGifClient,
  VideoTrimmerClient,
  Mp4ToMp3Client,
  WebmToMp4Client,
  CompressVideoClient,
  ScreenRecorderClient,
} from "@/components/tools/VideoToolClients";
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

/**
 * The one toolType → component mapping. Both mount points render tools
 * through this: `app/[slug]/page.tsx` (the SEO tool pages) and the
 * `/workspace` shell (Phase 4) — the same real component either way, never a
 * fork. Every branch resolves to a `next/dynamic` wrapper from the
 * `*ToolClients.tsx` modules, so a tool's heavy code loads when the tool is
 * shown, not when this module is imported.
 */
export function ToolClient({ tool }: { tool: Tool }) {
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
    case "jfif-to-jpg":
      return <JfifToJpgClient tool={tool} />;
    case "merge-pdf":
      return <MergePdfClient />;
    case "split-pdf":
      return <SplitPdfClient />;
    case "compress-pdf":
      return <CompressPdfClient />;
    case "pdf-to-jpg":
      return <PdfToJpgClient tool={tool} />;
    case "images-to-pdf":
      return <ImagesToPdfClient tool={tool} />;
    case "rotate-pdf":
      return <RotatePdfClient />;
    case "add-page-numbers":
      return <AddPageNumbersClient />;
    case "pdf-page-reorder":
      return <PdfPageReorderClient />;
    case "markdown-to-pdf":
      return <MarkdownToPdfClient />;
    case "mp3-to-wav":
      return <Mp3ToWavClient tool={tool} />;
    case "wav-to-mp3":
      return <WavToMp3Client tool={tool} />;
    case "m4a-to-mp3":
      return <M4aToMp3Client tool={tool} />;
    case "audio-trimmer":
      return <AudioTrimmerClient />;
    case "merge-audio":
      return <MergeAudioClient />;
    case "video-to-gif":
      return <VideoToGifClient />;
    case "video-trimmer":
      return <VideoTrimmerClient />;
    case "mp4-to-mp3":
      return <Mp4ToMp3Client />;
    case "webm-to-mp4":
      return <WebmToMp4Client />;
    case "compress-video":
      return <CompressVideoClient />;
    case "screen-recorder":
      return <ScreenRecorderClient />;
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
