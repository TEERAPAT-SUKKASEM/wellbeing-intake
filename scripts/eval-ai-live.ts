/**
 * One-off evaluation of the real AI path (PRD weeks 8-10, FR-23). `pnpm eval:ai` covers the keyword
 * matcher only, with no key and no network, so that it can gate CI. This script covers what that
 * cannot: what the model really answers, next to the keyword matcher and the expected service.
 *
 *   pnpm eval:ai:live                          all cases, 3 runs each; writes eval/live-ai-results.json
 *   pnpm eval:ai:live --only=EVAL-01 --runs=1  a single call; writes nothing
 *
 * It sends the golden dataset through the app's own rankWithAi() with the production catalogue. It
 * reads that catalogue and nothing else from the database, and does not spend the app's daily AI
 * budget. Reads .env.vercel, and needs a current LLM_API_KEY there. Not for CI: free-tier limits
 * and provider outages would fail builds at random. Pure demo phrases only; no real student text.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { env } from "@/lib/env";
import { isPromptInjection, rankWithAi } from "@/lib/finder/ai";
import { rankByKeywords } from "@/lib/finder/keywords";
import { db } from "@/lib/supabase/admin";

const PACE_MS = 9_000; // Groq's free tier allows about 8,000 tokens a minute.
const MAX_RATE_LIMIT_RETRIES = 3;
const RESULTS_PATH = "eval/live-ai-results.json";

type GoldenCase = {
  id: string;
  category: string;
  input: string;
  expectedTop?: string;
  expectEmpty: boolean;
  expectInjectionBlocked: boolean;
};
type RawCall = {
  status: number | null;
  ms: number;
  content: string | null;
  totalTokens: number | null;
  error: string | null;
  retryAfterSeconds: number | null;
};
type ServiceRow = { id: string; slug: string; name: string; keywords: string[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const { values: args } = parseArgs({
  options: { only: { type: "string" }, runs: { type: "string", default: "3" } },
  strict: true,
});
const runsPerCase = Number(args.runs);

/** Records what the provider really sent, which rankWithAi() deliberately reduces to ids or null. */
function recordProviderCalls(onCall: (call: RawCall) => void) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const started = performance.now();
    try {
      const response = await realFetch(input, init);
      const text = await response.clone().text();
      let body: { choices?: { message?: { content?: unknown } }[]; usage?: { total_tokens?: number } } = {};
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON: leave content empty, the status still says what happened.
      }
      const content = body.choices?.[0]?.message?.content;
      onCall({
        status: response.status,
        ms: Math.round(performance.now() - started),
        content: typeof content === "string" ? content : null,
        totalTokens: body.usage?.total_tokens ?? null,
        error: null,
        retryAfterSeconds: Number(response.headers.get("retry-after")) || null,
      });
      return response;
    } catch (error) {
      onCall({
        status: null,
        ms: Math.round(performance.now() - started),
        content: null,
        totalTokens: null,
        error: error instanceof Error ? error.name : "unknown",
        retryAfterSeconds: null,
      });
      throw error;
    }
  };
}

/** Judges the model's own output, before the app's validation can discard it. */
function judgeRaw(content: string | null, known: Set<string>) {
  if (content === null) return { schemaValid: false, grounded: false };
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { schemaValid: false, grounded: false };
  }
  const ids = (value as { serviceIds?: unknown } | null)?.serviceIds;
  if (!Array.isArray(ids)) return { schemaValid: false, grounded: false };
  return {
    schemaValid:
      Object.keys(value as object).length === 1 && ids.length <= 3 && ids.every((id) => typeof id === "string"),
    grounded: ids.every((id) => known.has(id)),
  };
}

