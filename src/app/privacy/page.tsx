import type { Metadata } from "next";

const LAST_UPDATED = "31 AUG 2026";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Transmute privacy policy — your files never leave your device. Learn how we protect your data with 100% browser-based processing.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS = [
  {
    h: "Files you process",
    b: "The files you select stay on your device. They are read into browser memory, processed locally, and offered back as a download. At no point are they transmitted. Close the tab and the memory is released.",
  },
  {
    h: "Cookies and local storage",
    b: "This site sets no cookies. Google Analytics is configured to run without cookies or any other browser storage, and Transmute sets none of its own. One localStorage key, transmute-recent-outputs, remembers the name, size and tool of your last 8 downloads so the Recent Output list can show them. That is metadata only — never file contents, and it never leaves your browser. Clearing site data removes it.",
  },
  {
    h: "Analytics",
    b: "Google Analytics counts aggregate traffic — page views and which tools get used. It is the one third-party script the site loads, and it stores nothing in your browser: no cookies, no identifier that survives the visit, which also means it cannot recognise you when you come back. Nothing about the files you process is ever recorded.",
  },
  {
    h: "Advertising",
    b: "Transmute carries no advertising, and no ad network is loaded on any page.",
  },
  {
    h: "External resources",
    b: "The heavy WebAssembly engines some tools rely on — FFmpeg.wasm and MuPDF — are served from this site rather than a third-party CDN, so opening a video or PDF tool hands nobody else your IP address. Every font is self-hosted too, including the Markdown to PDF tool's print typefaces. Beyond the analytics described above, the site makes no third-party requests at all — and nothing it fetches ever carries your file data.",
  },
  {
    h: "Children's privacy",
    b: "Transmute does not knowingly collect personal information from children under 13. The site is a general-purpose utility and requires no account or personal data entry.",
  },
  {
    h: "Changes to this policy",
    b: "This policy may be updated from time to time. Any change is reflected on this page with a new date.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[700px] flex-1 px-4 pt-11 pb-10 md:px-8">
      <div className="flex flex-col gap-6.5">
        <div className="flex flex-wrap items-baseline justify-between gap-5">
          <h1 className="m-0 font-display text-[clamp(28px,5vw,36px)] leading-[1.14] font-medium tracking-[-0.028em] text-text-primary">
            Privacy policy
          </h1>
          <span className="font-mono text-[10.5px] leading-none whitespace-nowrap text-text-muted">
            UPDATED {LAST_UPDATED}
          </span>
        </div>

        {/* The whole policy in one sentence; everything below is detail. */}
        <div className="flex items-start gap-3.5 rounded-[11px] border border-[rgba(126,224,168,.3)] bg-[rgba(126,224,168,.06)] p-[18px]">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-success)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 flex-none"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div className="flex flex-col gap-[5px]">
            <span className="font-display text-[13.5px] leading-[1.4] font-medium text-success">
              Your files never leave your device.
            </span>
            <span className="font-body text-[12.5px] leading-[1.6] text-neutral-400">
              Everything below is detail. That sentence is the policy.
            </span>
          </div>
        </div>

        <div className="flex flex-col">
          {SECTIONS.map((s, i) => (
            <section
              key={s.h}
              className="flex items-start gap-[18px] border-b border-border py-[17px]"
            >
              <span className="w-5 flex-none font-mono text-[10px] leading-[1.7] text-text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h2 className="m-0 font-display text-[13.5px] leading-[1.35] font-medium text-text-primary">
                  {s.h}
                </h2>
                <p className="m-0 font-body text-[12.5px] leading-[1.65] text-neutral-400">
                  {s.b}
                </p>
              </div>
            </section>
          ))}
        </div>

        <p className="m-0 font-body text-[12.5px] leading-[1.65] text-neutral-400">
          Questions about this policy? Reach the maintainer at{" "}
          <a
            href="https://ishank.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm text-accent underline underline-offset-[3px] transition-colors duration-200 hover:text-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ishank.dev
          </a>
          .
        </p>
      </div>
    </main>
  );
}
