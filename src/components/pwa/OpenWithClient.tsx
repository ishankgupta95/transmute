"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { DropZone } from "@/components/tools/DropZone";
import { LaunchQueueIntake, supportsFileHandling } from "@/components/pwa/LaunchQueueIntake";
import { useIsClient } from "@/hooks/useIsClient";
import { extensionOf, toolsForFile } from "@/lib/pwa/open-with";
import { SHARE_TARGET_PARAM } from "@/lib/pwa/share-target";
import { takeSharedFiles } from "@/lib/pwa/shared-intake";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { tools } from "@/data/tools";

/**
 * `/open` — the one route the operating system launches Transmute into, from
 * either of two directions: a file shared to the app (`share_target`, a POST
 * the service worker answers) or a file opened with it (`file_handlers`, via
 * `window.launchQueue`). Both end up here holding the same thing, a list of
 * `File`s, so both are drawn by the same surface.
 *
 * IT IS AN ORDINARY UPLOAD PAGE WHEN NOTHING ARRIVES, and that is the state it
 * will be in most of the time: share targets are Chromium-on-Android, file
 * handlers are Chromium-on-desktop-when-installed, and everything else that
 * reaches this URL — a bookmark, a link, Safari, a normal tab — gets the drop
 * zone. That is not a fallback bolted on; it is the third input source, and it
 * makes the page answer a question worth asking on its own: what can this site
 * do with the file I have?
 *
 * WHAT IT DOES NOT DO: carry the file into the tool you pick. There is no
 * mechanism on a static export that survives a navigation without leaving the
 * file in storage, and leaving it there would contradict what /privacy says
 * this site keeps. So the links below open the tool's own page and the copy
 * says, in as many words, to pick the file again there.
 */

