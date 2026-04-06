import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: [
      "src/__tests__/unit/**/*.test.ts",
      "src/__tests__/unit/**/*.test.tsx",
      "src/__tests__/integration/**/*.test.ts",
      "src/__tests__/integration/**/*.test.tsx",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/hooks/**"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
