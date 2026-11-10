// POST /api/v1/triage/assess: suggest Routine or Urgent for an intake note before the form is sent.
// Who can call it: public (no sign-in); the web app calls it only after the student chooses the AI option.
// What it does: Checks and counts the per-address limit, then runs the urgency check with the AI
//   switched on. If the AI is off or fails, the crisis-phrase list answers instead. It logs only the
//   mode, the reason and the time taken.
// Returns: 200 { urgency_level, triage_mode, disclaimer, emergency_links }; 400 validation_failed; 429.
import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import { emergencyContactsFor } from "@/lib/partners/helpdesk";
import { assessUrgency, guidanceFor, logTriage } from "@/lib/urgency/assess";

// Added to the PRD: Screen 2's AI widget has to show a suggestion before the form is submitted.
// The web app must only call this after the student chooses AI, because it sends their note to the AI
// provider. Nothing is stored here, and the note is never logged. On any AI problem this still answers.
// zod schema (a rule list for the JSON body): only intake_note, 1 to 2000 characters, as in POST /requests.
const input = z.object({ intake_note: z.string().trim().min(1).max(2000) }).strict();

export const POST = route({
  access: "public",
  body: input,
  handler: async ({ req, body, cid }) => {
    // Rate limit (a cap per address, kept only in server memory and never logged). Each AI call costs
    // time and money, so every call counts here, not only failures.
    const address = clientAddress(req);
    if (isLimited("triage", address, env.triageChecksPerIp)) throw new HttpError(429, { error: "too_many_requests" });
    addHit("triage", address);

    // useAi is true because calling this endpoint is the student's choice to use AI. The AI still runs
    // only if it is switched on, the note does not try to give the model orders (prompt injection), and
    // the shared daily budget allows it. The answer is URGENT if the AI or a crisis phrase says so.
    const startedAt = Date.now();
    const result = await assessUrgency({ note: body.intake_note, useAi: true });
    // Logs mode, fallback reason and timing only: never the note and never the urgency.
    logTriage(cid, result, startedAt);

    // Fixed safety wording only: nothing the AI wrote is ever shown. This is just a suggestion;
    // POST /requests decides the urgency again when the form is sent.
    return {
      json: {
        urgency_level: result.urgency_level,
        triage_mode: result.triage_mode,
        ...guidanceFor(result.urgency_level, await emergencyContactsFor(cid)),
      },
    };
  },
});
