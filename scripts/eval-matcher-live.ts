/**
 * One-off check of the real model on the service-matcher cases (eval/matcher-cases.json). The unit tests
 * cover the keyword path with no key and no network, so that they can gate CI; this covers what they
 * cannot: whether the real model picks the right service, and how fast it answers.
 *
 *   pnpm eval:matcher:live                     every case, 1 run each; writes eval/live-matcher-results.json
 *   pnpm eval:matcher:live --runs=3            repeat each case, to see whether answers are stable
 *   pnpm eval:matcher:live --only=MATCH-05     a single case; writes nothing
 *
 * It follows the endpoint's order of checks but calls suggestWithAi() directly: it touches no database and
 * spends no budget. Reads .env.vercel, and needs a current LLM_API_KEY there. Not for CI: free-tier limits
 * and provider outages would fail builds at random. Fictional descriptions only; never real student text.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { env } from "@/lib/env";
import { suggestWithAi } from "@/lib/matching/ai";
import { matchDeterministic, type CatalogueEntry, type Recommendation } from "@/lib/matching/rules";
import { hasPromptInjection, hasUrgentCue } from "@/lib/urgency/keywords";

const PACE_MS = 9_000; // Groq's free tier allows about 8,000 tokens a minute.
const RESULTS_PATH = "eval/live-matcher-results.json";

type Case = { id: string; category: string; input: string; urgent: boolean; first: string | null };
type Outcome = { path: "safety_phrase" | "attack_blocked" | "ai" | "ai_failed"; urgent: boolean; picks: Recommendation[]; ms: number };

const { values: args } = parseArgs({
  options: { only: { type: "string" }, runs: { type: "string", default: "1" } },
  strict: true,
});
const runsPerCase = Number(args.runs);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const correct = (c: Case, o: Outcome) =>
  c.urgent ? o.urgent : !o.urgent && (o.picks[0]?.service_id ?? null) === c.first;

async function main() {
  if (!env.llmApiKey) throw new Error("LLM_API_KEY is empty in .env.vercel.");
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1) throw new Error("--runs must be a whole number.");

  const file = JSON.parse(readFileSync("eval/matcher-cases.json", "utf8")) as { catalogue: CatalogueEntry[]; cases: Case[] };
  const cases = args.only ? file.cases.filter((c) => c.id === args.only) : file.cases;
  if (cases.length === 0) throw new Error(`No case named ${args.only}.`);

  console.log(`Model ${env.llmModel}, timeout ${env.aiTimeoutMs} ms, ${runsPerCase} run(s) each.\n`);

  const results = [];
  const times: number[] = [];
  let needPause = false;

  for (const c of cases) {
    const outcomes: Outcome[] = [];
    if (hasUrgentCue(c.input)) {
      outcomes.push({ path: "safety_phrase", urgent: true, picks: [], ms: 0 }); // the model is never called
    } else if (hasPromptInjection(c.input)) {
      outcomes.push({ path: "attack_blocked", urgent: false, picks: matchDeterministic(c.input, file.catalogue), ms: 0 });
    } else {
      for (let run = 0; run < runsPerCase; run++) {
        if (needPause) await sleep(PACE_MS);
        needPause = true;
        const started = performance.now();
        const ai = await suggestWithAi(c.input, file.catalogue);
        const ms = Math.round(performance.now() - started);
        times.push(ms);
        outcomes.push(
          ai
            ? { path: "ai", urgent: ai.urgent, picks: ai.recommendations, ms }
            : { path: "ai_failed", urgent: false, picks: matchDeterministic(c.input, file.catalogue), ms },
        );
      }
    }

    const modelCalled = outcomes.some((o) => o.path === "ai" || o.path === "ai_failed");
    const row = {
      id: c.id,
      category: c.category,
      input: c.input,
      expected: c.urgent ? "URGENT_GUIDANCE" : c.first,
      modelCalled,
      answers: outcomes.map((o) => ({
        path: o.path,
        shown: o.urgent ? "URGENT_GUIDANCE" : o.picks.map((p) => `${p.service_id}:${p.reason_code}`),
        ms: o.ms,
      })),
      modelCorrect: modelCalled ? outcomes.every((o) => o.path === "ai" && correct(c, o)) : null,
      finalCorrect: outcomes.every((o) => correct(c, o)),
    };
    results.push(row);
    const shown = row.answers.map((a) => (Array.isArray(a.shown) ? a.shown.join(" + ") || "(none)" : a.shown)).join(" | ");
    console.log(`${c.id} ${c.category.padEnd(8)} expected ${String(row.expected).padEnd(24)} ${outcomes.map((o) => o.path).join(",").padEnd(14)} ${shown}  ${outcomes.map((o) => `${o.ms} ms`).join(", ")}`);
  }

  const called = results.filter((r) => r.modelCalled);
  times.sort((a, b) => a - b);
  const summary = {
    capturedAt: new Date().toISOString(),
    model: env.llmModel,
    timeoutMs: env.aiTimeoutMs,
    runsPerCase,
    modelCorrect: `${called.filter((r) => r.modelCorrect).length}/${called.length}`,
    finalCorrect: `${results.filter((r) => r.finalCorrect).length}/${results.length}`,
    unusableAnswers: called.flatMap((r) => r.answers).filter((a) => a.path === "ai_failed").length,
    medianMs: times[Math.floor(times.length / 2)] ?? null,
    slowestMs: times.at(-1) ?? null,
  };
  console.log(`\n${JSON.stringify(summary, null, 2)}`);

  if (args.only) return;
  writeFileSync(RESULTS_PATH, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  console.log(`\nWrote ${RESULTS_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
