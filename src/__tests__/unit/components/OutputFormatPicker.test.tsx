import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";

import { OutputFormatPicker } from "@/components/tools/OutputFormatPicker";

/*
  Seven tools import this one control, so what is worth pinning is everything a
  caller could be lied to about by it:

    1. the chips offered are exactly the `formats` it was handed, in that
       order — an edit verb whose output must carry alpha passes
       ["png", "webp"] and must not find JPG on screen anyway;
    2. the quality slider is ABSENT for PNG rather than disabled, because PNG's
       encoder ignores the quality argument entirely and a greyed-out slider
       still asserts the number under it means something;
    3. the flatten warning fires for JPG and only for JPG — WebP carries an
       alpha channel, so the same sentence over WebP would be false;
    4. the formats named as the escape hatch are read out of `formats`, not
       hardcoded, so the sentence cannot advertise a chip that is not rendered;
    5. the two sentences of that warning are separated by a real space — this
       repo shipped `at most 300frames` from precisely this JSX shape;
    6. it renders a control and not a layout: no extra buttons, no
       `data-tool-surface`, no wrapper element around the controls.

  Copy strings are duplicated here rather than imported, so the test notices
  the constant changing.
*/

const FLATTEN_SENTENCE =
  "JPG has no alpha channel, so every transparent pixel is filled with white before this image is encoded.";
const ESCAPE_SENTENCE = "PNG and WEBP keep the transparency.";

/** Collapses the whitespace JSX inserts between source lines. */
function text(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function setup(props: Partial<ComponentProps<typeof OutputFormatPicker>> = {}) {
  const onChange = vi.fn();
  const onQualityChange = vi.fn();
  const view = render(
    <OutputFormatPicker
      value="png"
      onChange={onChange}
      quality={0.85}
      onQualityChange={onQualityChange}
      {...props}
    />,
  );
  return { ...view, onChange, onQualityChange };
}

function chipLabels(): string[] {
  return Array.from(
    screen.getByRole("group", { name: "Output format" }).querySelectorAll("button"),
  ).map((b) => b.textContent ?? "");
}

describe("OutputFormatPicker", () => {
  describe("the format chips", () => {
    it("offers PNG, JPG and WEBP in that order by default", () => {
      setup();
      expect(chipLabels()).toEqual(["PNG", "JPG", "WEBP"]);
    });

    it("offers exactly the formats it was handed, in that order", () => {
      setup({ value: "webp", formats: ["webp", "png"] });
      expect(chipLabels()).toEqual(["WEBP", "PNG"]);
    });

    it("presses the chip that matches `value`, and only that one", () => {
      setup({ value: "webp" });
      const pressed = screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.textContent);
      expect(pressed).toEqual(["WEBP"]);
    });

    it("reports the format value, not its label, when a chip is clicked", () => {
      const { onChange } = setup();
      fireEvent.click(screen.getByRole("button", { name: "JPG" }));
      expect(onChange).toHaveBeenCalledWith("jpeg");
    });

    it("disables every chip when `disabled` is set", () => {
      setup({ disabled: true });
      const chips = screen.getAllByRole("button");
      expect(chips).toHaveLength(3);
      expect(chips.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    });
  });

  describe("the quality slider", () => {
    it("is not rendered at all for PNG — hidden, not disabled", () => {
      const { container } = setup({ value: "png" });
      expect(screen.queryByLabelText("Quality")).toBeNull();
      // A disabled slider would still be in the DOM asserting that the number
      // under it applies to PNG. Nothing may be there.
      expect(container.querySelector("input[type=range]")).toBeNull();
    });

    it("renders for JPG with the quality as a whole percent", () => {
      setup({ value: "jpeg", quality: 0.85 });
      expect(screen.getByLabelText("Quality")).toHaveProperty("value", "0.85");
      expect(screen.getByText("85%")).toBeTruthy();
    });

    it("renders for WEBP too", () => {
      setup({ value: "webp", quality: 0.6 });
      expect(screen.getByText("60%")).toBeTruthy();
    });

    it("reports a number, not the input's string, when dragged", () => {
      const { onQualityChange } = setup({ value: "jpeg" });
      fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "0.5" } });
      expect(onQualityChange).toHaveBeenCalledWith(0.5);
    });

    it("is disabled with the rest of the controls", () => {
      setup({ value: "jpeg", disabled: true });
      expect(screen.getByLabelText("Quality")).toHaveProperty("disabled", true);
    });
  });

  describe("the transparency warning", () => {
    it("states the white fill when JPG is chosen over an image with alpha", () => {
      setup({ value: "jpeg", alphaWarning: true });
      expect(text(screen.getByRole("status"))).toBe(
        `${FLATTEN_SENTENCE} ${ESCAPE_SENTENCE}`,
      );
    });

    it("keeps a real space between the two sentences", () => {
      // `at most 300frames` shipped from this exact shape: an expression
      // following a text chunk loses the newline-only whitespace between them.
      setup({ value: "jpeg", alphaWarning: true });
      expect(text(screen.getByRole("status"))).not.toMatch(/encoded\.\S/);
    });

    it("says nothing for WEBP — WebP carries an alpha channel", () => {
      setup({ value: "webp", alphaWarning: true });
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("says nothing for JPG when the caller has not found any transparency", () => {
      setup({ value: "jpeg", alphaWarning: false });
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("names only the alpha-capable formats it is actually offering", () => {
      // No PNG chip on screen, so no PNG in the sentence.
      setup({ value: "jpeg", alphaWarning: true, formats: ["jpeg", "webp"] });
      const message = text(screen.getByRole("status"));
      expect(message).toContain("WEBP keeps the transparency.");
      expect(message).not.toContain("PNG");
    });

    it("stops after the white-fill sentence when nothing else can carry alpha", () => {
      setup({ value: "jpeg", alphaWarning: true, formats: ["jpeg"] });
      expect(text(screen.getByRole("status"))).toBe(FLATTEN_SENTENCE);
    });
  });

  describe("it is a control, not a layout", () => {
    it("renders the format chips as the only buttons — no ToolActions", () => {
      // ToolActions binds ⌘↵ on `window` with no arbitration, so a shared
      // control that rendered one would fight the tool's own primary.
      const { container } = setup({ value: "jpeg" });
      expect(container.querySelectorAll("button")).toHaveLength(3);
    });

    it("claims neither the tool surface nor the settings rail", () => {
      const { container } = setup({ value: "jpeg" });
      expect(container.querySelector("[data-tool-surface]")).toBeNull();
      expect(container.querySelector("[data-tool-aside]")).toBeNull();
    });

    it("returns bare controls, with no wrapper of its own", () => {
      // One block for FORMAT, one for the slider — siblings the caller's
      // `ToolControlGroup` spaces itself. A wrapper here would be a third box.
      const { container, rerender } = setup({ value: "jpeg" });
      expect(container.children).toHaveLength(2);
      rerender(
        <OutputFormatPicker
          value="png"
          onChange={vi.fn()}
          quality={0.85}
          onQualityChange={vi.fn()}
        />,
      );
      expect(container.children).toHaveLength(1);
    });
  });
});
