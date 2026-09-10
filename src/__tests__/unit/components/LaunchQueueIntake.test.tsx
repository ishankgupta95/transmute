import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  LaunchQueueIntake,
  supportsFileHandling,
} from "@/components/pwa/LaunchQueueIntake";

/*
  `window.launchQueue` exists in Chromium, and only in an installed app. It is
  therefore ABSENT in the overwhelming majority of sessions this component
  renders in — every Firefox and Safari visit, and every visit to the site in
  an ordinary tab. The first test is the important one: in that majority case
  the component must do nothing at all, visibly or otherwise.
*/

type Consumer = (params: { files?: readonly unknown[] }) => void;

/** A handle shaped like the File System Access API's. */
function fileHandle(file: File) {
  return { kind: "file", getFile: async () => file };
}

function installLaunchQueue(): { fire: (params: { files?: readonly unknown[] }) => void } {
  let consumer: Consumer | null = null;
  Object.defineProperty(window, "launchQueue", {
    configurable: true,
    writable: true,
    value: {
      setConsumer(next: Consumer) {
        consumer = next;
      },
    },
  });
  return {
    fire: (params) => consumer?.(params),
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "launchQueue");
  vi.restoreAllMocks();
});

describe("without launchQueue — most browsers, most of the time", () => {
  it("renders nothing and reports nothing", () => {
    const onFiles = vi.fn();
    const { container } = render(<LaunchQueueIntake onFiles={onFiles} />);

    expect(container).toBeEmptyDOMElement();
    expect(onFiles).not.toHaveBeenCalled();
    expect(supportsFileHandling()).toBe(false);
  });

  it("does not throw where the object exists but is not the API", () => {
    // Belt and braces against an extension or a polyfill stub.
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      writable: true,
      value: {},
    });
    expect(supportsFileHandling()).toBe(false);
    expect(() => render(<LaunchQueueIntake onFiles={vi.fn()} />)).not.toThrow();
  });
});

describe("with launchQueue", () => {
  it("hands over the files the OS launched with", async () => {
    const queue = installLaunchQueue();
    const onFiles = vi.fn();
    const file = new File(["%PDF"], "invoice.pdf", { type: "application/pdf" });
    render(<LaunchQueueIntake onFiles={onFiles} />);

    expect(supportsFileHandling()).toBe(true);
    queue.fire({ files: [fileHandle(file)] });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
  });

  it("never calls back synchronously", async () => {
    /*
      `setConsumer` invokes the consumer SYNCHRONOUSLY when a launch is already
      queued — which is the normal case, since the OS queued it before the page
      loaded. Calling `onFiles` inline would be a setState inside an effect
      body, a hard error in this repo, so every path goes through a microtask.
    */
    let consumer: Consumer | null = null;
    const file = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      writable: true,
      value: {
        setConsumer(next: Consumer) {
          consumer = next;
          // Fire during setConsumer, exactly as a queued launch does.
          next({ files: [fileHandle(file)] });
        },
      },
    });
    const onFiles = vi.fn();

    render(<LaunchQueueIntake onFiles={onFiles} />);

    expect(consumer).not.toBeNull();
    expect(onFiles).not.toHaveBeenCalled(); // still inside the effect's turn
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
  });

  it("ignores a launch with no files — a click on the app icon", async () => {
    const queue = installLaunchQueue();
    const onFiles = vi.fn();
    render(<LaunchQueueIntake onFiles={onFiles} />);

    queue.fire({});
    queue.fire({ files: [] });

    await Promise.resolve();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores a directory handle, which has no getFile", async () => {
    const queue = installLaunchQueue();
    const onFiles = vi.fn();
    const file = new File(["x"], "a.png", { type: "image/png" });
    render(<LaunchQueueIntake onFiles={onFiles} />);

    queue.fire({ files: [{ kind: "directory", name: "Pictures" }, fileHandle(file)] });

    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
  });

  it("survives a handle whose file is gone", async () => {
    const queue = installLaunchQueue();
    const onFiles = vi.fn();
    render(<LaunchQueueIntake onFiles={onFiles} />);

    queue.fire({
      files: [
        {
          kind: "file",
          getFile: async () => {
            throw new DOMException("not found", "NotFoundError");
          },
        },
      ],
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("does not call back after unmount", async () => {
    const queue = installLaunchQueue();
    const onFiles = vi.fn();
    const { unmount } = render(<LaunchQueueIntake onFiles={onFiles} />);

    queue.fire({ files: [fileHandle(new File(["x"], "a.png"))] });
    unmount();

    await Promise.resolve();
    await Promise.resolve();
    expect(onFiles).not.toHaveBeenCalled();
  });
});