/*
  The `?shared=` id, read the way the workspace reads `?tool=` — through
  `useSyncExternalStore` with a null server snapshot, so the export prerenders
  the picker and the client reads the real query after hydration WITHOUT a
  setState in an effect body (a hard error in this repo).
*/
function subscribeToShareId(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function readShareId(): string | null {
  return new URLSearchParams(window.location.search).get(SHARE_TARGET_PARAM);
}

/** Enough to show what a file is for; the rest is one link away. */
const MAX_SUGGESTIONS = 8;

const CARD =
  "flex flex-col gap-3 rounded-[11px] border border-border bg-bg-primary p-[18px]";
const META =
  "font-mono text-[10px] leading-none tracking-[0.05em] text-text-muted";

function FileCard({ file }: { file: File }) {
  const ext = extensionOf(file.name);
  const matches = toolsForFile(file.name);
  const shown = matches.slice(0, MAX_SUGGESTIONS);

  return (
    <article className={CARD}>
      <header className="flex flex-col gap-1.5">
        <h3 className="m-0 truncate font-display text-[15px] leading-[1.3] font-medium text-text-primary">
          {file.name}
        </h3>
        <span className={META}>
          {ext ? ext.slice(1).toUpperCase() : "NO EXTENSION"}
          <span aria-hidden="true" className="px-2 opacity-40">
            ·
          </span>
          {formatFileSize(file.size)}
        </span>
      </header>

      {shown.length > 0 ? (
        <>
          <ul className="m-0 grid list-none grid-cols-1 gap-x-8 p-0 sm:grid-cols-2">
            {shown.map((tool) => (
              <li key={tool.slug} className="min-w-0">
                <Link
                  href={`/${tool.slug}`}
                  className="flex min-w-0 flex-col gap-0.5 border-b border-border py-[11px] transition-[padding-left] duration-200 hover:pl-1.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                >
                  <span className="truncate font-body text-[13.5px] leading-[1.3] font-medium text-neutral-200">
                    {tool.name}
                  </span>
                  <span className="line-clamp-1 font-body text-[11.5px] leading-[1.45] text-text-muted">
                    {tool.hubLine ?? tool.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="m-0 font-body text-[11.5px] leading-[1.5] text-text-muted">
            {matches.length > shown.length ? (
              <>
                {matches.length - shown.length} more of the {tools.length} tools also take{" "}
                {ext}.{" "}
              </>
            ) : null}
            <Link
              href="/all-tools"
              className="rounded-sm text-accent-200 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Browse every tool
            </Link>
          </p>
        </>
      ) : (
        <p className="m-0 font-body text-[12.5px] leading-[1.6] text-text-muted">
          No tool here opens {ext ? ext : "a file with no extension"}.{" "}
          <Link
            href="/all-tools"
            className="rounded-sm text-accent-200 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Browse every tool
          </Link>{" "}
          to check what does.
        </p>
      )}
    </article>
  );
}

export function OpenWithClient() {
  const shareId = useSyncExternalStore(subscribeToShareId, readShareId, () => null);
  /*
    `null` means the intake has not finished. It is distinct from `[]` — "the
    intake ran and there was nothing" — because only the first of those should
    ever print "collecting", and only the second should show the picker.
  */
  const [files, setFiles] = useState<File[] | null>(null);
  const mounted = useIsClient();

  const receive = useCallback((incoming: File[]) => setFiles(incoming), []);

  useEffect(() => {
    let live = true;
    void takeSharedFiles(shareId).then((shared) => {
      if (!live) return;
      if (shared.length > 0) setFiles(shared);
      // A sweep that found nothing must not wipe files the launch queue or the
      // picker has already delivered — hence the functional form.
      else setFiles((current) => current ?? []);
    });
    return () => {
      live = false;
    };
  }, [shareId]);

  const collecting = shareId !== null && files === null;
  const shown = files ?? [];

  return (
    <div className="flex flex-col gap-6">
      <LaunchQueueIntake onFiles={receive} />

      {collecting ? (
        <p className="m-0 font-body text-[13px] leading-[1.6] text-text-muted">
          Collecting the shared file…
        </p>
      ) : shown.length > 0 ? (
        <>
          <div className="flex flex-col gap-3.5">
            {shown.map((file, index) => (
              // Name + size + index: two files shared from a camera roll can
              // carry the same name, and the index is the order they arrived
              // in, which is the order the merge tools would want.
              <FileCard key={`${index}-${file.name}-${file.size}`} file={file} />
            ))}
          </div>
          <p className="m-0 max-w-[560px] font-body text-[12.5px] leading-[1.7] text-text-muted">
            Opening a tool takes you to its own page, where you pick the file
            again — the file itself stays in this tab. Nothing about it was
            uploaded: the hand-off from your share sheet holds it in this
            browser&rsquo;s own cache for the length of one page load, and this
            page deletes it as it reads it.
          </p>
        </>
      ) : (
        <>
          {shareId !== null && (
            <p
              role="status"
              className="m-0 rounded-[11px] border border-border bg-bg-primary px-[18px] py-3.5 font-body text-[12.5px] leading-[1.6] text-text-muted"
            >
              No shared file reached this page. It may already have been handled
              by an earlier load, or your browser may not hand files to
              installed apps. Pick one below instead.
            </p>
          )}
          {/*
            No `accept` and no size note on purpose: this page never reads a
            byte of the file. It looks at the name and the size the OS already
            reported, so there is nothing here for a cap to protect — and
            narrowing `accept` would stop the page answering the one question
            it exists to answer for an unusual format.
          */}
          <DropZone
            multiple
            onFiles={receive}
            label="Drop a file to see which tools take it"
          />
        </>
      )}

      {/*
        The capability line. Printed only after mount, and only as far as the
        browser can be asked: `launchQueue` is a real feature test, so that
        half is derived. Whether this browser can SHARE a file to an installed
        app is not detectable from a page at all, so nothing is claimed about
        it — CapabilityReadout.tsx:10-11.
      */}
      {mounted && (
        <p className={`${META} leading-[1.7]`}>
          OPEN WITH {supportsFileHandling() ? "✓" : "—"}
          <span aria-hidden="true" className="px-2 opacity-40">
            ·
          </span>
          {supportsFileHandling()
            ? "this browser can hand a file to an installed Transmute"
            : "this browser does not hand files to installed apps"}
        </p>
      )}
    </div>
  );
}
