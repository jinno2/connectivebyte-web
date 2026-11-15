/** x-discover 検証手順 (README コマンド節・AGENTS.md) と恒久テスト実装の整合性ガード。
 *
 * docs 8b48e86 で修正した不一致 (恒久テスト test_persona_gate.py / test_llm_backend.py
 * が検証手順から漏っていた) の回帰防止。恒久テストの追加・削除・テストメソッド件数の
 * 変動が docs に反映されていないとき、docs が実在しないテストを記載したときにfailする。
 * 恒久テストを増減するときは README コマンド節と AGENTS.md 検証手順行を併せて更新する。 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const xDiscoverDir = path.join(repoRoot, "scripts", "x-discover");

// 恒久テストの実体 (scripts/x-discover/test_*.py) とテストメソッド実数
const permanentTests = readdirSync(xDiscoverDir)
  .filter((f) => /^test_.+\.py$/.test(f))
  .sort()
  .map((file) => ({
    file,
    methodCount: (readFileSync(path.join(xDiscoverDir, file), "utf8").match(/^    def test_/gm) ?? []).length,
  }));
assert.ok(permanentTests.length >= 2, "test_*.py が2件検出できない (テストの前提が崩れた)");

const readmeMd = readFileSync(path.join(xDiscoverDir, "README.md"), "utf8");

// README の「## コマンド」節を切り出す
function commandSection(md) {
  const start = md.indexOf("## コマンド");
  assert.ok(start !== -1, "README に「## コマンド」節がない (テストの前提が崩れた)");
  const rest = md.slice(start);
  const next = rest.indexOf("\n## ", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

const commandsMd = commandSection(readmeMd);
// コマンド節に記載された恒久テスト起動行 (python3 test_*.py)
const documentedTests = [...commandsMd.matchAll(/^python3 (test_.+?\.py)\b/gm)].map((m) => m[1]);

const agentsMd = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");

test("恒久テスト: test_*.py 実在集合とREADME コマンド節の記載は双方向で一致する", () => {
  const actual = permanentTests.map((t) => t.file);
  for (const file of actual) {
    assert.ok(documentedTests.includes(file), `${file} がREADME コマンド節に記載されていない`);
  }
  for (const file of documentedTests) {
    assert.ok(actual.includes(file), `READMEが実在しない恒久テスト ${file} を記載している`);
  }
});

test("恒久テスト: README の件数主張はテストメソッド実数と一致する", () => {
  for (const { file, methodCount } of permanentTests) {
    const line = commandsMd.split("\n").find((l) => l.startsWith(`python3 ${file}`));
    assert.ok(line, `README に「python3 ${file}」行がない`);
    const claimed = line.match(/恒久テスト(\d+)件/);
    assert.ok(claimed, `${file} 行に「恒久テストN件」の件数主張がない: ${line.trim()}`);
    assert.equal(Number(claimed[1]), methodCount, `${file} の件数主張がメソッド実数 (${methodCount}) と不一致`);
  }
});

test("恒久テスト: AGENTS.md のx-discover検証手続行は全test_*.pyとdry-run検証を網羅する", () => {
  const line = agentsMd.split("\n").find((l) => l.includes("恒久テスト (`python3 "));
  assert.ok(line, "AGENTS.md に恒久テストを含む検証手続行がない");
  for (const { file } of permanentTests) {
    assert.ok(line.includes(file), `AGENTS.md 検証手続行に ${file} の記載がない`);
  }
  assert.ok(line.includes("post.py --dry-run"), "検証手続から post.py --dry-run が消えている");
  assert.ok(line.includes("collect.py --dry"), "検証手続から collect.py --dry が消えている");
});
