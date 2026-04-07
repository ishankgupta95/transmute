import Link from "next/link";
import { categories } from "@/data/categories";

const BASE_URL = "https://transmute.tools";

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Transmute",
  url: BASE_URL,
  description:
    "Free, private, browser-based file conversion tools. Convert images, PDFs, audio, video, and more — no uploads, no sign-ups.",
  potentialAction: {
    "@type": "SearchAction",
    target: `${BASE_URL}/?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Transmute",
  url: BASE_URL,
  description:
    "Free, private, browser-based file conversion tools.",
};

const categoryIcons: Record<string, React.ReactNode> = {
  "image-tools": (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  ),
  "pdf-tools": (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  "audio-tools": (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  "video-tools": (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </svg>
  ),
  "developer-tools": (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </svg>
  ),
};

export default function HomePage() {
  return (
      <main className="flex-1 flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />

        {/* Hero Section */}
        <section className="relative flex flex-col items-center justify-center px-4 pt-24 pb-20 overflow-hidden">
          {/* Gradient orbs — matching portfolio blue */}
          <div className="pointer-events-none absolute inset-0">
            <div
              className="absolute top-[-20%] left-[15%] h-[500px] w-[500px] rounded-full opacity-30 blur-[120px]"
              style={{ background: "radial-gradient(circle, rgba(86,184,230,0.35) 0%, transparent 70%)" }}
            />
            <div
              className="absolute bottom-[-10%] right-[10%] h-[400px] w-[400px] rounded-full opacity-20 blur-[100px]"
              style={{ background: "radial-gradient(circle, rgba(86,184,230,0.25) 0%, transparent 70%)" }}
            />
          </div>

          {/* Subtle grid pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />

          <div className="relative z-10 text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-border-hover bg-bg-secondary/60 px-4 py-1.5 text-xs font-medium text-text-secondary backdrop-blur-sm mb-8">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              100% browser-based &middot; No uploads &middot; Free forever
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold font-display tracking-tight mb-6">
              <span className="text-text-primary">Transform your </span>
              <span className="text-accent">
                files instantly
              </span>
            </h1>

            <p className="text-lg md:text-xl text-text-secondary max-w-xl mx-auto leading-relaxed">
              Powerful conversion tools that run entirely in your browser.
              Your files never leave your device.
            </p>
          </div>
        </section>

        {/* Category Cards */}
        <section className="px-4 pb-24">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {categories.map((cat) => (
                <Link
                  key={cat.slug}
                  href={`/${cat.slug}`}
                  className="group relative rounded-lg border border-border bg-bg-elevated p-7 transition-all duration-300 hover:bg-bg-hover hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)] hover:-translate-y-1"
                >
                  {/* Left accent bar on hover */}
                  <div className="absolute top-0 left-0 w-[2px] h-full bg-accent rounded-l-lg transform scale-y-0 origin-top transition-transform duration-300 group-hover:scale-y-100" />
                  <div className="mb-4 inline-flex items-center justify-center rounded-md bg-accent-muted p-3 text-accent border border-[rgba(86,184,230,0.15)] transition-colors group-hover:bg-[rgba(86,184,230,0.12)]">
                    {categoryIcons[cat.slug]}
                  </div>
                  <h2 className="text-lg font-bold font-display text-text-primary mb-2 transition-colors group-hover:text-accent">
                    {cat.name}
                  </h2>
                  <p className="text-sm text-text-secondary leading-relaxed">
                    {cat.description}
                  </p>
                  <div className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-text-muted opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:text-accent group-hover:translate-x-1">
                    Explore tools
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Features strip */}
        <section className="border-t border-border px-4 py-16">
          <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { title: "Private by Design", desc: "Files never leave your browser. Zero server uploads, zero tracking.", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
              { title: "Lightning Fast", desc: "WebAssembly-powered engines deliver near-native conversion speed.", icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z" },
              { title: "No Sign-up", desc: "Start converting immediately. No accounts, no paywalls, no limits.", icon: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3" },
            ].map((feature) => (
              <div key={feature.title} className="text-center md:text-left">
                <div className="inline-flex items-center justify-center rounded-md bg-accent-muted border border-[rgba(86,184,230,0.15)] p-2.5 text-accent mb-4">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={feature.icon} />
                  </svg>
                </div>
                <h3 className="text-sm font-bold font-display text-text-primary mb-1.5">
                  {feature.title}
                </h3>
                <p className="text-sm text-text-muted leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
  );
}
