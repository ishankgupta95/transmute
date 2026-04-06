export interface Category {
  name: string;
  slug: string;
  description: string;
  icon: string;
}

export const categories: Category[] = [
  {
    name: "Image Tools",
    slug: "image-tools",
    description: "Convert, compress, and resize images in your browser.",
    icon: "Image",
  },
  {
    name: "PDF Tools",
    slug: "pdf-tools",
    description: "Merge, split, and manipulate PDF files — no upload needed.",
    icon: "FileText",
  },
  {
    name: "Audio Tools",
    slug: "audio-tools",
    description: "Convert, trim, and merge audio files — all in your browser.",
    icon: "Music",
  },
  {
    name: "Video Tools",
    slug: "video-tools",
    description: "Convert, trim, compress, and record video — powered by FFmpeg.wasm.",
    icon: "Video",
  },
  {
    name: "Developer Tools",
    slug: "developer-tools",
    description: "Format JSON, encode Base64, generate hashes, and more.",
    icon: "Code",
  },
];
