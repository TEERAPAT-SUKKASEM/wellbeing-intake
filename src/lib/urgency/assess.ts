// What this file does: decides if a request is ROUTINE or URGENT, and picks the fixed safety text and
// emergency numbers to show with the result.
// Why it exists: PRD 3.B and TEST-06: the AI is optional, and every AI failure must fall back to the
// deterministic rule (fixed phrases plus the student's own choice) without blocking the student.
// Key idea: URGENT wins. A request is URGENT if the AI, a crisis phrase, OR the student says so.
import "server-only";
import { env } from "@/lib/env";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS, type EmergencyContact } from "@/lib/emergency";
import { db } from "@/lib/supabase/admin";
import { assessWithAi } from "@/lib/urgency/ai";
import { hasPromptInjection, hasUrgentCue, type Urgency } from "@/lib/urgency/keywords";

// AI_ASSISTED only when the AI really gave a valid answer. Every other case is DETERMINISTIC_FALLBACK.
export type TriageMode = "AI_ASSISTED" | "DETERMINISTIC_FALLBACK";

export type TriageResult = {
  urgency_level: Urgency;
  triage_mode: TriageMode;
  /** Why the fallback answered. Logged, never shown. */
  reason: "not_selected" | "prompt_injection_blocked" | "disabled" | "budget_exhausted" | "ai_unavailable" | null;
};

/**
 * The safety rule: a request is URGENT if the AI, the urgency phrases, or the student says so. Nothing
 * can talk a student out of their own Urgent choice, and a calm AI answer cannot cancel a phrase match.
 * Every failure of the AI path ends in the deterministic path, and none of them block the student.
 */
export async function assessUrgency(input: {
  note: string;
  manualUrgency?: Urgency | null;
  useAi: boolean;
}): Promise<TriageResult> {
  const { note, manualUrgency, useAi } = input;

  // ai stays null unless the model gives a valid answer.
  let ai: Urgency | null = null;
  let reason: TriageResult["reason"] = null;

  // The checks run in a fixed order, and the first one that stops the AI records the reason:
  //   1. the student did not opt in, so the note must not leave our server;
  //   2. the note looks like prompt injection (text trying to give the AI orders);
  //   3. the AI is switched off, or there is no API key;
  //   4. the shared daily AI budget is used up;
  //   5. the AI call itself failed (timeout, error, or an answer in the wrong shape).
  if (!useAi) reason = "not_selected";
  else if (hasPromptInjection(note)) reason = "prompt_injection_blocked"; // before the budget: an attack spends nothing
  else if (!env.aiTriageEnabled || !env.llmApiKey) reason = "disabled";
  else {
    // Global daily cap; no per-visitor identifier is stored to enforce it.
    // consume_ai_budget adds 1 to today's counter in the database and returns false once it is full.
    // The call is counted before the AI runs, so failed calls also use up the budget.
    const budget = await db().rpc("consume_ai_budget", { p_limit: env.aiDailyBudget });
    if (budget.error || budget.data !== true) reason = "budget_exhausted";
    else {
      ai = await assessWithAi(note);
      if (ai === null) reason = "ai_unavailable";
    }
  }

  // The safety rule. Any one URGENT signal is enough. The phrases run even when the AI answered, so a
  // calm AI answer cannot hide a crisis phrase, and the student's own Urgent choice always counts.
  const urgent = ai === "URGENT" || hasUrgentCue(note) || manualUrgency === "URGENT";
  return {
    urgency_level: urgent ? "URGENT" : "ROUTINE",
    triage_mode: ai ? "AI_ASSISTED" : "DETERMINISTIC_FALLBACK",
    reason,
  };
}

// Shown with a ROUTINE result. An URGENT result gets CANNOT_HELP_NOW from emergency.ts instead.
const ROUTINE_DISCLAIMER =
  "This app books appointments. It cannot provide emergency help. If you or someone else is in danger, please contact one of these numbers now.";

/**
 * Fixed wording only: nothing a model wrote is ever shown to a student. `contacts` defaults to the
 * hard-coded list; the routes pass the list from emergencyContactsFor() (src/lib/partners/helpdesk.ts),
 * so Team 14's official campus numbers can replace our placeholders.
 */
export function guidanceFor(urgency: Urgency, contacts: readonly EmergencyContact[] = EMERGENCY_CONTACTS) {
  // The same emergency numbers are shown for both levels. A tel: link lets a phone dial the number.
  return {
    disclaimer: urgency === "URGENT" ? CANNOT_HELP_NOW : ROUTINE_DISCLAIMER,
    emergency_links: contacts.map((contact) => ({
      name: contact.name,
      detail: contact.detail,
      phone: contact.phone,
      href: `tel:${contact.tel}`,
    })),
  };
}

/** Mode and reason only: never the note, and never the urgency it was given. */
// cid is the correlation id: one id shared by all log lines of the same HTTP request.
export function logTriage(cid: string, result: TriageResult, startedAt: number) {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      svc: "wellbeing",
      kind: "triage",
      cid,
      mode: result.triage_mode,
      reason: result.reason,
      ms: Date.now() - startedAt,
    }),
  );
}
