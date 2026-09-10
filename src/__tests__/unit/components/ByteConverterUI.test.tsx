import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ByteConverterUI } from "@/components/tools/ByteConverterUI";

/**
 * The page's whole promise is that every row on screen is the same size in a
 * different unit, and that the EXACT BYTES figure is that size counted in
 * BigInt. The failure this file guards is the moment that stops being true:
 * the row you are typing into no longer agrees with the fifteen below it.
 *
 * Backspacing a field to empty is how anyone replaces a number, and it used to
 * raise a red `"" is not a number this can convert` while the rest of the page
 * — every other row, the EXACT BYTES stat, and an enabled "Copy the exact byte
 * count" — went on asserting the previous value.
 */
const MB = "Megabytes (1000² bytes)";
const KIB = "Kibibytes (1024 bytes)";
const PRIMARY = "Copy the exact byte count";

describe("ByteConverterUI, while a row is being retyped", () => {
  it("does not call an empty field an error", () => {
    render(<ByteConverterUI />);
    fireEvent.change(screen.getByLabelText(MB), { target: { value: "" } });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("holds the copy action shut rather than handing back the previous value", () => {
    render(<ByteConverterUI />);
    // 1 MB is the default, so 1,000,000 is the number that would be copied.
    expect(screen.getByRole("button", { name: PRIMARY })).toBeEnabled();

    fireEvent.change(screen.getByLabelText(MB), { target: { value: "" } });
    expect(screen.getByRole("button", { name: PRIMARY })).toBeDisabled();
  });

  it("says which value the other rows are still showing", () => {
    render(<ByteConverterUI />);
    fireEvent.change(screen.getByLabelText(MB), { target: { value: "" } });

    expect(
      screen.getByText("THE ROWS ABOVE STILL SHOW THE LAST VALUE THAT PARSED — 1 MB"),
    ).toBeInTheDocument();
    // …and the stale rows are still there to be read, which is why the
    // disclosure has to exist.
    expect((screen.getByLabelText(KIB) as HTMLInputElement).value).not.toBe("");
  });

  it("still refuses a value that cannot be a number, and quotes it", () => {
    render(<ByteConverterUI />);
    fireEvent.change(screen.getByLabelText(MB), { target: { value: "1,5" } });

    expect(screen.getByRole("alert").textContent).toContain('"1,5" is not a number');
    expect(screen.getByRole("button", { name: PRIMARY })).toBeDisabled();
  });

  it("comes back as soon as the field parses again", () => {
    render(<ByteConverterUI />);
    const mb = screen.getByLabelText(MB);
    fireEvent.change(mb, { target: { value: "" } });
    fireEvent.change(mb, { target: { value: "2" } });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: PRIMARY })).toBeEnabled();
    expect(screen.getByText("EXACT — COUNTED IN BIGINT, NOT ROUNDED THROUGH A DOUBLE")).toBeInTheDocument();
    // 2 MB is 1953.125 KiB, shown at the default six significant digits.
    expect((screen.getByLabelText(KIB) as HTMLInputElement).value).toBe("1,953.13");
  });
});
