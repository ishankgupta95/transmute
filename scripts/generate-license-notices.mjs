import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerate `public/licenses/third-party-notices.txt` from the installed
 * dependency tree.
 *
 * Almost every licence this app has to honour requires that the library's own
 * copyright and permission notice travel with the copy we serve. Writing that
 * inventory by hand guarantees it goes stale the first time someone adds a
 * dependency, so it is generated: for each runtime dependency this walks the
 * installed package, finds whatever LICENSE / COPYING / NOTICE file it ships,
 * and reproduces it verbatim under a header naming the package, its version
 * and its declared licence.
 *
 * The output is CHECKED IN rather than produced by `copy:wasm`. The /licenses
 * page links it, and a compliance document that silently disappears when a
 * build step is skipped is worse than useless — this way it is reviewable in a
 * diff, and a dependency change that alters the notices shows up there.
 *
 * Packages that ship no licence file at all are listed at the end of the run
 * and must be covered by hand in `src/app/licenses/page.tsx` — today that is
 * `@ffmpeg/ffmpeg` and `@ffmpeg/util`, both MIT. Do not let that list grow
 * silently: if this prints a package you have not accounted for on the page,
 * the page is now incomplete.
 *
 * Run it after ANY dependency change:  node scripts/generate-license-notices.mjs
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/*
  Where the two notices files are written. Defaults to the checked-in location;
  `--out-dir <path>` sends them somewhere else.

  WHY THE FLAG EXISTS. `license-notices.test.ts` proves the checked-in notices
  still describe the installed tree by regenerating and diffing, and its comment
  said it "regenerates into a temporary location and compares" — which was not
  true. It ran this script against the repo root, so the generator OVERWROTE the
  very file the test then re-read. A stale file therefore failed the run once and
  was silently repaired by it, so the next run passed: a gate that cannot fail
  twice, which is this repo's own "a verification gate that cannot fail proves
  nothing" in its subtler form. It also meant a test mutated the working tree.
  With --out-dir the comparison is real and the tree is left alone.
*/
const outDirFlag = process.argv.indexOf("--out-dir");
const outDir =
  outDirFlag !== -1 && process.argv[outDirFlag + 1]
    ? path.resolve(process.argv[outDirFlag + 1])
    : path.join(root, "public/licenses");

const BAR = "=".repeat(78);

/**
 * Walk the runtime dependency tree TRANSITIVELY.
 *
 * Direct dependencies alone are not the set that reaches a browser: pdf-lib
 * pulls in pako and @pdf-lib/standard-fonts, and their code is executed in the
 * visitor's tab just as ours is, so their notices are owed just as much. An
 * earlier version of this script listed only the direct names and the page
 * claimed the result was a superset of what gets shipped — which was false for
 * exactly those packages. devDependencies are deliberately NOT followed: they
 * build the site rather than ship in it, and the one that does ship,
 * `@ffmpeg/core`, is a GPL component covered by hand on /licenses with a full
 * source offer rather than a one-line notice.
 */
function collectRuntimeDeps(startNames) {
  const seen = new Set();
  const queue = [...startNames];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const manifest = path.join(root, "node_modules", name, "package.json");
    if (!fs.existsSync(manifest)) continue;
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(manifest, "utf8"));
    } catch {
      continue;
    }
    for (const dep of Object.keys(meta.dependencies ?? {})) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return [...seen].sort();
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const names = collectRuntimeDeps(Object.keys(pkg.dependencies));

const sections = [];
const uncovered = [];

for (const name of names) {
  const dir = path.join(root, "node_modules", name);
  if (!fs.existsSync(dir)) {
    uncovered.push(`${name} (not installed)`);
    continue;
  }

  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    // A package without a readable manifest still gets its licence file below.
  }

  const repo = meta.homepage || (meta.repository && (meta.repository.url || meta.repository)) || "";
  const files = fs.readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(f));

  if (files.length === 0) {
    uncovered.push(`${name} ${meta.version ?? ""} (${meta.license ?? "licence not declared"})`);
    continue;
  }

  const header = `${BAR}\n${name} ${meta.version ?? ""}  —  ${meta.license ?? "see below"}\n${repo}\n${BAR}\n`;
  const body = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8").trim()).join("\n\n");
  sections.push(`${header}${body}\n`);
}


