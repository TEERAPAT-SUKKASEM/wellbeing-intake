// GET /api/v1/practitioner/queue: list the requests that still wait for a practitioner's decision.
// Who can call it: practitioners only (signed in). No sign-in gets 401; admins and other staff get 404.
// What it does: Reads every PENDING request, URGENT ones first and then the earliest requested time.
//   Each row is turned into the shared AppointmentRequest shape from the PRD.
// Returns: 200 with an array of requests (never with an access key); 401 unauthenticated; 404 not_found.
import { route } from "@/lib/http";
import { REQUEST_COLUMNS, toAppointmentRequest, type RequestRow } from "@/lib/requests";
import { db } from "@/lib/supabase/admin";

// PRD 6: requests waiting for a decision, Urgent pinned first, then the soonest requested time.
export const GET = route({
  // Without a sign-in route() answers 401 (PRD test TEST-05). A signed-in admin gets 404, not 403,
  // so a caller can never tell "not allowed" apart from "does not exist".
  access: ["practitioner"],
  handler: async () => {
    // db() is the server's own database client. Sorting urgency_level from Z to A puts "URGENT" above
    // "ROUTINE" (U comes after R in the alphabet), which pins urgent requests at the top.
    // A database index on (status, urgency_level, slot_start) keeps this query fast.
    const { data, error } = await db()
      .from("appointment_request")
      .select(REQUEST_COLUMNS)
      .eq("status", "PENDING")
      .order("urgency_level", { ascending: false }) // URGENT sorts after ROUTINE
      .order("slot_start", { ascending: true });
    // A plain Error becomes a content-free 500 in route(); the message is never sent to the caller.
    if (error) throw new Error("read_failed");
    // No access key is passed to toAppointmentRequest(), so staff never see one: a practitioner must not
    // be able to act as the student. (The database only holds a hash of the key anyway.)
    return { json: ((data ?? []) as unknown as RequestRow[]).map((row) => toAppointmentRequest(row)) };
  },
});
