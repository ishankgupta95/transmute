import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ProcessedResult } from "@/hooks/useFileProcessor";
import type { ImageEditJobOptions } from "@/lib/workers/image-protocol";

/*
  This tool's hardest problem is a copy problem, so most of these tests are
  about sentences.

  A static site cannot know what size a platform wants today. The page ships
  prerendered, there is no runtime check anywhere in the app that could
  confirm one of these numbers, and platform specs move. So the surface draws
  a line and holds it: the PIXEL DIMENSIONS are facts — they are literally
  what the engine is asked to write — and the platform names are only what a
  size is commonly used for. The tests below pin both halves of that line,
  including the negative: no string on this page may claim a size is current,
  official or required.

  The second claim is about loss. "Cover" crops, and a user who does not know
  that finds out after posting. The rail has to say which of the two settings
  loses picture, and the previews have to show it.

  The third is derived rather than asserted: a picture smaller than a frame is
  enlarged, and only the frames that are actually bigger than THIS picture get
  the notice.
*/

const editImageToMany = vi.fn();
const downloadFilesAsZip = vi.fn();
const triggerDownload = vi.fn();

vi.mock("@/lib/workers/image-client", () => ({
  editImageToMany: (...args: unknown[]) => editImageToMany(...args),
}));

vi.mock("@/lib/utils/download", () => ({
  downloadFilesAsZip: (...args: unknown[]) => downloadFilesAsZip(...args),
  triggerDownload: (...args: unknown[]) => triggerDownload(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile(dropName)])}>drop</button>
  ),
}));

// The dropped file's NAME. It decides the starting format and it is the whole
// of what the flatten warning can be derived from before anything is decoded.
let dropName = "photo.jpg";

// jsdom decodes nothing, so the source's pixel size is stated as a premise —
// which is also what makes the enlargement notice testable at all.
let dimensions: { w: number; h: number } | null = { w: 2400, h: 1600 };
vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dimensions,
}));

import {
  SocialMediaImageResizerUI,
  SOCIAL_PRESETS,
  frameScale,
} from "@/components/tools/SocialMediaImageResizerUI";

function makeFile(name = "photo.jpg"): File {
  const type = name.endsWith(".png") ? "image/png" : "image/jpeg";
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function output(label: string, newSize = 51200): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(newSize)], { type: "image/jpeg" }),
    fileName: `photo-${label}.jpg`,
    originalSize: 3,
    newSize,
  };
}

function lastJob(): ImageEditJobOptions {
  return editImageToMany.mock.calls[editImageToMany.mock.calls.length - 1][1] as ImageEditJobOptions;
}

/** The preset specs of the last run — narrowed, so a wrong verb fails loudly. */
function lastOutputs() {
  const edit = lastJob().edit;
  if (edit.kind !== "presets") throw new Error(`expected presets, got ${edit.kind}`);
  return edit;
}

const objectUrls = { created: [] as string[], revoked: [] as string[] };
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    const url = `blob:social-${objectUrls.created.length}-${blob.size}`;
    objectUrls.created.push(url);
    return url;
  },
  revokeObjectURL: (url: string) => objectUrls.revoked.push(url),
});

function drop() {
  render(<SocialMediaImageResizerUI acceptFormats=".jpg,.png,.webp" />);
  fireEvent.click(screen.getByText("drop"));
}

/** A preset card, addressed the way its accessible name reads. */
const card = (name: string, w: number, h: number) =>
  screen.getByRole("button", { name: `${name} — ${w} by ${h} pixels` });

beforeEach(() => {
  editImageToMany.mockReset();
  downloadFilesAsZip.mockReset();
  triggerDownload.mockReset();
  editImageToMany.mockResolvedValue([output("square-1080"), output("link-1200x630")]);
  dimensions = { w: 2400, h: 1600 };
  dropName = "photo.jpg";
  objectUrls.created = [];
  objectUrls.revoked = [];
});

