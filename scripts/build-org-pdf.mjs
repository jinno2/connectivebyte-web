#!/usr/bin/env node
// build-org-pdf.mjs — 17-org-pdf 記入式様式の完成PDF生成 (2026-09-10 残課題#4・r4 F8)。
//
// 入力: content/17-org-pdf/index.html の <pre id="asset-body"> (studio approved r5 と
// byte一致検証済みのweb側写し)。出力: content/17-org-pdf/organization-guide.pdf。
// markdown→print HTML変換はこのscript内で完結 (本scriptが唯一の生成源・commit対象は
// 生成済みPDF。再生成: node scripts/build-org-pdf.mjs)。
//
// 変換方針 (主張不変・紙面のための表現変換のみ):
// - 「（記入）」cellは空欄+記入高さに (手書き可能に)
// - 紙面では相対linkが機能しないため絶対URL併記に変換
// - 「## CTA」見出しは工程用語のため読者面から隠し、申込linkを目立つboxへ
// 依存: headless chromium (CHROME_BIN override可。無ければ chromium/chromium-browser/
// google-chrome/playwright cacheを順に探す)。日本語fontはシステムのNoto Sans CJK等。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = join(root, "content/17-org-pdf/index.html");
const outPath = join(root, "content/17-org-pdf/organization-guide.pdf");
const BASE_URL = "https://lab.connectivebyte.com";

function chromeBinary() {
  // snap版chromiumは/tmpを読めない(-private tmp)ため、deb版の絶対pathを優先する。
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome", "/usr/bin/chromium-browser",
    `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux/chrome`,
    `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux/chrome`,
    "chromium"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { execFileSync(candidate, ["--version"], { stdio: "ignore" }); return candidate; }
    catch { /* 次候補へ */ }
  }
  throw new Error("headless chromium が見つからない (CHROME_BIN で指定可)");
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 紙面用のlink表現: [label](relative#anchor) → label（lab.connectivebyte.com/#anchor）
function inline(text) {
  return escapeHtml(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (all, label, href) => {
    const anchor = href.split("#")[1];
    const shown = anchor ? `${BASE_URL.replace(/^https?:\/\//, "")}/#${anchor}` : href.replace(/^https?:\/\//, "");
    return `${label}（${shown}）`;
  });
}

// markdown (この様式が使うsubset: 見出し/段落/箇条書き/表/link) → print HTML。
function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let inList = false, tableOpen = false, pendingSheet = false, pendingCta = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const closeTable = () => { if (tableOpen) { out.push("</tbody></table>"); tableOpen = false; } };
  for (const line of lines) {
    if (line.startsWith("# ")) continue; // titleはtemplate側でkicker付きで置く
    if (line.startsWith("## ")) {
      closeList(); closeTable();
      pendingSheet = line.includes("部門シート");
      pendingCta = line.trim() === "## CTA";
      if (!pendingCta) out.push(`<h2>${inline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue; // 区切り行
      if (!tableOpen) {
        out.push(`<table${pendingSheet ? ' class="sheet"' : ""}><thead><tr>`
          + cells.map((cell) => `<th>${inline(cell)}</th>`).join("") + "</tr></thead><tbody>");
        tableOpen = true; pendingSheet = false;
      } else {
        out.push("<tr>" + cells.map((cell) => cell === "（記入）" ? '<td class="blank"></td>' : `<td>${inline(cell)}</td>`).join("") + "</tr>");
      }
      continue;
    }
    closeTable();
    if (line.startsWith("- ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.trim().length === 0) continue;
    if (pendingCta) { out.push(`<p class="apply-box">${inline(line)}</p>`); pendingCta = false; continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeTable();
  return out.join("\n");
}

const html = readFileSync(pagePath, "utf8");
const pre = html.match(/<pre id="asset-body">([\s\S]*?)<\/pre>/);
if (!pre) throw new Error("asset-body が見つからない");
const markdown = pre[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();

const printHtml = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 17mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans CJK JP", "Noto Sans JP", "IPAGothic", sans-serif; font-size: 10.5pt; line-height: 1.75; color: #101c2c; margin: 0; }
  h1 { font-size: 17pt; letter-spacing: .02em; margin: 0 0 4pt; }
  .kicker { color: #499b95; font-size: 8pt; font-weight: 700; letter-spacing: .18em; margin: 0 0 6pt; }
  h2 { font-size: 12pt; margin: 16pt 0 6pt; padding-left: 7pt; border-left: 3pt solid #c8ff52; break-after: avoid; }
  p { margin: 6pt 0; }
  ul { margin: 6pt 0; padding-left: 14pt; }
  li { margin: 3pt 0; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; break-inside: avoid; }
  th, td { border: .6pt solid #82909f; padding: 5pt 7pt; text-align: left; vertical-align: top; font-size: 9.5pt; }
  th { background: #f0f3f6; font-weight: 700; }
  table.sheet td.blank { height: 34pt; background: #fcfdfe; }
  .apply-box { margin: 14pt 0 4pt; padding: 9pt 11pt; background: #101c2c; color: #ffffff; font-weight: 700; }
  .footer { margin-top: 18pt; padding-top: 7pt; border-top: .6pt solid #82909f; font-size: 8pt; color: #5b6673; }
</style></head>
<body>
<p class="kicker">FOR ORGANIZATIONS — 記入式</p>
<h1>部門別・AI活用診断</h1>
${markdownToHtml(markdown)}
<div class="footer">ConnectiveByte — ${BASE_URL.replace(/^https?:\/\//, "")}　|　この様式の実施支援: ${BASE_URL.replace(/^https?:\/\//, "")}/#apply</div>
</body></html>`;

// 一時HTMLはrepo直下に置く (snap chromiumの/tmp不達を避ける。終了時に必ず削除)。
const workDir = mkdtempSync(join(root, ".org-pdf-build-"));
try {
  const htmlPath = join(workDir, "organization-guide.html");
  writeFileSync(htmlPath, printHtml);
  execFileSync(chromeBinary(), [
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--print-to-pdf=" + outPath, "--no-pdf-header-footer",
    "file://" + htmlPath
  ], { stdio: "ignore" });
  const pdf = readFileSync(outPath);
  if (pdf.length < 5000 || pdf.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error(`PDF生成が不自然 (${pdf.length} bytes)`);
  }
  console.log(`organization-guide.pdf: ${(pdf.length / 1024).toFixed(1)} KB`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
