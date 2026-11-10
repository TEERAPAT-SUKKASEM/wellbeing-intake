// What this file does: sends one question to the AI model, an LLM (large language model) behind an
// OpenAI-compatible chat API (Groq by default), and returns its answer as JSON, or null.
// Why it exists: one small, safe place for every AI call. It has a short time limit and no retries, so
// when the AI fails the app falls back to its fixed rules (PRD: deterministic fallback).
// Used by: urgency triage (src/lib/urgency/ai.ts) and service matching (src/lib/matching/ai.ts).
import "server-only";
import { env } from "@/lib/env";

// The one way this app talks to the AI provider, shared by urgency triage and service matching.
// A bare fetch with exactly two headers, so nothing from the visitor's request can ride along; one
// attempt with a short time limit; JSON answers only. Every problem comes back as null, and each
// caller then answers from its deterministic rule. Callers validate the parsed value themselves.

/** Returns the model's answer parsed as JSON, or null on ANY problem. */
export async function askModelForJson(system: string, user: string): Promise<unknown> {
  // No API key set means the AI is not set up, so callers go straight to their rule.
  if (!env.llmApiKey) return null;

  try {
    // "system" holds our fixed instructions; "user" holds the text to judge. Keeping them apart helps
    // the model treat the student's text as data, not as instructions.
    // Any "/" at the end of the base URL is removed before adding the endpoint path.
    const response = await fetch(`${env.llmBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.llmApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.llmModel,
        // Temperature 0 means the least randomness, so the same text gives as similar an answer as possible.
        temperature: 0,
        // A reasoning model spends tokens thinking before it answers; a small limit could cut the JSON off.
        max_tokens: 1024,
        // Asks the provider to reply with one JSON object and nothing else.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      // One attempt only. A slow model must never hold up a student.
      signal: AbortSignal.timeout(env.aiTimeoutMs),
    });
    if (!response.ok) return null; // auth, rate limit, 5xx

    // Take the text of the first answer and parse it as JSON. Callers check its shape themselves.
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return JSON.parse(content) as unknown;
  } catch {
    return null; // timeout, network failure, text that is not JSON
  }
}
