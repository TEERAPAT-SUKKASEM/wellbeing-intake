import { z } from "zod";
import type { Service } from "./contracts";

export const MATCH_REASONS = {
  STUDY_SUPPORT: "For concerns about exams, studying, or academic pressure.",
  GENERAL_SUPPORT: "A broad option for talking through worries or difficult feelings.",
  URGENT_SUPPORT: "For an urgent appointment request. This is not immediate crisis support.",
  RELATED_SERVICE: "This service’s published description may fit what you shared.",
} as const;

export const suggestionSchema = z.object({
  mode: z.enum(["AI_ASSISTED", "DETERMINISTIC_FALLBACK"]),
  urgent_guidance: z.boolean(),
  recommendations: z.array(z.object({
    service_id: z.string().min(1).max(64),
    reason_code: z.enum(["STUDY_SUPPORT", "GENERAL_SUPPORT", "URGENT_SUPPORT", "RELATED_SERVICE"]),
  }).strict()).max(2),
}).strict();

export type ServiceSuggestions = z.infer<typeof suggestionSchema>;
export type MatchedService = { service: Service; reason: string };

export function resolveSuggestions(value: unknown, services: Service[]): {
  mode: ServiceSuggestions["mode"];
  urgentGuidance: boolean;
  matches: MatchedService[];
} | null {
  const parsed = suggestionSchema.safeParse(value);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const matches = parsed.data.urgent_guidance ? [] : parsed.data.recommendations.flatMap(item => {
    const service = services.find(s => s.id === item.service_id && s.is_active);
    if (!service || seen.has(service.id)) return [];
    seen.add(service.id);
    return [{ service, reason: MATCH_REASONS[item.reason_code] }];
  });
  return { mode: parsed.data.mode, urgentGuidance: parsed.data.urgent_guidance, matches };
}

// Fictional development preview. A local word match, never represented as AI.
export function previewSuggestions(text: string, services: Service[]): ServiceSuggestions {
  const urgent = /\b(suicid\w*|self.harm|immediate danger|kill myself|cannot stay safe)\b/i.test(text);
  const study = /\b(exams?|stud(?:y|ying|ies)|academic|coursework|grades?|assignments?)\b/i.test(text);
  const general = /\b(worr\w*|overwhelm\w*|feel\w*|relationship\w*|anxi\w*|sleep\w*|stress\w*|sad\w*|lonely|talk)\b/i.test(text);
  const match = study || general ? services.find(s => s.is_active && (study ? /academic|study/i.test(s.name) : /general/i.test(s.name))) : undefined;
  return {
    mode: "DETERMINISTIC_FALLBACK",
    urgent_guidance: urgent,
    recommendations: !urgent && match ? [{ service_id: match.id, reason_code: study ? "STUDY_SUPPORT" : "GENERAL_SUPPORT" }] : [],
  };
}
