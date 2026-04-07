import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TextCaseConverterUI } from "@/components/tools/TextCaseConverterUI";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

function typeAndConvert(text: string, caseName: string) {
  render(<TextCaseConverterUI />);
  const input = screen.getByPlaceholderText(/enter text to convert/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByText(caseName));
}

describe("TextCaseConverterUI", () => {
  describe("UPPERCASE", () => {
    it("converts plain text to uppercase", () => {
      typeAndConvert("hello world", "UPPERCASE");
      expect(screen.getByDisplayValue("HELLO WORLD")).toBeInTheDocument();
    });

    it("converts camelCase input to uppercase", () => {
      typeAndConvert("helloWorld", "UPPERCASE");
      expect(screen.getByDisplayValue("HELLOWORLD")).toBeInTheDocument();
    });
  });

  describe("lowercase", () => {
    it("converts plain text to lowercase", () => {
      typeAndConvert("HELLO WORLD", "lowercase");
      expect(screen.getByDisplayValue("hello world")).toBeInTheDocument();
    });

    it("converts mixed case to lowercase", () => {
      typeAndConvert("Hello World", "lowercase");
      expect(screen.getByDisplayValue("hello world")).toBeInTheDocument();
    });
  });

  describe("Title Case", () => {
    it("converts plain text to title case", () => {
      typeAndConvert("hello world", "Title Case");
      expect(screen.getByDisplayValue("Hello World")).toBeInTheDocument();
    });

    it("converts camelCase input to title case", () => {
      typeAndConvert("helloWorld", "Title Case");
      expect(screen.getByDisplayValue("Hello World")).toBeInTheDocument();
    });

    it("converts snake_case input to title case", () => {
      typeAndConvert("hello_world", "Title Case");
      expect(screen.getByDisplayValue("Hello World")).toBeInTheDocument();
    });

    it("converts kebab-case input to title case", () => {
      typeAndConvert("hello-world", "Title Case");
      expect(screen.getByDisplayValue("Hello World")).toBeInTheDocument();
    });
  });

  describe("camelCase", () => {
    it("converts plain text to camelCase", () => {
      typeAndConvert("hello world", "camelCase");
      expect(screen.getByDisplayValue("helloWorld")).toBeInTheDocument();
    });

    it("converts snake_case input to camelCase", () => {
      typeAndConvert("hello_world_test", "camelCase");
      expect(screen.getByDisplayValue("helloWorldTest")).toBeInTheDocument();
    });

    it("converts kebab-case input to camelCase", () => {
      typeAndConvert("hello-world-test", "camelCase");
      expect(screen.getByDisplayValue("helloWorldTest")).toBeInTheDocument();
    });

    it("converts UPPERCASE input to camelCase", () => {
      typeAndConvert("HELLO WORLD", "camelCase");
      expect(screen.getByDisplayValue("helloWorld")).toBeInTheDocument();
    });
  });

  describe("snake_case", () => {
    it("converts plain text to snake_case", () => {
      typeAndConvert("hello world", "snake_case");
      expect(screen.getByDisplayValue("hello_world")).toBeInTheDocument();
    });

    it("converts camelCase input to snake_case", () => {
      typeAndConvert("helloWorld", "snake_case");
      expect(screen.getByDisplayValue("hello_world")).toBeInTheDocument();
    });

    it("converts kebab-case input to snake_case", () => {
      typeAndConvert("hello-world", "snake_case");
      expect(screen.getByDisplayValue("hello_world")).toBeInTheDocument();
    });
  });

  describe("kebab-case", () => {
    it("converts plain text to kebab-case", () => {
      typeAndConvert("hello world", "kebab-case");
      expect(screen.getByDisplayValue("hello-world")).toBeInTheDocument();
    });

    it("converts camelCase input to kebab-case", () => {
      typeAndConvert("helloWorld", "kebab-case");
      expect(screen.getByDisplayValue("hello-world")).toBeInTheDocument();
    });

    it("converts snake_case input to kebab-case", () => {
      typeAndConvert("hello_world", "kebab-case");
      expect(screen.getByDisplayValue("hello-world")).toBeInTheDocument();
    });
  });

  describe("PascalCase", () => {
    it("converts plain text to PascalCase", () => {
      typeAndConvert("hello world", "PascalCase");
      expect(screen.getByDisplayValue("HelloWorld")).toBeInTheDocument();
    });

    it("converts camelCase input to PascalCase", () => {
      typeAndConvert("helloWorld", "PascalCase");
      expect(screen.getByDisplayValue("HelloWorld")).toBeInTheDocument();
    });

    it("converts snake_case input to PascalCase", () => {
      typeAndConvert("hello_world", "PascalCase");
      expect(screen.getByDisplayValue("HelloWorld")).toBeInTheDocument();
    });

    it("converts kebab-case input to PascalCase", () => {
      typeAndConvert("hello-world", "PascalCase");
      expect(screen.getByDisplayValue("HelloWorld")).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      typeAndConvert("", "UPPERCASE");
      // Output section should not appear since output is empty string
      expect(screen.queryByText("Copy")).not.toBeInTheDocument();
    });

    it("handles single word", () => {
      typeAndConvert("hello", "UPPERCASE");
      expect(screen.getByDisplayValue("HELLO")).toBeInTheDocument();
    });

    it("handles multiple spaces between words", () => {
      typeAndConvert("hello   world", "snake_case");
      expect(screen.getByDisplayValue("hello_world")).toBeInTheDocument();
    });

    it("handles leading and trailing spaces", () => {
      typeAndConvert("  hello world  ", "kebab-case");
      expect(screen.getByDisplayValue("hello-world")).toBeInTheDocument();
    });
  });

  describe("UI interaction", () => {
    it("renders all seven conversion buttons", () => {
      render(<TextCaseConverterUI />);
      const buttons = [
        "UPPERCASE",
        "lowercase",
        "Title Case",
        "camelCase",
        "snake_case",
        "kebab-case",
        "PascalCase",
      ];
      for (const name of buttons) {
        expect(screen.getByText(name)).toBeInTheDocument();
      }
    });

    it("shows output section only after clicking a conversion button", () => {
      render(<TextCaseConverterUI />);
      const input = screen.getByPlaceholderText(/enter text to convert/i);
      fireEvent.change(input, { target: { value: "hello" } });
      // Output not visible yet (no button clicked)
      expect(screen.queryByText("Copy")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("UPPERCASE"));
      expect(screen.getByText("Copy")).toBeInTheDocument();
    });

    it("copies output to clipboard", () => {
      typeAndConvert("hello world", "UPPERCASE");
      fireEvent.click(screen.getByText("Copy"));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("HELLO WORLD");
    });

    it("shows active case label above output", () => {
      typeAndConvert("hello", "PascalCase");
      // The label appears both as a button and as the output label
      const labels = screen.getAllByText("PascalCase");
      expect(labels.length).toBeGreaterThanOrEqual(2);
      // One of them should be the label element
      expect(labels.some((el) => el.tagName === "LABEL")).toBe(true);
    });
  });
});