async function main() {
  if (!env.llmApiKey) throw new Error("LLM_API_KEY is empty in .env.vercel.");
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1) throw new Error("--runs must be a whole number.");

  // The same query suggest() makes, plus the slug so that results are readable.
  const { data, error } = await db().from("service").select("id, slug, name, keywords").order("name");
  if (error) throw new Error(`Could not read the catalogue: ${error.message}`);
  const catalogue = (data ?? []) as ServiceRow[];
  const known = new Set(catalogue.map((s) => s.id));
  const slugOf = (id: string) => catalogue.find((s) => s.id === id)?.slug ?? id;

  let lastCall: RawCall | null = null;
  recordProviderCalls((call) => {
    lastCall = call;
  });

  const allCases = JSON.parse(readFileSync("eval/eval-cases.json", "utf8")) as GoldenCase[];
  const cases = args.only ? allCases.filter((c) => c.id === args.only) : allCases;
  if (cases.length === 0) throw new Error(`No case named ${args.only}.`);

  console.log(`Model ${env.llmModel}, timeout ${env.aiTimeoutMs} ms, ${catalogue.length} services, ${runsPerCase} run(s) each.\n`);

  const results = [];
  let rateLimitRetries = 0;
  let waitBeforeNextCall = false;

  for (const tc of cases) {
    const runs = [];
    for (let run = 1; run <= runsPerCase; run++) {
      let answer: string[] | null = null;
      let call: RawCall | null = null;
      for (let attempt = 0; ; attempt++) {
        if (waitBeforeNextCall) await sleep(PACE_MS);
        lastCall = null;
        answer = await rankWithAi(tc.input, catalogue);
        call = lastCall as RawCall | null;
        waitBeforeNextCall = call !== null;
        if (call?.status === 401 || call?.status === 403) {
          throw new Error(`Groq refused the key (HTTP ${call.status}). Copy the current LLM_API_KEY from Vercel into .env.vercel.`);
        }
        // A rate limit says nothing about the model, so it is retried rather than scored.
        if (call?.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;
        rateLimitRetries++;
        const waitSeconds = (call.retryAfterSeconds ?? 60) + 1;
        console.log(`  rate limited, waiting ${waitSeconds} s`);
        await sleep(waitSeconds * 1000);
      }

      const fallback = rankByKeywords(tc.input, catalogue).map(slugOf);
      const aiSlugs = answer?.map(slugOf) ?? null;
      const shown = aiSlugs ?? fallback;
      // An attack counts as correct only if it was blocked. Otherwise the model itself has to give
      // the answer: a timeout rescued by the keyword matcher does not score for the AI.
      const correct = tc.expectInjectionBlocked
        ? aiSlugs === null && fallback.length === 0
        : tc.expectEmpty
          ? aiSlugs?.length === 0
          : aiSlugs?.[0] === tc.expectedTop;
      const raw = judgeRaw(call?.content ?? null, known);
      runs.push({
        run,
        modelCalled: call !== null,
        status: call?.status ?? null,
        error: call?.error ?? null,
        ms: call?.ms ?? null,
        totalTokens: call?.totalTokens ?? null,
        rawContent: call?.content ?? null,
        schemaValid: raw.schemaValid,
        grounded: raw.grounded,
        aiAnswer: aiSlugs,
        shownToVisitor: { mode: aiSlugs === null ? "fallback" : "ai", services: shown },
        correct,
      });
    }

    const modelCalled = runs.some((r) => r.modelCalled);
    const keywordAnswer = rankByKeywords(tc.input, catalogue).map(slugOf);
    const flagged = isPromptInjection(tc.input);
    const row = {
      id: tc.id,
      category: tc.category,
      input: tc.input,
      expected: tc.expectEmpty ? [] : [tc.expectedTop],
      keywordAnswer,
      keywordCorrect: tc.expectEmpty ? keywordAnswer.length === 0 : keywordAnswer[0] === tc.expectedTop,
      modelCalled,
      correct: runs.every((r) => r.correct),
      safe: tc.expectInjectionBlocked ? flagged && !modelCalled && runs.every((r) => r.shownToVisitor.services.length === 0) : !flagged,
      // Grounding, consistency and schema describe the model, so they do not apply when it was never called.
      grounded: modelCalled ? runs.every((r) => r.grounded) : null,
      schemaValid: modelCalled ? runs.every((r) => r.schemaValid) : null,
      consistent: modelCalled ? new Set(runs.map((r) => JSON.stringify(r.aiAnswer))).size === 1 : null,
      runs,
    };
    results.push(row);
    console.log(
      `${tc.id} ${tc.category.padEnd(8)} expected ${(row.expected[0] ?? "[]").padEnd(18)} keyword ${(keywordAnswer.join(",") || "[]").padEnd(34)} ` +
        `AI ${runs.map((r) => (r.aiAnswer === null ? `none(${r.status ?? r.error ?? "blocked"})` : r.aiAnswer.join(",") || "[]")).join(" | ")}`,
    );
  }

  const modelCases = results.filter((r) => r.modelCalled);
  const calls = results.flatMap((r) => r.runs).filter((r) => r.modelCalled);
  const times = calls.map((c) => c.ms ?? 0).sort((a, b) => a - b);
  const summary = {
    capturedAt: new Date().toISOString(),
    model: env.llmModel,
    timeoutMs: env.aiTimeoutMs,
    runsPerCase,
    modelCalls: calls.length,
    rateLimitRetries,
    totalTokens: calls.reduce((sum, c) => sum + (c.totalTokens ?? 0), 0),
    medianMs: times[Math.floor(times.length / 2)] ?? null,
    slowestMs: times.at(-1) ?? null,
    callsWithNoUsableAnswer: calls.filter((c) => c.aiAnswer === null).length,
    correctness: `${results.filter((r) => r.correct).length}/${results.length}`,
    correctCalls: `${calls.filter((c) => c.correct).length}/${calls.length}`,
    keywordCorrectness: `${results.filter((r) => r.keywordCorrect).length}/${results.length}`,
    safety: `${results.filter((r) => r.safe).length}/${results.length}`,
    grounding: `${modelCases.filter((r) => r.grounded).length}/${modelCases.length}`,
    consistency: `${modelCases.filter((r) => r.consistent).length}/${modelCases.length}`,
    schemaValidity: `${modelCases.filter((r) => r.schemaValid).length}/${modelCases.length}`,
  };
  console.log(`\n${JSON.stringify(summary, null, 2)}`);

  if (args.only) {
    console.log("\nSingle-case run: results file not written.");
    console.log(JSON.stringify(results[0].runs[0], null, 2));
    return;
  }
  writeFileSync(RESULTS_PATH, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  console.log(`\nWrote ${RESULTS_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
