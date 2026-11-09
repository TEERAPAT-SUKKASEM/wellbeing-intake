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

config({ path: ".env.local" });
config({ path: ".env" });

const SECRET_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "HUB_SIGNING_SECRET",
  "HUB_INBOUND_SECRET",
  "HUB_MACHINE_TOKEN",
  "DISPATCH_TOKEN",
  "ACCESS_KEY_SECRET",
  "LLM_API_KEY",
];
// Names that must never appear in client code even when the value is unknown at scan time.
const FORBIDDEN_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "service_role"];

const STATIC_ROOT = ".next/static";
const roots = [STATIC_ROOT, ".next/server/app", ".next/server/pages"].filter(existsSync);
if (!existsSync(STATIC_ROOT)) {
  console.error("No .next/static directory — run `pnpm build` first.");
  process.exit(1);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const secrets = SECRET_VARS.map((name) => ({ name, value: process.env[name] })).filter((s) => s.value && s.value.length >= 8);
const findings = [];
let scanned = 0;

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

if (findings.length) {
  console.error("Secret material found in the client bundle:\n" + findings.join("\n"));
  process.exit(1);
}
console.log(`Browser-deliverable output clean: ${scanned} files scanned, ${secrets.length} secret values and ${FORBIDDEN_NAMES.length} forbidden names checked.`);
