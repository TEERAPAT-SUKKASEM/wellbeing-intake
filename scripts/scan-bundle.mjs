// What this script does: after a production build, it searches every file a browser can download for
// server secrets: the real values of secret environment variables, and forbidden names like "service_role".
// Why it matters: a "secret in the client bundle" means a private key was copied into the JavaScript or
// HTML that is sent to every visitor, where anyone could read it. CI fails the build if this happens.
// How to run it: `pnpm build` first, then `pnpm scan:bundle`.
//
// Fail if any server secret reached what the browser can download.
// Run after `pnpm build`. Two roots:
//   .next/static      — client JS/CSS: secret VALUES and forbidden NAMES are both checked
//   .next/server/app  — only the prerendered artefacts served to browsers (.html, .rsc, .body,
//                       *.segments/*): secret VALUES only, because server code legitimately
//                       names the service role.
// Responses of dynamic routes are rendered per request and are not covered by a static scan.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

// Load the real secret values from .env.local, then .env, so we know exactly what to search for.
config({ path: ".env.local" });
config({ path: ".env" });

// Server-only secrets. None of their values may ever appear in browser files.
const SECRET_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "HUB_SIGNING_SECRET",
  "HUB_INBOUND_SECRET",
  "HUB_MACHINE_TOKEN",
  "DISPATCH_TOKEN",
  "ACCESS_KEY_SECRET",
  "LLM_API_KEY",
  "HELPDESK_REFERRAL_TOKEN",
  "HELPDESK_WEBHOOK_SECRET",
];
// Names that must never appear in client code even when the value is unknown at scan time.
const FORBIDDEN_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "service_role"];

// The build output folders to scan. The build must exist first.
const STATIC_ROOT = ".next/static";
const roots = [STATIC_ROOT, ".next/server/app", ".next/server/pages"].filter(existsSync);
if (!existsSync(STATIC_ROOT)) {
  console.error("No .next/static directory — run `pnpm build` first.");
  process.exit(1);
}

// Lists every file inside a folder, including all sub-folders.
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Keep only secrets that are set and at least 8 characters long; very short values would match by chance.
const secrets = SECRET_VARS.map((name) => ({ name, value: process.env[name] })).filter((s) => s.value && s.value.length >= 8);
const findings = [];
let scanned = 0;

// Read each browser file and record every secret value it contains. In the client JS/CSS folder,
// also record any forbidden name.
for (const root of roots) {
  const isStatic = root === STATIC_ROOT;
  for (const file of walk(root)) {
    const normalized = file.split("\\").join("/");
    const wanted = isStatic
      ? /\.(js|mjs|css|map|json|html|txt)$/.test(normalized)
      : /\.(html|rsc|body)$/.test(normalized) || normalized.includes(".segments/");
    if (!wanted) continue;
    scanned++;
    const text = readFileSync(file, "utf8");
    for (const s of secrets) if (text.includes(s.value)) findings.push(`${file}: contains the VALUE of ${s.name}`);
    if (isStatic) for (const n of FORBIDDEN_NAMES) if (text.includes(n)) findings.push(`${file}: mentions ${n}`);
  }
}

// Any finding prints the file names and exits with code 1, which fails CI.
if (findings.length) {
  console.error("Secret material found in the client bundle:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(`Browser-deliverable output clean: ${scanned} files scanned, ${secrets.length} secret values and ${FORBIDDEN_NAMES.length} forbidden names checked.`);
