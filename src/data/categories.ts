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
    name: "Developer Tools",
    slug: "developer-tools",
    description: "Format JSON, encode Base64, generate hashes, and more.",
    icon: "Code",
  },
];
