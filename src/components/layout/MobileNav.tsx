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
        className="p-2 text-text-secondary hover:text-text-primary"
        aria-label="Toggle menu"
      >
        {open ? <X size={24} /> : <Menu size={24} />}
      </button>
      {open && (
        <div className="fixed inset-0 top-14 z-40 bg-bg-primary px-4 py-8">
          <nav className="flex flex-col gap-4">
            {categories.map((cat) => (
              <Link
                key={cat.slug}
                href={`/${cat.slug}`}
                onClick={() => setOpen(false)}
                className="text-lg text-text-secondary hover:text-text-primary transition-colors"
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
