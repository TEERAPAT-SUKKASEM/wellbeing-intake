import "server-only";
import { env } from "@/lib/env";

// The one way this app talks to the AI provider, shared by urgency triage and service matching.
// A bare fetch with exactly two headers, so nothing from the visitor's request can ride along; one
// attempt with a short time limit; JSON answers only. Every problem comes back as null, and each
// caller then answers from its deterministic rule. Callers validate the parsed value themselves.

/** Returns the model's answer parsed as JSON, or null on ANY problem. */
export async function askModelForJson(system: string, user: string): Promise<unknown> {
  if (!env.llmApiKey) return null;

  try {
    const response = await fetch(`${env.llmBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.llmApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.llmModel,
        temperature: 0,
        // A reasoning model spends tokens thinking before it answers; a small limit could cut the JSON off.
        max_tokens: 1024,
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

    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return JSON.parse(content) as unknown;
  } catch {
    return null; // timeout, network failure, text that is not JSON
  }
}
