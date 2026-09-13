import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AnalyticsPageviews } from "@/components/layout/AnalyticsPageviews";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import "./globals.css";
import { HTML_LANG, OG_LOCALE } from "@/lib/seo/locale";

const GA_ID = "G-TCWDH01ZSK";

/*
  Preloaded, and spelled out rather than left to the default, because this is
  the font the LCP element is drawn in: the hero `h1` is `font-display`, and
  `--font-display` resolves to `--font-inter` (globals.css:236). The family
  below deliberately opts OUT of preloading, so the contrast between the two
  declarations is the point — a reader should not have to know the default to
  see which font this page treats as critical.
*/
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

/*
  NOT PRELOADED, and that is the whole point of the setting.

  MEASURED on the built home page: four fonts were preloaded, totalling
  78,664 bytes — Inter at 48,432 B and IBM Plex Mono at 10,052 / 10,060 /
  10,120 B for weights 400, 500 and 600. The LCP element is the hero `h1`,
  which is `font-display` -> `--font-inter` (globals.css:236). So THREE OF THE
  FOUR PRELOADS, 30,232 bytes, were competing on the critical path with the one
  font the largest paint actually needs, and none of them could ever draw it.

  `next/font` preloads every declared family by default; `preload: false` stops
  the <link rel=preload> without changing anything else. The face still loads
  the moment the stylesheet references it, and `display: "swap"` is unchanged,
  so mono text renders immediately in the fallback and swaps — which is already
  the behaviour this file asked for. VERIFIED in the built output: the home
  page now emits exactly ONE font preload, Inter's 48,432 B, down from four
  totalling 78,664 B.

  THE TRADE-OFF, stated because it is visible: mono IS used above the fold, in
  the navbar's 10.5px muted status line (desktop only, `xl:flex`). On a slow
  connection that line will show a fallback monospace briefly before swapping.
  Muted secondary chrome swapping is the cost; the page's largest paint getting
  the bandwidth is the benefit. One line to revert if that is the wrong call.

  ⚠ THE LCP IMPROVEMENT ITSELF IS UNMEASURED. Lighthouse ran against the LIVE
  site, and the live site is many tools behind this tree — re-measuring needs a
  deploy. What is measured here is the byte change, nothing more.
*/
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const BASE_URL = "https://transmute.tools";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "Transmute — Free Online File Conversion Tools",
    template: "%s | Transmute",
  },
  description:
    "Free, private, browser-based file conversion tools. Convert images, PDFs, audio, video, and more — no uploads, no sign-ups. Everything runs locally in your browser.",
  keywords: [
    "file converter",
    "online converter",
    "free file conversion",
    "browser-based tools",
    "image converter",
    "pdf tools",
    "audio converter",
    "video converter",
    "developer tools",
    "privacy-first",
    "no upload",
  ],
  alternates: {
    canonical: BASE_URL,
  },
  openGraph: {
    locale: OG_LOCALE,
    title: "Transmute — Free Online File Conversion Tools",
    description:
      "Convert images, PDFs, audio, video, and more — free, private, and entirely in your browser. No uploads, no sign-ups.",
    url: BASE_URL,
    siteName: "Transmute",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Transmute — Free file conversion tools, right in your browser",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Transmute — Free Online File Conversion Tools",
    description:
      "Convert images, PDFs, audio, video, and more — free, private, and entirely in your browser.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  // Matches the navbar ground, so mobile browser chrome blends into the app.
  themeColor: "#161826",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang={HTML_LANG}
      className={`${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <link rel="preconnect" href="https://www.google-analytics.com" />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        {/* Cookieless by decision: client_storage 'none' keeps GA out of
            cookies and browser storage entirely. Each page load gets an
            in-memory client id, so returning visitors count as new — the
            accepted cost of the privacy claim on /privacy and in the footer.
            SPA page_views (AnalyticsPageviews) fire through the same
            dataLayer and don't depend on a cookie-based client id. */}
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}', { client_storage: 'none' });
          `}
        </Script>
      </head>
      {/* The page ground lives here as utilities — `globals.css` is @theme
          plus Tailwind only, no bare element rules. */}
      <body className="min-h-full flex flex-col bg-bg-primary text-text-primary font-body">
        {/* WCAG 2.4.1: the navbar puts eight tab stops in front of every page's
            first control. The wrapper below is what the link targets — it needs
            `flex flex-1 flex-col` because each route's <main className="flex-1">
            was a direct flex child of <body>, and `tabIndex={-1}` because
            otherwise the browser scrolls without moving focus. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[10000] focus:rounded-lg focus:border focus:border-accent focus:bg-bg-primary focus:px-4 focus:py-2 focus:font-body focus:text-sm focus:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Skip to content
        </a>
        <Navbar />
        <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
          {children}
        </div>
        <Footer />
        <CommandPalette />
        {/* GA pageviews for client-side navigations — the head snippet only
            counts the initial document. */}
        <AnalyticsPageviews />
        {/* Registers public/sw.js in production builds only, after `load`, and
            renders nothing until a NEW version is waiting behind the running
            one — at which point it asks, because a tab may be mid-conversion.
            Folded away entirely in dev: `process.env.NODE_ENV` is inlined. */}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
