import type { Metadata } from "next";

const LAST_UPDATED = "April 7, 2026";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Transmute privacy policy — your files never leave your device. Learn how we protect your data with 100% browser-based processing.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="flex-1 px-4 py-16 max-w-3xl mx-auto w-full">
      <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-6">
        Privacy Policy
      </h1>

      <p className="text-text-muted text-sm mb-8">Last updated: {LAST_UPDATED}</p>

      <div className="space-y-8 text-text-secondary leading-relaxed">
        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Overview
          </h2>
          <p>
            Transmute is designed to be private by default. All file processing
            happens locally in your browser using WebAssembly and native browser
            APIs. Your files are never uploaded to any server operated by
            Transmute or any third party.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Files You Process
          </h2>
          <p>
            When you use any Transmute tool, the files you select stay on your
            device. They are read into your browser&rsquo;s memory, processed
            locally, and the result is offered as a download. At no point are
            your files transmitted over the network. Once you close the tab, the
            browser releases all associated memory.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Cookies &amp; Local Storage
          </h2>
          <p>
            Transmute does not set any first-party cookies or store personal
            data in local storage. If third-party advertising is enabled on the
            site, ad network scripts may set their own cookies in accordance
            with their respective privacy policies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Analytics
          </h2>
          <p>
            Transmute may use privacy-respecting analytics to understand
            aggregate traffic patterns such as page views and popular tools. No
            personally identifiable information is collected, and no data about
            the files you process is ever recorded.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Third-Party Advertising
          </h2>
          <p>
            Transmute may display advertisements provided by third-party ad
            networks such as Google AdSense. These networks may use cookies and
            similar technologies to serve ads based on your browsing activity.
            You can opt out of personalized advertising at{" "}
            <a
              href="https://www.google.com/settings/ads"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:opacity-80 transition-opacity"
            >
              Google Ads Settings
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            External Resources
          </h2>
          <p>
            Some tools load open-source WebAssembly modules from CDNs (for
            example, FFmpeg.wasm from unpkg). These requests are standard
            browser resource fetches and do not transmit any of your file data.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Children&rsquo;s Privacy
          </h2>
          <p>
            Transmute does not knowingly collect any personal information from
            children under the age of 13. The site is a general-purpose utility
            tool and does not require account creation or personal data entry.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Changes to This Policy
          </h2>
          <p>
            This privacy policy may be updated from time to time. Any changes
            will be reflected on this page with an updated date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Contact
          </h2>
          <p>
            If you have questions about this privacy policy, you can reach the
            maintainer at{" "}
            <a
              href="https://ishank.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:opacity-80 transition-opacity"
            >
              ishank.dev
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
