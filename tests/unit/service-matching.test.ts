import { describe, expect, it } from "vitest";
import { previewSuggestions, resolveSuggestions } from "@/lib/client/service-matching";
import type { Service } from "@/lib/client/contracts";

const services: Service[] = [
  { id: "study", name: "Academic Stress Counselling", description: "Study support", duration_minutes: 45, is_active: true },
  { id: "general", name: "General Counselling", description: "General support", duration_minutes: 45, is_active: true },
  { id: "inactive", name: "Inactive service", description: "Unavailable", duration_minutes: 45, is_active: false },
];
const response = (recommendations: unknown[], extra = {}) => ({ mode: "AI_ASSISTED", urgent_guidance: false, recommendations, ...extra });
describe("service matching boundary", () => {
  it("resolves only actual active catalogue IDs with fixed reasons", () => {
    const result = resolveSuggestions(response([{ service_id: "study", reason_code: "STUDY_SUPPORT" }, { service_id: "invented", reason_code: "GENERAL_SUPPORT" }]), services);
    expect(result?.matches).toEqual([{ service: services[0], reason: "For concerns about exams, studying, or academic pressure." }]);
  });
  it("drops inactive services and duplicate IDs", () => {
    expect(resolveSuggestions(response([{ service_id: "inactive", reason_code: "RELATED_SERVICE" }]), services)?.matches).toEqual([]);
    expect(resolveSuggestions(response([{ service_id: "study", reason_code: "STUDY_SUPPORT" }, { service_id: "study", reason_code: "RELATED_SERVICE" }]), services)?.matches).toHaveLength(1);
  });
  it("rejects raw model text, unknown reasons, old contracts, and excessive output", () => {
    expect(resolveSuggestions(response([], { explanation: "untrusted model text" }), services)).toBeNull();
    expect(resolveSuggestions(response([{ service_id: "study", reason_code: "DIAGNOSIS" }]), services)).toBeNull();
    expect(resolveSuggestions({ mode: "ai", serviceIds: ["study"] }, services)).toBeNull();
    expect(resolveSuggestions(response(Array(3).fill({ service_id: "study", reason_code: "STUDY_SUPPORT" })), services)).toBeNull();
  });
  it("suppresses appointment suggestions when immediate safety guidance is returned", () => {
    const result = resolveSuggestions(response([{ service_id: "study", reason_code: "STUDY_SUPPORT" }], { urgent_guidance: true }), services);
    expect(result?.urgentGuidance).toBe(true);
    expect(result?.matches).toEqual([]);
  });
  it("accepts a valid empty fallback without inventing a service", () => {
    expect(resolveSuggestions({ mode: "DETERMINISTIC_FALLBACK", urgent_guidance: false, recommendations: [] }, services)?.matches).toEqual([]);
  });
  it("labels preview word matching as fallback and supports no-match and safety states", () => {
    expect(previewSuggestions("exams are affecting my sleep", services)).toEqual({ mode: "DETERMINISTIC_FALLBACK", urgent_guidance: false, recommendations: [{ service_id: "study", reason_code: "STUDY_SUPPORT" }] });
    expect(previewSuggestions("I feel worried", services).recommendations[0].service_id).toBe("general");
    expect(previewSuggestions("xyzzy", services).recommendations).toEqual([]);
    expect(previewSuggestions("I cannot stay safe", services).urgent_guidance).toBe(true);
  });
});
