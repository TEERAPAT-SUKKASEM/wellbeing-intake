// PATCH /api/v1/admin/services/{id}: change one service (name, description, length, or on/off).
// Who can call it: admins only (signed-in staff with the admin role). No sign-in gets 401, other staff 404.
// What it does: Checks the body, updates the one service row with that id, and reads the row back.
//   A duplicate name is turned into a clear 409 instead of a general error.
// Returns: 200 with the updated service; 400 validation_failed; 404 not_found for an unknown id;
//   409 name_exists; 403 cross_origin_rejected if a cookie-signed write comes from another website.
import { z } from "zod";
import { HttpError, notFound, route } from "@/lib/http";
import { SERVICE_COLUMNS } from "@/lib/slots/calendar";
import { db } from "@/lib/supabase/admin";

// zod schema (a rule list that checks the JSON body). Every field is optional, but .refine() needs
// at least one, so an empty {} is a 400. .strict() refuses other fields such as "id", so the id can
// never be changed. The length rule (15-120 minutes, steps of 5) matches the database check.
const changes = z
  .object({
    is_active: z.boolean().optional(),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    duration_minutes: z.number().int().min(15).max(120).multipleOf(5).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

// Requests already made keep the times they were given.
export const PATCH = route({
  access: ["admin"],
  body: changes,
  handler: async ({ params, body }) => {
    // route() has already checked that {id} is a safe id (letters, digits, _ and -). Only the checked
    // fields are written. .maybeSingle() gives null, not an error, when no row has this id.
    const { data, error } = await db()
      .from("service")
      .update(body)
      .eq("id", params.id)
      .select(SERVICE_COLUMNS)
      .maybeSingle();
    if (error) {
      // 23505 is the Postgres code for "this unique value already exists": service names are unique.
      if (error.code === "23505") throw new HttpError(409, { error: "name_exists" });
      throw new Error("update_failed");
    }
    // Nothing was updated, so the id does not exist: the standard 404.
    if (!data) throw notFound();
    return { json: data };
  },
});
