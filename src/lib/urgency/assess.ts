import "server-only";
import { env } from "@/lib/env";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";
import { db } from "@/lib/supabase/admin";
import { assessWithAi } from "@/lib/urgency/ai";
import { hasPromptInjection, hasUrgentCue, type Urgency } from "@/lib/urgency/keywords";

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

  let ai: Urgency | null = null;
  let reason: TriageResult["reason"] = null;

  if (!useAi) reason = "not_selected";
  else if (hasPromptInjection(note)) reason = "prompt_injection_blocked"; // before the budget: an attack spends nothing
  else if (!env.aiTriageEnabled || !env.llmApiKey) reason = "disabled";
  else {
    // Global daily cap; no per-visitor identifier is stored to enforce it.
    const budget = await db().rpc("consume_ai_budget", { p_limit: env.aiDailyBudget });
    if (budget.error || budget.data !== true) reason = "budget_exhausted";
    else {
      ai = await assessWithAi(note);
      if (ai === null) reason = "ai_unavailable";
    }
  }

  const urgent = ai === "URGENT" || hasUrgentCue(note) || manualUrgency === "URGENT";
  return {
    urgency_level: urgent ? "URGENT" : "ROUTINE",
    triage_mode: ai ? "AI_ASSISTED" : "DETERMINISTIC_FALLBACK",
    reason,
  };
}

const ROUTINE_DISCLAIMER =
  "This app books appointments. It cannot provide emergency help. If you or someone else is in danger, please contact one of these numbers now.";

/** Fixed wording only: nothing a model wrote is ever shown to a student. */
export function guidanceFor(urgency: Urgency) {
  return {
    disclaimer: urgency === "URGENT" ? CANNOT_HELP_NOW : ROUTINE_DISCLAIMER,
    emergency_links: EMERGENCY_CONTACTS.map((contact) => ({
      name: contact.name,
      detail: contact.detail,
      phone: contact.phone,
      href: `tel:${contact.tel}`,
    })),
  };
}

/** Mode and reason only: never the note, and never the urgency it was given. */
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
