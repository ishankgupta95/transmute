"use client";

import Link from "next/link";
import { categories } from "@/data/categories";
import { MobileNav } from "./MobileNav";

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-[rgba(8,8,10,0.8)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-4 h-16">
        <Link
          href="/"
          className="flex items-center gap-2.5 group"
        >
          <span className="text-lg font-bold font-display text-text-primary tracking-tight">
            Trans<span className="text-accent">mute</span>
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-0.5">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/${cat.slug}`}
              className="px-3.5 py-2 rounded-md text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-all duration-200"
            >
              {cat.name}
            </Link>
          ))}
        </div>

        <MobileNav />
      </div>
    </nav>
  );
}
