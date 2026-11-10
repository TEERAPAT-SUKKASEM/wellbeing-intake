// What this script does: it sends every fictional note in eval/eval-cases.json to the real AI model and
// records if the model, and the app's final decision, gave the expected urgency, and how long it took.
// Why it matters: it measures the real AI (accuracy, stable answers, speed), which CI cannot test. The
// saved file eval/live-ai-results.json is the record of the last full run.
// How to run it: `pnpm eval:ai:live` (needs LLM_API_KEY in .env.vercel; run by hand, never in CI).
/**
 * One-off check of the real model on the golden dataset. `pnpm eval:ai` covers the deterministic rule
 * with no key and no network, so that it can gate CI; this covers what that cannot.
 *
 *   pnpm eval:ai:live                          every case, 1 run each; writes eval/live-ai-results.json
 *   pnpm eval:ai:live --runs=3                 repeat each case, to see whether answers are stable
 *   pnpm eval:ai:live --only=EVAL-01           a single case; writes nothing
 *
 * It calls assessWithAi() directly: it touches no database and spends no budget. Reads .env.vercel, and
 * needs a current LLM_API_KEY there. Not for CI: free-tier limits and provider outages would fail
 * builds at random. Fictional phrases only; never real student text.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { env } from "@/lib/env";
import { assessWithAi } from "@/lib/urgency/ai";
import { hasPromptInjection, hasUrgentCue } from "@/lib/urgency/keywords";

const PACE_MS = 9_000; // Groq's free tier allows about 8,000 tokens a minute.
const RESULTS_PATH = "eval/live-ai-results.json";

type Case = { id: string; category: string; input: string; expected: "ROUTINE" | "URGENT"; attack: boolean };

// Read the optional --only=<case id> and --runs=<number> flags.
const { values: args } = parseArgs({
  options: { only: { type: "string" }, runs: { type: "string", default: "1" } },
  strict: true,
});
const runsPerCase = Number(args.runs);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!env.llmApiKey) throw new Error("LLM_API_KEY is empty in .env.vercel.");
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1) throw new Error("--runs must be a whole number.");

  // Load the cases. With --only, keep just that one case.
  const all = JSON.parse(readFileSync("eval/eval-cases.json", "utf8")) as Case[];
  const cases = args.only ? all.filter((c) => c.id === args.only) : all;
  if (cases.length === 0) throw new Error(`No case named ${args.only}.`);

  console.log(`Model ${env.llmModel}, timeout ${env.aiTimeoutMs} ms, ${runsPerCase} run(s) each.\n`);

  const results = [];
  const times: number[] = [];
  let needPause = false;

  // For each case: if the injection guard blocks the text, the model is not called (as in the app).
  // Otherwise call the model, waiting between calls to stay inside the free-tier rate limit.
  for (const c of cases) {
    const runs: { answer: string | null; ms: number }[] = [];
    if (hasPromptInjection(c.input)) {
      runs.push({ answer: null, ms: 0 }); // the guard stops it; the model is never called
    } else {
      for (let run = 0; run < runsPerCase; run++) {
        if (needPause) await sleep(PACE_MS);
        needPause = true;
        const started = performance.now();
        const answer = await assessWithAi(c.input);
        const ms = Math.round(performance.now() - started);
        times.push(ms);
        runs.push({ answer, ms });
      }
    }

    const modelCalled = !hasPromptInjection(c.input);
    // What the app would decide: the model's answer, raised by the phrases, as in assessUrgency().
    const shown = runs.map((r) => (r.answer === "URGENT" || hasUrgentCue(c.input) ? "URGENT" : "ROUTINE"));
    const row = {
      id: c.id,
      category: c.category,
      input: c.input,
      expected: c.expected,
      modelCalled,
      modelAnswers: runs.map((r) => r.answer),
      modelCorrect: modelCalled ? runs.every((r) => r.answer === c.expected) : null,
      finalCorrect: shown.every((s) => s === c.expected),
      ms: runs.map((r) => r.ms),
    };
    results.push(row);
    console.log(`${c.id} ${c.category.padEnd(8)} expected ${c.expected.padEnd(8)} model ${runs.map((r) => r.answer ?? "none").join(",").padEnd(10)} ${runs.map((r) => `${r.ms} ms`).join(", ")}`);
  }

  // Summary: how often the model alone was right, how often the app's final answer was right,
  // how many answers were unusable, and the median and slowest response times.
  const called = results.filter((r) => r.modelCalled);
  times.sort((a, b) => a - b);
  const summary = {
    capturedAt: new Date().toISOString(),
    model: env.llmModel,
    timeoutMs: env.aiTimeoutMs,
    runsPerCase,
    modelCorrect: `${called.filter((r) => r.modelCorrect).length}/${called.length}`,
    finalCorrect: `${results.filter((r) => r.finalCorrect).length}/${results.length}`,
    unusableAnswers: called.flatMap((r) => r.modelAnswers).filter((a) => a === null).length,
    medianMs: times[Math.floor(times.length / 2)] ?? null,
    slowestMs: times.at(-1) ?? null,
  };
  console.log(`\n${JSON.stringify(summary, null, 2)}`);

  // Save the full results to eval/live-ai-results.json, but not for a single --only case.
  if (args.only) return;
  writeFileSync(RESULTS_PATH, `${JSON.stringify({ summary, results }, null, 2)}\n`);
  console.log(`\nWrote ${RESULTS_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
