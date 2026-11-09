import { z } from "zod";
import { HttpError, notFound, route } from "@/lib/http";
import { SERVICE_COLUMNS } from "@/lib/slots/calendar";
import { db } from "@/lib/supabase/admin";

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
    const { data, error } = await db()
      .from("service")
      .update(body)
      .eq("id", params.id)
      .select(SERVICE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23505") throw new HttpError(409, { error: "name_exists" });
      throw new Error("update_failed");
    }
    if (!data) throw notFound();
    return { json: data };
  },
});
