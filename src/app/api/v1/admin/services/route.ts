// GET /api/v1/admin/services: list every service, including switched-off ones, for the admin screen.
// Who can call it: admins only (signed-in staff with the admin role). No sign-in gets 401, other staff 404.
// What it does: Reads all rows of the service table, sorted by name. Unlike the public GET /services,
//   it does not filter on is_active, so an admin can see and switch a service back on.
// Returns: 200 with an array of services; 401 unauthenticated; 404 not_found for a non-admin.
import { route } from "@/lib/http";
import { SERVICE_COLUMNS } from "@/lib/slots/calendar";
import { db } from "@/lib/supabase/admin";

// Added to the PRD: the Administrator role configures which service categories are active.
export const GET = route({
  // route() signs the caller in and checks the role before the handler runs. A practitioner gets the
  // same 404 as a missing page, so the reply does not even reveal that this admin route exists.
  access: ["admin"],
  handler: async () => {
    // db() is the server's own database client. SERVICE_COLUMNS is the shared column list, so this
    // returns the same shape as the public GET /services.
    const { data, error } = await db().from("service").select(SERVICE_COLUMNS).order("name");
    // A plain Error becomes a content-free 500 in route(); the message is never sent to the caller.
    if (error) throw new Error("read_failed");
    return { json: data ?? [] };
  },
});
