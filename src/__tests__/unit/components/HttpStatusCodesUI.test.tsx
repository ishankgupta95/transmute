import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { HttpStatusCodesUI } from "@/components/tools/HttpStatusCodesUI";

/**
 * A reference page is worth exactly what its claims are worth, so the two
 * things pinned here are claims rather than mechanics: the footnote must
 * describe the search that is actually running, and the button must count in
 * English.
 */
const search = () => screen.getByLabelText("Search");
const GENERAL_RULE = "SEARCH MATCHES THE CODE, THE REASON PHRASE, THE DESCRIPTION AND THE RFC";
const NUMERIC_RULE = "A BARE NUMBER MATCHES THE START OF A CODE, AND AN RFC NUMBER";

describe("HttpStatusCodesUI", () => {
  it("pluralises the copy button on a single match", () => {
    render(<HttpStatusCodesUI />);
    // 425 Too Early is the only code that starts with 425.
    fireEvent.change(search(), { target: { value: "425" } });

    expect(screen.getByRole("button", { name: "Copy this code" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Copy these/ })).toBeNull();
  });

  it("keeps the plural when more than one code matches", () => {
    render(<HttpStatusCodesUI />);
    fireEvent.change(search(), { target: { value: "42" } });

    expect(screen.getByRole("button", { name: /^Copy these \d+ codes$/ })).toBeInTheDocument();
  });

  it("finds the codes an RFC defines when the RFC number is typed bare", () => {
    render(<HttpStatusCodesUI />);
    fireEvent.change(search(), { target: { value: "6585" } });

    // 428, 429, 431 and 511 all cite RFC 6585.
    expect(screen.getByRole("button", { name: "Copy these 4 codes" })).toBeInTheDocument();
    for (const code of ["428", "429", "431", "511"]) {
      expect(screen.getByText(code, { selector: "code" })).toBeInTheDocument();
    }
  });

  it("states the numeric rule instead of the general one while a number is typed", () => {
    render(<HttpStatusCodesUI />);
    expect(screen.getByText(GENERAL_RULE)).toBeInTheDocument();

    fireEvent.change(search(), { target: { value: "6585" } });
    expect(screen.getByText(NUMERIC_RULE)).toBeInTheDocument();
    expect(screen.queryByText(GENERAL_RULE)).toBeNull();

    fireEvent.change(search(), { target: { value: "gateway" } });
    expect(screen.getByText(GENERAL_RULE)).toBeInTheDocument();
    expect(screen.queryByText(NUMERIC_RULE)).toBeNull();
  });

  it("finds 511 from the query the About text tells the reader to type", () => {
    render(<HttpStatusCodesUI />);
    // 511's summary hyphenates it as "captive-portal".
    fireEvent.change(search(), { target: { value: "captive portal" } });

    expect(screen.getByText("511", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("Network Authentication Required")).toBeInTheDocument();
  });
});
