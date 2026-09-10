import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ServiceWorkerRegistration,
  shouldRegisterServiceWorker,
} from "@/components/pwa/ServiceWorkerRegistration";

/*
  Two properties are worth a test here and the rest is plumbing.

  1. THE WORKER MUST NOT REGISTER IN DEV. Not a preference — a shipped test
     depends on it. Both Playwright projects run against `npm run dev`
     (playwright.config.ts), and conversion/video.spec.ts:120 stalls the FFmpeg
     core with `page.route("**\/ffmpeg-core.wasm")`. Playwright's typings state
     that a route "will not intercept requests intercepted by Service Worker",
     so a worker in dev would make that request invisible and the assertion it
     guards would quietly stop meaning anything.

  2. THE UPDATE MUST BE ASKED FOR. `skipWaiting()` plus `clients.claim()` swaps
     the controller under every open tab, and a tab here may be minutes into a
     conversion holding the user's only copy of a file in memory. So: exactly
     one message, `{ type: "SKIP_WAITING" }` — the sole thing
     service-worker.ts's message handler accepts — sent only from a click.
*/

/* ── A Service Worker container, in memory ────────────────────────────────── */

type Listener = (event?: unknown) => void;

function makeWorker() {
  const posted: unknown[] = [];
  return {
    posted,
    state: "installed" as ServiceWorkerState,
    postMessage: (data: unknown) => posted.push(data),
    addEventListener: vi.fn(),
  };
}

function makeRegistration(waiting: ReturnType<typeof makeWorker> | null) {
  const listeners = new Map<string, Listener[]>();
  return {
    waiting,
    installing: null as ReturnType<typeof makeWorker> | null,
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
  };
}

function installContainer(options: {
  registration: ReturnType<typeof makeRegistration>;
  controller: object | null;
}) {
  const listeners = new Map<string, Listener[]>();
  const container = {
    controller: options.controller,
    register: vi.fn(async () => options.registration),
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener: vi.fn(),
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  return container;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  // The component registers after `load`; jsdom's document is already
  // "complete" by the time a test renders, which is the ordinary case.
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("shouldRegisterServiceWorker", () => {
  it("is false in development, whatever the browser supports", () => {
    installContainer({ registration: makeRegistration(null), controller: null });
    expect(shouldRegisterServiceWorker("development")).toBe(false);
    expect(shouldRegisterServiceWorker("test")).toBe(false);
    expect(shouldRegisterServiceWorker(undefined)).toBe(false);
  });

  it("is true in production when the browser has service workers", () => {
    installContainer({ registration: makeRegistration(null), controller: null });
    expect(shouldRegisterServiceWorker("production")).toBe(true);
  });

  it("is false in production without service-worker support", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    expect(shouldRegisterServiceWorker("production")).toBe(false);
  });
});

describe("registration", () => {
  it("registers /sw.js — the origin root, because scope / cannot be widened", async () => {
    const container = installContainer({
      registration: makeRegistration(null),
      controller: null,
    });
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(container.register).toHaveBeenCalledWith("/sw.js"));
  });

  it("registers nothing in a development build", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const container = installContainer({
      registration: makeRegistration(null),
      controller: null,
    });
    render(<ServiceWorkerRegistration />);
    // Give the effect and any microtask queue a turn before concluding.
    await Promise.resolve();
    expect(container.register).not.toHaveBeenCalled();
  });

  it("waits for load rather than competing with first paint", async () => {
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const container = installContainer({
      registration: makeRegistration(null),
      controller: null,
    });
    render(<ServiceWorkerRegistration />);
    await Promise.resolve();
    expect(container.register).not.toHaveBeenCalled();

    fireEvent(window, new Event("load"));
    await waitFor(() => expect(container.register).toHaveBeenCalledTimes(1));
  });

  it("survives a registration that throws", async () => {
    const container = installContainer({
      registration: makeRegistration(null),
      controller: null,
    });
    container.register.mockRejectedValue(new Error("insecure context"));
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());
    // No banner, no thrown render: the site works exactly as it did with no
    // worker at all.
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the update affordance", () => {
  it("announces a worker left waiting by an earlier visit", async () => {
    // `updatefound` fires once, and it may have fired before this page loaded.
    const waiting = makeWorker();
    installContainer({ registration: makeRegistration(waiting), controller: {} });
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByText(/new version of Transmute is ready/i)).toBeInTheDocument();
  });

  it("says nothing about a waiting worker when nothing is in control", async () => {
    /*
      Uncontrolled and waiting is a real state — a shift-reload loads the page
      outside the worker's control — and it is NOT an update to announce.
      Nothing is running to be replaced, and `controllerchange` does not fire
      for a page no worker controls, so the RELOAD button would sit there
      waiting for an event that never arrives.
    */
    const waiting = makeWorker();
    installContainer({ registration: makeRegistration(waiting), controller: null });
    render(<ServiceWorkerRegistration />);
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces a worker that reaches 'installed' while one is already in control", async () => {
    const registration = makeRegistration(null);
    const container = installContainer({ registration, controller: {} });
    const installing = makeWorker();
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    registration.installing = installing;
    registration.fire("updatefound");
    // The component subscribed to statechange on the installing worker.
    const [, onStateChange] = installing.addEventListener.mock.calls[0] as [string, () => void];
    onStateChange();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
  });

  it("stays silent when a worker installs with no controller running", async () => {
    const registration = makeRegistration(null);
    const container = installContainer({ registration, controller: null });
    const installing = makeWorker();
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    registration.installing = installing;
    registration.fire("updatefound");
    const [, onStateChange] = installing.addEventListener.mock.calls[0] as [string, () => void];
    onStateChange();

    await Promise.resolve();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("posts exactly one SKIP_WAITING, and only when the button is pressed", async () => {
    const waiting = makeWorker();
    installContainer({ registration: makeRegistration(waiting), controller: {} });
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    // Nothing has been sent by merely showing the banner. This is the
    // assertion that a silent skipWaiting would fail.
    expect(waiting.posted).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /RELOAD NOW/i }));
    expect(waiting.posted).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("reloads only after the controller actually changes", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
      writable: true,
    });
    const waiting = makeWorker();
    const container = installContainer({
      registration: makeRegistration(waiting),
      controller: {},
    });
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /RELOAD NOW/i }));
    expect(reload).not.toHaveBeenCalled(); // the new worker has not taken over yet

    container.fire("controllerchange");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("dismisses without sending anything", async () => {
    const waiting = makeWorker();
    installContainer({ registration: makeRegistration(waiting), controller: {} });
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /NOT NOW/i }));
    expect(waiting.posted).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns that the reload interrupts work, because it can", async () => {
    const waiting = makeWorker();
    installContainer({ registration: makeRegistration(waiting), controller: {} });
    render(<ServiceWorkerRegistration />);
    const banner = await screen.findByRole("status");
    // A tab may be holding a 32 MB FFmpeg instance and the user's only copy of
    // a file. The copy has to say so before the button is pressed.
    expect(banner).toHaveTextContent(/finish anything you have running first/i);
  });
});
