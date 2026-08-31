import Link from "next/link";
import { categories } from "@/data/categories";
import { Logo } from "./Logo";
import { Year } from "./Year";

const SHORT_LABEL: Record<string, string> = {
  "image-tools": "Image",
  "pdf-tools": "PDF",
  "audio-tools": "Audio",
  "video-tools": "Video",
  "developer-tools": "Developer",
};

const SITE_LINKS = [
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
];

const linkClass =
  "font-body text-[12.5px] leading-none text-neutral-400 transition-colors duration-200 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Footer() {
  return (
    <footer className="border-t border-border px-4 pt-11 pb-[34px] md:px-11">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-9 flex flex-col justify-between gap-10 md:flex-row md:gap-15">
          <div className="max-w-[300px]">
            <Logo size={19} className="mb-3" wordmarkClassName="text-[14px]" />
            <p className="m-0 font-body text-[12.5px] leading-[1.6] text-text-muted">
              Browser-based file tools. Free, private, and open about how they work.
            </p>
          </div>

          <div className="flex gap-14">
            <div className="flex flex-col gap-[9px]">
              <span className="mb-0.5 font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
                TOOLS
              </span>
              {categories.map((c) => (
                <Link key={c.slug} href={`/${c.slug}`} className={linkClass}>
                  {SHORT_LABEL[c.slug] ?? c.name}
                </Link>
              ))}
              <Link href="/all-tools" className={linkClass}>
                All tools
              </Link>
            </div>

            <div className="flex flex-col gap-[9px]">
              <span className="mb-0.5 font-mono text-[9.5px] leading-none font-medium tracking-[0.14em] text-text-muted">
                SITE
              </span>
              {SITE_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className={linkClass}>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-5.5 font-mono text-[11px] leading-none text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            © <Year /> TRANSMUTE · BUILT BY{" "}
            <a
              href="https://ishank.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-300 underline underline-offset-[3px] transition-colors duration-200 hover:text-accent"
            >
              ISHANK
            </a>
          </span>
          <span>NO COOKIES · NO FILE EVER TRANSMITTED</span>
        </div>
      </div>
    </footer>
  );
}
