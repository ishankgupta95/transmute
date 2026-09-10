import type { Metadata } from "next";

import { OfflineSettings } from "@/components/pwa/OfflineSettings";

/**
 * The offline opt-in page.
 *
 * NOT `/offline`: `public/offline.html` is the service worker's navigation
 * fallback and Next copies `public/` into the export root, so a route of that
 * name would emit `out/offline.html` on top of it and one of the two would
 * win silently. The fallback has to stay the hand-written, chunk-free
 * document — it is what renders when nothing else can.
 *
 * The shell is a Server Component and the interactive half is a Client one, so
 * the static export carries the engine table, its byte counts and the whole
 * argument as real HTML. A reader with JavaScript off, or a crawler, still
 * sees exactly what this site would download and when — which is the claim
 * the page exists to make. Only the "stored / not stored" words need a
 * browser, and they are the only words that wait for one.
 */
export const metadata: Metadata = {
  title: "Offline access",
  description:
    "Choose which Transmute engines to keep on your device for offline use — each one named, sized in bytes, and fetched only when you ask. Nothing is downloaded in the background.",
  alternates: { canonical: "/offline-access" },
};

export default function OfflineAccessPage() {
  return (
    <main className="mx-auto w-full max-w-[700px] flex-1 px-4 pt-11 pb-10 md:px-8">
      <OfflineSettings />
    </main>
  );
}
