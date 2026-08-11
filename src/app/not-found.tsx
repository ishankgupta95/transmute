import Link from "next/link";
import { categories } from "@/data/categories";
import { tools } from "@/data/tools";
import { SearchTrigger } from "@/components/layout/SearchTrigger";

export default function NotFound() {
  return (
    <main className="relative flex flex-1 items-center overflow-hidden px-4 py-20 md:px-11">
      <div className="pointer-events-none absolute -top-[120px] left-[30%] h-[340px] w-[520px] animate-tm-glow rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-accent)_26%,transparent)_0%,transparent_70%)] blur-[140px]" />

      <div className="relative mx-auto grid w-full max-w-[1440px] items-center gap-12 lg:grid-cols-[1fr_400px] lg:gap-20">
        <div className="max-w-[520px]">
          <span className="font-mono text-[10.5px] leading-none font-medium tracking-[0.16em] text-accent-300">
            HTTP 404 · NO SUCH ROUTE
          </span>

          <h1 className="mt-5 mb-4 font-display text-[clamp(32px,6vw,46px)] leading-[1.1] font-medium tracking-[-0.028em] text-text-primary">
            Nothing converts to this.
          </h1>

          <p className="m-0 mb-7 font-body text-[15px] leading-[1.7] text-neutral-400">
            The page you asked for is not one of the {tools.length}. Search for the format
            you have and the format you want — that is usually faster than guessing a URL.
          </p>

          <SearchTrigger
            size="field"
            placeholder={`Search ${tools.length} tools…`}
            className="max-w-[400px]"
          />

          <div className="mt-5.5 flex flex-wrap gap-5.5">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/${c.slug}`}
                className="font-body text-[12.5px] leading-none text-neutral-400 transition-colors duration-200 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>

        {/* The mark with its arc unresolved — the conversion that never happened. */}
        <div className="hidden items-center justify-center lg:flex">
          <svg
            width="200"
            height="200"
            viewBox="0 0 32 32"
            fill="none"
            className="opacity-50"
            aria-hidden="true"
          >
            <path
              d="M13 6.5 H7.5 V25.5 H13"
              stroke="var(--color-neutral-700)"
              strokeWidth="3"
              strokeLinejoin="miter"
              fill="none"
            />
            <path
              d="M16.5 5 A11 11 0 0 1 16.5 27"
              stroke="var(--color-neutral-700)"
              strokeWidth="3"
              strokeDasharray="3 4"
              fill="none"
            />
          </svg>
        </div>
      </div>
    </main>
  );
}
