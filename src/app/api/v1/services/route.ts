// GET /api/v1/services: list the counselling services a student can choose from.
// Who can call it: public (no sign-in, no key).
// What it does: Reads only the active services, sorted by name, using the shared column list.
// Returns: 200 with an array of { id, name, description, duration_minutes, is_active };
//   a database problem gives a content-free 500 internal_error.
import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { SERVICE_COLUMNS } from "@/lib/slots/calendar";

// PRD 1: active counselling services. Public, and nothing about any student.
export const GET = route({
  access: "public",
  handler: async () => {
    // db() is the server's own database client; the browser can never reach the tables directly.
    // Switched-off services are filtered out here; admins see them through GET /admin/services.
    const { data, error } = await db().from("service").select(SERVICE_COLUMNS).eq("is_active", true).order("name");
    // A plain Error becomes a 500 { error: "internal_error" } in route(); this message is never sent out.
    if (error) throw new Error("catalogue_unavailable");
    return { json: data ?? [] };
  },
});
