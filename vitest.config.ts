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
        // Measured 2026-11-11: 86.3 / 80.9 / 87.0 / 87.8. A floor a few points
        // under that, so a real drop fails the run but jitter does not.
        statements: 82,
        branches: 76,
        functions: 83,
        lines: 83,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
