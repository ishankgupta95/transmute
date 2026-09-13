/**
 * The one place this site says what language it is in.
 *
 * ── WHY TWO CONSTANTS NEED A FILE ────────────────────────────────────────────
 * Because the language was already stated in ten places and nine of them were
 * silently wrong. `<html lang>` was a literal in layout.tsx, `og:locale` was a
 * literal in the root metadata, and — the part that is easy to be wrong about —
 * a page's `openGraph` block REPLACES the root layout's rather than merging
 * with it. Eight files declare their own. So the root's `locale` bought nothing
 * for any of them, and **212 of 222 exported pages shipped with no `og:locale`
 * at all** (measured 2026-09-13; the 10 that had it were exactly the pages with
 * no openGraph override, and `og:title` was present on 221, so the blocks were
 * there and one field was missing).
 *
 * A constant cannot be forgotten in the tenth metadata block the way a literal
 * can. `og-locale.test.ts` checks that every block reaches for it.
 *
 * ── WHY THIS IS NOT AN i18n MODULE ───────────────────────────────────────────
 * ⚠ It was one, briefly, and the scaffolding was removed on 2026-09-13 when the
 * owner declined i18n. It exported a `LOCALES` tuple, a `Locale` type, a
 * `SCHEMA_LANGUAGE` map nothing ever read, and both values as
 * `Record<Locale, string>` indexed by a `DEFAULT_LOCALE` that could only ever
 * be `"en"`. That is machinery for a decision that has been made the other way,
 * and it made a two-constant fact look like a subsystem. If a second language
 * is ever wanted, plan.md's i18n item has the measurements — and the shape of
 * this file is the smallest part of that job.
 */

/**
 * BCP 47, for `<html lang>`. Hyphenated if a region is ever added.
 * Deliberately separate from the Open Graph form below: `lang` wants a hyphen
 * (`en-US`) and Open Graph wants an underscore (`en_US`), and writing one where
 * the other belongs emits a locale no validator accepts and nothing looks
 * wrong on the page.
 */
export const HTML_LANG = "en";

/** The Open Graph form — underscored region, per the OG spec. */
export const OG_LOCALE = "en_US";
