import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QrCodeGeneratorUI } from "@/components/tools/QrCodeGeneratorUI";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

const mockToCanvas = vi.fn().mockImplementation(async () => {});
const mockToString = vi
  .fn()
  .mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

// Mock qrcode library
vi.mock("qrcode", () => ({
  default: {
    toCanvas: (...args: unknown[]) => mockToCanvas(...args),
    toString: (...args: unknown[]) => mockToString(...args),
  },
}));

describe("QrCodeGeneratorUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();

    // Make canvas.toDataURL return a proper data URL
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,fakedata"
    );
  });

  it("renders text input and generate button", () => {
    render(<QrCodeGeneratorUI />);
    expect(
      screen.getByPlaceholderText("https://example.com")
    ).toBeInTheDocument();
    expect(screen.getByText("Generate QR Code")).toBeInTheDocument();
  });

  it("renders foreground and background color pickers", () => {
    render(<QrCodeGeneratorUI />);
    expect(screen.getByText("Foreground")).toBeInTheDocument();
    expect(screen.getByText("Background")).toBeInTheDocument();
  });

  it("does not generate QR for empty input", async () => {
    render(<QrCodeGeneratorUI />);
    await act(async () => {
      fireEvent.click(screen.getByText("Generate QR Code"));
    });
    expect(mockToCanvas).not.toHaveBeenCalled();
  });

  it("generates QR code on button click with input", async () => {
    render(<QrCodeGeneratorUI />);
    const textarea = screen.getByPlaceholderText("https://example.com");
    fireEvent.change(textarea, { target: { value: "https://test.com" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Generate QR Code"));
    });

    expect(mockToCanvas).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      "https://test.com",
      expect.objectContaining({
        width: 300,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      })
    );
  });

  it("shows download buttons after QR generation", async () => {
    render(<QrCodeGeneratorUI />);
    const textarea = screen.getByPlaceholderText("https://example.com");
    fireEvent.change(textarea, { target: { value: "hello" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Generate QR Code"));
    });

    expect(screen.getByText("Download PNG")).toBeInTheDocument();
    expect(screen.getByText("Download SVG")).toBeInTheDocument();
  });

  it("calls QRCode.toString for SVG download", async () => {
    render(<QrCodeGeneratorUI />);
    const textarea = screen.getByPlaceholderText("https://example.com");
    fireEvent.change(textarea, { target: { value: "hello" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Generate QR Code"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Download SVG"));
    });

    expect(mockToString).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        type: "svg",
        margin: 2,
      })
    );
  });

  it("passes custom colors to QR generation", async () => {
    render(<QrCodeGeneratorUI />);
    const textarea = screen.getByPlaceholderText("https://example.com");
    fireEvent.change(textarea, { target: { value: "test" } });

    const colorInputs = document.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[0], { target: { value: "#ff0000" } });
    fireEvent.change(colorInputs[1], { target: { value: "#00ff00" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Generate QR Code"));
    });

    expect(mockToCanvas).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      "test",
      expect.objectContaining({
        color: { dark: "#ff0000", light: "#00ff00" },
      })
    );
  });

  it("shows error when QR generation fails", async () => {
    mockToCanvas.mockRejectedValueOnce(new Error("Too long"));
    render(<QrCodeGeneratorUI />);
    const textarea = screen.getByPlaceholderText("https://example.com");
    fireEvent.change(textarea, { target: { value: "test" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Generate QR Code"));
    });

    expect(screen.getByText("Too long")).toBeInTheDocument();
  });
});
