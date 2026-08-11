/**
 * Renders assets/og-image.svg to public/og-image.png at 1200×630.
 *
 * The card sets type in Inter and IBM Plex Mono, which next/font serves under
 * generated family names and which are not installed system-wide — so a plain
 * SVG rasteriser would silently substitute fonts. Instead the SVG is inlined
 * into a page served by the dev server, where those families resolve, and the
 * <svg> element itself is screenshotted.
 *
 *   npm run dev            # in another terminal
 *   node scripts/render-og.mjs [baseUrl]
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = join(ROOT, "public/og-image.png");

const svg = await readFile(join(ROOT, "assets/og-image.svg"), "utf8");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

await page.evaluate((markup) => {
  document.body.innerHTML = `<div id="og-host" style="position:fixed;inset:0;margin:0">${markup}</div>`;
  const el = document.querySelector("#og-host svg");
  el.style.display = "block";
  el.setAttribute("width", "1200");
  el.setAttribute("height", "630");
}, svg.replace(/<\?xml[^?]*\?>/, ""));

await page.evaluate(() => document.fonts.ready);
await page.locator("#og-host svg").screenshot({ path: OUT, scale: "css" });

await browser.close();
console.log(`og-image.png written from assets/og-image.svg (${BASE})`);
