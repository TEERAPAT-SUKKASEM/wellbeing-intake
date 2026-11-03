/**
 * Seed fixtures (BR-21) and the NFR-09 reset procedure in one command:
 *   pnpm seed        — destroy the whole dataset, then load demo fixtures
 *
 * Demo data only (BR-18): every person here is fictional. Never point this at real records.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { requireDbTarget } from "./lib/db-target";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_PASSWORD ?? "demo-password-16";
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
  process.exit(1);
}
requireDbTarget({
  supabaseUrl: url,
  argv: process.argv.slice(2),
  command: "pnpm seed",
  danger: "It deletes every table and every login in that database.",
});

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const SERVICES = [
  {
    slug: "counselling",
    name: "Counselling",
    what_for: "Talking through stress, low mood, anxiety, relationships, grief, or anything that is weighing on you. You do not need a diagnosis or a 'big enough' problem.",
    first_session: "A relaxed 50-minute conversation with a counsellor about what is going on and what might help. Nothing is decided for you.",
    who_will_know: "Only the counsellors of this service. Not your lecturers, not your parents, not other students.",
    keywords: ["stress", "stressed", "anxiety", "anxious", "worry", "panic", "sad", "low mood", "depressed", "lonely", "grief", "relationship", "breakup", "family", "overwhelmed", "burnout", "homesick", "talk", "counsellor", "therapy", "exam stress", "cannot cope"],
  },
  {
    slug: "health-clinic",
    name: "Health clinic",
    what_for: "Everyday physical health: vaccinations and flu shots, feeling unwell, minor injuries, medical certificates, and general health questions.",
    first_session: "A 15 to 20 minute visit with a campus nurse. Bring your student ID.",
    who_will_know: "Only the nurses of the health clinic.",
    keywords: ["vaccine", "vaccination", "flu shot", "flu", "fever", "cold", "cough", "sick", "unwell", "injury", "headache", "stomach", "medical certificate", "certificate", "nurse", "allergy", "prescription", "check up"],
  },
  {
    slug: "physiotherapy",
    name: "Physiotherapy",
    what_for: "Aches, sports injuries, back and neck pain from study, and recovery after an injury.",
    first_session: "A 30-minute assessment of the problem area and a first set of exercises.",
    who_will_know: "Only the physiotherapists of this service.",
    keywords: ["back pain", "neck pain", "shoulder", "knee", "ankle", "sprain", "sports injury", "posture", "muscle", "physio", "rehab", "stretch", "pain"],
  },
  {
    slug: "wellbeing-advising",
    name: "Wellbeing advising",
    what_for: "Practical help with sleep, study-life balance, money worries, settling in, and finding the right support on or off campus.",
    first_session: "A 30-minute chat with a wellbeing officer to map out what would make things easier.",
    who_will_know: "Only the wellbeing officers of this service.",
    keywords: ["sleep", "sleeping", "insomnia", "tired", "balance", "time management", "money", "finance", "budget", "settling in", "international", "visa", "motivation", "procrastination", "habits", "wellbeing", "not sure"],
  },
];

type SeedUser = { email: string; name: string; kind: "student" | "staff"; role: "student" | "practitioner" | "coordinator"; service?: string };

const USERS: SeedUser[] = [
  { email: "student.a@demo.test", name: "Demo Student A", kind: "student", role: "student" },
  { email: "student.b@demo.test", name: "Demo Student B", kind: "student", role: "student" },
  { email: "student.c@demo.test", name: "Demo Student C", kind: "student", role: "student" },
  { email: "counsellor.1@demo.test", name: "Demo Counsellor One", kind: "staff", role: "practitioner", service: "counselling" },
  { email: "counsellor.2@demo.test", name: "Demo Counsellor Two", kind: "staff", role: "practitioner", service: "counselling" },
  { email: "nurse.1@demo.test", name: "Demo Nurse One", kind: "staff", role: "practitioner", service: "health-clinic" },
  { email: "physio.1@demo.test", name: "Demo Physio One", kind: "staff", role: "practitioner", service: "physiotherapy" },
  { email: "wellbeing.1@demo.test", name: "Demo Wellbeing Officer", kind: "staff", role: "practitioner", service: "wellbeing-advising" },
  { email: "coordinator@demo.test", name: "Demo Intake Coordinator", kind: "staff", role: "coordinator" },
];

function fail(step: string, error: unknown): never {
  console.error(`Seed failed at: ${step}`, error);
  process.exit(1);
}

async function main() {
  // 1. NFR-09: destroy the whole dataset.
  const reset = await db.rpc("reset_demo_data");
  if (reset.error) fail("reset_demo_data", reset.error);

  const existing = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (existing.error) fail("list auth users", existing.error);
  for (const u of existing.data.users) {
    const del = await db.auth.admin.deleteUser(u.id);
    if (del.error) fail(`delete auth user ${u.email}`, del.error);
  }

  // 2. Services.
  const services = await db.from("service").insert(SERVICES).select("id, slug");
  if (services.error) fail("insert services", services.error);
  const serviceId = new Map(services.data.map((s) => [s.slug as string, s.id as string]));

  // 3. Fixture identities (Supabase Auth) + the minimal app_user rows.
  const practitionerIds: string[] = [];
  for (const u of USERS) {
    const created = await db.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
      app_metadata: { kind: u.kind },
      user_metadata: { display_name: u.name },
    });
    if (created.error || !created.data.user) fail(`create auth user ${u.email}`, created.error);

    const row = await db
      .from("app_user")
      .insert({
        identity_ref: created.data.user.id,
        email: u.email,
        display_name: u.name,
        role: u.role,
        service_id: u.service ? serviceId.get(u.service) : null,
      })
      .select("id")
      .single();
    if (row.error) fail(`insert app_user ${u.email}`, row.error);
    if (u.role === "practitioner") practitionerIds.push(row.data.id as string);
  }

  // 4. Slots: three per practitioner. One falls inside the 24 h reminder lead time so the
  //    reminder webhook can be demonstrated immediately after booking.
  const hour = 60 * 60 * 1000;
  const base = Date.now();
  const slots = practitionerIds.flatMap((id, i) => [
    { practitioner_id: id, start_at: new Date(base + (20 + i) * hour).toISOString() },
    { practitioner_id: id, start_at: new Date(base + (72 + i) * hour).toISOString() },
    { practitioner_id: id, start_at: new Date(base + (120 + i) * hour).toISOString() },
  ]);
  const insertedSlots = await db.from("slot").insert(slots);
  if (insertedSlots.error) fail("insert slots", insertedSlots.error);

  console.log(`Seeded ${SERVICES.length} services, ${USERS.length} demo users, ${slots.length} slots.`);
  console.log(`Demo password for every account: ${password}`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(12)} ${u.email}`);
}

main().catch((e) => fail("unexpected", e));
