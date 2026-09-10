import type { Metadata } from "next";
import { tools } from "@/data/tools";

export const metadata: Metadata = {
  title: "About",
  description:
    "About Transmute — free, private, browser-based file conversion tools. Learn how Transmute keeps your files safe with 100% client-side processing.",
  alternates: { canonical: "/about" },
};

const CAPABILITIES = [
  { tag: "IMAGE", text: "Convert between HEIC, WebP, PNG, JPG, AVIF and TIFF" },
  { tag: "IMAGE", text: "Compress, resize and crop with real quality control" },
  { tag: "PDF", text: "Merge, split, compress, rotate and reorder pages" },
  { tag: "AUDIO", text: "Convert and trim MP3, WAV and M4A, or merge tracks" },
  { tag: "VIDEO", text: "Convert to GIF, trim clips, extract audio, compress" },
  { tag: "DEV", text: "Format JSON, SQL and XML; encode Base64 and URLs" },
  { tag: "DEV", text: "Generate UUIDs, passwords, hashes, QR codes, lorem ipsum" },
  { tag: "DEV", text: "Build CSS gradients and box shadows, pick colours" },
] as const;

/*
  This page used to tell every visitor that working in the tab means "faster
  results, no queue, no size cap, and nothing to sign up for". Three of those
  four are still true. "No size cap" is the same unqualified absolute that was
  taken off the drop zones, the spec rows and the homepage tile, and it is
  false in two different ways at once: nine tools ENFORCE a 1.5 GB ceiling and
  refuse a larger file outright ("File is too large (1.56 GB). Maximum is
  1.5 GB." on /video-trimmer), and seventeen more hold the whole file in the
  tab and disclose that on their own drop zone. A site-wide claim that the
  tools themselves contradict is worse than no claim.

  So the paragraph names the numbers instead of denying them, and counts them
  off the registry so they cannot go stale the way the sentence did.
  `Tool.takesNoFile` keeps the denominator honest — a password generator has
  nothing to say about file sizes.
*/
const FILE_TOOLS = tools.filter((t) => !t.takesNoFile);
const UNCAPPED_COUNT = FILE_TOOLS.filter((t) => !t.maxSizeMB && !t.practicalLimitNote).length;
const ENFORCED_CAPS = tools.filter((t) => t.maxSizeMB);
const MEMORY_BOUND_COUNT = tools.filter((t) => t.practicalLimitNote).length;
/* Every enforced cap on the site is the same number; printed the way the drop
   zones print it (`formatCap` in DropZone.tsx), not as "1536 MB". */
const CAP_GB = (Math.max(...ENFORCED_CAPS.map((t) => t.maxSizeMB ?? 0)) / 1024)
  .toFixed(2)
  .replace(/\.?0+$/, "");

const H2 = "m-0 font-display text-[17px] leading-[1.25] font-medium text-text-primary";
const BODY = "m-0 font-body text-sm leading-[1.75] text-neutral-400";
const RULE =
  "h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_32px,var(--color-border)_calc(100%-32px),transparent)]";

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-[700px] flex-1 px-4 pt-11 pb-10 md:px-8">
      <div className="flex flex-col gap-6.5">
        <h1 className="m-0 font-display text-[clamp(28px,5vw,36px)] leading-[1.14] font-medium tracking-[-0.028em] text-text-primary">
          About Transmute
        </h1>

        <p className="m-0 font-body text-[15px] leading-[1.75] text-neutral-300">
          A free collection of browser-based file conversion and developer tools. Every
          tool runs on your device using WebAssembly and modern browser APIs. Your files
          are never uploaded to a server.
        </p>

        <div className={RULE} />

        <section className="flex flex-col gap-[9px]">
          <h2 className={H2}>Why it works this way</h2>
          <p className={BODY}>
            Most online converters ask you to upload a file, wait in a queue, and trust
            them with it. Transmute does the work in your tab instead. That means faster
            results, no queue, and nothing to sign up for — because there is no account
            and no data to hand over.
          </p>
          <p className={BODY}>
            What it does not mean is no limit. There is no upload limit, because there is
            no upload — but a browser tab has a ceiling of its own, and the honest thing
            is to name it. {UNCAPPED_COUNT} of the {FILE_TOOLS.length} tools that take a
            file take one of any size. {ENFORCED_CAPS.length} enforce a {CAP_GB} GB cap
            and print it on the drop zone before you pick anything, and{" "}
            {MEMORY_BOUND_COUNT} more hold the whole file in memory to do their work and
            say so on the page rather than promise otherwise.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={H2}>What you can do</h2>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[9px] border border-border bg-border sm:grid-cols-2">
            {CAPABILITIES.map((c) => (
              <div
                key={c.text}
                className="flex flex-col gap-[5px] bg-bg-primary px-3.5 py-3"
              >
                <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-accent-300">
                  {c.tag}
                </span>
                <span className="font-body text-[12.5px] leading-[1.5] text-neutral-400">
                  {c.text}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-[9px]">
          <h2 className={H2}>How it is built</h2>
          <p className={BODY}>
            Next.js and TypeScript, exported as a fully static site. The heavy lifting is
            done by FFmpeg.wasm, pdf-lib, pdf.js, qpdf, the Canvas API, Web Audio
            and WebCodecs. Because everything compiles to static HTML, CSS and JavaScript,
            there is no backend — and therefore nothing that can leak your files.{" "}
            {tools.length} tools ship this way today.
          </p>
        </section>

        <section className="flex flex-col gap-[9px]">
          <h2 className={H2}>Built by</h2>
          <p className={BODY}>
            Transmute is built and maintained by{" "}
            <a
              href="https://ishank.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-sm text-accent underline underline-offset-[3px] transition-colors duration-200 hover:text-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Ishank
            </a>
            . Feedback and feature requests are welcome.
          </p>
        </section>
      </div>
    </main>
  );
}
