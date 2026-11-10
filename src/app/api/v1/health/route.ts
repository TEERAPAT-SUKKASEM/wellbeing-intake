// GET /api/v1/health: tell a monitor whether the app is running and can reach its database.
// Who can call it: public (no sign-in, no key).
// What it does: Runs a tiny database query that only counts services. If the query fails or throws,
//   the database is reported as "down".
// Returns: 200 { status: "ok", database: "up", ... } or 503 { status: "degraded", database: "down", ... }.
import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

// Public, content-free liveness and readiness.
// (Liveness: "is the app running?". Readiness: "can it do its work?", which here means "is the DB up?".)
export const GET = route({
  access: "public",
  handler: async () => {
    let database: "up" | "down" = "down";
    try {
      // head: true asks only for a count, so no data rows come back. It just proves the database answers.
      const { error } = await db().from("service").select("id", { count: "exact", head: true });
      database = error ? "down" : "up";
    } catch {
      // A network failure throws instead of returning an error object; treat both the same way.
      database = "down";
    }
    const healthy = database === "up";
    // 503 (not 200) when the database is down, so uptime monitors notice. version is the short commit
    // id of the deployed code. Nothing about any student is ever returned here.
    return {
      status: healthy ? 200 : 503,
      json: { status: healthy ? "ok" : "degraded", service: "wellbeing", version: env.version, database },
    };
  },
});
