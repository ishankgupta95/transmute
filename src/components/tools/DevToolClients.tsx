"use client";

import dynamic from "next/dynamic";

// Text/Data Formatters
const BcryptGeneratorUI = dynamic(() => import("./BcryptGeneratorUI").then((m) => ({ default: m.BcryptGeneratorUI })), { ssr: false });
const CsvMarkdownTableUI = dynamic(() => import("./CsvMarkdownTableUI").then((m) => ({ default: m.CsvMarkdownTableUI })), { ssr: false });
const ContactsCalendarCsvUI = dynamic(() => import("./ContactsCalendarCsvUI").then((m) => ({ default: m.ContactsCalendarCsvUI })), { ssr: false });
const JsonFormatterUI = dynamic(() => import("./JsonFormatterUI").then((m) => ({ default: m.JsonFormatterUI })), { ssr: false });
const JsonToCsvUI = dynamic(() => import("./JsonToCsvUI").then((m) => ({ default: m.JsonToCsvUI })), { ssr: false });
const CsvToJsonUI = dynamic(() => import("./CsvToJsonUI").then((m) => ({ default: m.CsvToJsonUI })), { ssr: false });
const SqlFormatterUI = dynamic(() => import("./SqlFormatterUI").then((m) => ({ default: m.SqlFormatterUI })), { ssr: false });
const MarkdownToHtmlUI = dynamic(() => import("./MarkdownToHtmlUI").then((m) => ({ default: m.MarkdownToHtmlUI })), { ssr: false });
const HtmlToMarkdownUI = dynamic(() => import("./HtmlToMarkdownUI").then((m) => ({ default: m.HtmlToMarkdownUI })), { ssr: false });
const XmlFormatterUI = dynamic(() => import("./XmlFormatterUI").then((m) => ({ default: m.XmlFormatterUI })), { ssr: false });
// One component for both YAML directions: `yaml-to-json` and `json-to-yaml`
// share the `yaml-json-converter` toolType and the page reads which way round
// to open off the registry, exactly as the image and audio pair pages do.
const YamlJsonConverterUI = dynamic(() => import("./YamlJsonConverterUI").then((m) => ({ default: m.YamlJsonConverterUI })), { ssr: false });
const YamlFormatterUI = dynamic(() => import("./YamlFormatterUI").then((m) => ({ default: m.YamlFormatterUI })), { ssr: false });
const JsonMinifyUI = dynamic(() => import("./JsonMinifyUI").then((m) => ({ default: m.JsonMinifyUI })), { ssr: false });
const SortDedupeLinesUI = dynamic(() => import("./SortDedupeLinesUI").then((m) => ({ default: m.SortDedupeLinesUI })), { ssr: false });
const XlsxToCsvUI = dynamic(() => import("./XlsxToCsvUI").then((m) => ({ default: m.XlsxToCsvUI })), { ssr: false });
const HarViewerUI = dynamic(() => import("./HarViewerUI").then((m) => ({ default: m.HarViewerUI })), { ssr: false });

// Encoders/Decoders
const Base64EncodeDecodeUI = dynamic(() => import("./Base64EncodeDecodeUI").then((m) => ({ default: m.Base64EncodeDecodeUI })), { ssr: false });
const UrlEncodeDecodeUI = dynamic(() => import("./UrlEncodeDecodeUI").then((m) => ({ default: m.UrlEncodeDecodeUI })), { ssr: false });
const JwtDecoderUI = dynamic(() => import("./JwtDecoderUI").then((m) => ({ default: m.JwtDecoderUI })), { ssr: false });
const HtmlEntityEncodeDecodeUI = dynamic(() => import("./HtmlEntityEncodeDecodeUI").then((m) => ({ default: m.HtmlEntityEncodeDecodeUI })), { ssr: false });
// `jwt-encoder` sits beside the decoder rather than inside it: signing needs a
// secret and the decoder takes nothing but a token, so the two surfaces share
// no control. `crlf-lf` mounts under the `line-endings` toolType — the slug is
// what people search for, the type is what the tool writes (CR too).
const JwtEncoderUI = dynamic(() => import("./JwtEncoderUI").then((m) => ({ default: m.JwtEncoderUI })), { ssr: false });
const CharsetConverterUI = dynamic(() => import("./CharsetConverterUI").then((m) => ({ default: m.CharsetConverterUI })), { ssr: false });
const CrlfLfUI = dynamic(() => import("./CrlfLfUI").then((m) => ({ default: m.CrlfLfUI })), { ssr: false });

