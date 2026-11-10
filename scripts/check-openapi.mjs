// What this script does: it makes two lists and compares them: every API operation the code has
// (each route.ts under src/app/api/v1 and its GET/POST/PUT/PATCH/DELETE) and every one in openapi.yaml.
// Why it matters: it fails if the lists differ, so the published API contract (openapi.yaml) can never
// drift away from the real code. CI runs it on every pull request.
// How to run it: `pnpm check:openapi`.
//
// Every implemented route must appear in openapi.yaml, and vice versa.
// Dependency-free: reads route files from disk and path keys from the YAML text.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = join("src", "app", "api", "v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
// Development-only contract mock; deliberately not part of the published API.
const UNDOCUMENTED = new Set(["/mock/hub"]);

// Finds every route.ts file inside a folder and its sub-folders.
function* routeFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* routeFiles(full);
    else if (name === "route.ts") yield full;
  }
}

// Step 1: list what the code implements, as "METHOD /path" (for example "GET /requests/me").
const implemented = new Set();
for (const file of routeFiles(API_ROOT)) {
  // The folder path is the URL path. A Next.js folder like [id] becomes the OpenAPI form {id}.
  const path = "/" + relative(API_ROOT, join(file, "..")).split(sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
  if (UNDOCUMENTED.has(path)) continue;
  const source = readFileSync(file, "utf8");
  // A method counts as implemented when the file exports a handler with that name,
  // for example `export async function GET` or `export const POST`.
  for (const m of METHODS) {
    if (new RegExp(`export (const|async function) ${m}\\b`).test(source)) implemented.add(`${m} ${path}`);
  }
}

// Step 2: read openapi.yaml and check that it declares OpenAPI version 3.1.
const yaml = readFileSync("openapi.yaml", "utf8");
if (!/^openapi:\s*["']?3\.1/m.test(yaml)) {
  console.error("openapi.yaml must declare OpenAPI 3.1.x");
  process.exit(1);
}
// Step 3: list what openapi.yaml documents. Inside the `paths:` section, a key indented by 2 spaces
// is a path, and a key indented by 4 spaces (get, post, ...) is a method of that path.
const documented = new Set();
let current = null;
let inPaths = false;
for (const line of yaml.split(/\r?\n/)) {
  if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
  if (inPaths && /^\S/.test(line)) inPaths = false;
  if (!inPaths) continue;
  const p = line.match(/^ {2}(\/[^:\s]*):\s*$/);
  if (p) { current = p[1]; continue; }
  const m = line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
  if (m && current) documented.add(`${m[1].toUpperCase()} ${current}`);
}

// Step 4: compare. "missing" = in the code but not documented. "stale" = documented but not in the code.
// Any difference prints the list and exits with code 1, which fails CI.
const missing = [...implemented].filter((r) => !documented.has(r)).sort();
const stale = [...documented].filter((r) => !implemented.has(r)).sort();
if (missing.length || stale.length) {
  if (missing.length) console.error("Implemented but not in openapi.yaml:\n  " + missing.join("\n  "));
  if (stale.length) console.error("In openapi.yaml but not implemented:\n  " + stale.join("\n  "));
  process.exit(1);
}
console.log(`openapi.yaml matches the implementation: ${implemented.size} operations.`);
