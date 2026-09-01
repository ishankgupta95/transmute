export interface Category {
  name: string;
  slug: string;
  description: string;
  icon: string;
  /** Nav-pill label — the medium, not the page title. */
  shortName: string;
  /** What actually does the work, shown in the hub's stat strip. */
  engine: string;
  /** The "I have a…" chips in the hub sidebar. */
  formats: string[];
}

export const categories: Category[] = [
  {
    name: "Image Tools",
    slug: "image-tools",
    description: "Convert, compress, and resize images in your browser.",
    icon: "Image",
    shortName: "Image",
    engine: "CANVAS 2D",
    formats: ["JPG", "PNG", "HEIC", "WEBP", "AVIF", "SVG", "BMP", "TIFF", "ICO"],
  },
  {
    name: "PDF Tools",
    slug: "pdf-tools",
    description: "Merge, split, and manipulate PDF files — no upload needed.",
    icon: "FileText",
    shortName: "PDF",
    engine: "PDF-LIB · PDFJS",
    formats: ["PDF", "JPG", "PNG", "WEBP", "MD"],
  },
  {
    name: "Audio Tools",
    slug: "audio-tools",
    description: "Convert, trim, and merge audio files — all in your browser.",
    icon: "Music",
    shortName: "Audio",
    engine: "WEB AUDIO",
    formats: ["MP3", "WAV", "M4A", "OGG", "FLAC", "AAC"],
  },
  {
    name: "Video Tools",
    slug: "video-tools",
    description: "Convert, trim, compress, and record video — WebCodecs and FFmpeg.wasm, in your tab.",
    icon: "Video",
    shortName: "Video",
    engine: "FFMPEG · WEBCODECS",
    formats: ["MP4", "WEBM", "MOV", "M4V", "GIF"],
  },
  {
    name: "Developer Tools",
    slug: "developer-tools",
    description: "Format JSON, encode Base64, generate hashes, and more.",
    icon: "Code",
    shortName: "Developer",
    engine: "NATIVE JS",
    formats: ["JSON", "CSV", "XML", "SQL", "MD", "HTML", "TXT", "JWT"],
  },
];

export function getCategoryBySlug(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}