// Generators
const UuidGeneratorUI = dynamic(() => import("./UuidGeneratorUI").then((m) => ({ default: m.UuidGeneratorUI })), { ssr: false });
const PasswordGeneratorUI = dynamic(() => import("./PasswordGeneratorUI").then((m) => ({ default: m.PasswordGeneratorUI })), { ssr: false });
const HashGeneratorUI = dynamic(() => import("./HashGeneratorUI").then((m) => ({ default: m.HashGeneratorUI })), { ssr: false });
const LoremIpsumGeneratorUI = dynamic(() => import("./LoremIpsumGeneratorUI").then((m) => ({ default: m.LoremIpsumGeneratorUI })), { ssr: false });
const QrCodeGeneratorUI = dynamic(() => import("./QrCodeGeneratorUI").then((m) => ({ default: m.QrCodeGeneratorUI })), { ssr: false });
// Three that look like modes of the rows above and are not. `hmac-generator`
// keys a hash; `file-checksum` hangs a comparison surface off the same digests
// `hash-generator` prints; `wifi-qr-code` draws the same squares as
// `qr-code-generator` over a payload with its own escaping rules.
const HmacGeneratorUI = dynamic(() => import("./HmacGeneratorUI").then((m) => ({ default: m.HmacGeneratorUI })), { ssr: false });
const FileChecksumUI = dynamic(() => import("./FileChecksumUI").then((m) => ({ default: m.FileChecksumUI })), { ssr: false });
const WifiQrCodeUI = dynamic(() => import("./WifiQrCodeUI").then((m) => ({ default: m.WifiQrCodeUI })), { ssr: false });

// CSS Tools
const ColorPickerUI = dynamic(() => import("./ColorPickerUI").then((m) => ({ default: m.ColorPickerUI })), { ssr: false });
const CssGradientGeneratorUI = dynamic(() => import("./CssGradientGeneratorUI").then((m) => ({ default: m.CssGradientGeneratorUI })), { ssr: false });
const BoxShadowGeneratorUI = dynamic(() => import("./BoxShadowGeneratorUI").then((m) => ({ default: m.BoxShadowGeneratorUI })), { ssr: false });

// Dev Utilities
const RegexTesterUI = dynamic(() => import("./RegexTesterUI").then((m) => ({ default: m.RegexTesterUI })), { ssr: false });
const CronExpressionGeneratorUI = dynamic(() => import("./CronExpressionGeneratorUI").then((m) => ({ default: m.CronExpressionGeneratorUI })), { ssr: false });
const TimestampConverterUI = dynamic(() => import("./TimestampConverterUI").then((m) => ({ default: m.TimestampConverterUI })), { ssr: false });
const TextDiffUI = dynamic(() => import("./TextDiffUI").then((m) => ({ default: m.TextDiffUI })), { ssr: false });
const TextCaseConverterUI = dynamic(() => import("./TextCaseConverterUI").then((m) => ({ default: m.TextCaseConverterUI })), { ssr: false });
const WordCounterUI = dynamic(() => import("./WordCounterUI").then((m) => ({ default: m.WordCounterUI })), { ssr: false });
const SubtitleConverterUI = dynamic(() => import("./SubtitleConverterUI").then((m) => ({ default: m.SubtitleConverterUI })), { ssr: false });
// The six reference and calculator pages. Every one of them takes no file at
// all — they compute from what you type — so each renders its own surface from
// the first paint rather than waiting on a drop zone.
const ChmodCalculatorUI = dynamic(() => import("./ChmodCalculatorUI").then((m) => ({ default: m.ChmodCalculatorUI })), { ssr: false });
const HttpStatusCodesUI = dynamic(() => import("./HttpStatusCodesUI").then((m) => ({ default: m.HttpStatusCodesUI })), { ssr: false });
const TimezoneConverterUI = dynamic(() => import("./TimezoneConverterUI").then((m) => ({ default: m.TimezoneConverterUI })), { ssr: false });
const ByteConverterUI = dynamic(() => import("./ByteConverterUI").then((m) => ({ default: m.ByteConverterUI })), { ssr: false });
const AspectRatioCalculatorUI = dynamic(() => import("./AspectRatioCalculatorUI").then((m) => ({ default: m.AspectRatioCalculatorUI })), { ssr: false });
const UrlParserUI = dynamic(() => import("./UrlParserUI").then((m) => ({ default: m.UrlParserUI })), { ssr: false });

// Archives. `create-zip` and `unzip-files` share `zip-tools.ts` but not a
// surface — one picks files and writes an index, the other reads an index and
// picks entries — and `extract-archive` is a third page rather than a mode of
// the second: it loads a WebAssembly libarchive to reach TAR, 7z, RAR and the
// compressed-tar family, and that engine is read-only by construction.
const CreateZipUI = dynamic(() => import("./CreateZipUI").then((m) => ({ default: m.CreateZipUI })), { ssr: false });
const UnzipFilesUI = dynamic(() => import("./UnzipFilesUI").then((m) => ({ default: m.UnzipFilesUI })), { ssr: false });
const ExtractArchiveUI = dynamic(() => import("./ExtractArchiveUI").then((m) => ({ default: m.ExtractArchiveUI })), { ssr: false });
// Codes, both directions. `barcode-generator` runs BWIPP over eleven
// symbologies with their own alphabets and check digits, which is not
// `qr-code-generator` with a picker on it; `qr-code-reader` goes the other way
// entirely and shares a LIB with `wifi-qr-code`, not a UI.
const BarcodeGeneratorUI = dynamic(() => import("./BarcodeGeneratorUI").then((m) => ({ default: m.BarcodeGeneratorUI })), { ssr: false });
const QrCodeReaderUI = dynamic(() => import("./QrCodeReaderUI").then((m) => ({ default: m.QrCodeReaderUI })), { ssr: false });
// Two document readers. `svg-optimizer` sits beside `xml-formatter` in kind —
// an SVG is XML — and `docx-to-markdown` feeds mammoth's HTML into the same
// turndown chain `html-to-markdown` configures, off a binary package instead
// of pasted text.
const SvgOptimizerUI = dynamic(() => import("./SvgOptimizerUI").then((m) => ({ default: m.SvgOptimizerUI })), { ssr: false });
const DocxToMarkdownUI = dynamic(() => import("./DocxToMarkdownUI").then((m) => ({ default: m.DocxToMarkdownUI })), { ssr: false });

