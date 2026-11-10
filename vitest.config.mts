// What this file is for: the settings of Vitest, the test runner. It defines two groups of tests
// ("projects"): fast unit tests, and slower integration tests that use a real local database.
// When it is used: by `pnpm test` (unit), `pnpm test:integration` (integration) and `pnpm test:all` (both).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Import shortcuts used by the tests.
const alias = {
  // "@/lib/..." means "src/lib/...", the same shortcut that tsconfig.json defines for the app.
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside a React Server build; tests import server modules directly.
  "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // The two test groups. The `--project unit` / `--project integration` flags in package.json pick one.
    // Each group repeats `resolve: { alias }` so the shortcuts above also work inside that group.
    projects: [
      // Unit tests: plain logic run in Node.js (not a browser), with no database and no real network.
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      // Integration tests: the real API route handlers, called against the local Supabase database.
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Runs once before all integration tests: checks the database URL and key are set, then reseeds.
          globalSetup: ["tests/integration/global-setup.ts"],
          // Runs before each test file: loads .env.local and sets fixed, test-only environment values.
          setupFiles: ["tests/integration/setup-env.ts"],
          // One shared database: run files one at a time for deterministic outbox state.
          fileParallelism: false,
          // Real database calls are slow: allow 30 seconds per test and 2 minutes per setup hook.
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
