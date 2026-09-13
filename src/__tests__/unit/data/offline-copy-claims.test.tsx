import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ToolPageLayout } from "@/components/tools/ToolPageLayout";
import { faqs } from "@/data/faqs";
import { getToolBySlug } from "@/data/tools";
import { getWorkspaceTool } from "@/data/workspace";

/*
 * THE CLAIMS A DURABLE CACHE TOUCHES.
 *
 * This site is about to keep a copy of itself in storage it manages — a
 * service-worker cache — and three surfaces made claims that a stored copy
 * either falsifies or leaves without an antecedent. Two of the three were
 * already wrong before any of this work started:
 *
 *   1. privacy/page.tsx said "Transmute sets none of its own" browser storage
 *      in a paragraph that then described a localStorage key. The object of
 *      "none of its own" was cookies, but nothing in the sentence said so, and
 *      a cache of the site's own code turns the loose reading into a lie.
 *
 *   2. privacy/page.tsx also said "None of the seven is fetched when you open
 *      the page" after a list that names SEVEN fetched libraries — FFmpeg, the
 *      MP3 encoder, the HEIC decoder, qpdf, the barcode reader, the archive
 *      reader and the PNG optimiser, of which five are WebAssembly. "The four"
 *      matched neither count; it was left behind by an edit that grew the list.
 *
 *   3. ToolPageLayout's status bar rendered "<engine> READY" out of a registry
 *      string. Nothing verified it: /wma-to-mp3 said "WEB AUDIO·LAMEJS·FFMPEG
 *      READY" with the 32 MB core never requested, and said it identically in
 *      an offline tab with no stored copy to load. The fix precedent is one
 *      cell to the right in the same bar — CapabilityReadout.tsx:10-11, "a
 *      capability claim we can't verify is a claim we don't make".
 *
 * Every negative assertion below is paired with a positive one over the same
 * text, because a negative search passes just as happily on an empty read or a
 * typo'd path — the trap engine-disclosure.test.ts documents at length.
 *
 * A NOTE FOR WHOEVER WRITES THE CACHING POLICY, recorded here because this is
 * the file that reasons about which claims a cache breaks: /vendor/lamejs.js
 * and the two /vendor/libheif.* files carry the LGPL argument made on
 * /licenses — they are served unbundled at stable URLs precisely so a
 * recipient can substitute their own build by replacing those files. A cache-first entry for either
 * would shadow the replacement and weaken that argument. Serving them only if
 * a copy is already there, never adding one except on an explicit request, and
 * keeping the removal path working, is what preserves it.
 */

const root = process.cwd();
const readSrc = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const PRIVACY = readSrc("src/app/privacy/page.tsx");
const LAYOUT = readSrc("src/components/tools/ToolPageLayout.tsx");

/** Every FAQ answer on the site, as one lowercased blob. */
const ANSWERS = Object.values(faqs)
  .flat()
  .map((f) => f.answer);