export function BcryptGeneratorClient() {
  return <BcryptGeneratorUI />;
}

export function CsvMarkdownTableClient() {
  return <CsvMarkdownTableUI />;
}

export function VcfToCsvClient() {
  return <ContactsCalendarCsvUI kind="vcf" />;
}

export function IcsToCsvClient() {
  return <ContactsCalendarCsvUI kind="ics" />;
}

export function JsonFormatterClient() { return <JsonFormatterUI />; }
export function JsonToCsvClient() { return <JsonToCsvUI />; }
export function CsvToJsonClient() { return <CsvToJsonUI />; }
export function SqlFormatterClient() { return <SqlFormatterUI />; }
export function MarkdownToHtmlClient() { return <MarkdownToHtmlUI />; }
export function HtmlToMarkdownClient() { return <HtmlToMarkdownUI />; }
export function XmlFormatterClient() { return <XmlFormatterUI />; }
export function Base64EncodeDecodeClient() { return <Base64EncodeDecodeUI />; }
export function UrlEncodeDecodeClient() { return <UrlEncodeDecodeUI />; }
export function JwtDecoderClient() { return <JwtDecoderUI />; }
export function HtmlEntityEncodeDecodeClient() { return <HtmlEntityEncodeDecodeUI />; }
export function UuidGeneratorClient() { return <UuidGeneratorUI />; }
export function PasswordGeneratorClient() { return <PasswordGeneratorUI />; }
export function HashGeneratorClient() { return <HashGeneratorUI />; }
export function LoremIpsumGeneratorClient() { return <LoremIpsumGeneratorUI />; }
export function QrCodeGeneratorClient() { return <QrCodeGeneratorUI />; }
export function ColorPickerClient() { return <ColorPickerUI />; }
export function CssGradientGeneratorClient() { return <CssGradientGeneratorUI />; }
export function BoxShadowGeneratorClient() { return <BoxShadowGeneratorUI />; }
export function RegexTesterClient() { return <RegexTesterUI />; }
export function CronExpressionGeneratorClient() { return <CronExpressionGeneratorUI />; }
export function TimestampConverterClient() { return <TimestampConverterUI />; }
export function TextDiffClient() { return <TextDiffUI />; }
export function TextCaseConverterClient() { return <TextCaseConverterUI />; }
export function WordCounterClient() { return <WordCounterUI />; }
export function SubtitleConverterClient() { return <SubtitleConverterUI />; }
export function YamlJsonConverterClient() { return <YamlJsonConverterUI />; }
export function YamlFormatterClient() { return <YamlFormatterUI />; }
export function JsonMinifyClient() { return <JsonMinifyUI />; }
export function SortDedupeLinesClient() { return <SortDedupeLinesUI />; }
export function XlsxToCsvClient() { return <XlsxToCsvUI />; }
export function HarViewerClient() { return <HarViewerUI />; }
export function JwtEncoderClient() { return <JwtEncoderUI />; }
export function CharsetConverterClient() { return <CharsetConverterUI />; }
export function CrlfLfClient() { return <CrlfLfUI />; }
export function HmacGeneratorClient() { return <HmacGeneratorUI />; }
export function FileChecksumClient() { return <FileChecksumUI />; }
export function WifiQrCodeClient() { return <WifiQrCodeUI />; }
export function ChmodCalculatorClient() { return <ChmodCalculatorUI />; }
export function HttpStatusCodesClient() { return <HttpStatusCodesUI />; }
export function TimezoneConverterClient() { return <TimezoneConverterUI />; }
export function ByteConverterClient() { return <ByteConverterUI />; }
export function AspectRatioCalculatorClient() { return <AspectRatioCalculatorUI />; }
export function UrlParserClient() { return <UrlParserUI />; }
export function CreateZipClient() { return <CreateZipUI />; }
export function UnzipFilesClient() { return <UnzipFilesUI />; }
export function ExtractArchiveClient() { return <ExtractArchiveUI />; }
export function BarcodeGeneratorClient() { return <BarcodeGeneratorUI />; }
export function QrCodeReaderClient() { return <QrCodeReaderUI />; }
export function SvgOptimizerClient() { return <SvgOptimizerUI />; }
export function DocxToMarkdownClient() { return <DocxToMarkdownUI />; }
