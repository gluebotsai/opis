import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@worktual/ticketing": path.resolve(root, "../ticketing-sdk/src/index.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
});
