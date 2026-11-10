// What this file does: the entry point of the service finder. It decides whether to show emergency
// guidance, ask the AI, or use the keyword matcher, and returns at most two services.
// Why it exists: POST /finder/suggest helps a student choose a service, and it must never delay or
// hide crisis help. The route calls it only after the student agreed to use the AI (ai_opt_in).
// Key idea: crisis phrases are checked first and always get emergency guidance, never a service.
import "server-only";
import { env } from "@/lib/env";
import { suggestWithAi } from "@/lib/matching/ai";
import { finalize, matchDeterministic, type CatalogueEntry, type Recommendation } from "@/lib/matching/rules";
import { db } from "@/lib/supabase/admin";
import { hasPromptInjection, hasUrgentCue } from "@/lib/urgency/keywords";

export type MatchMode = "AI_ASSISTED" | "DETERMINISTIC_FALLBACK";

// urgent_guidance = true means "show the fixed emergency guidance"; recommendations is then empty.
export type ServiceSuggestions = {
  mode: MatchMode;
  urgent_guidance: boolean;
  recommendations: Recommendation[];
};

/**
 * Suggests up to two active services for a short description. The order of the checks:
 * 1. A crisis phrase always gets the fixed emergency guidance and no appointment suggestion, without
 *    waiting for or depending on the AI.
 * 2. The AI runs only if it is switched on, the text is not trying to steer it, and the shared daily
 *    budget allows it. An attack spends nothing.
 * 3. Every AI problem ends in the keyword matcher, which returns an empty list rather than guess.
 */
export async function suggestServices(text: string, catalogue: readonly CatalogueEntry[]): Promise<ServiceSuggestions> {
  // Step 1: crisis phrases first. No AI call, no database call, so this answer is instant.
  if (hasUrgentCue(text)) return answer("DETERMINISTIC_FALLBACK", true, [], catalogue);

  // Step 2: the AI, only if every condition holds. The injection check comes before the budget, so
  // an attack does not use up the shared daily budget. The AI switch is the same one triage uses.
  if (catalogue.length > 0 && !hasPromptInjection(text) && env.aiTriageEnabled && env.llmApiKey) {
    // consume_ai_budget adds 1 to today's shared counter; false means the daily cap is reached.
    const budget = await db().rpc("consume_ai_budget", { p_limit: env.aiDailyBudget });
    if (!budget.error && budget.data === true) {
      const ai = await suggestWithAi(text, catalogue);
      // null means the AI failed or gave a bad answer, so we fall through to step 3.
      if (ai) return answer("AI_ASSISTED", ai.urgent, ai.recommendations, catalogue);
    }
  }

  // Step 3: the keyword matcher. Its urgent flag is false, because step 1 already caught crisis phrases.
  return answer("DETERMINISTIC_FALLBACK", false, matchDeterministic(text, catalogue), catalogue);
}

function answer(
  mode: MatchMode,
  urgent: boolean,
  picks: readonly Recommendation[],
  catalogue: readonly CatalogueEntry[],
): ServiceSuggestions {
  // The allowlist is checked once more right before answering, whichever path produced the picks.
  // When urgent, suggestions are always dropped: a student in danger is shown help, not a booking.
  return { mode, urgent_guidance: urgent, recommendations: urgent ? [] : finalize(picks, catalogue) };
}

/**
 * Mode and timing only. Never the text, never the services suggested, and never whether emergency
 * guidance was shown: that alone would record that someone typed a crisis phrase.
 */
export function logMatch(cid: string, mode: MatchMode, startedAt: number) {
  console.log(
    JSON.stringify({ t: new Date().toISOString(), svc: "wellbeing", kind: "finder", cid, mode, ms: Date.now() - startedAt }),
  );
}
