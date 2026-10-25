// module-structure-doc.test.js — MODULE_STRUCTURE.md 構造ツリーの実体整合ガード。
//
// 手書きの構造ツリーは新規ファイル追加のたびに陳腐化する実績があるため、
// ツリーに「記載されたパスが実在 (git管理下) する」ことのみ機械検査する。
// 逆方向 (全ファイルがツリー掲載) は検査しない — ツリーは主要構成の俯瞰で
// あり、新規ファイルのたびにdoc更新を強制すると即座に陳腐化するため。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// パスtoken (拡張子つき)。test/logic.test.js や .github/ のような相対パス・
// dotfile を許す一方、日本語注釈 (deploy等の単語、・入りの語) に誤マッチ
// しないよう拡張子は実際にツリーで使われる種類に限定。
const PATH_TOKEN = /^[A-Za-z0-9._/-]+\.(md|js|json|html|css|svg|png|xml|txt|yml|yaml)$/;

// ツリー行は「├── <パス...>  注釈」形式で、1行に複数パスと日本語注釈が混在する。
// パスは「/終わり」か「拡張子つきファイル名」か「*入りのglob」で書くこと。
export function extractTreeEntries(md) {
  const block = md.match(/```text\n([\s\S]*?)```/)?.[1];
  assert.ok(block, "MODULE_STRUCTURE.md に ```text 構造ツリーが無い (テストの前提が崩れた)");
  const entries = [];
  for (const line of block.split("\n")) {
    const content = line.replace(/[│├└─]+\s*/g, "").trim();
    if (!content || content === ".") continue;
    for (const token of content.split(/\s+/)) {
      if (token.endsWith("/") || token.includes("*") || PATH_TOKEN.test(token)) {
        entries.push(token);
      }
    }
  }
  return entries;
}

// git管理下の実体に対する未解決entryを返す (空配列なら全て実在)。
export function missingEntries(md, trackedFiles) {
  const tracked = new Set(trackedFiles);
  const missing = [];
  for (const entry of extractTreeEntries(md)) {
    const prefix = entry.replace(/\*.*$/, ""); // glob → 存在確認は直前のdirまで
    const dirPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const ok = tracked.has(prefix)
      || [...tracked].some((f) => f.startsWith(dirPrefix));
    if (!ok) missing.push(entry);
  }
  return missing;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

test("構造ツリーに記載されたパスはすべてgit管理下に実在する", async () => {
  const md = await readFile(path.join(repoRoot, ".module/MODULE_STRUCTURE.md"), "utf8");
  const entries = extractTreeEntries(md);
  assert.ok(entries.length >= 5,
    `ツリーからのパス抽出が過少 (${entries.length}件) — ツリー形式が変わってparse不能になっていないか`);
  const missing = missingEntries(md, trackedFiles());
  assert.deepEqual(missing, [],
    `MODULE_STRUCTURE.md の構造ツリーに実在しないパス: ${missing.join(", ")} — ` +
    "ツリーを実体に合わせて更新するか、そのパスを追加すること");
});

test("パーサは実在しないパスの混入を検知する (ドリフト検知の負方向確認)", () => {
  const bogus = "```text\n.\n├── content/\n└── this-file-does-not-exist.js\n```\n";
  const missing = missingEntries(bogus, ["content/blog/index.html", "README.md"]);
  assert.deepEqual(missing, ["this-file-does-not-exist.js"],
    "実在しないパスを検知できていない — ドリフト検知が機能していない");
});
