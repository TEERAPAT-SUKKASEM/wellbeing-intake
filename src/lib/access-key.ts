// What this file does: makes, checks and hashes the Private Access Key (WB-XXXX-XXXX-XXXX) that a
// student gets after booking.
// Why it exists: the key is a student's only proof that a request is theirs, so it must be hard to
// guess and must never be stored in readable form.
// Used by: POST /requests (makes the key), GET /requests/me and POST /requests/{id}/cancel (check it).
import { createHash, createHmac, randomBytes } from "node:crypto";

// The Private Access Key is the only thing that links an anonymous student to their request, so it has
// to resist guessing: 12 characters from 32 symbols is 60 bits, against about 18 bits for WB-9842-X.
// It is shown once and only its hash is stored, so a database leak does not reveal any key. It is never
// derived from the request id, which is published in the webhook.
//
// No server-only import, so unit tests can use this directly.

// 32 symbols means each symbol carries exactly 5 bits, so 12 symbols carry 12 x 5 = 60 bits:
// about a million million million (2^60) possible keys.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0, 1, I or O: easy to read back and type
// The exact key shape: "WB-" and then three groups of four symbols, all taken from ALPHABET.
const KEY_RE = /^WB-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

// Turns bytes into key text: one symbol per byte, using the first 12 bytes.
function format(bytes: Uint8Array): string {
  // "b & 31" keeps the lowest 5 bits of a byte: a number from 0 to 31 that picks one symbol.
  // 256 is a multiple of 32, so masking each byte keeps every symbol equally likely.
  const chars = Array.from(bytes.subarray(0, 12), (b) => ALPHABET[b & 31]).join("");
  return `WB-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** A new random key from the secure random source. Used when the browser sends no Idempotency-Key. */
export function generateAccessKey(): string {
  return format(randomBytes(12));
}

// submissionKey is the Idempotency-Key: a random id the browser sends with a submit, so a retry of
// the same submit is recognised. HMAC (a hash mixed with a secret key) means the same input always
// gives the same access key, but nobody without ACCESS_KEY_SECRET can work it out from the id.
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

// SHA-256 is a one-way hash: easy to compute from the key, but the key cannot be got back from it.
// A slow password hash or a salt (random extra input) is not needed here: unlike a password, the key
// is already 60 bits of pure randomness, so trying every key is not practical. A plain hash also lets
// us look a request up directly by its hash.
/** Returns the SHA-256 hash of a key as hex text. Only this hash is stored and searched. */
export function hashAccessKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
