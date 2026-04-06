import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border py-8 px-4">
      <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-text-muted">
        <span>&copy; {new Date().getFullYear()} Transmute</span>
        <div className="flex gap-6">
          <Link href="/about" className="hover:text-text-secondary transition-colors">
            About
          </Link>
          <Link href="/privacy" className="hover:text-text-secondary transition-colors">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
