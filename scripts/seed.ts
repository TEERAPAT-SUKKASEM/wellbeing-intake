/**
 * Seed fixtures and the dataset reset in one command:
 *   pnpm seed        destroy the whole dataset, then load demo fixtures
 *
 * Demo data only. Staff accounts here are fictional. Students are anonymous, so there are none to seed.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { checkDbTarget, requireDbTarget } from "./lib/db-target";

config({ path: ".env.local" });
config({ path: ".env" });

const DEFAULT_PASSWORD = "demo-password-16";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD ?? DEFAULT_PASSWORD;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
  process.exit(1);
}
const argv = process.argv.slice(2);
requireDbTarget({
  supabaseUrl: url,
  argv,
  command: "pnpm seed",
  danger: "It deletes every table and every login in that database.",
});
// Anyone can now post a note without signing in, and staff logins can read those notes. This password
// is printed in a public repository, so it must never protect a hosted database.
if (!checkDbTarget(url, argv).local && password === DEFAULT_PASSWORD) {
  console.error("Refusing to run pnpm seed: set SEED_PASSWORD to a private value for a hosted database.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

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

const STAFF: SeedStaff[] = [
  { email: "practitioner.1@demo.test", name: "Demo Practitioner One", role: "practitioner" },
  { email: "practitioner.2@demo.test", name: "Demo Practitioner Two", role: "practitioner" },
  { email: "admin@demo.test", name: "Demo Administrator", role: "admin" },
];

function fail(step: string, error: unknown): never {
  console.error(`Seed failed at: ${step}`, error);
  process.exit(1);
}

async function main() {
  // 1. Destroy the whole dataset.
  const reset = await db.rpc("reset_demo_data");
  if (reset.error) fail("reset_demo_data", reset.error);

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

  console.log(`Seeded ${SERVICES.length} services, ${WINDOWS.length} opening windows, ${STAFF.length} staff accounts.`);
  for (const s of STAFF) console.log(`  ${s.role.padEnd(12)} ${s.email}`);
  if (checkDbTarget(url!, argv).local) console.log(`Local demo password for every account: ${password}`);
}

main().catch((e) => fail("unexpected", e));
