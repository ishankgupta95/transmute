import Link from "next/link";
import { categories } from "@/data/categories";

export function Footer() {
  return (
    <footer className="border-t border-border py-10 px-4">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col md:flex-row justify-between gap-8 mb-8">
          <div>
            <span className="text-lg font-bold font-display text-text-primary tracking-tight">
              Trans<span className="text-accent">mute</span>
            </span>
            <p className="text-sm text-text-muted mt-2 max-w-xs leading-relaxed">
              Free, private, browser-based file conversion tools. Your files never leave your device.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-8">
            <div>
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Tools</h3>
              <ul className="space-y-2">
                {categories.map((cat) => (
                  <li key={cat.slug}>
                    <Link
                      href={`/${cat.slug}`}
                      className="text-sm text-text-muted hover:text-accent transition-colors duration-200"
                    >
                      {cat.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">Company</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/blog" className="text-sm text-text-muted hover:text-accent transition-colors duration-200">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="text-sm text-text-muted hover:text-accent transition-colors duration-200">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-sm text-text-muted hover:text-accent transition-colors duration-200">
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6 text-center text-sm text-text-muted">
          &copy; {new Date().getFullYear()} Transmute &middot; Built by{" "}
          <a href="https://ishank.dev" target="_blank" rel="noopener noreferrer" className="text-accent underline hover:opacity-80 transition-opacity">
            Ishank
          </a>
        </div>
      </div>
    </footer>
  );
}
