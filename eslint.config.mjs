// What this file is for: the ESLint rules that check the code for mistakes and bad patterns. It uses the
// official Next.js rule sets (Next.js, React, React Hooks, TypeScript) and lists folders that are skipped.
// When it is used: by `pnpm lint`, locally and in CI on every pull request. Code editors can use it too.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // Next.js, React and React Hooks rules. The "core-web-vitals" version also turns rules that
  // affect page speed from warnings into errors.
  ...nextVitals,
  // Extra rules for TypeScript code (from typescript-eslint).
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Installed skill tooling is vendor code, not application source.
    ".agents/skills/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
