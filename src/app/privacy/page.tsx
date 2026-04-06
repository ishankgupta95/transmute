import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Transmute privacy policy — your files stay on your device.",
};

export default function PrivacyPage() {
  return (
    <main className="flex-1 px-4 py-16 max-w-3xl mx-auto prose prose-invert">
      <h1 className="text-3xl font-bold font-display text-text-primary mb-4">
        Privacy Policy
      </h1>
      <p className="text-text-secondary">
        Transmute processes all files locally in your browser. We do not upload,
        store, or transmit your files to any server.
      </p>
    </main>
  );
}
