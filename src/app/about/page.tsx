import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "About Transmute — free, private, browser-based file conversion tools. Learn how Transmute keeps your files safe with 100% client-side processing.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="flex-1 px-4 py-16 max-w-3xl mx-auto w-full">
      <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight text-text-primary mb-6">
        About Transmute
      </h1>

      <div className="space-y-6 text-text-secondary leading-relaxed">
        <p>
          Transmute is a free, open collection of browser-based file conversion
          and developer tools. Every tool runs entirely on your device using
          WebAssembly and modern browser APIs &mdash; your files are never
          uploaded to a server.
        </p>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Why Transmute?
          </h2>
          <p>
            Most online converters require you to upload files to their servers,
            wait in a queue, and trust them with your data. Transmute takes a
            different approach: all processing happens locally in your browser
            tab. That means faster results, no file size queues, and total
            privacy. There is nothing to sign up for and no data to hand over.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            What You Can Do
          </h2>
          <ul className="list-disc list-inside space-y-1.5 text-text-secondary">
            <li>Convert images between HEIC, WebP, PNG, JPG, AVIF, TIFF, and more</li>
            <li>Compress, resize, and crop images with quality control</li>
            <li>Merge, split, compress, rotate, and reorder PDF pages</li>
            <li>Convert and trim audio (MP3, WAV, M4A) and merge tracks</li>
            <li>Convert video to GIF, trim clips, extract audio, and compress</li>
            <li>Format JSON, SQL, and XML; encode Base64 and URLs</li>
            <li>Generate UUIDs, passwords, hashes, QR codes, and lorem ipsum text</li>
            <li>Build CSS gradients, box shadows, and pick colors</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            How It Works
          </h2>
          <p>
            Transmute is built with Next.js and TypeScript and exported as a
            fully static site. Heavy-lifting is handled by WebAssembly engines
            like FFmpeg.wasm and MuPDF, the Canvas API, Web Audio API, and
            WebCodecs. Because everything compiles to static HTML, CSS, and
            JavaScript, there is no backend server &mdash; and therefore nothing
            that can leak your files.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-bold font-display text-text-primary mb-3">
            Built By
          </h2>
          <p>
            Transmute is built and maintained by{" "}
            <a
              href="https://ishank.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:opacity-80 transition-opacity"
            >
              Ishank
            </a>
            . If you have feedback or feature requests, feel free to get in touch.
          </p>
        </section>
      </div>
    </main>
  );
}