/**
 * Typefaces get their own notices file.
 *
 * Every OFL-1.1 licence file is the same licence text preceded by a DIFFERENT
 * copyright line, and the copyright line is the part the licence actually
 * requires be carried. Linking one font's file as "the OFL text" for six
 * typefaces therefore misattributes five of them — which is what an earlier
 * version of /licenses did, serving Newsreader's copyright to someone asking
 * about JetBrains Mono. Each face gets its own section instead.
 *
 * The four @fontsource-variable faces are self-hosted from node_modules by
 * `copy:wasm`. Inter and IBM Plex Mono arrive through `next/font/google`, which
 * downloads and self-hosts them at build time — no package on disk carries
 * their licence, so their copyright lines are recorded here by hand from the
 * upstream projects and the shared OFL text is linked once from the page.
 */
const GOOGLE_FONTS = [
  {
    name: "Inter",
    copyright: "Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)",
    note: "Served via next/font/google, which downloads and self-hosts the files at build time.",
  },
  {
    name: "IBM Plex Mono",
    copyright: "Copyright 2017 IBM Corp. (https://github.com/IBM/plex)",
    note: "Served via next/font/google, which downloads and self-hosts the files at build time.",
  },
];

const fontSections = [];
const fontsourceDir = path.join(root, "node_modules/@fontsource-variable");
if (fs.existsSync(fontsourceDir)) {
  for (const face of fs.readdirSync(fontsourceDir).sort()) {
    const licence = path.join(fontsourceDir, face, "LICENSE");
    if (!fs.existsSync(licence)) {
      uncovered.push(`@fontsource-variable/${face} (no LICENSE file)`);
      continue;
    }
    let version = "";
    try {
      version = JSON.parse(fs.readFileSync(path.join(fontsourceDir, face, "package.json"), "utf8")).version ?? "";
    } catch {
      // A missing manifest costs the version number, not the notice.
    }
    fontSections.push(
      `${BAR}\n@fontsource-variable/${face} ${version}  —  OFL-1.1\nSelf-hosted from node_modules by npm run copy:wasm\n${BAR}\n` +
        fs.readFileSync(licence, "utf8").trim() +
        "\n",
    );
  }
}
for (const font of GOOGLE_FONTS) {
  fontSections.push(
    `${BAR}\n${font.name}  —  OFL-1.1\n${font.note}\n${BAR}\n${font.copyright}\n\n` +
      "Licensed under the SIL Open Font License, Version 1.1 — the full text is at\n" +
      "/licenses/ofl-1.1.txt and at https://openfontlicense.org.\n",
  );
}

fs.writeFileSync(
  path.join(outDir, "font-notices.txt"),
  "Typeface notices for transmute.tools\n" +
    "Every typeface this site serves, with its own copyright line. The shared SIL\n" +
    "Open Font License text is at /licenses/ofl-1.1.txt.\n\n" +
    fontSections.join("\n"),
);

const out = path.join(outDir, "third-party-notices.txt");
fs.writeFileSync(
  out,
  "Third-party notices for transmute.tools\n" +
    "Generated by scripts/generate-license-notices.mjs from the installed runtime\n" +
    "dependency tree, followed transitively. Each section reproduces that package's\n" +
    "own licence file verbatim.\n\n" +
    sections.join("\n"),
);

console.log(`Wrote public/licenses/font-notices.txt — ${fontSections.length} typefaces`);
console.log(`Wrote ${path.relative(root, out)} — ${sections.length} of ${names.length} runtime packages (transitive), ${fs.statSync(out).size} bytes`);
if (uncovered.length > 0) {
  console.log("\nNo licence file in the package — these MUST be covered by hand on /licenses:");
  for (const entry of uncovered) console.log(`  - ${entry}`);
}
