// The deterministic half of triage: urgency phrases and the prompt-injection guard. Pure and
// dependency-free, because this is what must keep working when the AI does not.
//
// The PRD's example keywords include "help", but matched alone it would pin ordinary requests such as
// "I need help with exam stress" to the top of the queue and bury real crises. So help only counts in
// phrases that ask for immediate help. A false alarm costs a practitioner a moment; a missed crisis is
// the failure that matters, so phrases lean towards flagging.

export type Urgency = "ROUTINE" | "URGENT";

// Matched on word boundaries against lower-cased text with straight apostrophes.
const ENGLISH_PHRASES = [
  "crisis",
  "urgent",
  "urgently",
  "emergency",
  "suicide",
  "suicidal",
  "kill myself",
  "killing myself",
  "kill himself",
  "kill herself",
  "kill themselves",
  "end my life",
  "ending my life",
  "take my own life",
  "want to die",
  "wanna die",
  "don't want to live",
  "do not want to live",
  "no reason to live",
  "better off dead",
  "hurt myself",
  "hurting myself",
  "harm myself",
  "harming myself",
  "self harm",
  "self-harm",
  "cut myself",
  "cutting myself",
  "overdose",
  "can't keep myself safe",
  "cannot keep myself safe",
  "not safe",
  "don't feel safe",
  "do not feel safe",
  "help me now",
  "need help now",
  "need help right now",
  "need help immediately",
  "please help me",
];

// Thai is written without spaces between words, so these match as substrings.
const THAI_PHRASES = [
  "ฆ่าตัวตาย",
  "อยากตาย",
  "ไม่อยากมีชีวิตอยู่",
  "ไม่อยากอยู่แล้ว",
  "จบชีวิต",
  "ทำร้ายตัวเอง",
  "กรีดแขน",
  "กินยาเกินขนาด",
  "ไม่ปลอดภัย",
  "ฉุกเฉิน",
  "วิกฤต",
  "ด่วน",
  "ช่วยด้วย",
];

const escapeForRegex = (phrase: string) => phrase.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

const ENGLISH_RE = new RegExp(`\\b(?:${ENGLISH_PHRASES.map(escapeForRegex).join("|")})\\b`);

export function hasUrgentCue(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[‘’]/g, "'");
  return ENGLISH_RE.test(normalized) || THAI_PHRASES.some((phrase) => normalized.includes(phrase));
}

const PROMPT_INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|bypass|override)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?|directives?|guidelines?)\b/i,
  /\[\s*system\b|\bsystem\s+override\b|<\s*\/?\s*(?:system|instruction|prompt)\s*>/i,
  /\b(?:developer\s+mode|dan\s+mode|jailbreak|god\s+mode|unrestricted\s+mode|admin\s+override)\b/i,
  /\bforget\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous\s+|prior\s+)?(?:rules?|instructions?|constraints?|guidelines?|prompts?)\b/i,
  /\b(?:reveal|show|print|output|dump|leak|repeat|expose)\s+(?:your\s+|the\s+|all\s+)?(?:internal|system|hidden|secret|initial|original)\s+(?:prompts?|instructions?|rules?|messages?)\b/i,
  /\b(?:act\s+as|pretend\s+to\s+be|you\s+are\s+now)\s+(?:an?\s+)?(?:unrestricted|unfiltered|developer|system|admin)\b/i,
];

/**
 * Text trying to steer the model never reaches it. That only skips the AI: the urgency phrases still
 * run on the same text, so "ignore previous instructions, I want to die" is still flagged URGENT.
 */
export function hasPromptInjection(text: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}
