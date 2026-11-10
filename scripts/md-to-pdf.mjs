// What this script does: it turns a Markdown document (for example docs/PRD.md) into a PDF file, using
// a Chrome or Edge browser that runs in the background with no window.
// Why it matters: it makes printable PDF copies of the project documents, with diagrams drawn. It is a
// documentation tool only; it does not touch the app or the database.
// How to run it: `pnpm docs:pdf docs/PRD.md` (same as `node scripts/md-to-pdf.mjs <file.md> [out.pdf]`).
//
// Renders a Markdown file (GitHub-style, with mermaid diagrams) to PDF using headless Chrome/Edge.
// Usage: node scripts/md-to-pdf.mjs docs/PRD.md   (any Markdown file; writes the PDF next to it)
// Needs internet once per run: marked and mermaid are loaded from the jsDelivr CDN.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Step 1: read the input file name. The PDF goes next to it unless a second name is given.
const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/md-to-pdf.mjs <file.md> [out.pdf]");
  process.exit(1);
}
const output = resolve(process.argv[3] ?? input.replace(/\.md$/i, ".pdf"));

// Step 2: find an installed Chrome or Edge (CHROME_PATH first, then the usual install folders).
const browser = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!browser) {
  console.error("No Chrome or Edge found. Set CHROME_PATH.");
  process.exit(1);
}

// Relative links (../openapi.yaml) are dead inside a PDF, so resolve them against the GitHub repo.
let base = "";
try {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim().replace(/\.git$/, "");
  const dirInRepo = dirname(relative(process.cwd(), resolve(input))).replaceAll("\\", "/");
  if (remote.startsWith("https://github.com/")) base = `<base href="${remote}/blob/main/${dirInRepo}/">`;
} catch {
  // not a git checkout — leave links as they are
}

// Local images are inlined as data URIs so the PDF never depends on what has been pushed.
const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml" };
const markdown = readFileSync(input, "utf8").replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (whole, open, src, close) => {
  const file = resolve(dirname(input), src);
  const type = mime[extname(file).toLowerCase()];
  if (/^[a-z]+:/i.test(src) || !type || !existsSync(file)) return whole;
  return `${open}data:${type};base64,${readFileSync(file).toString("base64")}${close}`;
});
// Step 3: build one HTML page: print styles, the Markdown text, and a small script that turns the
// Markdown into HTML (marked) and draws the diagrams (mermaid) inside the browser.
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">${base}<title>${basename(input, ".md")}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font: 10.5pt/1.5 "Segoe UI", system-ui, sans-serif; color: #1a1a1a; }
  h1 { font-size: 20pt; border-bottom: 2px solid #1a1a1a; padding-bottom: 4pt; }
  h2 { font-size: 14pt; margin-top: 20pt; border-bottom: 1px solid #bbb; padding-bottom: 2pt; break-after: avoid; }
  h3 { font-size: 11.5pt; margin-top: 14pt; break-after: avoid; }
  a { color: #0b57a4; text-decoration: none; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9pt; }
  th, td { border: 1px solid #c8c8c8; padding: 3pt 5pt; vertical-align: top; text-align: left; }
  th { background: #eef1f4; }
  tr { break-inside: avoid; }
  code { font: 8.5pt Consolas, "Cascadia Mono", monospace; background: #f1f3f5; padding: 0 2pt; border-radius: 2pt; }
  pre { background: #f6f8fa; border: 1px solid #dde1e5; border-radius: 3pt; padding: 6pt 8pt; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
  pre code { background: none; padding: 0; }
  /* max-height keeps a tall screenshot on the same page as its caption */
  img { max-width: 100%; max-height: 175mm; border: 1px solid #c8c8c8; break-inside: avoid; }
  p:not(:has(img)):has(+ p > img) { break-after: avoid; } /* a caption stays with its image; images are not chained together */
  blockquote { margin: 8pt 0; padding: 2pt 10pt; border-left: 3px solid #999; color: #444; }
  /* A diagram gets its own page, and the heading above it comes along instead of being orphaned. */
  .mermaid { break-before: page; break-after: page; text-align: center; }
  :is(h2, h3):has(+ .mermaid) { break-before: page; }
  :is(h2, h3) + .mermaid { break-before: avoid; }
  .mermaid svg { max-width: 100%; max-height: 238mm; height: auto; }
</style></head><body>
<div id="doc"></div>
<script id="src" type="application/json">${JSON.stringify(markdown).replace(/</g, "\\u003c")}</script>
<script type="module">
  import { marked } from "https://cdn.jsdelivr.net/npm/marked@14/lib/marked.esm.js";
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  const doc = document.getElementById("doc");
  doc.innerHTML = marked.parse(JSON.parse(document.getElementById("src").textContent), { gfm: true });
  for (const code of doc.querySelectorAll("pre > code.language-mermaid")) {
    const div = document.createElement("div");
    div.className = "mermaid";
    div.textContent = code.textContent;
    code.parentElement.replaceWith(div);
  }
  mermaid.initialize({ startOnLoad: false, theme: "neutral", er: { useMaxWidth: true } });
  await mermaid.run({ querySelector: ".mermaid" });
  document.title = "rendered";
</script></body></html>`;

// Step 4: save the page in a temporary folder, ask the headless browser to print it to PDF, and always
// delete the temporary folder afterwards.
const dir = mkdtempSync(join(tmpdir(), "md-to-pdf-"));
const page = join(dir, "page.html");
writeFileSync(page, html);
try {
  execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--virtual-time-budget=30000",
      `--user-data-dir=${join(dir, "profile")}`,
      `--print-to-pdf=${output}`,
      pathToFileURL(page).href,
    ],
    { stdio: "ignore" },
  );
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}
console.log(`Wrote ${output}`);
