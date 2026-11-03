// A6 / A7 / A8 Gate 3 — Golden Dataset Evaluation Harness (10 cases, 5 dimensions)
// Compares Week 08 Baseline (pre-fix) against Week 11 Improved (post-fix + prompt injection shield).
// Exits non-zero if Week 11 Improved drops below 10/10 (100%) on any dimension.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CASES = JSON.parse(readFileSync(join("eval", "eval-cases.json"), "utf8"));

// Seeded 4-service catalogue (exact vocabulary from scripts/seed.ts)
const CATALOGUE = [
  {
    id: "counselling",
    name: "Counselling",
    keywords: [
      "stress", "stressed", "anxiety", "anxious", "worry", "panic", "sad", "low mood", "depressed",
      "lonely", "grief", "relationship", "breakup", "family", "overwhelmed", "burnout", "homesick",
      "talk", "counsellor", "therapy", "exam stress", "cannot cope",
    ],
  },
  {
    id: "health-clinic",
    name: "Health clinic",
    keywords: [
      "vaccine", "vaccination", "flu shot", "flu", "fever", "cold", "cough", "sick", "unwell",
      "injury", "headache", "stomach", "medical certificate", "certificate", "nurse", "allergy",
      "prescription", "check up",
    ],
  },
  {
    id: "physiotherapy",
    name: "Physiotherapy",
    keywords: [
      "back pain", "neck pain", "shoulder", "knee", "ankle", "sprain", "sports injury",
      "posture", "muscle", "physio", "rehab", "stretch", "pain",
    ],
  },
  {
    id: "wellbeing-advising",
    name: "Wellbeing advising",
    keywords: [
      "sleep", "sleeping", "insomnia", "tired", "balance", "time management", "money", "finance",
      "budget", "settling in", "international", "visa", "motivation", "procrastination", "habits",
      "wellbeing", "not sure",
    ],
  },
];

const KNOWN_IDS = new Set(CATALOGUE.map((c) => c.id));

// ---------------------------------------------------------------------------
// Week 08 Baseline implementation (reproduced verbatim before Week 10–11 fixes)
// Bug 1: STOPWORDS stripped "in" and "not" BEFORE phrase check, breaking "not sure" / "settling in"
// Bug 2: No prompt-injection detector in ai.ts or keywords.ts
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for", "from", "get", "have",
  "how", "i", "im", "in", "is", "it", "me", "my", "need", "not", "of", "on", "or", "so", "some",
  "that", "the", "to", "want", "was", "with", "would", "you",
]);

function baselineTokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function baselineStem(token) {
  return token.replace(/(ing|ed|es|s)$/u, "");
}

function runBaselinePipeline(text) {
  const injectionBlocked = false; // Week 08 had no prompt-injection pre-filter
  const tokens = baselineTokenize(text);
  let serviceIds = [];
  if (tokens.length > 0) {
    const stems = new Set(tokens.map(baselineStem));
    const joined = " " + tokens.join(" ") + " ";
    const scored = CATALOGUE.map((entry) => {
      let score = 0;
      for (const raw of [...entry.keywords, ...baselineTokenize(entry.name)]) {
        const kw = raw.toLowerCase().trim();
        if (!kw) continue;
        if (kw.includes(" ")) {
          if (joined.includes(" " + kw + " ")) score += 3;
        } else if (tokens.includes(kw)) {
          score += 2;
        } else if (stems.has(baselineStem(kw))) {
          score += 1;
        }
      }
      return { id: entry.id, score };
    });
    serviceIds = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((s) => s.id);
  }
  return { response: { mode: "fallback", serviceIds }, injectionBlocked };
}

// ---------------------------------------------------------------------------
// Load Week 11 Improved implementation directly from src/lib/finder/keywords.ts
// ---------------------------------------------------------------------------
async function loadImprovedModule() {
  const aiSource = readFileSync(join("src", "lib", "finder", "ai.ts"), "utf8");
  if (!/export\s+function\s+isPromptInjection\b/.test(aiSource)) {
    throw new Error("src/lib/finder/ai.ts must export isPromptInjection(text: string): boolean");
  }

  // Strip TypeScript type annotations from live src/lib/finder/keywords.ts and load as pure ESM
  const tsSource = readFileSync(join("src", "lib", "finder", "keywords.ts"), "utf8");
  const jsSource = tsSource
    .replace(/export\s+type\s+CatalogueEntry\s*=\s*\{[\s\S]*?\};/m, "")
    .replace(/:\s*readonly\s+RegExp\[\]/g, "")
    .replace(/:\s*CatalogueEntry\[\]/g, "")
    .replace(/:\s*string\[\]/g, "")
    .replace(/:\s*string/g, "")
    .replace(/:\s*boolean/g, "");
  const encoded = "data:text/javascript;base64," + Buffer.from(jsSource, "utf8").toString("base64");
  const mod = await import(encoded);
  if (typeof mod.rankByKeywords !== "function" || typeof mod.hasPromptInjection !== "function") {
    throw new Error("Could not load rankByKeywords / hasPromptInjection from src/lib/finder/keywords.ts");
  }
  return { rankByKeywords: mod.rankByKeywords, hasPromptInjection: mod.hasPromptInjection };
}

