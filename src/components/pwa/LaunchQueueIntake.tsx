"use client";

import { useEffect } from "react";

/**
 * The page side of `file_handlers`: when the operating system launches an
 * installed Transmute for a file the user double-clicked, the handles arrive
 * here through `window.launchQueue`.
 *
 * IT MUST DEGRADE TO NOTHING AT ALL. `launchQueue` is a Chromium-only object
 * and only exists in an installed app — which is to say it is absent in the
 * overwhelming majority of sessions this component will render in, including
 * every one in Firefox and Safari and every visit to the site in a normal tab.
 * So every path below is a silent `return`: no throw, no console noise, no
 * fallback UI, and (see the page copy) no printed claim that the feature is
 * there. `CapabilityReadout.tsx:10-11` is the precedent — a capability claim
 * we can't verify is a claim we don't make — and this component is one step
 * stronger, because it can verify the answer and still says nothing when the
 * answer is no.
 *
 * Renders `null` unconditionally; it is a wiring component, not a surface.
 */

/**
 * The two objects this file touches, typed locally: neither
 * `WindowEventHandlers.launchQueue` nor `LaunchParams` is in TypeScript's DOM
 * lib, and pulling in a `@types` package for two properties would be a
 * dependency for a declaration.
 *
 * `files` is typed `readonly unknown[]` rather than
 * `readonly FileSystemFileHandle[]` on purpose: the entries come from outside
 * the page, `toFile` below duck-types every one of them, and a lie in this
 * interface would be a lie the compiler then enforced.
 */
interface LaunchParams {
  readonly files?: readonly unknown[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

function launchQueue(): LaunchQueue | null {
  if (typeof window === "undefined") return null;
  const queue = (window as unknown as { launchQueue?: Partial<LaunchQueue> }).launchQueue;
  if (!queue || typeof queue.setConsumer !== "function") return null;
  return queue as LaunchQueue;
}

/**
 * Whether THIS browser, in THIS window, can be handed a file by the OS.
 *
 * Read after mount only (the export prerenders on a build machine, where the
 * answer is meaningless), and used by the page to decide whether to say
 * anything about file handling at all.
 */
export function supportsFileHandling(): boolean {
  return launchQueue() !== null;
}

/**
 * A launch entry is a `FileSystemFileHandle` in every implementation that
 * exists, but the queue can also carry a DIRECTORY handle — a user can pick
 * "Open with" on a folder — and `getFile()` does not exist on one of those.
 * Duck-typed rather than `instanceof`, because `FileSystemFileHandle` is not
 * guaranteed to be a global in every context this runs in.
 */
async function toFile(entry: unknown): Promise<File | null> {
  const handle = entry as { kind?: unknown; getFile?: unknown } | null;
  if (!handle || handle.kind !== "file" || typeof handle.getFile !== "function") return null;
  try {
    const file = await (handle.getFile as () => Promise<File>)();
    return file instanceof File ? file : null;
  } catch {
    // A revoked or moved file. The picker is still there.
    return null;
  }
}

export function LaunchQueueIntake({ onFiles }: { onFiles: (files: File[]) => void }) {
  useEffect(() => {
    const queue = launchQueue();
    if (!queue) return;

    let live = true;
    queue.setConsumer((params) => {
      const entries = params?.files ?? [];
      // The consumer runs on EVERY launch, including a plain click on the app
      // icon, where `files` is empty. That is not a file launch and must not
      // disturb whatever the page is already showing.
      if (entries.length === 0) return;
      /*
        Everything after this point is async, deliberately. `setConsumer`
        invokes the consumer SYNCHRONOUSLY when a launch is already queued —
        which is the normal case, since the OS queued it before the page
        loaded — so calling `onFiles` inline would be a setState inside an
        effect body, which is a hard error here. `getFile()` is a promise
        anyway; awaiting it puts the update in a microtask where it belongs.
      */
      void (async () => {
        const files: File[] = [];
        for (const entry of entries) {
          const file = await toFile(entry);
          if (file) files.push(file);
        }
        // `live` guards the unmount between the launch and the last
        // `getFile()` resolving.
        if (live && files.length > 0) onFiles(files);
      })();
    });

    return () => {
      live = false;
    };
  }, [onFiles]);

  return null;
}
