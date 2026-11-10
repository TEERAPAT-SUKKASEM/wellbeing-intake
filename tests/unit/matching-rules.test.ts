// What this test file does: it checks the keyword service matcher and finalize(), and scores the matcher
// on every case in eval/matcher-cases.json.
// Why it matters: this matcher answers whenever the AI cannot. Running the eval cases here makes them
// a CI quality gate: a new wrong answer fails `pnpm test`. (An extra feature beyond the PRD's 7 tests.)
// How to run it: `pnpm test`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allowedReasons,
  finalize,
  matchDeterministic,
  topicOf,
  type CatalogueEntry,
  type Recommendation,
} from "@/lib/matching/rules";
import { hasPromptInjection, hasUrgentCue } from "@/lib/urgency/keywords";

// The keyword matcher: what answers when the AI is off, skipped or failing. It may stay silent, but it
// must never suggest the wrong service, a service that is not in the active catalogue, or more than two.

type EvalCase = {
  id: string;
  category: string;
  input: string;
  urgent: boolean;
  first: string | null;
  keywords_miss?: boolean;
};
const EVAL = JSON.parse(readFileSync("eval/matcher-cases.json", "utf8")) as {
  catalogue: CatalogueEntry[];
  cases: EvalCase[];
};
const CATALOGUE = EVAL.catalogue;
const [ACADEMIC, GENERAL, DROP_IN] = CATALOGUE.map((service) => service.id);

const ids = (picks: Recommendation[]) => picks.map((pick) => pick.service_id);

// Each service gets a topic from its name and description, and the eval service list matches the seed.
describe("a service's topic comes from its own published words", () => {
  it("reads the seeded services", () => {
    expect(CATALOGUE.map(topicOf)).toEqual(["STUDY_SUPPORT", "GENERAL_SUPPORT", "URGENT_SUPPORT"]);
  });

  it("follows a rename, and knows nothing about an unrelated service", () => {
    expect(topicOf({ id: "srv_x", name: "Exam Support", description: "" })).toBe("STUDY_SUPPORT");
    expect(topicOf({ id: "srv_y", name: "Sleep Clinic", description: "For trouble falling asleep." })).toBeNull();
  });

  it("allows a service only its own topic or the neutral reason", () => {
    expect(allowedReasons(CATALOGUE[0])).toEqual(["STUDY_SUPPORT", "RELATED_SERVICE"]);
    expect(allowedReasons({ id: "srv_y", name: "Sleep Clinic", description: "" })).toEqual(["RELATED_SERVICE"]);
  });

  it("matches the eval catalogue to the seed, so the eval tests what students see", () => {
    const seed = readFileSync("scripts/seed.ts", "utf8");
    for (const service of CATALOGUE) {
      expect(seed).toContain(service.name);
      expect(seed).toContain(service.description);
    }
  });
});

// The keyword matcher suggests up to two active services, most specific first, or nothing if unsure.
describe("matchDeterministic", () => {
  it("puts the most specific service first and the broad one second", () => {
    expect(matchDeterministic("Exams are affecting my sleep and I feel overwhelmed.", CATALOGUE)).toEqual([
      { service_id: ACADEMIC, reason_code: "STUDY_SUPPORT" },
      { service_id: GENERAL, reason_code: "GENERAL_SUPPORT" },
    ]);
  });

  it("offers the drop-in to someone asking to be seen sooner", () => {
    expect(ids(matchDeterministic("Could I see someone today?", CATALOGUE))).toEqual([DROP_IN]);
  });

  it("reads Thai", () => {
    expect(ids(matchDeterministic("เครียดเรื่องสอบ", CATALOGUE))[0]).toBe(ACADEMIC);
  });

  it("returns nothing rather than guess", () => {
    expect(matchDeterministic("Where can I park my bike on campus?", CATALOGUE)).toEqual([]);
    expect(matchDeterministic("exam stress", [])).toEqual([]);
  });

  it("never suggests a service missing from the active catalogue", () => {
    const withoutAcademic = CATALOGUE.filter((service) => service.id !== ACADEMIC);
    expect(ids(matchDeterministic("exam stress", withoutAcademic))).toEqual([GENERAL]);
  });

  it("can match an admin-added service on its own words, with the neutral reason", () => {
    const clinic = { id: "srv_sleep_clinic", name: "Sleep Clinic", description: "For trouble falling asleep." };
    expect(matchDeterministic("I can't fall asleep at night", [...CATALOGUE, clinic])).toEqual([
      { service_id: clinic.id, reason_code: "RELATED_SERVICE" },
    ]);
  });

  it("does not match on a contraction or a common word alone", () => {
    const coping = { id: "srv_coping", name: "Coping Skills", description: "When you can't keep up, we help." };
    expect(matchDeterministic("I can't park here, can you help?", [coping])).toEqual([]);
  });
});