describe("frameScale — how much the picture has to be stretched", () => {
  it("takes the larger ratio for cover and the smaller for contain", () => {
    // 800 × 600 into 1200 × 630: cover must fill both edges (1.5), contain
    // must fit inside both (1.05).
    expect(frameScale(800, 600, 1200, 630, "cover")).toBeCloseTo(1.5);
    expect(frameScale(800, 600, 1200, 630, "contain")).toBeCloseTo(1.05);
  });

  it("is at most 1 when the picture is bigger than the frame both ways", () => {
    expect(frameScale(2400, 1600, 1080, 1080, "cover")).toBeLessThan(1);
    expect(frameScale(2400, 1600, 400, 400, "cover")).toBeLessThan(1);
  });
});

describe("SocialMediaImageResizerUI — the numbers are the claim", () => {
  it("prints every preset's pixel size beside its name", () => {
    drop();
    for (const p of SOCIAL_PRESETS) {
      expect(card(p.name, p.width, p.height)).toBeInTheDocument();
      expect(card(p.name, p.width, p.height)).toHaveTextContent(`${p.width} × ${p.height}`);
    }
  });

  it("frames the platform names as usage, not as a live reading of a spec", () => {
    drop();
    expect(
      screen.getByText(
        "THE PIXEL SIZES ARE THE FACT HERE — THE PLATFORM NAMES ARE WHAT EACH SIZE IS COMMONLY USED FOR, NOT A READING OF ANY PLATFORM’S CURRENT SPEC",
      ),
    ).toBeInTheDocument();
  });

  it("never says a size is the current, official or required one", () => {
    /*
      The negative half of the same claim, and the one that would rot first: a
      later copy pass adding "the current Instagram size" to a card would leave
      the footnote above still on screen, contradicting it two rows down.
    */
    drop();
    const surface = screen.getByRole("complementary", { name: "Settings" }).parentElement;
    expect(surface?.textContent ?? "").not.toMatch(/\b(official|required)\b/i);
    // "CURRENT SPEC" appears once, inside the disclaimer that denies it.
    expect((surface?.textContent ?? "").match(/current/gi) ?? []).toHaveLength(1);
  });
});

describe("SocialMediaImageResizerUI — cover is the one that loses picture", () => {
  it("says so, in those words, while cover is selected", () => {
    drop();
    expect(
      screen.getByText(/This is the one that loses parts of the picture/),
    ).toBeInTheDocument();
  });

  it("swaps to contain's promise, and offers the pad colour only there", () => {
    drop();
    expect(screen.queryByLabelText("Pad colour")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Contain" }));

    expect(screen.getByText(/Nothing is cropped/)).toBeInTheDocument();
    expect(screen.queryByText(/loses parts of the picture/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pad colour")).toBeInTheDocument();
  });

  it("sends the fit and the pad colour the rail is showing", async () => {
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Contain" }));
    fireEvent.change(screen.getByLabelText("Pad colour"), { target: { value: "#112233" } });
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));

    await waitFor(() => expect(editImageToMany).toHaveBeenCalledTimes(1));
    expect(lastOutputs()).toMatchObject({ fit: "contain", padColour: "#112233" });
  });
});

describe("SocialMediaImageResizerUI — the selection is what runs", () => {
  it("sends the chosen frames, in preset order, with their exact pixel sizes", async () => {
    drop();
    fireEvent.click(card("Story", 1080, 1920));
    fireEvent.click(card("Square post", 1080, 1080)); // deselect the default
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));

    await waitFor(() => expect(editImageToMany).toHaveBeenCalledTimes(1));
    expect(lastOutputs().outputs).toEqual([
      { label: "story-1080x1920", width: 1080, height: 1920 },
      { label: "link-1200x630", width: 1200, height: 630 },
    ]);
  });

  it("refuses to run with nothing selected, and says the box is empty", () => {
    drop();
    fireEvent.click(card("Square post", 1080, 1080));
    fireEvent.click(card("Link preview", 1200, 630));

    expect(screen.getByRole("button", { name: /^Resize$/ })).toBeDisabled();
    expect(screen.getByText("PICK AT LEAST ONE SIZE — NOTHING IS SELECTED")).toBeInTheDocument();
  });

  it("counts the files that came back, not the frames that were asked for", async () => {
    // The two are not the same number, and only one of them is an observation.
    editImageToMany.mockResolvedValue([output("square-1080")]);
    drop();
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));

    expect(await screen.findByText("1 SIZES")).toBeInTheDocument();
  });
});

