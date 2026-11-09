import { createHash, createHmac, randomBytes } from "node:crypto";

// The Private Access Key is the only thing that links an anonymous student to their request, so it has
// to resist guessing: 12 characters from 32 symbols is 60 bits, against about 18 bits for WB-9842-X.
// It is shown once and only its hash is stored, so a database leak does not reveal any key. It is never
// derived from the request id, which is published in the webhook.
//
// No server-only import, so unit tests can use this directly.

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0, 1, I or O: easy to read back and type
const KEY_RE = /^WB-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

function format(bytes: Uint8Array): string {
  // 256 is a multiple of 32, so masking each byte keeps every symbol equally likely.
  const chars = Array.from(bytes.subarray(0, 12), (b) => ALPHABET[b & 31]).join("");
  return `WB-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function generateAccessKey(): string {
  return format(randomBytes(12));
}

/**
 * The same submission always gets the same key. If the first response is lost, a retry can return the
 * key without it ever being stored, so the student is not locked out of a request they already made.
 */
export function deriveAccessKey(submissionKey: string, secret: string): string {
  return format(createHmac("sha256", secret).update(submissionKey).digest());
}

/** Forgiving about case and spaces. Returns null for anything that cannot be a key. */
export function normalizeAccessKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toUpperCase();
  return KEY_RE.test(key) ? key : null;
}

export function hashAccessKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
