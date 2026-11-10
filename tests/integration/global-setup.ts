// What this file does: it runs once before all integration tests. It checks that the database settings
// exist, then runs `pnpm seed` to reset the local database to the demo data.
// Why it matters: every run starts from the same clean data. Because seed refuses a remote database
// (scripts/lib/db-target.ts), the tests cannot wipe a hosted database by mistake.
// How to run it: it is not run by itself; vitest.config.mts runs it first for `pnpm test:integration`.
import { execSync } from "node:child_process";
import { config } from "dotenv";

// Integration tests run against the local Supabase stack (`pnpm db:start`) on freshly
// seeded demo data, so the reset procedure is exercised on every run.
export default function setup() {
  config({ path: ".env.local" });
  config({ path: ".env" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Integration tests need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local). Run `pnpm db:start` first.");
  }
  execSync("pnpm seed", { stdio: "inherit" });
}
