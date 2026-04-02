import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
    testTimeout: 30_000, // crypto operations can be slow
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
