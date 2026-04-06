"use client";

import Link from "next/link";
import { categories } from "@/data/categories";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg-primary/80 backdrop-blur-md">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-14">
        <Link href="/" className="text-lg font-bold font-display text-text-primary">
          Transmute
        </Link>
        <div className="hidden md:flex items-center gap-6">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/${cat.slug}`}
              className="text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
