// x-discover-sources.test.js — 素材源のdocs↔実装整合ガード。
//
// v0からcollect.py docstringとGENRES.mdが未実装のRedditを素材源として記載し
// 続けた放置 (2026-10-12 b2c6158で修正) への回帰防止。docs側の構造化された
// 素材源列挙 — GENRES.md「素材源 v0 = …」行とcollect.py docstring冒頭の
// 「…から候補を集め」列挙 — に載せた素材源は、collect.pyにcollect_<名前>
// 収集関数が実装されていない限り書けないことを保証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadCollectors() {
  const collectPy = await readFile(
    path.join(repoRoot, "scripts/x-discover/collect.py"), "utf8");
  const collectors = new Set(
    [...collectPy.matchAll(/^def (collect_\w+)\(/gm)].map((m) => m[1]));
  assert.ok(collectors.size > 0, "collect.py に collect_* 関数が1つも無い");
  return { collectPy, collectors };
}

// 素材源表示名は先頭語 (括弧注記・"search"等の修飾を除く) をsnake小文字化した
// 収集関数名の慣例に載る: "HN (Algolia・keyless)" -> collect_hn,
// "GitHub search (keyless)" -> collect_github。
function requiredCollector(sourceLabel) {
  const first = sourceLabel.trim().split(/[\s(]/)[0];
  assert.ok(first, `素材源表示名が空: ${JSON.stringify(sourceLabel)}`);
  return `collect_${first.toLowerCase()}`;
}

function assertImplemented(sourceLabel, collectors) {
  const fn = requiredCollector(sourceLabel);
  assert.ok(collectors.has(fn),
    `素材源「${sourceLabel}」の収集関数 ${fn} が collect.py に無い — ` +
    "未実装の素材源をdocsに記載しない (Reddit放置回帰)");
}

test("GENRES.md素材源v0行の各素材源はcollect.pyに収集関数が実装されている", async () => {
  const { collectors } = await loadCollectors();
  const genres = await readFile(
    path.join(repoRoot, "scripts/x-discover/GENRES.md"), "utf8");
  const line = genres.match(/^- 素材源 v0 = (.+)$/m)?.[1];
  assert.ok(line, "GENRES.md に「素材源 v0 = …」行が無い");
  const sources = line.split("+").map((s) => s.trim()).filter(Boolean);
  assert.ok(sources.length > 0, "素材源v0行の列挙が空");
  for (const src of sources) assertImplemented(src, collectors);
});

test("collect.py docstring冒頭の素材源列挙も実装と一致している", async () => {
  const { collectPy, collectors } = await loadCollectors();
  // docstringは行折返しを持つので空白正規化してから抜き出す。
  const doc = collectPy.match(/"""([\s\S]*?)"""/)?.[1];
  assert.ok(doc, "collect.py にdocstringが無い");
  const listed = doc.replace(/\s+/g, " ")
    .match(/ジャンル \(GENRES\.md\) で (.+?) から\s*候補を集め/)?.[1];
  assert.ok(listed, "docstringに素材源列挙「…から候補を集め」が無い");
  const sources = listed.split("/").map((s) => s.trim()).filter(Boolean);
  assert.ok(sources.length > 0, "docstringの素材源列挙が空");
  for (const src of sources) assertImplemented(src, collectors);
});
