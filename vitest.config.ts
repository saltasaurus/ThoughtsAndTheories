import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    env: {
      DATABASE_URL:
        "postgresql://theorytracker:theorytracker@localhost:5432/theorytracker_test",
    },
    globalSetup: "./tests/global-setup.ts",
    // Tests share one Postgres database; run files sequentially to avoid
    // cross-file races (the bootstrap test needs a deterministic User table).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