describe("SocialMediaImageResizerUI — enlargement is measured, not assumed", () => {
  it("says nothing when the picture is bigger than every frame chosen", () => {
    // 2400 × 1600 covers a 1080 square and a 1200 × 630 card with room over.
    drop();
    expect(screen.queryByText(/WILL LOOK\s+SOFTER/)).not.toBeInTheDocument();
  });

  it("names the frames this particular picture is too small for", () => {
    /*
      800 × 600 into the 1500 × 500 header needs a 1.875× enlargement; into
      the 400 × 400 avatar it needs none. A blanket "small images may look
      soft" caveat would be true of neither run in particular.
    */
    dimensions = { w: 800, h: 600 };
    drop();
    fireEvent.click(card("Square post", 1080, 1080));
    fireEvent.click(card("Link preview", 1200, 630));
    fireEvent.click(card("Avatar", 400, 400));

    expect(screen.queryByText(/BIGGER THAN THAT/)).not.toBeInTheDocument();

    fireEvent.click(card("Profile header", 1500, 500));
    expect(
      screen.getByText(
        "THIS PICTURE IS 800 × 600 — 1 OF THE SELECTED FRAMES IS BIGGER THAN THAT (PROFILE HEADER), SO THAT FILE IS ENLARGED AND WILL LOOK SOFTER",
      ),
    ).toBeInTheDocument();
  });

  it("names every enlarged frame, not just how many there are", () => {
    /*
      The count alone is what this page shipped, and the registry copy promises
      more than that: "the page says which ones". It matters because this tool
      writes the soft files and the sharp ones into the SAME ZIP — a reader
      told "2 of them" cannot tell which two to re-export from a bigger source.
    */
    dimensions = { w: 800, h: 600 };
    drop();
    fireEvent.click(card("Story", 1080, 1920));
    fireEvent.click(card("Profile header", 1500, 500));
    fireEvent.click(card("Square post", 1080, 1080)); // deselect the default
    fireEvent.click(card("Link preview", 1200, 630)); // deselect the other default

    expect(
      screen.getByText(
        "THIS PICTURE IS 800 × 600 — 2 OF THE SELECTED FRAMES ARE BIGGER THAN THAT (STORY AND PROFILE HEADER), SO THOSE FILES ARE ENLARGED AND WILL LOOK SOFTER",
      ),
    ).toBeInTheDocument();
  });
});

