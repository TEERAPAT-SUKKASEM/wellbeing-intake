// What this script does: it runs the app's crisis-phrase rule on every fictional note in
// eval/eval-cases.json and prints a score table, next to the PRD's simple three-keyword idea.
// Why it matters: it is the quality gate for the triage fallback (PRD 3B.2 and TEST-06). CI runs it, and
// it fails if the rule misses an unexpected case or the prompt-injection guard gives a wrong answer.
// How to run it: `pnpm eval:ai` (no API key and no network needed).
/**
 * Scores the deterministic urgency rule on the golden dataset, next to the PRD's first idea of three
 * bare keywords ("crisis", "help", "urgent"). No key and no network, so it can gate CI. Some indirect
 * warning signs cannot be caught by phrases; those cases are marked `keywords_miss` and only the AI
 * catches them. The gate fails on any other miss, and also once a marked case starts passing, so the
 * marks stay accurate. The real model is scored by `pnpm eval:ai:live`.
 */
import { readFileSync } from "node:fs";
import { hasPromptInjection, hasUrgentCue } from "../src/lib/urgency/keywords";

type Case = {
  id: string;
  category: string;
  input: string;
  expected: "ROUTINE" | "URGENT";
  attack: boolean;
  keywords_miss?: boolean;
};

// Load the golden dataset: fictional notes, each with the expected answer (ROUTINE or URGENT).
const cases = JSON.parse(readFileSync("eval/eval-cases.json", "utf8")) as Case[];

// The two rules we compare: the PRD's first idea (three bare keywords) and the real rule the app uses.
const naive = (text: string) => (/\b(?:crisis|help|urgent)\b/i.test(text) ? "URGENT" : "ROUTINE");
const improved = (text: string) => (hasUrgentCue(text) ? "URGENT" : "ROUTINE");

// Scoring: each answer is correct, a missed crisis (URGENT expected, ROUTINE given),
// or a false alarm (ROUTINE expected, URGENT given).
type Tally = { correct: number; missedCrises: number; falseAlarms: number };

function score(rule: (text: string) => string): Tally {
  const tally: Tally = { correct: 0, missedCrises: 0, falseAlarms: 0 };
  for (const c of cases) {
    const answer = rule(c.input);
    if (answer === c.expected) tally.correct++;
    else if (c.expected === "URGENT") tally.missedCrises++;
    else tally.falseAlarms++;
  }
  return tally;
}

// Print one row per case, so a person can read every answer of both rules.
console.log("ID       Category  Expected  3 keywords  Current rule  AI blocked");
for (const c of cases) {
  const blocked = hasPromptInjection(c.input);
  console.log(
    [c.id.padEnd(8), c.category.padEnd(9), c.expected.padEnd(9), naive(c.input).padEnd(11), improved(c.input).padEnd(13), blocked ? "yes" : "no"].join(" "),
  );
}

// Print the totals for both rules.
const before = score(naive);
const after = score(improved);
const line = (label: string, t: Tally) =>
  `${label.padEnd(14)} ${t.correct}/${cases.length} correct, ${t.missedCrises} crises missed, ${t.falseAlarms} false alarms`;
console.log(`\n${line("3 keywords:", before)}\n${line("Current rule:", after)}`);

// Gate check 1: the cases the current rule gets wrong must be exactly the cases marked keywords_miss.
const misses = cases.filter((c) => improved(c.input) !== c.expected).map((c) => c.id);
const marked = cases.filter((c) => c.keywords_miss).map((c) => c.id);
const marksAccurate = misses.join() === marked.join();
console.log(`Known phrase-rule misses, caught only by the AI: ${marked.join(", ") || "none"}`);
if (!marksAccurate) {
  console.error(`The phrase rule missed ${misses.join(", ") || "nothing"}, but the cases marked keywords_miss are ${marked.join(", ") || "none"}.`);
}

// Gate check 2: the prompt-injection guard must flag exactly the cases marked attack: true.
const guardCorrect = cases.every((c) => hasPromptInjection(c.input) === c.attack);
if (!guardCorrect) console.error("The prompt-injection guard gave a wrong answer on this set.");

// Exit code 1 fails CI. Reaching the end means the gate passed.
if (!marksAccurate || !guardCorrect) {
  console.error("Evaluation gate FAILED.");
  process.exit(1);
}
console.log("Evaluation gate PASSED.");
