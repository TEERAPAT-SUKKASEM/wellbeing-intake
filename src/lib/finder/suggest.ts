import "server-only";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { isPromptInjection, rankWithAi } from "@/lib/finder/ai";
import { rankByKeywords, type CatalogueEntry } from "@/lib/finder/keywords";

export type SuggestResult = {
  mode: "ai" | "fallback";
  /** Why the fallback answered; logged, never shown. */
  reason?: "prompt_injection_blocked" | "disabled" | "budget_exhausted" | "ai_unavailable";
  serviceIds: string[];
};

export async function suggest(text: string): Promise<SuggestResult> {
  const { data, error } = await db().from("service").select("id, name, keywords").order("name");
  if (error) throw new Error("catalogue_unavailable");
  const catalogue = (data ?? []) as CatalogueEntry[];

  const fallback = (reason: SuggestResult["reason"]): SuggestResult => ({
    mode: "fallback",
    reason,
    serviceIds: rankByKeywords(text, catalogue),
  });

  // Checked before the budget, so a blocked attack does not spend the shared daily cap.
  if (isPromptInjection(text)) return fallback("prompt_injection_blocked");

  // No flag or no key means no AI path at all — and no budget spent on a call that cannot happen.
  if (!env.aiFinderEnabled || !env.llmApiKey) return fallback("disabled");

  // Global daily cap; no per-visitor identifier is stored to enforce it (NFR-19).
  const budget = await db().rpc("consume_ai_budget", { p_limit: env.aiDailyBudget });
  if (budget.error || budget.data !== true) return fallback("budget_exhausted");

  const ranked = await rankWithAi(text, catalogue);
  if (ranked === null) return fallback("ai_unavailable");
  return { mode: "ai", serviceIds: ranked };
}
