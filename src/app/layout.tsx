import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AnalyticsPageviews } from "@/components/layout/AnalyticsPageviews";
import "./globals.css";

const GA_ID = "G-TCWDH01ZSK";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
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
    title: "Transmute — Free Online File Conversion Tools",
    description:
      "Convert images, PDFs, audio, video, and more — free, private, and entirely in your browser. No uploads, no sign-ups.",
    url: BASE_URL,
    siteName: "Transmute",
    type: "website",
    locale: "en_US",
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
      lang="en"
      className={`${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <link rel="preconnect" href="https://www.google-analytics.com" />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
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
      </body>
    </html>
  );
}
