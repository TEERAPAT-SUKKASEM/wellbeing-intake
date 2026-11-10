// What this file does: holds the crisis-phrase list (English and Thai) and the prompt-injection guard.
// Why it exists: PRD 3.B.2 and section 6 need a deterministic fallback (a fixed rule that always gives
// the same answer) that still works when the AI is off, skipped or failing.
// Key idea: if any crisis phrase matches, the request is URGENT, whatever the AI says.
//
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

// Some phrases contain characters such as "-" that have a special meaning in a regular expression.
// Escaping them makes every phrase match as plain text.
const escapeForRegex = (phrase: string) => phrase.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");

// All English phrases joined into one regular expression. \b is a word boundary, so "urgent" does
// not match inside a longer word such as "insurgent".
const ENGLISH_RE = new RegExp(`\\b(?:${ENGLISH_PHRASES.map(escapeForRegex).join("|")})\\b`);

// True if the text contains any crisis phrase. Used by triage and by the service finder.
export function hasUrgentCue(text: string): boolean {
  // Lower case, and curly apostrophes (common on phones) become straight ones, so "Don’t" matches "don't".
  const normalized = text.toLowerCase().replace(/[‘’]/g, "'");
  return ENGLISH_RE.test(normalized) || THAI_PHRASES.some((phrase) => normalized.includes(phrase));
}

// Prompt injection is text written to give the AI new orders instead of being classified.
// These patterns catch the common forms, one per line:
//   "ignore previous instructions"; fake system tags such as [system] or <system>;
//   "jailbreak" or "developer mode"; "forget your rules"; "reveal your system prompt";
//   "act as an unrestricted ...". The /i flag means upper or lower case both match.
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
