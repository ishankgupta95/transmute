"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { categories } from "@/data/categories";
import { Logo } from "./Logo";
import { SearchTrigger } from "./SearchTrigger";
import { MobileNav } from "./MobileNav";
import { cn } from "@/lib/utils/cn";

/** The design labels the nav pills by medium, not by page title. */
const SHORT_LABEL: Record<string, string> = {
  "image-tools": "Image",
  "pdf-tools": "PDF",
  "audio-tools": "Audio",
  "video-tools": "Video",
  "developer-tools": "Developer",
};

export function Navbar() {
  const pathname = usePathname();

  const links = [
    ...categories.map((c) => ({
      href: `/${c.slug}`,
      label: SHORT_LABEL[c.slug] ?? c.name,
    })),
    { href: "/blog", label: "Blog" },
  ];

  return (
    <nav className="sticky top-0 z-50 h-[58px] border-b border-border bg-bg-secondary/90 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-5 px-4 md:px-11">
        <Link
          href="/"
          className="flex-none rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-label="Transmute — home"
        >
          <Logo size={21} />
        </Link>

        <div className="ml-3.5 hidden items-center gap-0.5 lg:flex">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-[7px] px-[11px] py-[7px] font-body text-[13px] leading-none whitespace-nowrap transition-colors duration-200",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  active
                    ? "bg-accent/13 text-accent-200"
                    : "text-neutral-400 hover:bg-text-primary/5 hover:text-text-primary",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-3.5">
          <span className="hidden items-center gap-[7px] font-mono text-[10.5px] leading-none tracking-[0.05em] whitespace-nowrap text-text-muted xl:flex">
            <span className="size-[5px] animate-tm-blink rounded-full bg-success shadow-[0_0_8px_rgba(126,224,168,.7)]" />
            NOTHING LEAVES THIS TAB
          </span>
          <SearchTrigger className="hidden sm:flex" />
          {/* Phones have no ⌘K, so the palette needs a tappable way in. */}
          <SearchTrigger size="icon" className="sm:hidden" />
          <MobileNav />
        </div>
      </div>
    </nav>
  );
}
