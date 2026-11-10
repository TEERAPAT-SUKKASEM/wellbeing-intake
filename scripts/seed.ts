// What this script does: it wipes the whole database and loads fixed demo data: 3 services, opening
// hours (Monday to Friday, 09:00-17:00) and 3 staff logins (2 practitioners and 1 admin).
// Why it matters: every demo and every integration test run starts from the same known data. A safety
// guard refuses to run against a hosted (not local) database unless that exact host is confirmed.
// How to run it: `pnpm seed` (or `pnpm db:reset`). The integration tests also run it before they start.
/**
 * Seed fixtures and the dataset reset in one command:
 *   pnpm seed        destroy the whole dataset, then load demo fixtures
 *
 * Demo data only. Staff accounts here are fictional. Students are anonymous, so there are none to seed.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { checkDbTarget, requireDbTarget } from "./lib/db-target";

// Read the database address (SUPABASE_URL) and the service-role key from .env.local, then .env.
config({ path: ".env.local" });
config({ path: ".env" });

// The demo password for every staff login. It is public, so it is only allowed on a local database.
const DEFAULT_PASSWORD = "demo-password-16";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD ?? DEFAULT_PASSWORD;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
  process.exit(1);
}
// Safety guard 1: stop unless the database is on this computer (localhost), or the command line has
// --confirm-remote=<that exact host>. See scripts/lib/db-target.ts.
const argv = process.argv.slice(2);
requireDbTarget({
  supabaseUrl: url,
  argv,
  command: "pnpm seed",
  danger: "It deletes every table and every login in that database.",
});
// Safety guard 2: a confirmed hosted database also needs a private SEED_PASSWORD, not the public default.
// Anyone can now post a note without signing in, and staff logins can read those notes. This password
// is printed in a public repository, so it must never protect a hosted database.
if (!checkDbTarget(url, argv).local && password === DEFAULT_PASSWORD) {
  console.error("Refusing to run pnpm seed: set SEED_PASSWORD to a private value for a hosted database.");
  process.exit(1);
}

// An admin database client. The service-role key skips all row-level security, which is why the
// guards above must pass first.
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// The three demo services students can book (a 45, 45 and 30 minute session).
const SERVICES = [
  {
    id: "srv_academic_stress",
    name: "Academic Stress Counselling",
    description: "Talk through exam pressure, deadlines, study worries or feeling behind.",
    duration_minutes: 45,
  },
  {
    id: "srv_general_counselling",
    name: "General Counselling",
    description: "Anything weighing on you: low mood, anxiety, relationships, family or grief. No problem is too small.",
    duration_minutes: 45,
  },
  {
    id: "srv_urgent_drop_in",
    name: "Urgent Drop-in",
    description: "A shorter, sooner conversation when something can't wait. In an emergency, call the emergency numbers instead.",
    duration_minutes: 30,
  },
];

// One shared calendar: Monday to Friday, 09:00-17:00 campus time. Weekday 0 is Sunday.
const WINDOWS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: "09:00", end_time: "17:00" }));

type SeedStaff = { email: string; name: string; role: "practitioner" | "admin" };

// Fictional staff logins. Students are anonymous, so there are no student accounts.
const STAFF: SeedStaff[] = [
  { email: "practitioner.1@demo.test", name: "Demo Practitioner One", role: "practitioner" },
  { email: "practitioner.2@demo.test", name: "Demo Practitioner Two", role: "practitioner" },
  { email: "admin@demo.test", name: "Demo Administrator", role: "admin" },
];

// Prints which step failed and stops the script with exit code 1.
function fail(step: string, error: unknown): never {
  console.error(`Seed failed at: ${step}`, error);
  process.exit(1);
}

async function main() {
  // 1. Destroy the whole dataset.
  const reset = await db.rpc("reset_demo_data");
  if (reset.error) fail("reset_demo_data", reset.error);

  // Also delete every login (Supabase Auth user), so only the demo staff below will exist.
  const existing = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (existing.error) fail("list auth users", existing.error);
  for (const u of existing.data.users) {
    const del = await db.auth.admin.deleteUser(u.id);
    if (del.error) fail(`delete auth user ${u.email}`, del.error);
  }

  // 2. Services and opening hours. Slots are calculated from these, so none are stored.
  const services = await db.from("service").insert(SERVICES);
  if (services.error) fail("insert services", services.error);
  const windows = await db.rpc("set_availability", { p_windows: WINDOWS });
  if (windows.error) fail("set availability", windows.error);

  // 3. Staff identities (Supabase Auth) and their minimal staff rows.
  for (const s of STAFF) {
    const created = await db.auth.admin.createUser({
      email: s.email,
      password,
      email_confirm: true,
      app_metadata: { kind: "staff" },
      user_metadata: { display_name: s.name },
    });
    if (created.error || !created.data.user) fail(`create auth user ${s.email}`, created.error);

    const row = await db.from("staff").insert({
      identity_ref: created.data.user.id,
      email: s.email,
      display_name: s.name,
      role: s.role,
    });
    if (row.error) fail(`insert staff ${s.email}`, row.error);
  }

  // 4. Print what was created. The demo password is printed only for a local database.
  console.log(`Seeded ${SERVICES.length} services, ${WINDOWS.length} opening windows, ${STAFF.length} staff accounts.`);
  for (const s of STAFF) console.log(`  ${s.role.padEnd(12)} ${s.email}`);
  if (checkDbTarget(url!, argv).local) console.log(`Local demo password for every account: ${password}`);
}

main().catch((e) => fail("unexpected", e));
