import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { addHit, clientAddress, isLimited } from "@/lib/rate-limit";
import { assessUrgency, guidanceFor, logTriage } from "@/lib/urgency/assess";

// Added to the PRD: Screen 2's AI widget has to show a suggestion before the form is submitted.
// The web app must only call this after the student chooses AI, because it sends their note to the AI
// provider. Nothing is stored here, and the note is never logged. On any AI problem this still answers.
const input = z.object({ intake_note: z.string().trim().min(1).max(2000) }).strict();

export const POST = route({
  access: "public",
  body: input,
  handler: async ({ req, body, cid }) => {
    const address = clientAddress(req);
    if (isLimited("triage", address, env.triageChecksPerIp)) throw new HttpError(429, { error: "too_many_requests" });
    addHit("triage", address);

    const startedAt = Date.now();
    const result = await assessUrgency({ note: body.intake_note, useAi: true });
    logTriage(cid, result, startedAt);

    return {
      json: {
        urgency_level: result.urgency_level,
        triage_mode: result.triage_mode,
        ...guidanceFor(result.urgency_level),
      },
    };
  },
});
