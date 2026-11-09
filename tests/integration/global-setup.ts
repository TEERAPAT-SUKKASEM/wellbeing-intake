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
