"use client";

import dynamic from "next/dynamic";

// Text/Data Formatters
const JsonFormatterUI = dynamic(() => import("./JsonFormatterUI").then((m) => ({ default: m.JsonFormatterUI })), { ssr: false });
const JsonToCsvUI = dynamic(() => import("./JsonToCsvUI").then((m) => ({ default: m.JsonToCsvUI })), { ssr: false });
const CsvToJsonUI = dynamic(() => import("./CsvToJsonUI").then((m) => ({ default: m.CsvToJsonUI })), { ssr: false });
const SqlFormatterUI = dynamic(() => import("./SqlFormatterUI").then((m) => ({ default: m.SqlFormatterUI })), { ssr: false });
const MarkdownToHtmlUI = dynamic(() => import("./MarkdownToHtmlUI").then((m) => ({ default: m.MarkdownToHtmlUI })), { ssr: false });
const HtmlToMarkdownUI = dynamic(() => import("./HtmlToMarkdownUI").then((m) => ({ default: m.HtmlToMarkdownUI })), { ssr: false });
const XmlFormatterUI = dynamic(() => import("./XmlFormatterUI").then((m) => ({ default: m.XmlFormatterUI })), { ssr: false });

// Encoders/Decoders
const Base64EncodeDecodeUI = dynamic(() => import("./Base64EncodeDecodeUI").then((m) => ({ default: m.Base64EncodeDecodeUI })), { ssr: false });
const UrlEncodeDecodeUI = dynamic(() => import("./UrlEncodeDecodeUI").then((m) => ({ default: m.UrlEncodeDecodeUI })), { ssr: false });
const JwtDecoderUI = dynamic(() => import("./JwtDecoderUI").then((m) => ({ default: m.JwtDecoderUI })), { ssr: false });
const HtmlEntityEncodeDecodeUI = dynamic(() => import("./HtmlEntityEncodeDecodeUI").then((m) => ({ default: m.HtmlEntityEncodeDecodeUI })), { ssr: false });

// Generators
const UuidGeneratorUI = dynamic(() => import("./UuidGeneratorUI").then((m) => ({ default: m.UuidGeneratorUI })), { ssr: false });
const PasswordGeneratorUI = dynamic(() => import("./PasswordGeneratorUI").then((m) => ({ default: m.PasswordGeneratorUI })), { ssr: false });
const HashGeneratorUI = dynamic(() => import("./HashGeneratorUI").then((m) => ({ default: m.HashGeneratorUI })), { ssr: false });
const LoremIpsumGeneratorUI = dynamic(() => import("./LoremIpsumGeneratorUI").then((m) => ({ default: m.LoremIpsumGeneratorUI })), { ssr: false });
const QrCodeGeneratorUI = dynamic(() => import("./QrCodeGeneratorUI").then((m) => ({ default: m.QrCodeGeneratorUI })), { ssr: false });

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
