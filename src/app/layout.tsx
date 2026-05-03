import type { Metadata } from "next";
import Script from "next/script";
import { Syne, Outfit } from "next/font/google";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import "./globals.css";

const GA_ID = "G-TCWDH01ZSK";
const ADSENSE_ID = "ca-pub-8318354633894162";
const ADS_ENABLED = process.env.NEXT_PUBLIC_ADS_ENABLED === "true";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${outfit.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <link rel="preconnect" href="https://www.google-analytics.com" />
        {ADS_ENABLED && (
          <>
            <link rel="preconnect" href="https://pagead2.googlesyndication.com" />
            <link rel="preconnect" href="https://googleads.g.doubleclick.net" />
            <link rel="preconnect" href="https://tpc.googlesyndication.com" />
          </>
        )}
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
        {ADS_ENABLED && (
          <Script
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_ID}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
      </head>
      <body className="min-h-full flex flex-col">
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
