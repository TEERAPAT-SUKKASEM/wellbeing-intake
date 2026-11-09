import { route } from "@/lib/http";
import { REQUEST_COLUMNS, toAppointmentRequest, type RequestRow } from "@/lib/requests";
import { db } from "@/lib/supabase/admin";

// PRD 6: requests waiting for a decision, Urgent pinned first, then the soonest requested time.
export const GET = route({
  access: ["practitioner"],
  handler: async () => {
    const { data, error } = await db()
      .from("appointment_request")
      .select(REQUEST_COLUMNS)
      .eq("status", "PENDING")
      .order("urgency_level", { ascending: false }) // URGENT sorts after ROUTINE
      .order("slot_start", { ascending: true });
    if (error) throw new Error("read_failed");
    return { json: ((data ?? []) as unknown as RequestRow[]).map((row) => toAppointmentRequest(row)) };
  },
});
