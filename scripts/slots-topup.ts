/**
 * Adds upcoming demo slots without touching anything else. Unlike `pnpm seed` it deletes nothing,
 * and running it twice adds nothing the second time.
 *   pnpm slots:topup               add weekday slots for the next 14 days
 *   pnpm slots:topup --days=21     choose how far ahead (1-60)
 *   pnpm slots:topup --dry-run     only report what would be added
 *
 * Demo data only (BR-18). A remote database also needs --confirm-remote=<host>, except on a dry run.
 */
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { requireDbTarget } from "./lib/db-target";
import { planSlots } from "./lib/slot-schedule";

const DAY_MS = 86_400_000;

function fail(step: string, error: unknown): never {
  console.error(`Slot top-up failed at: ${step}`, error);
  process.exit(1);
}

function readOptions(argv: string[]) {
  // Strict, so a mistyped --dry-run stops here instead of writing for real.
  const { values } = parseArgs({
    args: argv,
    options: {
      days: { type: "string", default: "14" },
      "dry-run": { type: "boolean", default: false },
      "confirm-remote": { type: "string" },
    },
  });
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new Error("--days must be a whole number from 1 to 60.");
  return { days, dryRun: values["dry-run"] };
}

async function main() {
  const argv = process.argv.slice(2);
  let options: ReturnType<typeof readOptions>;
  try {
    options = readOptions(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const { days, dryRun } = options;

  config({ path: ".env.local" });
  config({ path: ".env" });
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
    process.exit(1);
  }

  const host = dryRun
    ? new URL(url).hostname
    : requireDbTarget({
        supabaseUrl: url,
        argv,
        command: "pnpm slots:topup",
        danger: "It adds bookable slots that real users of that database will see.",
      });

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const staff = await db.from("app_user").select("id, display_name, service_id").eq("role", "practitioner");
  if (staff.error) fail("read practitioners", staff.error);
  const withService = staff.data.filter((p) => p.service_id);
  if (withService.length === 0) {
    console.error("No practitioners found. Run `pnpm seed` first.");
    process.exit(1);
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + (days + 1) * DAY_MS);
  const current = await db
    .from("slot")
    .select("practitioner_id, start_at")
    .in(
      "practitioner_id",
      withService.map((p) => p.id),
    )
    .gt("start_at", now.toISOString())
    .lte("start_at", horizon.toISOString());
  if (current.error) fail("read existing slots", current.error);

  const planned = planSlots({
    practitioners: withService.map((p) => ({ id: p.id as string, serviceId: p.service_id as string })),
    existing: current.data.map((s) => ({ practitionerId: s.practitioner_id as string, startAt: s.start_at as string })),
    now,
    days,
  });

  console.log(`Database: ${host}${dryRun ? " (dry run, nothing is written)" : ""}`);
  for (const p of withService) {
    const count = planned.filter((s) => s.practitioner_id === p.id).length;
    console.log(`  ${String(p.display_name).padEnd(26)} ${count} new`);
  }

  if (!dryRun && planned.length > 0) {
    // The unique (practitioner_id, start_at) index settles a race with a practitioner publishing by hand.
    const inserted = await db
      .from("slot")
      .upsert(planned, { onConflict: "practitioner_id,start_at", ignoreDuplicates: true });
    if (inserted.error) fail("insert slots", inserted.error);
  }

  console.log(`${dryRun ? "Would add" : "Added"} ${planned.length} slots over the next ${days} days.`);
}

main().catch((e) => fail("unexpected", e));