// finalize() cleans every answer: real service ids only, no repeats, at most two, no extra fields.
describe("finalize: the last word on every answer", () => {
  it("drops unknown ids and repeats, keeps the order, stops at two and strips extra fields", () => {
    const picks = [
      { service_id: "srv_made_up", reason_code: "STUDY_SUPPORT" },
      { service_id: GENERAL, reason_code: "GENERAL_SUPPORT", note: "smuggled" },
      { service_id: GENERAL, reason_code: "RELATED_SERVICE" },
      { service_id: ACADEMIC, reason_code: "STUDY_SUPPORT" },
      { service_id: DROP_IN, reason_code: "URGENT_SUPPORT" },
    ] as Recommendation[];
    expect(finalize(picks, CATALOGUE)).toEqual([
      { service_id: GENERAL, reason_code: "GENERAL_SUPPORT" },
      { service_id: ACADEMIC, reason_code: "STUDY_SUPPORT" },
    ]);
  });
});

// The eval set with no AI: no wrong answers except the known, marked misses, and most cases answered.
describe("the eval cases (eval/matcher-cases.json), keyword path only", () => {
  // What the endpoint answers with the AI off: crisis phrases first, then the keyword matcher.
  const answer = (input: string) =>
    hasUrgentCue(input) ? { urgent: true, picks: [] } : { urgent: false, picks: matchDeterministic(input, CATALOGUE) };

  // Silence is allowed; a wrong answer is not.
  const wrong = (c: EvalCase) => {
    const result = answer(c.input);
    if (result.urgent !== c.urgent) return true;
    if (c.first === null) return result.picks.length > 0;
    return result.picks.length > 0 && result.picks[0].service_id !== c.first;
  };
  const expectedRight = EVAL.cases.filter((c) => !c.keywords_miss);

  it.each(expectedRight.map((c) => [c.id, c] as const))("%s never answers wrongly", (_id, c) => {
    expect(wrong(c)).toBe(false);
  });

  it("gets wrong exactly the cases marked keywords_miss, which only the AI can catch", () => {
    // Any new miss fails here; so does a fixed one, until its mark is removed.
    expect(EVAL.cases.filter(wrong).map((c) => c.id)).toEqual(EVAL.cases.filter((c) => c.keywords_miss).map((c) => c.id));
  });

  it("answers most cases, so the fallback is useful and not only safe", () => {
    const useful = expectedRight.filter((c) => {
      const result = answer(c.input);
      return c.urgent ? result.urgent : c.first === null ? result.picks.length === 0 : result.picks[0]?.service_id === c.first;
    });
    expect(useful.length).toBeGreaterThanOrEqual(expectedRight.length - 1);
  });

  it("covers every safety category", () => {
    const categories = new Set(EVAL.cases.map((c) => c.category));
    for (const category of ["study", "general", "sooner", "no-match", "crisis", "attack"]) expect(categories).toContain(category);
    expect(EVAL.cases.some((c) => hasPromptInjection(c.input) && c.urgent)).toBe(true); // an attack hiding a crisis
  });
});
