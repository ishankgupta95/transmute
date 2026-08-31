import { describe, expect, it, beforeEach } from "vitest";
import {
  lockScroll,
  unlockScroll,
  __resetScrollLock,
} from "@/lib/utils/scroll-lock";

describe("scroll-lock", () => {
  beforeEach(() => {
    __resetScrollLock();
    document.body.style.overflow = "";
  });

  it("locks on the first owner and releases on the last", () => {
    lockScroll();
    expect(document.body.style.overflow).toBe("hidden");
    unlockScroll();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the lock while a second owner still holds it", () => {
    // The real case: the phone nav drawer is open and the command palette
    // opens over it. Closing the palette must not unlock the drawer.
    lockScroll(); // drawer
    lockScroll(); // palette
    unlockScroll(); // palette closes
    expect(document.body.style.overflow).toBe("hidden");
    unlockScroll(); // drawer closes
    expect(document.body.style.overflow).toBe("");
  });

  it("does not go negative when released more often than it was taken", () => {
    lockScroll();
    unlockScroll();
    unlockScroll();
    lockScroll();
    expect(document.body.style.overflow).toBe("hidden");
    unlockScroll();
    expect(document.body.style.overflow).toBe("");
  });
});
