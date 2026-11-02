import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Integration suites share one database; run files one at a time.
    fileParallelism: false,
  },
});
