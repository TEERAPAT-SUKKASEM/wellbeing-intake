import { route } from "@/lib/http";
import { SERVICE_COLUMNS } from "@/lib/slots/calendar";
import { db } from "@/lib/supabase/admin";

// Added to the PRD: the Administrator role configures which service categories are active.
export const GET = route({
  access: ["admin"],
  handler: async () => {
    const { data, error } = await db().from("service").select(SERVICE_COLUMNS).order("name");
    if (error) throw new Error("read_failed");
    return { json: data ?? [] };
  },
});
