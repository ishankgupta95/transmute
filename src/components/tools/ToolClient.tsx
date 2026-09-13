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
  RotateImageClient,
  FlipImageClient,
  AddBorderClient,
  WatermarkImageClient,
  PixelateImageClient,
  CropCircleClient,
  ImageSplitterClient,
  SocialMediaImageResizerClient,
  CompressPngClient,
  ImageToTextClient,
  IcoToPngClient,
  Base64ToImageClient,
  ChangeImageDpiClient,
  ResizeGifClient,
  GifSpeedChangerClient,
  ReverseGifClient,
  SplitGifClient,
  GifMakerClient,
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
  ExtractPdfPagesClient,
  DeletePdfPagesClient,
  CropPdfClient,
  ChangePdfPageSizeClient,
  PdfResizerClient,
  PdfToTextClient,
  RecompressPdfImagesClient,
  ExtractPdfImagesClient,
  ProtectPdfClient,
  UnlockPdfClient,
  PdfPermissionsClient,
  RepairPdfClient,
  WatermarkPdfClient,
  SignPdfClient,
  AddImageToPdfClient,
  AnnotatePdfClient,
  FillPdfFormClient,
  FlattenPdfClient,
  RemoveMetadataClient,
  PdfEditorClient,
  OcrPdfClient,
} from "@/components/tools/PdfToolClients";
import { MarkdownToPdfClient } from "@/components/tools/MarkdownToPdfClient";
import {
  AudioConvertClient,
  ExtractAudioClient,
  AudioTrimmerClient,
  MergeAudioClient,
  NormalizeAudioClient,
  ChangeAudioVolumeClient,
  ReverseAudioClient,
  RemoveSilenceClient,
  AudioRecorderClient,
} from "@/components/tools/AudioToolClients";
import {
  VideoToGifClient,
  VideoTrimmerClient,
  Mp4ToMp3Client,
  WebmToMp4Client,
  CompressVideoClient,
  CompressVideoToSizeClient,
  ScreenRecorderClient,
  VideoRemuxClient,
  MuteVideoClient,
  RotateVideoClient,
  VideoToImagesClient,
  VideoThumbnailClient,
  SplitVideoClient,
  MergeVideoClient,
  WebcamRecorderClient,
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
  SubtitleConverterClient,
  YamlJsonConverterClient,
  YamlFormatterClient,
  JsonMinifyClient,
  SortDedupeLinesClient,
  XlsxToCsvClient,
  HarViewerClient,
  JwtEncoderClient,
  CharsetConverterClient,
  CrlfLfClient,
  HmacGeneratorClient,
  FileChecksumClient,
  WifiQrCodeClient,
  ChmodCalculatorClient,
  HttpStatusCodesClient,
  TimezoneConverterClient,
  ByteConverterClient,
  AspectRatioCalculatorClient,
  UrlParserClient,
  CreateZipClient,
  UnzipFilesClient,
  ExtractArchiveClient,
  BarcodeGeneratorClient,
  QrCodeReaderClient,
  SvgOptimizerClient,
  DocxToMarkdownClient,
  VcfToCsvClient,
  IcsToCsvClient,
  CsvMarkdownTableClient,
  BcryptGeneratorClient,
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
    /*
      Wave 4's image cluster. One type per slug, and unusually for a block this
      size that is not a default — it is the shape the surfaces force. The
      eight edit verbs share `lib/tools/image-edit-core.ts` the way the audio
      pair pages share one converter, but they do NOT share a surface: a
      rotation is three chips, a watermark is seven controls and a live
      preview, a split is a grid and a deck of tiles, and the resizer is a
      preset picker. There is nothing for a shared component to read off the
      registry that would tell the three apart, which is the test
      `image-convert` and `video-remux` pass and these fail.

      The four below them are not verbs at all and share nothing with each
      other either: `compress-png` is the only page on the site that fetches
      oxipng, and the last three read and write bytes without decoding.
    */
    case "rotate-image":
      return <RotateImageClient tool={tool} />;
    case "flip-image":
      return <FlipImageClient tool={tool} />;
    case "add-border":
      return <AddBorderClient tool={tool} />;
    case "watermark-image":
      return <WatermarkImageClient tool={tool} />;
    case "pixelate-image":
      return <PixelateImageClient tool={tool} />;
    case "crop-circle":
      return <CropCircleClient tool={tool} />;
    case "image-splitter":
      return <ImageSplitterClient tool={tool} />;
    case "social-media-image-resizer":
      return <SocialMediaImageResizerClient tool={tool} />;
    case "compress-png":
      return <CompressPngClient tool={tool} />;
    case "image-to-text":
      return <ImageToTextClient tool={tool} />;
    case "ocr-pdf":
      return <OcrPdfClient />;
    case "vcf-to-csv":
      return <VcfToCsvClient />;
    case "ics-to-csv":
      return <IcsToCsvClient />;
    case "resize-gif":
      return <ResizeGifClient />;
    case "gif-speed-changer":
      return <GifSpeedChangerClient />;
    case "reverse-gif":
      return <ReverseGifClient />;
    case "split-gif":
      return <SplitGifClient />;
    case "gif-maker":
      return <GifMakerClient tool={tool} />;
    case "csv-markdown-table":
      return <CsvMarkdownTableClient />;
    case "bcrypt-generator":
      return <BcryptGeneratorClient />;
    case "ico-to-png":
      return <IcoToPngClient tool={tool} />;
    // The one tool here that takes no file, so the only one whose client
    // takes no `tool`.
    case "base64-to-image":
      return <Base64ToImageClient />;
    case "change-image-dpi":
      return <ChangeImageDpiClient tool={tool} />;
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
    case "extract-pdf-pages":
      return <ExtractPdfPagesClient />;
    case "delete-pdf-pages":
      return <DeletePdfPagesClient />;
    case "crop-pdf":
      return <CropPdfClient />;
    case "change-pdf-page-size":
      return <ChangePdfPageSizeClient />;
    case "pdf-resizer":
      return <PdfResizerClient />;
    case "pdf-to-text":
      return <PdfToTextClient />;
    case "recompress-pdf-images":
      return <RecompressPdfImagesClient />;
    case "extract-images-from-pdf":
      return <ExtractPdfImagesClient />;
    case "protect-pdf":
      return <ProtectPdfClient />;
    case "unlock-pdf":
      return <UnlockPdfClient />;
    case "pdf-permissions":
      return <PdfPermissionsClient />;
    case "repair-pdf":
      return <RepairPdfClient />;
    case "watermark-pdf":
      return <WatermarkPdfClient />;
    case "sign-pdf":
      return <SignPdfClient />;
    case "add-image-to-pdf":
      return <AddImageToPdfClient />;
    case "annotate-pdf":
      return <AnnotatePdfClient />;
    case "fill-pdf-form":
      return <FillPdfFormClient />;
    case "flatten-pdf":
      return <FlattenPdfClient />;
    case "remove-metadata":
      return <RemoveMetadataClient />;
    case "pdf-editor":
      return <PdfEditorClient />;

    case "markdown-to-pdf":
      return <MarkdownToPdfClient />;
    /*
      One case, every audio format pair. `mp3-to-wav`, `wav-to-mp3` and
      `m4a-to-mp3` keep their original toolTypes; every page added since carries
      `audio-convert`. All of them mount the same component, which reads the
      format it STARTS on off the registry entry — so another pair page needs no
      branch here.
    */
    case "mp3-to-wav":
    case "wav-to-mp3":
    case "m4a-to-mp3":
    case "audio-convert":
      return <AudioConvertClient tool={tool} />;
    /*
      `extract-audio` (the hub), `video-to-wav` and `mp4-to-wav`. Same rule:
      the registry names the arm the page opens on.
    */
    case "extract-audio":
      return <ExtractAudioClient tool={tool} />;
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
    /*
      Same encoder as the case above, asked a size instead of a preset. It
      takes `tool` because the registry carries the seed for the MB field
      (`defaultTargetSizeKb`) and the accept string; the client passes
      `mode="target-size"` explicitly, so a missing seed cannot silently
      render the preset tool under this page's URL.
    */
    case "compress-video-to-size":
      return <CompressVideoToSizeClient tool={tool} />;
    case "screen-recorder":
      return <ScreenRecorderClient />;
    /*
      One case, six pages. `video-to-mp4` (the hub), `mov-to-mp4`,
      `mp4-to-mov`, `mkv-to-mp4`, `mp4-to-mkv` and `avi-to-mp4` all carry the
      `video-remux` toolType; the client reads the target container off the
      registry entry, so adding another container page needs no branch here.
    */
    case "video-remux":
      return <VideoRemuxClient tool={tool} />;
    case "mute-video":
      return <MuteVideoClient tool={tool} />;
    case "rotate-video":
      return <RotateVideoClient tool={tool} />;
    /*
      The audio-effects and frame clusters. Every one of these is a single-slug
      tool whose component takes no props, so there is nothing to read off
      `tool` here — the accept list, the size cap and the practical note are
      looked up by slug inside each UI.
    */
    case "normalize-audio":
      return <NormalizeAudioClient />;
    case "change-audio-volume":
      return <ChangeAudioVolumeClient />;
    case "reverse-audio":
      return <ReverseAudioClient />;
    case "remove-silence":
      return <RemoveSilenceClient />;
    case "audio-recorder":
      return <AudioRecorderClient />;
    case "video-to-images":
      return <VideoToImagesClient />;
    case "video-thumbnail":
      return <VideoThumbnailClient />;
    case "split-video":
      return <SplitVideoClient />;
    case "merge-video":
      return <MergeVideoClient />;
    case "webcam-recorder":
      return <WebcamRecorderClient />;
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
    case "subtitle-converter":
      return <SubtitleConverterClient />;
    /*
      Wave 4's developer fills. Every one of these clients takes NO props — the
      dev arm's rule, unchanged since the block above it: the accept string, the
      size note and anything else registry-shaped is looked up by slug inside
      each UI, so there is nothing to hand down here.

      One case, two pages: `yaml-to-json` and `json-to-yaml` share the
      `yaml-json-converter` toolType and one component, which reads the
      direction it OPENS on off the registry — the same arrangement as
      `audio-convert` and `video-remux` further up.
    */
    case "yaml-json-converter":
      return <YamlJsonConverterClient />;
    case "yaml-formatter":
      return <YamlFormatterClient />;
    case "json-minify":
      return <JsonMinifyClient />;
    case "sort-dedupe-lines":
      return <SortDedupeLinesClient />;
    case "xlsx-to-csv":
      return <XlsxToCsvClient />;
    case "har-viewer":
      return <HarViewerClient />;
    case "jwt-encoder":
      return <JwtEncoderClient />;
    case "charset-converter":
      return <CharsetConverterClient />;
    // The slug is `crlf-lf`; the type is `line-endings`, because the tool
    // writes a bare CR as well as the two the slug names.
    case "line-endings":
      return <CrlfLfClient />;
    case "hmac-generator":
      return <HmacGeneratorClient />;
    case "file-checksum":
      return <FileChecksumClient />;
    case "wifi-qr-code":
      return <WifiQrCodeClient />;
    case "chmod-calculator":
      return <ChmodCalculatorClient />;
    case "http-status-codes":
      return <HttpStatusCodesClient />;
    case "timezone-converter":
      return <TimezoneConverterClient />;
    case "byte-converter":
      return <ByteConverterClient />;
    case "aspect-ratio-calculator":
      return <AspectRatioCalculatorClient />;
    case "url-parser":
      return <UrlParserClient />;
    /*
      Wave 4's second batch. Same dev-arm rule as the block above — every one
      of these clients takes NO props. Seven slugs, seven toolTypes: nothing
      here shares a component with anything else, and the three pairs that look
      like they should are the ones worth naming. `create-zip` / `unzip-files`
      share `zip-tools.ts` and no control. `unzip-files` / `extract-archive`
      both open an archive, but the second loads a WebAssembly libarchive to
      reach TAR, 7z and RAR and carries a password field the first cannot use.
      `qr-code-generator` / `qr-code-reader` run in opposite directions and
      share only the WIFI: payload grammar, in `lib/`, under a round-trip test.
    */
    case "create-zip":
      return <CreateZipClient />;
    case "unzip-files":
      return <UnzipFilesClient />;
    case "extract-archive":
      return <ExtractArchiveClient />;
    case "barcode-generator":
      return <BarcodeGeneratorClient />;
    case "qr-code-reader":
      return <QrCodeReaderClient />;
    case "svg-optimizer":
      return <SvgOptimizerClient />;
    case "docx-to-markdown":
      return <DocxToMarkdownClient />;
    default:
      return null;
  }
}
