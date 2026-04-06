import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "About Transmute — free, private, browser-based file conversion tools.",
};

export default function AboutPage() {
  return (
    <main className="flex-1 px-4 py-16 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold font-display text-text-primary mb-4">
        About Transmute
      </h1>
      <p className="text-text-secondary">
        Transmute is a collection of free, browser-based file conversion tools.
        Your files never leave your device — all processing happens locally.
      </p>
    </main>
  );
}
