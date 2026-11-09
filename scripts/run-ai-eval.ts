/**
 * Scores the deterministic urgency rule on the golden dataset, next to the PRD's first idea of three
 * bare keywords ("crisis", "help", "urgent"). No key and no network, so it can gate CI: it fails if the
 * rule misses a case. The real model is scored by `pnpm eval:ai:live`.
 */
import { readFileSync } from "node:fs";
import { hasPromptInjection, hasUrgentCue } from "../src/lib/urgency/keywords";

type Case = { id: string; category: string; input: string; expected: "ROUTINE" | "URGENT"; attack: boolean };

const cases = JSON.parse(readFileSync("eval/eval-cases.json", "utf8")) as Case[];

const naive = (text: string) => (/\b(?:crisis|help|urgent)\b/i.test(text) ? "URGENT" : "ROUTINE");
const improved = (text: string) => (hasUrgentCue(text) ? "URGENT" : "ROUTINE");

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

console.log("ID       Category  Expected  3 keywords  Current rule  AI blocked");
for (const c of cases) {
  const blocked = hasPromptInjection(c.input);
  console.log(
    [c.id.padEnd(8), c.category.padEnd(9), c.expected.padEnd(9), naive(c.input).padEnd(11), improved(c.input).padEnd(13), blocked ? "yes" : "no"].join(" "),
  );
}

const before = score(naive);
const after = score(improved);
const line = (label: string, t: Tally) =>
  `${label.padEnd(14)} ${t.correct}/${cases.length} correct, ${t.missedCrises} crises missed, ${t.falseAlarms} false alarms`;
console.log(`\n${line("3 keywords:", before)}\n${line("Current rule:", after)}`);

const guardCorrect = cases.every((c) => hasPromptInjection(c.input) === c.attack);
if (!guardCorrect) console.error("The prompt-injection guard gave a wrong answer on this set.");

if (after.correct !== cases.length || !guardCorrect) {
  console.error("Evaluation gate FAILED.");
  process.exit(1);
}
console.log("Evaluation gate PASSED.");
