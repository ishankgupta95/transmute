"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { categories } from "@/data/categories";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
        aria-label="Toggle menu"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      {open && (
        <div className="fixed inset-0 top-16 z-40 bg-[rgba(8,8,10,0.95)] backdrop-blur-xl px-4 py-8">
          <nav className="flex flex-col gap-2 max-w-sm mx-auto">
            {categories.map((cat) => (
              <Link
                key={cat.slug}
                href={`/${cat.slug}`}
                onClick={() => setOpen(false)}
                className="rounded-md px-4 py-3.5 text-lg font-medium text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-all"
              >
                {cat.name}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
