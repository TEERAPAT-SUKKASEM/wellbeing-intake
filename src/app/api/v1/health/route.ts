import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

// Public, content-free liveness and readiness.
export const GET = route({
  access: "public",
  handler: async () => {
    let database: "up" | "down" = "down";
    try {
      const { error } = await db().from("service").select("id", { count: "exact", head: true });
      database = error ? "down" : "up";
    } catch {
      database = "down";
    }
    const healthy = database === "up";
    return {
      status: healthy ? 200 : 503,
      json: { status: healthy ? "ok" : "degraded", service: "wellbeing", version: env.version, database },
    };
  },
});
