// FR-23 / BR-24 deterministic fallback: a keyword matcher over the seeded service
// vocabulary. Pure and dependency-free — this is what the demo must never lack.

export type CatalogueEntry = {
  id: string;
  name: string;
  keywords: string[];
};

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for", "from", "get", "have",
  "how", "i", "im", "in", "is", "it", "me", "my", "need", "not", "of", "on", "or", "so", "some",
  "that", "the", "to", "want", "was", "with", "would", "you",
]);

const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|bypass|override)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?|directives?|guidelines?)\b/i,
  /\[\s*system\b|\bsystem\s+override\b|<\s*\/?\s*(?:system|instruction|prompt)\s*>/i,
  /\b(?:developer\s+mode|dan\s+mode|jailbreak|god\s+mode|unrestricted\s+mode|admin\s+override)\b/i,
  /\bforget\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous\s+|prior\s+)?(?:rules?|instructions?|constraints?|guidelines?|prompts?)\b/i,
  /\b(?:reveal|show|print|output|dump|leak|repeat|expose)\s+(?:your\s+|the\s+|all\s+)?(?:internal|system|hidden|secret|initial|original)\s+(?:prompts?|instructions?|rules?|messages?)\b/i,
  /\b(?:act\s+as|pretend\s+to\s+be|you\s+are\s+now)\s+(?:an?\s+)?(?:unrestricted|unfiltered|developer|system|admin)\b/i,
];

/** Detects adversarial prompt-injection meta-instructions (OWASP LLM01). */
export function hasPromptInjection(text: string): boolean {
  if (!text) return false;
  return PROMPT_INJECTION_PATTERNS.some((re) => re.test(text));
}

/** Filters out prompt-injection payloads before tokenization or phrase matching. */
export function sanitizeFinderText(text: string): string {
  if (!text || hasPromptInjection(text)) return "";
  return text;
}

/** Normalizes punctuation/casing while keeping stopwords intact for multi-word phrase checks. */
function rawTokens(text: string): string[] {
  const safe = sanitizeFinderText(text);
  if (!safe) return [];
  return safe
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function tokenize(text: string): string[] {
  return rawTokens(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Light stemming so "sleeping" -> "sleep", "vaccines" -> "vaccine", "injuries" -> "injury", "pains" -> "pain". */
function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
  if (/(?:sh|ch|x|z|ss)es$/u.test(token)) return token.slice(0, -2);
  const s = token.replace(/(?:ing|ed|(?<!s)s)$/u, "");
  return s.length >= 3 ? s : token;
}

export function rankByKeywords(text: string, catalogue: CatalogueEntry[], limit = 3): string[] {
  const allWords = rawTokens(text);
  if (allWords.length === 0) return [];

  // Preserve stopwords in phrase windows so "settling in" and "not sure" match accurately,
  // and build a stemmed phrase window so "sports injuries" matches "sports injury" and "neck pains" matches "neck pain".
  const rawJoined = " " + allWords.join(" ") + " ";
  const stemmedJoined = " " + allWords.map(stem).join(" ") + " ";

  const tokens = allWords.filter((t) => t.length > 1 && !STOPWORDS.has(t));
  const tokenSet = new Set(tokens);
  const stems = new Set(tokens.map(stem));

  const scored = catalogue.map((entry) => {
    let score = 0;
    for (const raw of [...entry.keywords, ...tokenize(entry.name)]) {
      const kw = raw.toLowerCase().trim();
      if (!kw) continue;
      if (kw.includes(" ")) {
        const kwWords = kw
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .split(/\s+/)
          .filter(Boolean);
        if (kwWords.length === 0) continue;
        const exactPhrase = " " + kwWords.join(" ") + " ";
        const stemmedPhrase = " " + kwWords.map(stem).join(" ") + " ";
        if (rawJoined.includes(exactPhrase) || stemmedJoined.includes(stemmedPhrase)) {
          score += 3; // phrase match counts most
        }
      } else if (tokenSet.has(kw)) {
        score += 2;
      } else if (stems.has(stem(kw))) {
        score += 1;
      }
    }
    return { id: entry.id, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)) // stable, deterministic
    .slice(0, limit)
    .map((s) => s.id);
}
