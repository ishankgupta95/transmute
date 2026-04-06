"use client";

import Link from "next/link";
import { tools } from "@/data/tools";

interface SidebarProps {
  currentCategory: string;
}

export function Sidebar({ currentCategory }: SidebarProps) {
  const categoryTools = tools.filter((t) => t.category === currentCategory);

  return (
    <aside className="hidden lg:block w-56 shrink-0">
      <nav className="sticky top-20 space-y-0.5">
        {categoryTools.map((tool) => (
          <Link
            key={tool.slug}
            href={`/${tool.slug}`}
            className="block px-3.5 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] rounded-md transition-all duration-200"
          >
            {tool.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
