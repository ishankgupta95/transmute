import type { Metadata } from "next";
import { tools } from "@/data/tools";
import { OpenWithClient } from "@/components/pwa/OpenWithClient";

/**
 * The landing route for both OS integration points — `share_target`'s POST
 * action and `file_handlers`' launch URL (src/app/manifest.ts). One route for
 * both because they are the same event from the page's side: files arrived
 * from outside the tab.
 */
export const metadata: Metadata = {
  title: "Open a file with Transmute",
  description:
    "Share or open a file with Transmute and see which of its browser-based tools can work on it. Nothing is uploaded.",
  alternates: { canonical: "/open" },
  /*
    Out of the index, for the reason /workspace is: this is a launch surface,
    not content. Its body is empty until an operating system hands it
    something, every tool it can name already has its own indexed page, and
    /all-tools is the crawlable index of those. `follow` stays on so the links
    it does render still pass through to them.
  */
  robots: { index: false, follow: true },
};

export default function OpenPage() {
  return (
    <main className="mx-auto w-full max-w-[840px] flex-1 px-4 pt-11 pb-12 md:px-8">
      <div className="flex flex-col gap-7">
        <h1 className="m-0 font-display text-[clamp(28px,5vw,36px)] leading-[1.14] font-medium tracking-[-0.028em] text-text-primary">
          Open with Transmute
        </h1>

        <p className="m-0 max-w-[620px] font-body text-[15px] leading-[1.75] text-neutral-300">
          Drop a file here — or share one to Transmute from your phone, or open
          one with it from your desktop — and this page names the tools that can
          work on it, out of {tools.length}. As everywhere else on the site, the
          file stays on your device.
        </p>

        <OpenWithClient />
      </div>
    </main>
  );
}
