import "server-only";
import { env } from "@/lib/env";
import { suggestWithAi } from "@/lib/matching/ai";
import { finalize, matchDeterministic, type CatalogueEntry, type Recommendation } from "@/lib/matching/rules";
import { db } from "@/lib/supabase/admin";
import { hasPromptInjection, hasUrgentCue } from "@/lib/urgency/keywords";

export type MatchMode = "AI_ASSISTED" | "DETERMINISTIC_FALLBACK";

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
  if (hasUrgentCue(text)) return answer("DETERMINISTIC_FALLBACK", true, [], catalogue);

  if (catalogue.length > 0 && !hasPromptInjection(text) && env.aiTriageEnabled && env.llmApiKey) {
    const budget = await db().rpc("consume_ai_budget", { p_limit: env.aiDailyBudget });
    if (!budget.error && budget.data === true) {
      const ai = await suggestWithAi(text, catalogue);
      if (ai) return answer("AI_ASSISTED", ai.urgent, ai.recommendations, catalogue);
    }
  }

  return answer("DETERMINISTIC_FALLBACK", false, matchDeterministic(text, catalogue), catalogue);
}

function answer(
  mode: MatchMode,
  urgent: boolean,
  picks: readonly Recommendation[],
  catalogue: readonly CatalogueEntry[],
): ServiceSuggestions {
  // The allowlist is checked once more right before answering, whichever path produced the picks.
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
