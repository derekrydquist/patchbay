// Vitest's own config, so tests never load vite.config.ts (its client root and dev
// plugins are for the app build). Pure-logic tests only, for now: no DOM.
import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "client/src/**/*.test.ts"],
    environment: "node",
  },
});