describe("offline copy claims", () => {
  it("reads its sources", () => {
    // The positive control for every negative assertion in this file.
    expect(PRIVACY.length).toBeGreaterThan(1000);
    expect(PRIVACY).toContain("External resources");
    expect(LAYOUT).toContain("data-tool-surface");
    expect(ANSWERS.length).toBeGreaterThan(500);
  });

  describe("privacy policy: what this site keeps in your browser", () => {
    it("no longer says Transmute sets no storage of its own", () => {
      /*
        The sentence a service-worker cache falsifies. It has to go, not be
        qualified: the reading that made it true ("none of its own COOKIES")
        was never written down in it.
      */
      expect(PRIVACY).not.toContain("Transmute sets none of its own");
      // Paired positive: the true half of it is still stated, unambiguously.
      expect(PRIVACY).toContain("This site sets no cookies");
      expect(PRIVACY).toContain("not Transmute's own");
    });

    it("names the site's own code as one of the things stored", () => {
      // The disclosure the cache requires. Without it the section enumerates
      // one store (localStorage) and reads as exhaustive.
      expect(PRIVACY).toContain("a copy of the site's own code");
      expect(PRIVACY).toContain("transmute-recent-outputs");
      // …and says why it is not a privacy cost: it is the site's material.
      expect(PRIVACY).toContain("neither is about you or about a file you processed");
    });

    it("keeps the engines out of that copy, and out of the background", () => {
      /*
        The rule the whole design rests on: 32 MB of FFmpeg is never pulled
        without being asked for. Stated as a constraint rather than as a
        feature, so it is true both before the opt-in path exists and after.
      */
      expect(PRIVACY).toContain("none of them is fetched in the background");
      expect(PRIVACY).toContain("except at your explicit request");
      expect(PRIVACY).toContain("with its size shown before the download starts");
    });

    it("scopes the page's one 'stores nothing' claim to Google Analytics", () => {
      /*
        That claim is true of the analytics script and false of the site. It
        sits one section below the storage list, so a reader skimming headings
        can carry it across — which is roughly how "Transmute sets none of its
        own" survived a page that already described a localStorage key.
      */
      expect(
        [...PRIVACY.matchAll(/stores nothing/g)].length,
        "positive control: the Analytics section is the one place this is said",
      ).toBe(1);
      expect(PRIVACY).toContain(
        "It is the one third-party script the site loads, and it stores nothing in your browser",
      );
    });
  });

  describe("privacy policy: External resources", () => {
    /*
      THE BUG THIS BLOCK EXISTS FOR: the sentence used to read "None of the
      four is fetched" over a list that had quietly grown to seven. A spelled-
      out count is the same failure mode as a spelled-out fraction — no
      arithmetic can contradict an English word — so the word is DERIVED from
      the list here rather than typed on both sides.

      Adding an engine to the policy without adding it to this array (or the
      reverse) now fails, in both directions.
    */
    const FETCHED = [
      "FFmpeg",
      "MP3 encoder",
      "HEIC decoder",
      "qpdf",
      "barcode reader",
      "archive reader",
      "PNG optimiser",
      "OCR engine",
    ] as const;

    const WORDS = [
      "zero", "one", "two", "three", "four", "five", "six",
      "seven", "eight", "nine", "ten", "eleven", "twelve",
    ] as const;
    const counted = `None of the ${WORDS[FETCHED.length]} is fetched when you open the page`;

    it("counts the libraries it actually listed", () => {
      expect(PRIVACY, `the policy should say: "${counted}"`).toContain(counted);
      // …and says it only once, so a stale sentence cannot survive beside a
      // corrected one.
      for (const word of WORDS) {
        if (word === WORDS[FETCHED.length]) continue;
        expect(PRIVACY, `a stale count survives: "None of the ${word}"`).not.toContain(
          `None of the ${word} is fetched`,
        );
      }
    });

    it("says when each of them arrives", () => {
      // The paired positive: a count is only honest if the list is really
      // there. Each name must appear in the section that makes the claim.
      const section = PRIVACY.slice(PRIVACY.indexOf(counted));
      expect(section.length, "the counted sentence was not found at all").toBeGreaterThan(200);
      for (const name of FETCHED) {
        expect(section, `the enumeration does not account for ${name}`).toContain(name);
      }
    });

    it("admits the opt-in as the other moment an engine is fetched", () => {
      // Otherwise "each waits until a tool actually needs it" becomes false
      // the first time someone stores one deliberately.
      expect(PRIVACY).toContain("kept for offline use");
    });
  });

  describe("the tool status bar", () => {
    /** A tool whose registry engine string names the 32 MB core. */
    const SLUG = "wma-to-mp3";

    /**
     * The status-bar row, reached from the one cell this file is not changing.
     * Scoped rather than page-wide because the engine's name is rendered three
     * times — PIPELINE strip, this bar, the spec panel — and only this one was
     * making a claim about it.
     */
    const statusBar = (container: HTMLElement): HTMLElement => {
      /*
        Anchored on the TOOLS INSTALLED cell. It used to be the `0 BYTES SENT`
        cell, chosen as "the one cell this file is not changing" — and then that
        cell was changed: the hard-coded byte claim was replaced by
        `RequestReadout`, which counts this document's own resource timeline
        instead of asserting a number. That readout renders NOTHING in jsdom (no
        PerformanceObserver for resources), so it cannot serve as an anchor
        here. TOOLS INSTALLED is a plain registry-derived string in the same row.
      */
      const anchor = Array.from(container.querySelectorAll("span")).find((el) =>
        (el.textContent ?? "").endsWith("TOOLS INSTALLED"),
      );
      if (!anchor) throw new Error("no TOOLS INSTALLED cell — the status bar did not render");
      const row = anchor.closest("div");
      if (!row) throw new Error("no row element around the status bar");
      return row;
    };

    const renderTool = () => {
      const tool = getToolBySlug(SLUG);
      if (!tool) throw new Error(`${SLUG} is not in the registry`);
      return render(
        <ToolPageLayout tool={tool} howToSteps={["Pick a file"]} faqs={faqs[SLUG] ?? []}>
          <div>tool surface stub</div>
        </ToolPageLayout>,
      );
    };

    it("renders the status bar at all", () => {
      // The positive control for the negative below: if the layout threw or
      // rendered nothing, "the bar does not say READY" would pass on air.
      const { container } = renderTool();
      expect(container.textContent ?? "").toContain("tool surface stub");
      expect(statusBar(container).textContent ?? "").toMatch(/TOOL \d+ OF \d+/);
    });

    it("names the engine", () => {
      const engine = getWorkspaceTool(SLUG)?.engine;
      expect(engine, "no workspace row to take an engine name from").toBeDefined();
      // Measured: this tool's engine string includes the core that costs 32 MB.
      expect(engine).toContain("FFMPEG");
      // Dropping the claim must not drop the fact with it.
      expect(statusBar(renderTool().container).textContent ?? "").toContain(engine!);
    });

    it("does not claim that engine is ready", () => {
      /*
        THE GATE. Put " READY" back after the engine name and this goes red.
      */
      expect(statusBar(renderTool().container).textContent ?? "").not.toContain("READY");
    });

    it("does not reach for a readiness word in the source either", () => {
      // The rendered assertion above cannot tell "READY" from "Ready" or from
      // a word the bar only shows on some other tool's registry row.
      expect(LAYOUT).not.toMatch(/\{ws\?\.engine\}\s*READY/i);
      expect(LAYOUT).toContain("{ws?.engine}");
    });
  });

  describe("the FAQ answers that talk about caching", () => {
    /*
      CHECKED, AND FOUND FINE — recorded so the finding survives.

      Ten answers say an engine is "downloaded once and cached afterwards"
      (flac-to-mp3, ogg-to-mp3, aac-to-mp3, m4a-to-wav, audio-converter,
      mp3-converter, wma-to-mp3, video tools, extract-archive, qr-code-reader).
      None of them becomes false when the site keeps its own cache: no engine
      is precached, so the first visit is unchanged, and an engine a user does
      store deliberately is cached harder than the browser's own copy of it
      was. What they must never grow into is the claim below.
    */
    it("names a cached engine at all", () => {
      // Positive control: the corpus really contains the sentences described.
      const cached = ANSWERS.filter((a) => /cached/i.test(a));
      expect(cached.length).toBeGreaterThanOrEqual(10);
      expect(cached.some((a) => a.includes("31 MB"))).toBe(true);
    });

    it("promises no tool works offline", () => {
      /*
        Whether a tool runs with no network is a fact about ONE device at ONE
        moment — the engine has to be stored there, and per-origin eviction is
        total and silent. A registry-wide FAQ answer cannot know it. If an
        honest offline answer is ever written, it belongs beside the readout
        that derives the state, and this assertion is the thing to come and
        change deliberately.
      */
      for (const answer of ANSWERS) {
        expect(answer, "an FAQ answer promises offline operation").not.toMatch(
          /works? offline|available offline|use (?:it|this) offline|without an internet connection/i,
        );
      }
    });
  });
});
