import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Uses import.meta.dirname rather than __dirname, which Vite's native config
 * loader does not provide and warns about.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