function evaluateSuite(name, runner) {
  const rows = [];
  const totals = {
    correctness: 0,
    safety: 0,
    grounding: 0,
    consistency: 0,
    schemaValidity: 0,
    passed: 0,
  };

  for (const tc of CASES) {
    const run1 = runner(tc.input);
    const run2 = runner(tc.input);
    const run3 = runner(tc.input);
    const { response, injectionBlocked } = run1;

    // 1. Schema Validity: exact { mode, serviceIds } keys, array of strings, max 3, no prose
    const keys = Object.keys(response).sort();
    const schemaValidity =
      keys.length === 2 &&
      keys[0] === "mode" &&
      keys[1] === "serviceIds" &&
      (response.mode === "ai" || response.mode === "fallback") &&
      Array.isArray(response.serviceIds) &&
      response.serviceIds.length <= 3 &&
      response.serviceIds.every((id) => typeof id === "string");

    // 2. Grounding: every suggested ID exists in the seeded 4-service catalogue
    const grounding =
      Array.isArray(response.serviceIds) && response.serviceIds.every((id) => KNOWN_IDS.has(id));

    // 3. Consistency: 3 consecutive evaluations produce identical outputs
    const sig1 = JSON.stringify(run1.response.serviceIds);
    const consistency =
      sig1 === JSON.stringify(run2.response.serviceIds) && sig1 === JSON.stringify(run3.response.serviceIds);

    // 4. Safety: prompt injections must be blocked and yield [], benign inputs must not be blocked
    const safety = tc.expectInjectionBlocked
      ? injectionBlocked === true && response.serviceIds.length === 0
      : injectionBlocked === false;

    // 5. Correctness: matches expected top service or expected empty fallback
    const correctness = tc.expectEmpty
      ? response.serviceIds.length === 0
      : response.serviceIds[0] === tc.expectedTop;

    const pass = schemaValidity && grounding && consistency && safety && correctness;

    if (correctness) totals.correctness++;
    if (safety) totals.safety++;
    if (grounding) totals.grounding++;
    if (consistency) totals.consistency++;
    if (schemaValidity) totals.schemaValidity++;
    if (pass) totals.passed++;

    rows.push({
      id: tc.id,
      category: tc.category,
      expected: tc.expectEmpty ? "[]" : tc.expectedTop,
      actual: response.serviceIds.length ? response.serviceIds.join(",") : "[]",
      injectionBlocked,
      correctness,
      safety,
      grounding,
      consistency,
      schemaValidity,
      pass,
    });
  }

  return { name, rows, totals, count: CASES.length };
}

function pct(n, total) {
  return `${Math.round((n / total) * 100)}%`;
}

async function main() {
  const improved = await loadImprovedModule();

  const baselineResult = evaluateSuite("Baseline (Week 08)", runBaselinePipeline);
  const improvedResult = evaluateSuite("Improved (Week 11)", (text) => ({
    response: { mode: "fallback", serviceIds: improved.rankByKeywords(text, CATALOGUE) },
    injectionBlocked: improved.hasPromptInjection(text),
  }));

  console.log("========================================================================================");
  console.log(" Team 16 — Wellbeing Service Finder AI & Fallback Evaluation (Golden Dataset: 10 Cases)");
  console.log("========================================================================================\n");

  console.log(
    [
      "ID     ",
      "Category",
      "Expected          ",
      "Week 08 Baseline          ",
      "W08 ",
      "Week 11 Improved          ",
      "W11 ",
    ].join(" | "),
  );
  console.log("-".repeat(104));

  for (let i = 0; i < CASES.length; i++) {
    const b = baselineResult.rows[i];
    const m = improvedResult.rows[i];
    console.log(
      [
        b.id.padEnd(7),
        b.category.padEnd(8),
        String(b.expected).padEnd(18),
        b.actual.slice(0, 26).padEnd(26),
        b.pass ? "PASS" : "FAIL",
        m.actual.slice(0, 26).padEnd(26),
        m.pass ? "PASS" : "FAIL",
      ].join(" | "),
    );
  }

  console.log("\n----------------------------------------------------------------------------------------");
  console.log(" 5-Dimension Quality Breakdown (Before vs. After)");
  console.log("----------------------------------------------------------------------------------------");
  const dims = [
    ["Correctness", "correctness"],
    ["Safety (Prompt Injection)", "safety"],
    ["Grounding (Catalogue Allowlist)", "grounding"],
    ["Consistency (Deterministic)", "consistency"],
    ["Schema Validity (JSON Contract)", "schemaValidity"],
    ["OVERALL CASE PASS RATE", "passed"],
  ];

  for (const [label, key] of dims) {
    const bVal = baselineResult.totals[key];
    const mVal = improvedResult.totals[key];
    const tot = CASES.length;
    console.log(
      `  ${label.padEnd(33)} Baseline: ${String(bVal).padStart(2)}/${tot} (${pct(bVal, tot).padStart(4)})   ->   Improved: ${String(mVal).padStart(2)}/${tot} (${pct(mVal, tot).padStart(4)})`,
    );
  }
  console.log("========================================================================================\n");

  if (improvedResult.totals.passed !== CASES.length) {
    console.error(
      `Evaluation gate FAILED: expected ${CASES.length}/${CASES.length} (100%), got ${improvedResult.totals.passed}/${CASES.length}.`,
    );
    process.exit(1);
  }

  console.log(
    `AI evaluation gate PASSED: Baseline ${baselineResult.totals.passed}/${CASES.length} (${pct(baselineResult.totals.passed, CASES.length)}) -> Improved ${improvedResult.totals.passed}/${CASES.length} (${pct(improvedResult.totals.passed, CASES.length)}).`,
  );
}

main().catch((err) => {
  console.error("AI evaluation script crashed:", err);
  process.exit(1);
});
