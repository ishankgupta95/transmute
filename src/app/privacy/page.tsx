import type { Metadata } from "next";

const LAST_UPDATED = "10 SEP 2026";

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
    h: "Check it yourself",
    b: "You do not have to take any of this on trust, and the page will help you check. The status strip under every tool ends with a live count of the network requests this page has made, split into this origin and everything else — it is read from the browser's own resource timeline on your device, not asserted by us, and it is the same number you will see if you open DevTools and look at the Network panel. On most pages that count will not read zero off-origin, and we would rather explain the number than hide it: the two off-origin requests are Google Analytics, described below, which loads once when the page opens and is configured to run without cookies or storage. What matters is what happens next. Open Network, drop a file into a tool, and run it: you will see the engine fetched from this origin the first time and nothing after it — the count stops moving, because no request carries your file anywhere. Two honest limits on that counter, so you know what it does not cover. It says REQUESTS, not bytes sent: the browser tells a page how many bytes it received and nothing whatever about what a request body contained, so a page printing “0 bytes sent” as a measured fact would be claiming something the browser never told it. And it can only see what this document requested — a request made inside a Web Worker, a WebSocket, or a beacon fired as you navigate away does not appear in a document's resource timeline. Your own Network panel has neither limit, which is why it is the check we point you at rather than the one we print.",
  },
  {
    h: "Cookies and browser storage",
    b: "This site sets no cookies: not Transmute's own, and not Google Analytics', which is configured to run without cookies or any other browser storage. Two things do get stored in your browser, and neither is about you or about a file you processed. One is a single localStorage key, transmute-recent-outputs, which remembers the name, size and tool of your last 8 downloads so the Recent Output list can show them — metadata only, never file contents, and it never leaves your browser. The other is a copy of the site's own code: the HTML, scripts, styles and fonts that draw a page, kept so a page opens quickly and, where the browser supports it, without waiting on the network. That copy is code this site published, not anything you brought to it. There is one exception, and it is brief: if you share a file to Transmute from your phone's share sheet, that file is held in the same store for the single navigation it takes to hand it to the page, which deletes it on arrival — it is the only way a shared file can survive the jump from the share sheet to a page that was not yet open, and nothing else you open is ever written there. The engines listed under External resources are deliberately outside it — none of them is fetched in the background, and none is written to storage for later use except at your explicit request, one named engine at a time, with its size shown before the download starts. Clearing site data removes all of it.",
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
    b: "A few tools fetch a library the first time you use them, and every one of those files comes from this domain rather than a third-party CDN — so opening a tool hands nobody else your IP address. That list is the FFmpeg.wasm video engine, the MP3 encoder, the HEIC decoder for iPhone photos, qpdf — a 2.3 MB WebAssembly module, served as /qpdf.js and /qpdf.wasm, that only the four PDF security tools use: password protection, unlocking, permissions and repair — and, since September 2026, three more: the barcode reader behind the QR code reader, served as /zxing_reader.wasm (1,093,289 bytes), the archive reader behind the archive extractor, served as /libarchive.wasm (613,235 bytes), and the PNG optimiser behind the PNG compressor, served as /squoosh_oxipng_bg.wasm (164,172 bytes). None of the seven is fetched when you open the page. Each waits until a tool actually needs it: FFmpeg for a format your browser cannot decode on its own, the MP3 encoder for the first MP3 written, the HEIC decoder for the first iPhone photo opened, qpdf the first time one of those PDF tools actually reads a file, the barcode reader on the first scan, the archive reader on the first archive, the PNG optimiser on the first PNG you compress. Asking for one of them to be kept for offline use is the only other moment any of them is fetched, and that is a request you make by name — see Cookies and browser storage above. The barcode and archive readers are worth one more sentence, because they are the only libraries here that would have broken the promise above on their own: both npm packages are published expecting to pull their WebAssembly from a public CDN — the barcode one has jsDelivr's address compiled into its loader — and both are wired here to the same-origin paths named above instead, so that address is never contacted and never even constructed. The PNG optimiser names no CDN anywhere, but it is not a lucky default either: its loader looks for the WebAssembly beside the worker script that runs it, which is an address this site does not serve, so the same-origin path above is passed to it explicitly. The other PDF tools pull no WebAssembly engine at all — the 10 MB one they used to download has been removed, and what replaced it is ordinary JavaScript, served from here like everything else. Every font is self-hosted too, including the Markdown to PDF tool's print typefaces. Beyond the analytics described above, the site makes no third-party requests at all — and nothing it fetches ever carries your file data.",
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
