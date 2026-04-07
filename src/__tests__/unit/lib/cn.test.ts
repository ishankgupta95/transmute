import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils/cn";

describe("cn", () => {
  it("merges multiple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes with clsx syntax", () => {
    expect(cn("base", true && "active", false && "hidden")).toBe("base active");
  });

  it("resolves Tailwind conflicts (last wins)", () => {
    // tailwind-merge should pick the last conflicting utility
    expect(cn("p-4", "p-2")).toBe("p-2");
  });

  it("resolves conflicting text sizes", () => {
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("resolves conflicting colors", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles undefined values", () => {
    expect(cn("foo", undefined, "bar")).toBe("foo bar");
  });

  it("handles null values", () => {
    expect(cn("foo", null, "bar")).toBe("foo bar");
  });

  it("handles false values", () => {
    expect(cn("foo", false, "bar")).toBe("foo bar");
  });

  it("handles empty string", () => {
    expect(cn("foo", "", "bar")).toBe("foo bar");
  });

  it("handles no arguments", () => {
    expect(cn()).toBe("");
  });

  it("handles arrays of class names", () => {
    expect(cn(["foo", "bar"], "baz")).toBe("foo bar baz");
  });

  it("handles object syntax", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("keeps non-conflicting Tailwind classes", () => {
    expect(cn("p-4", "m-2")).toBe("p-4 m-2");
  });

  it("resolves conflicting background colors", () => {
    expect(cn("bg-red-500", "bg-blue-500")).toBe("bg-blue-500");
  });

  it("resolves conflicting margin directions", () => {
    expect(cn("mt-2", "mt-4")).toBe("mt-4");
  });
});