describe("SocialMediaImageResizerUI — the download matches the deck", () => {
  it("names each output by the preset the returned file belongs to", async () => {
    drop();
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));
    await screen.findByText("2 SIZES");

    // Paired off the filename the engine chose, not off the click order.
    const tiles = screen.getAllByRole("figure").map((f) => f.textContent ?? "");
    expect(tiles[0]).toContain("Square post");
    expect(tiles[0]).toContain("1080 × 1080");
    expect(tiles[1]).toContain("Link preview");
    expect(tiles[1]).toContain("1200 × 630");
  });

  it("zips several outputs under a name derived from the source", async () => {
    drop();
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));
    await screen.findByText("2 SIZES");

    fireEvent.click(screen.getByRole("button", { name: "Download 2 sizes (ZIP)" }));

    const [files, name] = downloadFilesAsZip.mock.calls[0];
    expect((files as { name: string }[]).map((f) => f.name)).toEqual([
      "photo-square-1080.jpg",
      "photo-link-1200x630.jpg",
    ]);
    expect(name).toBe("photo-social.zip");
  });

  it("hands a single output over directly rather than promising a ZIP", async () => {
    /*
      `downloadFilesAsZip` saves a one-member list as the bare file, so a
      button reading "Download 1 size (ZIP)" would be a promise the download
      breaks — the trap `ExtractPdfPagesUI` documents.
    */
    editImageToMany.mockResolvedValue([output("story-1080x1920")]);
    drop();
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));
    await screen.findByText("1 SIZES");

    expect(screen.queryByText(/zip/i)).not.toBeInTheDocument();
    // Two affordances carry that name — the tile and the footer button — and
    // both have to save the same bare file for the screen to be consistent.
    const saves = screen.getAllByRole("button", { name: "Download photo-story-1080x1920.jpg" });
    expect(saves).toHaveLength(2);
    for (const save of saves) fireEvent.click(save);

    expect(triggerDownload).toHaveBeenCalledTimes(2);
    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), "photo-story-1080x1920.jpg");
    expect(downloadFilesAsZip).not.toHaveBeenCalled();
  });

  it("drops the deck the moment a setting changes under it", async () => {
    /*
      The repo's standing invariant: a blob produced under one set of options
      must never sit under another. The fit control stays reachable while the
      deck is up, so switching it has to put the run button back — otherwise
      the ZIP saves cropped files under a rail that says nothing is cropped.
    */
    drop();
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));
    await screen.findByText("2 SIZES");

    fireEvent.click(screen.getByRole("button", { name: "Contain" }));

    expect(screen.queryByRole("button", { name: /^Download / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Resize$/ })).toBeInTheDocument();
  });

  it("brings the size matrix back so the selection can be changed", async () => {
    // The deck replaces the matrix while it is up; the reset link is the only
    // way back to it, so it has to actually restore the cards.
    drop();
    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));
    await screen.findByText("2 SIZES");
    expect(screen.queryByRole("button", { name: /Story/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("CHANGE THE SIZES"));

    expect(card("Story", 1080, 1920)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download / })).not.toBeInTheDocument();
  });
});

describe("SocialMediaImageResizerUI — the format control cannot flatten in silence", () => {
  /*
    This is the one page on the site whose FORMAT control used to OPEN on JPG,
    and the only one that never passed `alphaWarning`. Together that meant a
    logo with transparent corners was written to every selected frame with
    `#ffffff` painted under it by a control the user had not touched, and no
    sentence anywhere on the surface said so.

    The picker owns the "is JPG selected" half of the warning; the caller owns
    the "can the source carry alpha at all" half. Both halves are asserted here
    because either one missing renders nothing.
  */
  const ALPHA = /JPG has no alpha channel, so every transparent pixel is filled with white/;

  it("opens on the source's own format rather than on JPG", () => {
    dropName = "logo.png";
    drop();

    expect(screen.getByRole("button", { name: "PNG" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "JPG" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(ALPHA)).toBeNull();
  });

  it("keeps a JPEG on JPG, where there is no transparency to lose", () => {
    drop();

    expect(screen.getByRole("button", { name: "JPG" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(ALPHA)).toBeNull();
  });

  it("warns the moment JPG is chosen for a source that can carry alpha", () => {
    dropName = "logo.png";
    drop();

    fireEvent.click(screen.getByRole("button", { name: "JPG" }));

    expect(screen.getByText(ALPHA)).toBeInTheDocument();
    expect(screen.getByText(/PNG and WEBP keep the transparency/)).toBeInTheDocument();
  });

  it("sends the format the chips are showing", async () => {
    dropName = "logo.png";
    drop();

    fireEvent.click(screen.getByRole("button", { name: /^Resize$/ }));
    await waitFor(() => expect(editImageToMany).toHaveBeenCalledTimes(1));

    expect(lastJob().format).toBe("png");
  });
});
