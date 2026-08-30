// publication-guard.test.js — 公開面への機密用語混入を防ぐ静的ガード。
//
// このrepoはpublic (GH Pages配信)。commitしたものは履歴含めすべて公開される。
// 非公開管理の成熟度モデル詳細定義に由来する用語・語句を、公開ファイルから
// 検出したらfailさせる。語の追加は自由。削除・無効化は人間承認を要する
// (承認なき弱体化 = 混入事故の再発経路になるため)。
//
// 注意: 一般論版の診断質問 (logic.js DIAGNOSTIC_QUESTIONS / DETAILED_QUESTIONS) は
// 意図的に一般語で書き直してあるため、ここで検出しない。guard語の追加時は
// 先に npm test で現行資産に誤検出しないことを確認すること。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// BANNED_TERMS: このリストの語すべてに対応する正規表現が BANNED_PATTERNS に
// 必要 (下の同期testが機械保証する)。pattern側だけの追加 (複合正規表現) は可。
const BANNED_TERMS = Object.freeze([
  "知能接続",
  "CIL",
  "フロンティア未認知",
  "接触・差異未認識",
  "性能差認識",
  "限界タスク",
  "新規仕事創出",
  "フロンティア限界到達",
  "ハーネス",
  "自己進化システム",
  "自己増殖",
  "ビジネス増殖",
  "事業生態系",
  "経済合理性最適化",
  "知能フロンティア",
  "exit_condition",
  "フロンティアモデル",
  "能力境界",
  "成功一件当たり",
  "要求品質を満たした",
  "評価、比較、選択、反映、監視",
  "資本、顧客、データ、技術、ブランド、信用、人材、権利"
]);

const BANNED_PATTERNS = Object.freeze([
  /知能接続/,
  /\bCIL\b/,
  /フロンティア未認知/,
  /接触・差異未認識/,
  /性能差認識/,
  /限界タスク/,
  /新規仕事創出/,
  /フロンティア限界到達/,
  /ハーネス/,
  /自己進化システム/,
  /自己増殖/,
  /ビジネス増殖/,
  /事業生態系/,
  /経済合理性最適化/,
  /知能フロンティア/,
  /exit_condition/,
  /フロンティアモデル/,
  /能力境界/,
  /成功一件当たり/,
  /要求品質を満たした/,
  /評価、比較、選択、反映、監視/,
  /資本、顧客、データ、技術、ブランド、信用、人材、権利/,
  /L1[01]/,
  /レベル0[–-]11/
]);

// test/ 自身は禁止語を文字列として含むため対象外。それ以外のgit管理ファイル全件。
function trackedPublicFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return out.split("\n").filter((f) => f && !f.startsWith("test/"));
}

test("公開ファイルに詳細定義由来の用語が混入していない", async () => {
  const files = trackedPublicFiles();
  // スキャンが空回りしていないことの保証 (主要公開資産が対象に含まれるか)
  for (const must of ["index.html", "logic.js", "app.js", "README.md"]) {
    assert.ok(files.includes(must), `${must} が走査対象にない — git ls-files 状態を確認`);
  }
  const violations = [];
  for (const file of files) {
    let content;
    try {
      content = await readFile(path.join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(content)) violations.push(`${file}: /${pattern.source}/`);
    }
  }
  if (violations.length > 0) {
    assert.fail([
      "公開禁止語を検出した — 一般論の表現へ書き直すこと。",
      "guard語の削除・無効化は人間承認が必要 (publication-guard.test.js 参照):",
      ...violations
    ].join("\n"));
  }
});

test("BANNED_TERMS と BANNED_PATTERNS が同期している (片方だけ追加する事故の防止)", () => {
  const patternSources = new Set(BANNED_PATTERNS.map((p) => p.source));
  for (const term of BANNED_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.ok(
      patternSources.has(escaped) || patternSources.has(`\\b${escaped}\\b`),
      `BANNED_TERMS の「${term}」に対応する pattern がない — 両方に追加すること`
    );
  }
});
