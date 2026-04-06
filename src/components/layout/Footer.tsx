import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border py-10 px-4">
      <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-text-muted">
        <span>
          &copy; {new Date().getFullYear()} Transmute &middot; Built by{" "}
          <a href="https://ishank.dev" target="_blank" rel="noopener noreferrer" className="text-accent hover:opacity-80 transition-opacity">
            Ishank
          </a>
        </span>
        <div className="flex gap-1">
          <Link href="/about" className="px-3 py-1.5 rounded-md hover:text-accent hover:bg-[rgba(255,255,255,0.03)] transition-all duration-200">
            About
          </Link>
          <Link href="/privacy" className="px-3 py-1.5 rounded-md hover:text-accent hover:bg-[rgba(255,255,255,0.03)] transition-all duration-200">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
