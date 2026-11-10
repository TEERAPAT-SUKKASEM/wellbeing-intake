// The deterministic half of service matching. Pure and dependency-free, like the urgency phrases: this
// is what answers when the AI is off, skipped or failing, so it must never guess. When nothing clearly
// fits, the answer is an empty list and the student browses the catalogue as usual.
//
// Admins can add and rename services, so a service's topic is read from its own published name and
// description, never from a fixed list of ids.

export const REASON_CODES = ["STUDY_SUPPORT", "GENERAL_SUPPORT", "URGENT_SUPPORT", "RELATED_SERVICE"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
type Topic = Exclude<ReasonCode, "RELATED_SERVICE">;

export type CatalogueEntry = { id: string; name: string; description: string };
export type Recommendation = { service_id: string; reason_code: ReasonCode };

export const MAX_RECOMMENDATIONS = 2;

const normalize = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'");

// Checked against the service name first, then its description; the first topic found wins.
const SERVICE_TOPICS: readonly (readonly [Topic, RegExp])[] = [
  ["URGENT_SUPPORT", /\b(?:urgent|drop-?in|same[- ]day|sooner|can't wait)\b/],
  ["STUDY_SUPPORT", /\b(?:academic|stud(?:y|ies|ying)|exams?|deadlines?|coursework|grades?)\b/],
  ["GENERAL_SUPPORT", /\b(?:general|anything|worr(?:y|ies)|feelings?|low mood|anxiety|relationships?)\b/],
];

export function topicOf(service: CatalogueEntry): Topic | null {
  for (const text of [service.name, service.description]) {
    const normalized = normalize(text);
    for (const [topic, pattern] of SERVICE_TOPICS) if (pattern.test(normalized)) return topic;
  }
  return null;
}

/** A reason must describe the service it is attached to: that service's own topic, or the neutral one. */
export function allowedReasons(service: CatalogueEntry): ReasonCode[] {
  const topic = topicOf(service);
  return topic ? [topic, "RELATED_SERVICE"] : ["RELATED_SERVICE"];
}

// What the student's description is about, in ranked order: the most specific topic first, the broad
// option last. Thai is written without spaces between words, so Thai cues match as substrings.
const TEXT_TOPICS: readonly (readonly [Topic, RegExp, readonly string[]])[] = [
  [
    "STUDY_SUPPORT",
    /\b(?:exams?|midterms?|finals|tests?|quiz(?:zes)?|stud(?:y|ies|ying)|assignments?|homework|coursework|deadlines?|grades?|gpa|class(?:es)?|lectures?|thesis|dissertation|academic\w*|semester|failing|procrastinat\w*)\b/,
    ["สอบ", "เรียน", "การบ้าน", "เกรด", "วิทยานิพนธ์"],
  ],
  [
    "URGENT_SUPPORT",
    /\b(?:asap|as soon as possible|sooner|right away|straight away|can't wait|cannot wait|(?:someone|somebody|anyone|counsell?or|appointment) (?:today|tonight))\b/,
    ["เร็วที่สุด", "วันนี้เลย"],
  ],
  [
    "GENERAL_SUPPORT",
    /\b(?:anxi\w*|stress\w*|sad\w*|low mood|down|depress\w*|lonel\w*|alone|relationships?|break ?up|broke up|partner|boyfriend|girlfriend|family|parents?|friends?|grie\w*|loss|worr\w*|overwhelm\w*|sleep\w*|insomnia|angry|anger|homesick\w*|panic\w*|feel\w*|talk to someone)\b/,
    ["เครียด", "เศร้า", "เหงา", "ครอบครัว", "แฟน", "นอนไม่หลับ", "กังวล", "เสียใจ", "เพื่อน"],
  ],
];

// Words too common to show that a service fits. Only used for services whose topic is unknown.
const GENERIC_WORDS = new Set([
  "about", "also", "anything", "because", "been", "being", "counselling", "counseling", "could", "feel",
  "from", "have", "help", "into", "just", "like", "minute", "more", "need", "other", "really", "service",
  "session", "some", "someone", "something", "student", "support", "talk", "than", "that", "their", "them",
  "then", "there", "they", "this", "through", "very", "want", "what", "when", "where", "which", "while",
  "with", "would", "your",
]);

const stem = (word: string) => word.replace(/(?:ing|ed|(?<!s)s)$/, "");

// Apostrophes split words, so contractions such as "can't" leave only short pieces that are dropped.
// Thai vowel and tone marks are \p{M}, so they stay inside their word.
function contentWords(text: string): Set<string> {
  const words = normalize(text)
    .split(/[^\p{L}\p{M}]+/u)
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word))
    .map(stem)
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word));
  return new Set(words);
}

export function matchDeterministic(text: string, catalogue: readonly CatalogueEntry[]): Recommendation[] {
  const normalized = normalize(text);
  const picks: Recommendation[] = [];

  for (const [topic, pattern, thai] of TEXT_TOPICS) {
    if (!pattern.test(normalized) && !thai.some((cue) => normalized.includes(cue))) continue;
    for (const service of catalogue) {
      if (topicOf(service) === topic) picks.push({ service_id: service.id, reason_code: topic });
    }
  }

  // A service with no recognisable topic can still fit on its own published words.
  const asked = contentWords(text);
  const related = catalogue
    .filter((service) => topicOf(service) === null)
    .map((service) => ({
      service,
      overlap: [...contentWords(`${service.name} ${service.description}`)].filter((word) => asked.has(word)).length,
    }))
    .filter(({ overlap }) => overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
  for (const { service } of related) picks.push({ service_id: service.id, reason_code: "RELATED_SERVICE" });

  return finalize(picks, catalogue);
}

/** The last word on every answer, AI or not: active services only, no repeats, best first, at most two. */
export function finalize(picks: readonly Recommendation[], catalogue: readonly CatalogueEntry[]): Recommendation[] {
  const active = new Set(catalogue.map((service) => service.id));
  const seen = new Set<string>();
  const result: Recommendation[] = [];
  for (const pick of picks) {
    if (!active.has(pick.service_id) || seen.has(pick.service_id)) continue;
    seen.add(pick.service_id);
    // Rebuilt field by field, so nothing else a caller or a model attached can pass through.
    result.push({ service_id: pick.service_id, reason_code: pick.reason_code });
    if (result.length === MAX_RECOMMENDATIONS) break;
  }
  return result;
}
