import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { SERVICE_COLUMNS } from "@/lib/slots/calendar";

// PRD 1: active counselling services. Public, and nothing about any student.
export const GET = route({
  access: "public",
  handler: async () => {
    const { data, error } = await db().from("service").select(SERVICE_COLUMNS).eq("is_active", true).order("name");
    if (error) throw new Error("catalogue_unavailable");
    return { json: data ?? [] };
  },
});
