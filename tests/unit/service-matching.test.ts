// What this test does: checks that "Get a suggestion" answers are validated before any service is shown.
// Talks to: no API calls. It tests the plain functions in src/lib/client/service-matching.ts.
// Note: it proves the AI cannot invent a service, add its own text, or suggest booking in a crisis.
import { describe, expect, it } from "vitest";
import { previewSuggestions, resolveSuggestions } from "@/lib/client/service-matching";
import type { Service } from "@/lib/client/contracts";

// A small fake catalogue: two active services and one inactive service.
const services: Service[] = [
  { id: "study", name: "Academic Stress Counselling", description: "Study support", duration_minutes: 45, is_active: true },
  { id: "general", name: "General Counselling", description: "General support", duration_minutes: 45, is_active: true },
  { id: "inactive", name: "Inactive service", description: "Unavailable", duration_minutes: 45, is_active: false },
];
// Builds a normal AI answer. `extra` lets a test add a field or override one (like urgent_guidance).
const response = (recommendations: unknown[], extra = {}) => ({ mode: "AI_ASSISTED", urgent_guidance: false, recommendations, ...extra });
describe("service matching boundary", () => {
  // "invented" is not in the catalogue, so it is dropped. The reason shown is our fixed sentence.
  it("resolves only actual active catalogue IDs with fixed reasons", () => {
    const result = resolveSuggestions(response([{ service_id: "study", reason_code: "STUDY_SUPPORT" }, { service_id: "invented", reason_code: "GENERAL_SUPPORT" }]), services);
    expect(result?.matches).toEqual([{ service: services[0], reason: "For concerns about exams, studying, or academic pressure." }]);
  });
  // An inactive service is never suggested, and the same service is never listed twice.
  it("drops inactive services and duplicate IDs", () => {
    expect(resolveSuggestions(response([{ service_id: "inactive", reason_code: "RELATED_SERVICE" }]), services)?.matches).toEqual([]);
    expect(resolveSuggestions(response([{ service_id: "study", reason_code: "STUDY_SUPPORT" }, { service_id: "study", reason_code: "RELATED_SERVICE" }]), services)?.matches).toHaveLength(1);
  });
  // Anything outside the strict shape gives null: extra AI text, an unknown reason code,
  // an old answer format, or more than 2 recommendations.
  it("rejects raw model text, unknown reasons, old contracts, and excessive output", () => {
    expect(resolveSuggestions(response([], { explanation: "untrusted model text" }), services)).toBeNull();
    expect(resolveSuggestions(response([{ service_id: "study", reason_code: "DIAGNOSIS" }]), services)).toBeNull();
    expect(resolveSuggestions({ mode: "ai", serviceIds: ["study"] }, services)).toBeNull();
    expect(resolveSuggestions(response(Array(3).fill({ service_id: "study", reason_code: "STUDY_SUPPORT" })), services)).toBeNull();
  });
  // With urgent safety guidance, no appointment is suggested, even if the answer listed one.
  it("suppresses appointment suggestions when immediate safety guidance is returned", () => {
    const result = resolveSuggestions(response([{ service_id: "study", reason_code: "STUDY_SUPPORT" }], { urgent_guidance: true }), services);
    expect(result?.urgentGuidance).toBe(true);
    expect(result?.matches).toEqual([]);
  });
  // "No clear match" is a valid answer and simply gives an empty list.
  it("accepts a valid empty fallback without inventing a service", () => {
    expect(resolveSuggestions({ mode: "DETERMINISTIC_FALLBACK", urgent_guidance: false, recommendations: [] }, services)?.matches).toEqual([]);
  });
  // The preview word matcher: study words, worry words, no match at all, and a crisis phrase.
  it("labels preview word matching as fallback and supports no-match and safety states", () => {
    expect(previewSuggestions("exams are affecting my sleep", services)).toEqual({ mode: "DETERMINISTIC_FALLBACK", urgent_guidance: false, recommendations: [{ service_id: "study", reason_code: "STUDY_SUPPORT" }] });
    expect(previewSuggestions("I feel worried", services).recommendations[0].service_id).toBe("general");
    expect(previewSuggestions("xyzzy", services).recommendations).toEqual([]);
    expect(previewSuggestions("I cannot stay safe", services).urgent_guidance).toBe(true);
  });
});
